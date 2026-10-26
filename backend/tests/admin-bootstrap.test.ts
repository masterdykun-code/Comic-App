import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { ReadStream } from 'node:tty';
import test from 'node:test';
import argon2 from 'argon2';
import { createAdminBootstrapService } from '../src/services/admin-bootstrap.service';
import { runCreateAdmin } from '../src/scripts/create-admin';
import type { AdminTerminal } from '../src/types/admin-bootstrap.types';
import { AdminBootstrapError } from '../src/utils/admin-bootstrap-error';
import { createLocalAdminTerminal, readHidden } from '../src/utils/admin-terminal';
import { MemoryAdminBootstrapStore } from './helpers/memory-admin-bootstrap.store';

// Test-only inputs. No production CLI run or database connection occurs.
const input = { username: 'first_admin', email: 'admin@example.test', displayName: 'First Admin', password: 'Test-password-123' };
const errorCode = (code: string) => (e: unknown) => e instanceof AdminBootstrapError && e.code === code;

class FakeTerminal implements AdminTerminal {
  lines: string[] = [];
  publicAnswers = [input.username, input.email, input.displayName];
  secretAnswers = [input.password, input.password];
  closed = false;
  interactive = true;
  asked = 0;
  secretsAsked = 0;
  assertInteractive() { if (!this.interactive) throw new AdminBootstrapError('LOCAL_TERMINAL_REQUIRED'); }
  async ask(_label: string) { this.asked++; return this.publicAnswers.shift()!; }
  async secret(_label: string) { this.secretsAsked++; return this.secretAnswers.shift()!; }
  write(message: string) { this.lines.push(message); }
  close() { this.closed = true; }
}

test('first ADMIN created ACTIVE with Argon2id; normalized identity and safe return values', async () => {
  const store = new MemoryAdminBootstrapStore(); const service = createAdminBootstrapService(store);
  await service.checkAvailable();
  const result = await service.create({ ...input, username: 'First_Admin', email: 'Admin@Example.test', displayName: ' First Admin ' });
  assert.deepEqual(Object.keys(result).sort(), ['id', 'role', 'status']);
  assert.equal(result.role, 'ADMIN'); assert.equal(result.status, 'ACTIVE');
  assert.equal(store.users.length, 1); const user = store.users[0];
  assert.equal(user.username, input.username); assert.equal(user.email, input.email); assert.equal(user.displayName, input.displayName);
  assert(user.passwordHash?.startsWith('$argon2id$v=19$'));
  assert.deepEqual(user.passwordHash!.split('$')[3].split(',').sort(), ['m=19456', 'p=1', 't=2']);
  assert(await argon2.verify(user.passwordHash!, input.password));
  assert(!JSON.stringify(result).includes('password'));
});

test('bootstrap refuses any existing ADMIN, including BANNED', async () => {
  const store = new MemoryAdminBootstrapStore(); const service = createAdminBootstrapService(store);
  await service.create(input); store.users[0].status = 'BANNED';
  await assert.rejects(service.checkAvailable(), errorCode('ADMIN_EXISTS'));
  await assert.rejects(service.create({ ...input, username: 'second_admin', email: 'second@example.test' }), errorCode('ADMIN_EXISTS'));
  assert.equal(store.users.length, 1);
});

