import path from 'node:path';

export function profileFrom(argv: string[]): string | null {
  const index = argv.findIndex(
    (arg) => arg === '--profile' || arg.startsWith('--profile='),
  );

  if (index < 0) return null;

  const arg = argv[index]!;
  const value =
    arg === '--profile' ? argv[index + 1] : arg.slice('--profile='.length);

  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(value))
    throw new Error(
      'Profile names must be 1–40 letters, numbers, hyphens, or underscores, starting with a letter or number. Example: --profile alice',
    );

  return value.toLowerCase();
}

export function profileDirectory(base: string, profile: string | null): string {
  const root = path.join(base, 'ByteBridge');

  return profile ? path.join(root, 'profiles', profile) : root;
}
