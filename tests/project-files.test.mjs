import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  readFile,
  link,
  rename,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalProject, PROJECT_POLICY } from '../dist/main/project-files.js';

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'bytebridge-project-'));

  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }

  return root;
}

test('catalog is metadata only and respects nested ignores, secrets, links and size limits', async () => {
  const root = await fixture({
    '.gitignore': '*.log\nignored/\nsrc/*.tmp\n!src/kept.tmp\n',
    'src/.gitignore': 'private.txt\n!allowed.log\n',
    'src/main.js': 'original',
    'src/kept.tmp': 'keep',
    'src/secret.tmp': 'ignore',
    'src/private.txt': 'ignore',
    'src/allowed.log': 'keep',
    'debug.log': 'ignore',
    'node_modules/lib.js': 'ignore',
    'ignored/a.js': 'ignore',
    '.env.local': 'secret',
    'private.key': 'secret',
    'large.txt': 'x'.repeat(PROJECT_POLICY.maxFileBytes + 1),
    'binary.bin': Buffer.from([0, 255, 1]),
    'hard.js': 'linked',
  });

  await symlink(path.join(root, 'src/main.js'), path.join(root, 'linked.js'));
  await link(path.join(root, 'hard.js'), path.join(root, 'hard2.js'));

  const { project, manifest } = await LocalProject.select(root);
  const names = manifest.files.map((file) => file.path);

  for (const name of ['src/main.js', 'src/kept.tmp', 'src/allowed.log']) {
    assert.ok(names.includes(name), name);
    await project.read(manifest.files.find((file) => file.path === name).id);
  }

  for (const name of [
    'src/secret.tmp',
    'src/private.txt',
    'debug.log',
    'node_modules/lib.js',
    'ignored/a.js',
    '.env.local',
    'private.key',
    'large.txt',
    'linked.js',
    'hard.js',
    'hard2.js',
  ])
    assert.ok(!names.includes(name), name);

  assert.ok(
    manifest.files.every(
      (file) => !('content' in file) && !file.path.startsWith(root),
    ),
  );
  await assert.rejects(
    project.read(manifest.files.find((file) => file.path === 'binary.bin').id),
  );
  project.close();
});
test('75-file catalog loads latest contents on demand and only explicit saves write to disk', async () => {
  const root = await fixture(
    Object.fromEntries(
      Array.from({ length: 75 }, (_, i) => [`src/${i}.js`, 'before']),
    ),
  );
  const { project, manifest } = await LocalProject.select(root);

  assert.equal(manifest.files.length, 75);

  const file = manifest.files[0],
    target = path.join(root, file.path);

  await writeFile(target, 'after catalog');
  assert.equal((await project.read(file.id)).content, 'after catalog');
  assert.equal(await readFile(target, 'utf8'), 'after catalog');
  await project.save(file.id, 'collaborative edits');
  assert.equal(await readFile(target, 'utf8'), 'collaborative edits');
  await project.save(file.id, 'second save');
  assert.equal(await readFile(target, 'utf8'), 'second save');
  await assert.rejects(project.read('../secret'), /scope/);
  project.close();
  await assert.rejects(project.read(file.id));
});
test('external edits and replacement block saves without overwriting', async () => {
  const root = await fixture({ 'a.js': 'original', 'b.js': 'original' });
  const { project, manifest } = await LocalProject.select(root);

  for (const entry of manifest.files) await project.read(entry.id);

  const a = manifest.files.find((entry) => entry.path === 'a.js'),
    b = manifest.files.find((entry) => entry.path === 'b.js');

  await writeFile(path.join(root, 'a.js'), 'external');
  await assert.rejects(project.save(a.id, 'shared edits'), /changed outside/);
  assert.equal(await readFile(path.join(root, 'a.js'), 'utf8'), 'external');
  await writeFile(path.join(root, 'replacement'), 'original');
  await rename(path.join(root, 'replacement'), path.join(root, 'b.js'));
  await assert.rejects(project.save(b.id, 'shared edits'), /changed outside/);
  project.close();
});
test('changed ignore rules and symlink substitutions cannot bypass approved scope', async () => {
  const root = await fixture({ '.gitignore': '', 'src/a.js': 'original' });
  const { project, manifest } = await LocalProject.select(root);
  const entry = manifest.files.find((file) => file.path === 'src/a.js');

  await project.read(entry.id);
  await writeFile(path.join(root, '.gitignore'), 'src/\n');
  await assert.rejects(project.save(entry.id, 'new'), /ignored/);
  await writeFile(path.join(root, '.gitignore'), '');
  await rename(path.join(root, 'src'), path.join(root, 'old-src'));
  await symlink(path.join(root, 'old-src'), path.join(root, 'src'));
  await assert.rejects(project.read(entry.id), /Symlinks/);
  assert.equal(
    await readFile(path.join(root, 'old-src/a.js'), 'utf8'),
    'original',
  );
  project.close();
});
