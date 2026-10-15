import {
  opendir,
  lstat,
  open,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import ignore from 'ignore';

// Native limits and exclusions cannot be relaxed by a remote room participant.
export const PROJECT_POLICY = {
  maxFiles: 2000,
  maxEntries: 50000,
  maxDepth: 30,
  maxPathLength: 240,
  maxFileBytes: 256 * 1024,
  excludedDirectories: [
    '.git',
    '.hg',
    '.svn',
    'node_modules',
    'dist',
    'build',
    'target',
    'coverage',
    '.next',
    '.venv',
    'venv',
    '__pycache__',
    '.bytebridge-data',
    '.aws',
    '.ssh',
    '.gnupg',
  ],
};

const digest = (value: Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

const safePath = (value: string) =>
  value.length > 0 &&
  value.length <= PROJECT_POLICY.maxPathLength &&
  !/[\\:\x00-\x1f\x7f]/.test(value) &&
  value.split('/').every((part) => part && part !== '.' && part !== '..');

const excludedName = (name: string) =>
  /^\.env(?:\.|$)/i.test(name) ||
  /^\.bytebridge-save-/i.test(name) ||
  /\.(pem|key|p12|pfx|keystore)$/i.test(name) ||
  /^(\.npmrc|\.netrc|\.pypirc|id_rsa|id_ecdsa|id_ed25519|credentials(?:\.json)?|secrets?\..+)$/i.test(
    name,
  );

const binaryExtension =
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|exe|dll|so|dylib|woff2?|ttf|mp[34]|mov|sqlite|db)$/i;

async function boundedRead(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const stat = await handle.stat();

    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > PROJECT_POLICY.maxFileBytes
    )
      throw new Error('File is too large, linked, or not a regular file.');

    const buffer = Buffer.alloc(PROJECT_POLICY.maxFileBytes + 1);
    let size = 0;

    while (size < buffer.length) {
      const result = await handle.read(
        buffer,
        size,
        buffer.length - size,
        size,
      );

      if (!result.bytesRead) break;

      size += result.bytesRead;
    }

    if (size > PROJECT_POLICY.maxFileBytes)
      throw new Error('File exceeds the size limit.');

    const bytes = buffer.subarray(0, size);
    const content = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);

    if (/[\x00-\x08\x0e-\x1f]/.test(content))
      throw new Error('Only UTF-8 text files can be opened.');

    return { content, hash: digest(bytes), stat };
  } finally {
    await handle.close();
  }
}

type Entry = { id: string; path: string; size: number };

type Baseline = { hash: string; dev: number; ino: number; mtimeMs: number };

export class LocalProject {
  readonly id: string;
  readonly files = new Map<string, Entry>();
  private baselines = new Map<string, Baseline>();
  private reviews = new Map<string, { token: string; baseline: Baseline }>();
  private busy = new Set<string>();
  private active = true;

  private constructor(
    readonly root: string,
    readonly name: string,
    private identityKey?: Uint8Array,
  ) {
    this.id = identityKey
      ? createHmac('sha256', identityKey).update(root).digest('hex')
      : randomUUID();
  }

