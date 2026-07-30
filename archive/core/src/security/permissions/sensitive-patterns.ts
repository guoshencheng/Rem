/**
 * Built-in glob patterns that identify sensitive read targets.
 * These are not user-configurable for now.
 */
export const BUILT_IN_SENSITIVE_READ_PATTERNS = [
  '**/.env*',
  '**/*.pem',
  '**/*.key',
  '**/secrets/**/*',
  '**/.ssh/**/*',
];
