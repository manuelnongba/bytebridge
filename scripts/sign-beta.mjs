import { signAsync } from '@electron/osx-sign';

// Local beta signing seals the bundle but does not establish a trusted developer identity.
export default async function signBeta(options) {
  await signAsync({
    ...options,
    identity: '-',
    identityValidation: false,
    gatekeeperAssess: false,
    preAutoEntitlements: false,
    optionsForFile: (file) => ({
      ...options.optionsForFile?.(file),
      hardenedRuntime: false,
      timestamp: 'none',
    }),
  });
}