  static async select(directory: string, identityKey?: Uint8Array) {
    const root = await realpath(directory);
    const project = new LocalProject(root, path.basename(root), identityKey);
    const skipped: Array<{ path: string; reason: string }> = [];
    let entries = 0,
      skippedCount = 0,
      truncated = false;

    const skip = (name: string, reason: string) => {
      skippedCount++;

      if (skipped.length < 100) skipped.push({ path: name, reason });
    };

    type Rule = { base: string; matcher: ReturnType<typeof ignore> };

    async function walk(relative: string, rules: Rule[], depth: number) {
      if (truncated) return;

      if (depth > PROJECT_POLICY.maxDepth) {
        skip(relative, 'Depth limit');

        return;
      }

      const full = relative ? await project.resolve(relative) : root;
      const localRules = [...rules];

      try {
        const data = await boundedRead(path.join(full, '.gitignore'));

        localRules.push({
          base: relative,
          matcher: ignore().add(data.content),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error(
            'Cannot read .gitignore safely. Project sharing canceled.',
          );
      }

      for await (const entry of await opendir(full)) {
        if (
          ++entries > PROJECT_POLICY.maxEntries ||
          project.files.size >= PROJECT_POLICY.maxFiles
        ) {
          truncated = true;
          break;
        }

        const name = relative ? `${relative}/${entry.name}` : entry.name;

        if (!safePath(name) || entry.isSymbolicLink()) {
          skip(name, 'Unsafe path or symlink');
          continue;
        }

        if (
          excludedName(entry.name) ||
          (entry.isDirectory() &&
            PROJECT_POLICY.excludedDirectories.includes(
              entry.name.toLowerCase(),
            ))
        ) {
          skip(name, 'Secret/dependency/build exclusion');
          continue;
        }

        let excluded = false;

        for (const rule of localRules) {
          const result = rule.matcher.test(
            (rule.base ? name.slice(rule.base.length + 1) : name) +
              (entry.isDirectory() ? '/' : ''),
          );

          if (result.ignored) excluded = true;

          if (result.unignored) excluded = false;
        }

        if (excluded) {
          skip(name, '.gitignore');
          continue;
        }

        if (entry.isDirectory()) {
          await walk(name, localRules, depth + 1);
          continue;
        }

        if (!entry.isFile() || binaryExtension.test(entry.name)) {
          skip(name, 'Non-text file');
          continue;
        }

        const stat = await lstat(path.join(full, entry.name));

        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.size > PROJECT_POLICY.maxFileBytes
        ) {
          skip(name, 'File size or link restriction');
          continue;
        }

        const id = project.identityKey
          ? createHmac('sha256', project.identityKey)
              .update(project.id + '/' + name)
              .digest('hex')
          : randomUUID();

        project.files.set(id, { id, path: name, size: stat.size });
      }
    }

    await walk('', [], 0);

    return {
      project,
      manifest: {
        id: project.id,
        name: project.name,
        files: [...project.files.values()].sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
        skipped,
        skippedCount,
        truncated,
      },
    };
  }

  private async resolve(relative: string) {
    if (!this.active || !safePath(relative))
      throw new Error('Project is closed or path is invalid.');

    let full = this.root;

    // Reject symlinks in every component, including replacements since selection.
    for (const part of relative.split('/')) {
      full = path.join(full, part);

      if ((await lstat(full)).isSymbolicLink())
        throw new Error('Symlinks are not shared.');
    }

    const actual = await realpath(full);
    const rel = path.relative(this.root, actual);

    if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel))
      throw new Error('Path escaped the shared folder.');