test('two concurrent bootstraps cannot create two first ADMIN accounts', async () => {
  const store = new MemoryAdminBootstrapStore(); const service = createAdminBootstrapService(store);
  await Promise.all([service.checkAvailable(), service.checkAvailable()]); // Stale preflight checks are deliberately allowed.
  const result = await Promise.allSettled([
    service.create(input), service.create({ ...input, username: 'another_admin', email: 'other@example.test' }),
  ]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = result.find(r => r.status === 'rejected');
  assert(rejected?.status === 'rejected' && errorCode('ADMIN_EXISTS')(rejected.reason));
  assert.equal(store.users.length, 1); assert.equal(store.transactionCount, 2);
});

test('duplicate username/email refuses creation without elevating or modifying USER', async () => {
  for (const variant of ['username', 'email'] as const) {
    const store = new MemoryAdminBootstrapStore(); const service = createAdminBootstrapService(store);
    await service.create(input); store.users[0].role = 'USER';
    const before = structuredClone(store.users);
    const candidate = variant === 'username' ? { ...input, username: 'FIRST_ADMIN', email: 'other@example.test' } :
      { ...input, username: 'other_admin', email: 'ADMIN@EXAMPLE.TEST' };
    await assert.rejects(service.create(candidate), errorCode('ACCOUNT_CONFLICT'));
    assert.deepEqual(store.users, before);
  }
});

for (const [label, value] of [
  ['short password', { ...input, password: 'short' }], ['long password', { ...input, password: 'x'.repeat(129) }],
  ['short username', { ...input, username: 'ab' }], ['invalid email', { ...input, email: 'bad' }],
  ['empty display name', { ...input, displayName: ' ' }], ['mass assignment', { ...input, role: 'ADMIN' }],
] as const) {
  test(`invalid bootstrap input: ${label}`, async () => {
    const store = new MemoryAdminBootstrapStore();
    await assert.rejects(createAdminBootstrapService(store).create(value), errorCode('INVALID_INPUT'));
    assert.equal(store.users.length, 0); assert.equal(store.transactionCount, 0);
  });
}

test('transaction commit error rolls back the inserted ADMIN', async () => {
  const store = new MemoryAdminBootstrapStore(); store.failCommit = true;
  await assert.rejects(createAdminBootstrapService(store).create(input), errorCode('BOOTSTRAP_FAILED'));
  assert.equal(store.users.length, 0);
  store.failCommit = false;
  await createAdminBootstrapService(store).create(input); assert.equal(store.users.length, 1);
});

test('database unique conflict race is sanitized and leaves no partial user', async () => {
  const store = new MemoryAdminBootstrapStore(); store.uniqueRace = true;
  await assert.rejects(createAdminBootstrapService(store).create(input), errorCode('ACCOUNT_CONFLICT'));
  assert.equal(store.users.length, 0);
});

test('CLI success never prints password/hash/token and always closes/disconnects', async () => {
  const store = new MemoryAdminBootstrapStore(); const terminal = new FakeTerminal(); let disconnected = false;
  const code = await runCreateAdmin(terminal, createAdminBootstrapService(store), async () => { disconnected = true; });
  assert.equal(code, 0); assert(terminal.closed && disconnected); assert.equal(terminal.secretsAsked, 2);
  const output = terminal.lines.join('\n'); assert(output.includes('created successfully'));
  assert(!output.includes(input.password)); assert(!output.includes(store.users[0].passwordHash!)); assert(!output.includes('$argon2'));
});

test('CLI already-existing ADMIN exits before asking for credentials', async () => {
  const store = new MemoryAdminBootstrapStore(); const service = createAdminBootstrapService(store); await service.create(input);
  const terminal = new FakeTerminal();
  assert.equal(await runCreateAdmin(terminal, service, async () => {}), 1);
  assert.equal(terminal.asked, 0); assert.equal(terminal.secretsAsked, 0); assert.equal(store.users.length, 1);
});

test('CLI confirmation mismatch aborts without transaction', async () => {
  const store = new MemoryAdminBootstrapStore(); const terminal = new FakeTerminal(); terminal.secretAnswers[1] = 'Mismatch-password';
  assert.equal(await runCreateAdmin(terminal, createAdminBootstrapService(store), async () => {}), 1);
  assert.equal(store.transactionCount, 0); assert.equal(store.users.length, 0);
});

test('CLI refuses noninteractive use before database access', async () => {
  const terminal = new FakeTerminal(); terminal.interactive = false;
  const store = new MemoryAdminBootstrapStore();
  assert.equal(await runCreateAdmin(terminal, createAdminBootstrapService(store), async () => {}), 1);
  assert.equal(terminal.asked, 0); assert.equal(store.transactionCount, 0);
});

test('CLI generic database errors and cancellation never leak raw details', async () => {
  const terminal = new FakeTerminal(); const store = new MemoryAdminBootstrapStore(); store.failCommit = true;
  assert.equal(await runCreateAdmin(terminal, createAdminBootstrapService(store), async () => {}), 1);
  assert(!terminal.lines.join('\n').includes('PRIVATE_')); assert(!terminal.lines.join('\n').includes(input.password));
  const cancel = new FakeTerminal(); cancel.secret = async () => { throw new AdminBootstrapError('CANCELLED'); };
  assert.equal(await runCreateAdmin(cancel, createAdminBootstrapService(new MemoryAdminBootstrapStore()), async () => {}), 130);
  assert(cancel.closed);
});

class FakeTTY extends PassThrough {
  isTTY = true;
  isRaw = false;
  modes: boolean[] = [];
  setRawMode(value: boolean) { this.isRaw = value; this.modes.push(value); return this; }
}
test('hidden input disables echo, supports backspace and restores terminal state', async () => {
  const tty = new FakeTTY(); let output = '';
  const secret = readHidden(tty as unknown as ReadStream, { write: ((chunk: string) => { output += chunk; return true; }) as never }, 'Password: ');
  for (const char of 'test-secretx') tty.emit('keypress', char, { name: char });
  tty.emit('keypress', undefined, { name: 'backspace' }); tty.emit('keypress', '\r', { name: 'return' });
  assert.equal(await secret, 'test-secret'); assert.equal(output, 'Password: \n'); assert.deepEqual(tty.modes, [true, false]);
  assert.equal(tty.listenerCount('keypress'), 0); tty.destroy();
});

test('hidden password cancellation and length limit restore raw mode without echo', async () => {
  for (const mode of ['cancel', 'length']) {
    const tty = new FakeTTY(); let output = '';
    const result = readHidden(tty as unknown as ReadStream, { write: ((chunk: string) => { output += chunk; return true; }) as never }, 'Secret: ');
    const rejected = assert.rejects(result, errorCode(mode === 'cancel' ? 'CANCELLED' : 'INVALID_INPUT'));
    if (mode === 'cancel') tty.emit('keypress', '\x03', { ctrl: true, name: 'c' });
    else tty.emit('keypress', 'x'.repeat(129), {});
    await rejected; assert.deepEqual(tty.modes, [true, false]); assert.equal(output, 'Secret: \n'); tty.destroy();
  }
});

test('real terminal guard rejects arguments even when stdin/stdout claim TTY', () => {
  const priorArgs = process.argv; const priorCI = process.env.CI;
  const inputDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const outputDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  try {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    delete process.env.CI;
    process.argv = ['node', 'create-admin.ts', '--password=not-accepted'];
    assert.throws(() => createLocalAdminTerminal().assertInteractive(), errorCode('LOCAL_TERMINAL_REQUIRED'));
    process.argv = ['node', 'create-admin.ts']; process.env.CI = 'true';
    assert.throws(() => createLocalAdminTerminal().assertInteractive(), errorCode('LOCAL_TERMINAL_REQUIRED'));
  } finally {
    process.argv = priorArgs;
    if (priorCI === undefined) delete process.env.CI; else process.env.CI = priorCI;
    if (inputDescriptor) Object.defineProperty(process.stdin, 'isTTY', inputDescriptor); else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (outputDescriptor) Object.defineProperty(process.stdout, 'isTTY', outputDescriptor); else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
});
