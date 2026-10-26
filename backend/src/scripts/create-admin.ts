import { disconnectPrisma } from '../config/prisma';
import { adminBootstrapService, type AdminBootstrapService } from '../services/admin-bootstrap.service';
import type { AdminTerminal } from '../types/admin-bootstrap.types';
import { AdminBootstrapError, bootstrapMessage } from '../utils/admin-bootstrap-error';
import { createLocalAdminTerminal } from '../utils/admin-terminal';

// Injectable for mock tests. Importing this module never starts the CLI.
export async function runCreateAdmin(
  terminal: AdminTerminal,
  service: AdminBootstrapService = adminBootstrapService,
  disconnect: () => Promise<void> = disconnectPrisma,
): Promise<number> {
  let exitCode = 0;
  let password = '';
  let confirmation = '';
  try {
    terminal.assertInteractive();
    await service.checkAvailable();
    terminal.write('Create the first ADMIN in the database configured by backend/.env. Ctrl+C cancels.');
    const username = await terminal.ask('Username (3-30 letters/digits/underscores): ');
    const email = await terminal.ask('Email: ');
    const displayName = await terminal.ask('Display name: ');
    password = await terminal.secret('Password (8-128 characters, hidden): ');
    confirmation = await terminal.secret('Confirm password (hidden): ');
    if (password !== confirmation) throw new AdminBootstrapError('INVALID_INPUT');
    await service.create({ username, email, displayName, password });
    terminal.write('First ADMIN created successfully. Sign in through /api/auth/login.');
  } catch (error) {
    terminal.write(bootstrapMessage(error));
    exitCode = error instanceof AdminBootstrapError && error.code === 'CANCELLED' ? 130 : 1;
  } finally {
    password = ''; confirmation = '';
    terminal.close();
    try { await disconnect(); }
    catch { terminal.write('Could not close the database connection cleanly.'); exitCode = 1; }
  }
  return exitCode;
}

if (require.main === module) {
  void runCreateAdmin(createLocalAdminTerminal()).then((code) => { process.exitCode = code; }).catch(() => {
    console.error('Unable to complete ADMIN bootstrap. Sensitive details are hidden.');
    process.exitCode = 1;
  });
}
