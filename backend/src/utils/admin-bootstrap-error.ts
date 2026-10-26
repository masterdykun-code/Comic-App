export type BootstrapCode = 'ADMIN_EXISTS' | 'ACCOUNT_CONFLICT' | 'INVALID_INPUT' | 'CANCELLED' | 'LOCAL_TERMINAL_REQUIRED' | 'BOOTSTRAP_BUSY' | 'BOOTSTRAP_FAILED';
const messages: Record<BootstrapCode, string> = {
  ADMIN_EXISTS: 'Bootstrap refused: an ADMIN already exists (including BANNED accounts).',
  ACCOUNT_CONFLICT: 'Username or email is already in use. Existing users are never modified.',
  INVALID_INPUT: 'Invalid input or password confirmation. Check username, email, display name and password (8-128 characters).',
  CANCELLED: 'Bootstrap cancelled.',
  LOCAL_TERMINAL_REQUIRED: 'Run npm run admin manually in a trusted interactive terminal. Piped input, CI and command-line arguments are not accepted.',
  BOOTSTRAP_BUSY: 'Bootstrap is busy. Wait and try again; the ADMIN check will run again.',
  BOOTSTRAP_FAILED: 'Unable to complete bootstrap. Check database availability; rerun to verify whether an ADMIN already exists.',
};
export class AdminBootstrapError extends Error {
  constructor(public readonly code: BootstrapCode) { super(messages[code]); }
}
export function bootstrapMessage(error: unknown): string {
  // Render constants only, never raw Prisma/validation errors or supplied values.
  return messages[error instanceof AdminBootstrapError ? error.code : 'BOOTSTRAP_FAILED'];
}