    return actual;
  }

  private async target(id: string) {
    const entry = this.files.get(id);

    if (!entry || !this.active)
      throw new Error('File is not in this host’s approved project scope.');

    // Re-evaluate .gitignore and hard exclusions for the requested path at read/save time.
    const parts = entry.path.split('/');
    let excluded = false;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;

      if (
        excludedName(part) ||
        PROJECT_POLICY.excludedDirectories.includes(part.toLowerCase())
      )
        throw new Error('File is excluded from sharing.');

      const directory = i
        ? await this.resolve(parts.slice(0, i).join('/'))
        : this.root;

      try {
        const rules = ignore().add(
          (await boundedRead(path.join(directory, '.gitignore'))).content,
        );
        const result = rules.test(parts.slice(i).join('/'));

        if (result.ignored) excluded = true;

        if (result.unignored) excluded = false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('Cannot verify current .gitignore rules.');
      }

      // An excluded parent cannot be re-included by a child .gitignore.
      if (i < parts.length - 1) {
        try {
          const rules = ignore().add(
            (await boundedRead(path.join(directory, '.gitignore'))).content,
          );

          if (rules.ignores(part + '/'))
            throw new Error('An ancestor folder is now ignored.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }

    if (excluded)
      throw new Error(
        'File is now ignored. Previously shared content cannot be recalled.',
      );

    return this.resolve(entry.path);
  }

  async read(id: string) {
    if (this.busy.has(id))
      throw new Error('File operation already in progress.');

    this.busy.add(id);

    try {
      const data = await boundedRead(await this.target(id));

      if (!this.active) throw new Error('Project was closed.');

      // A second read must not silently advance the baseline past unsaved shared edits.
      const old = this.baselines.get(id);

      if (
        old &&
        (old.hash !== data.hash ||
          old.dev !== data.stat.dev ||
          old.ino !== data.stat.ino ||
          old.mtimeMs !== data.stat.mtimeMs)
      )
        throw new Error(
          'File changed on disk. Save a copy and merge externally before reopening the project.',
        );

      this.baselines.set(id, {
        hash: data.hash,
        dev: data.stat.dev,
        ino: data.stat.ino,
        mtimeMs: data.stat.mtimeMs,
      });

      return { content: data.content };
    } finally {
      this.busy.delete(id);
    }
  }

  async inspect(id: string) {
    if (this.busy.has(id))
      throw new Error('File operation already in progress.');
    this.busy.add(id);
    try {
      const data = await boundedRead(await this.target(id));
      if (!this.active) throw new Error('Project was closed.');
      const token = randomUUID();
      this.reviews.set(id, {
        token,
        baseline: {
          hash: data.hash,
          dev: data.stat.dev,
          ino: data.stat.ino,
          mtimeMs: data.stat.mtimeMs,
        },
      });
      return { content: data.content, token };
    } finally {
      this.busy.delete(id);
    }
  }

  async accept(id: string, token: string) {
    if (this.busy.has(id))
      throw new Error('File operation already in progress.');
    const review = this.reviews.get(id);
    if (!review || review.token !== token)
      throw new Error('Review the disk file again before resolving.');
    this.busy.add(id);
    try {
      const data = await boundedRead(await this.target(id));
      const b = review.baseline;
      if (
        !this.active ||
        data.hash !== b.hash ||
        data.stat.dev !== b.dev ||
        data.stat.ino !== b.ino ||
        data.stat.mtimeMs !== b.mtimeMs
      )
        throw new Error('Disk changed again. Review the latest version.');
      this.baselines.set(id, b);
      this.reviews.delete(id);
      return { content: data.content };
    } finally {
      this.busy.delete(id);
    }
  }

  async save(id: string, content: string) {
    if (
      typeof content !== 'string' ||
      Buffer.byteLength(content) > PROJECT_POLICY.maxFileBytes
    )
      throw new Error('File exceeds the save size limit.');

    if (this.busy.has(id))
      throw new Error('File operation already in progress.');

    const baseline = this.baselines.get(id);

    if (!baseline)
      throw new Error('Open this file through the host before saving.');

    this.busy.add(id);

    let temporary: string | null = null;

    try {
      const target = await this.target(id);

      const unchanged = async () => {
        const data = await boundedRead(await this.target(id));

        if (
          data.hash !== baseline.hash ||
          data.stat.dev !== baseline.dev ||
          data.stat.ino !== baseline.ino ||
          data.stat.mtimeMs !== baseline.mtimeMs
        )
          throw new Error(
            'Save blocked: file changed outside ByteBridge. Save a copy and merge externally; disk content was not overwritten.',
          );

        return data;
      };

      const current = await unchanged();

      temporary = path.join(
        path.dirname(target),
        `.bytebridge-save-${randomUUID()}.tmp`,
      );

      const handle = await open(temporary, 'wx', current.stat.mode & 0o777);

      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      await unchanged();

      if (!this.active) throw new Error('Project was closed before saving.');

      await rename(temporary, target);
      temporary = null;

      const stat = await lstat(target);

      this.baselines.set(id, {
        hash: digest(Buffer.from(content)),
        dev: stat.dev,
        ino: stat.ino,
        mtimeMs: stat.mtimeMs,
      });

      return { saved: true };
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});

      this.busy.delete(id);
    }
  }

  close() {
    this.active = false;
    this.files.clear();
    this.baselines.clear();
    this.reviews.clear();
  }
}
