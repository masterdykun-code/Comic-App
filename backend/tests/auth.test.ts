import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/config/auth';
import { createAuthRouter } from '../src/routes/auth.routes';
import { createAuthService, hashRefreshToken } from '../src/services/auth.service';
import { authorizeRole, createAuthenticate } from '../src/middlewares/auth.middleware';
import { errorHandler, notFoundHandler } from '../src/middlewares/error-handler';
import { MemoryAuthStore } from './helpers/memory-auth.store';

// Ephemeral test-only key; the real .env secret is never used or printed here.
const testSecret = randomBytes(48).toString('hex');
process.env.JWT_SECRET = testSecret;
const account = { username: 'reader_one', email: 'reader@example.test', password: 'Test-password-123' };

async function fixture(run: (f: {
  store: MemoryAuthStore;
  request: (path: string, method?: string, body?: unknown, token?: string) => Promise<{ status: number; body: any; headers: Headers }>;
  registerAndLogin: () => Promise<any>;
}) => Promise<void>) {
  const store = new MemoryAuthStore();
  const service = createAuthService(store);
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', createAuthRouter(service));
  // Test-only protected resource: no production ADMIN route is added.
  app.get('/admin-example', createAuthenticate(service), authorizeRole('ADMIN'), (_req, res) => res.json({ success: true }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const request = async (path: string, method = 'GET', body?: unknown, token?: string) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    const registerAndLogin = async () => {
      assert.equal((await request('/api/auth/register', 'POST', account)).status, 201);
      const response = await request('/api/auth/login', 'POST', { email: account.email, password: account.password });
      assert.equal(response.status, 200);
      return response.body.data;
    };
    await run({ store, request, registerAndLogin });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((e) => e ? reject(e) : resolve());
      server.closeAllConnections();
    });
  }
}

test('register hashes with Argon2id, forces USER, normalizes identity and hides hash', async () => fixture(async ({ store, request }) => {
  const response = await request('/api/auth/register', 'POST', { ...account, username: 'Reader_One', email: 'Reader@Example.test' });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.role, 'USER');
  assert.equal(response.body.data.username, account.username);
  assert.equal(response.body.data.email, account.email);
  assert(!JSON.stringify(response.body).includes('passwordHash'));
  const user = [...store.users.values()][0];
  assert(user.passwordHash?.startsWith('$argon2id$'));
  assert(await argon2.verify(user.passwordHash!, account.password));
}));

test('email and username conflicts, including case normalization, return 409', async () => fixture(async ({ request }) => {
  assert.equal((await request('/api/auth/register', 'POST', account)).status, 201);
  assert.equal((await request('/api/auth/register', 'POST', { ...account, username: 'another' })).status, 409);
  assert.equal((await request('/api/auth/register', 'POST', { ...account, email: 'other@example.test' })).status, 409);
  assert.equal((await request('/api/auth/register', 'POST', { ...account, username: 'READER_ONE', email: 'last@example.test' })).status, 409);
}));

for (const invalid of [
  { ...account, role: 'ADMIN' }, { ...account, status: 'ACTIVE' }, { ...account, passwordHash: 'x' },
  { ...account, username: 'ab' }, { ...account, username: 'bad name' }, { ...account, email: 'not-email' },
  { ...account, password: 'short' }, { ...account, password: 'a'.repeat(129) },
]) {
  test(`invalid registration rejected: ${Object.keys(invalid).find(k => !['username', 'email', 'password'].includes(k)) ?? (invalid.username !== account.username ? 'username' : invalid.email !== account.email ? 'email' : 'password')}`, async () => fixture(async ({ store, request }) => {
    assert.equal((await request('/api/auth/register', 'POST', invalid)).status, 400);
    assert.equal(store.users.size, 0);
  }));
}

test('login, me and profile update work without exposing sensitive fields', async () => fixture(async ({ store, request, registerAndLogin }) => {
  const data = await registerAndLogin();
  assert.equal(data.expiresIn, 900);
  assert.equal(data.refreshToken.length, 64);
  assert(store.tokens.has(hashRefreshToken(data.refreshToken)));
  assert(!store.tokens.has(data.refreshToken));
  const me = await request('/api/auth/me', 'GET', undefined, data.accessToken);
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  const updated = await request('/api/auth/me', 'PATCH', { displayName: 'New Reader', avatarUrl: 'https://example.test/avatar.png' }, data.accessToken);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.displayName, 'New Reader');
  for (const body of [data, me.body, updated.body]) {
    assert(!JSON.stringify(body).includes('passwordHash'));
    assert(!JSON.stringify(body).includes('$argon2'));
  }
  assert.equal((await request('/api/auth/me', 'PATCH', { avatarUrl: null }, data.accessToken)).status, 200);
}));

test('wrong password, missing account, OAuth-only account and BANNED have identical login errors', async () => fixture(async ({ store, request, registerAndLogin }) => {
  await registerAndLogin();
  const wrong = await request('/api/auth/login', 'POST', { email: account.email, password: 'wrong-password' });
  const absent = await request('/api/auth/login', 'POST', { email: 'absent@example.test', password: account.password });
  const user = [...store.users.values()][0];
  user.status = 'BANNED';
  const banned = await request('/api/auth/login', 'POST', { email: account.email, password: account.password });
  user.status = 'ACTIVE'; user.passwordHash = null;
  const oauth = await request('/api/auth/login', 'POST', { email: account.email, password: account.password });
  for (const response of [wrong, absent, banned, oauth]) {
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, wrong.body);
  }
}));

test('missing, malformed, expired, wrong signature/algorithm/claims tokens return 401', async () => fixture(async ({ store, request, registerAndLogin }) => {
  const data = await registerAndLogin();
  const claims = jwt.decode(data.accessToken) as jwt.JwtPayload;
  const sign = (payload: object, options: jwt.SignOptions = {}) => jwt.sign(payload, testSecret, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, ...options });
  const invalid = [undefined, 'bad-token',
    sign({ sub: claims.sub, sid: claims.sid, tokenUse: 'access' }, { expiresIn: -1 }),
    jwt.sign({ sub: claims.sub, sid: claims.sid, tokenUse: 'access' }, randomBytes(48), { expiresIn: 900 }),
    sign({ sub: claims.sub, sid: claims.sid, tokenUse: 'access' }, { expiresIn: 900, algorithm: 'HS384' }),
    sign({ sub: claims.sub, sid: claims.sid, tokenUse: 'refresh' }, { expiresIn: 900 }),
    sign({ sub: claims.sub, sid: claims.sid, tokenUse: 'access' }),
    sign({ sub: '------------------------------------', sid: claims.sid, tokenUse: 'access' }, { expiresIn: 900 }),
    sign({ sub: claims.sub, sid: claims.sid, tokenUse: 'access' }, { expiresIn: 900, issuer: 'other-app' }),
  ];
  for (const token of invalid) assert.equal((await request('/api/auth/me', 'GET', undefined, token)).status, 401);
  assert.equal(store.sessions.size, 1);
}));

test('profile rejects privilege fields, empty patch and unsafe avatar URLs', async () => fixture(async ({ request, registerAndLogin }) => {
  const data = await registerAndLogin();
  for (const body of [{ role: 'ADMIN' }, { status: 'ACTIVE' }, { passwordHash: 'x' }, { email: 'other@example.test' }, {}, { displayName: '' }, { avatarUrl: 'javascript:alert(1)' }]) {
    assert.equal((await request('/api/auth/me', 'PATCH', body, data.accessToken)).status, 400);
  }
}));

test('rotation changes token; replay revokes the complete session and access tokens', async () => fixture(async ({ request, registerAndLogin }) => {
  const login = await registerAndLogin();
  const refreshed = await request('/api/auth/refresh', 'POST', { refreshToken: login.refreshToken });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.data.refreshToken, login.refreshToken);
  assert.equal((await request('/api/auth/me', 'GET', undefined, refreshed.body.data.accessToken)).status, 200);
  assert.equal((await request('/api/auth/refresh', 'POST', { refreshToken: login.refreshToken })).status, 401);
  assert.equal((await request('/api/auth/refresh', 'POST', { refreshToken: refreshed.body.data.refreshToken })).status, 401);
  assert.equal((await request('/api/auth/me', 'GET', undefined, login.accessToken)).status, 401);
  assert.equal((await request('/api/auth/me', 'GET', undefined, refreshed.body.data.accessToken)).status, 401);
}));

test('concurrent refresh accepts at most one use and detects replay', async () => fixture(async ({ request, registerAndLogin }) => {
  const data = await registerAndLogin();
  const responses = await Promise.all([1, 2].map(() => request('/api/auth/refresh', 'POST', { refreshToken: data.refreshToken })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
  assert.equal((await request('/api/auth/me', 'GET', undefined, data.accessToken)).status, 401);
}));

test('logout is idempotent, revokes access/refresh and accepts an old rotated token', async () => fixture(async ({ request, registerAndLogin }) => {
  const login = await registerAndLogin();
  const rotated = await request('/api/auth/refresh', 'POST', { refreshToken: login.refreshToken });
  assert.equal(rotated.status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await request('/api/auth/logout', 'POST', { refreshToken: login.refreshToken })).status, 200);
  assert.equal((await request('/api/auth/me', 'GET', undefined, rotated.body.data.accessToken)).status, 401);
  assert.equal((await request('/api/auth/refresh', 'POST', { refreshToken: rotated.body.data.refreshToken })).status, 401);
  assert.equal((await request('/api/auth/logout', 'POST', { refreshToken: randomBytes(48).toString('base64url') })).status, 200);
}));

test('ban and session expiration invalidate existing access and refresh tokens', async () => fixture(async ({ store, request, registerAndLogin }) => {
  const data = await registerAndLogin();
  const user = [...store.users.values()][0];
  user.status = 'BANNED';
  assert.equal((await request('/api/auth/me', 'GET', undefined, data.accessToken)).status, 401);
  assert.equal((await request('/api/auth/refresh', 'POST', { refreshToken: data.refreshToken })).status, 401);
  user.status = 'ACTIVE';
  const next = await request('/api/auth/login', 'POST', { email: account.email, password: account.password });
  const token = store.tokens.get(hashRefreshToken(next.body.data.refreshToken))!;
  store.sessions.get(token.sessionId)!.expiresAt = new Date(0);
  assert.equal((await request('/api/auth/me', 'GET', undefined, next.body.data.accessToken)).status, 401);
  assert.equal((await request('/api/auth/refresh', 'POST', { refreshToken: next.body.data.refreshToken })).status, 401);
}));

test('authorizeRole denies guests/USER, allows ADMIN and reads current role', async () => fixture(async ({ store, request, registerAndLogin }) => {
  const data = await registerAndLogin();
  assert.equal((await request('/admin-example')).status, 401);
  assert.equal((await request('/admin-example', 'GET', undefined, data.accessToken)).status, 403);
  // In-memory test user only. No default or database ADMIN is created.
  const user = [...store.users.values()][0];
  user.role = 'ADMIN';
  assert.equal((await request('/admin-example', 'GET', undefined, data.accessToken)).status, 200);
  user.role = 'USER';
  assert.equal((await request('/admin-example', 'GET', undefined, data.accessToken)).status, 403);
}));

test('login and registration rate limits return JSON 429', async () => fixture(async ({ request }) => {
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/auth/login', 'POST', { email: account.email, password: account.password })).status, 401);
  const limited = await request('/api/auth/login', 'POST', { email: account.email, password: account.password });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  assert(limited.headers.has('retry-after'));
  for (let i = 0; i < 5; i++) assert.equal((await request('/api/auth/register', 'POST', {})).status, 400);
  assert.equal((await request('/api/auth/register', 'POST', {})).status, 429);
}));

test('refresh/logout validate body and reject missing or malformed tokens', async () => fixture(async ({ request }) => {
  for (const path of ['/api/auth/refresh', '/api/auth/logout']) {
    for (const body of [{}, { refreshToken: 'x' }, { refreshToken: 'x'.repeat(64), role: 'ADMIN' }]) {
      assert.equal((await request(path, 'POST', body)).status, 400);
    }
  }
  assert.equal((await request('/api/auth/refresh', 'POST', { refreshToken: 'x'.repeat(64) })).status, 401);
}));

test('logout leaves another device session active', async () => fixture(async ({ request, registerAndLogin }) => {
  const first = await registerAndLogin();
  const second = await request('/api/auth/login', 'POST', { email: account.email, password: account.password });
  assert.equal(second.status, 200);
  assert.equal((await request('/api/auth/logout', 'POST', { refreshToken: first.refreshToken })).status, 200);
  assert.equal((await request('/api/auth/me', 'GET', undefined, first.accessToken)).status, 401);
  assert.equal((await request('/api/auth/me', 'GET', undefined, second.body.data.accessToken)).status, 200);
}));

test('missing signing key fails closed without persisting a session', async () => fixture(async ({ store, request }) => {
  assert.equal((await request('/api/auth/register', 'POST', account)).status, 201);
  delete process.env.JWT_SECRET;
  try {
    const response = await request('/api/auth/login', 'POST', { email: account.email, password: account.password });
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { success: false, message: 'Internal server error', error: { code: 'INTERNAL_SERVER_ERROR' } });
    assert.equal(store.sessions.size, 0);
  } finally {
    process.env.JWT_SECRET = testSecret;
  }
}));

const passwordChange = { currentPassword: account.password, newPassword: 'New-test-password-456', confirmPassword: 'New-test-password-456' };
test('password change hashes with Argon2id, revokes all sessions and accepts only the new password', async () => fixture(async ({ store, request, registerAndLogin }) => {
  const first = await registerAndLogin();
  const other = (await request('/api/auth/login', 'POST', {email: account.email, password: account.password})).body.data;
  const response = await request('/api/auth/change-password', 'POST', passwordChange, first.accessToken);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.body.data, { sessionsRevoked: true });
  const hash = [...store.users.values()][0]!.passwordHash!;
  assert(hash.startsWith('$argon2id$'));
  assert(await argon2.verify(hash, passwordChange.newPassword));
  for (const secret of [hash, account.password, passwordChange.newPassword, first.accessToken, first.refreshToken])
    assert(!JSON.stringify(response.body).includes(secret));
  for (const token of [first.accessToken, other.accessToken])
    assert.equal((await request('/api/auth/me', 'GET', undefined, token)).status, 401);
  for (const refreshToken of [first.refreshToken, other.refreshToken])
    assert.equal((await request('/api/auth/refresh', 'POST', {refreshToken})).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', {email: account.email, password: account.password})).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', {email: account.email, password: passwordChange.newPassword})).status, 200);
}));
test('wrong current password leaves credentials and session active', async () => fixture(async ({store, request, registerAndLogin}) => {
  const data = await registerAndLogin(), before = [...store.users.values()][0]!.passwordHash;
  const response = await request('/api/auth/change-password', 'POST', {...passwordChange, currentPassword: 'Wrong-password-123'}, data.accessToken);
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'CURRENT_PASSWORD_INCORRECT');
  assert.equal([...store.users.values()][0]!.passwordHash, before);
  assert.equal((await request('/api/auth/me', 'GET', undefined, data.accessToken)).status, 200);
}));
for (const [name, invalid] of [
  ['short', {...passwordChange, newPassword: 'short', confirmPassword:'short'}],
  ['too long', {...passwordChange, newPassword: 'x'.repeat(129), confirmPassword:'x'.repeat(129)}],
  ['mismatch', {...passwordChange, confirmPassword: 'Mismatched-value'}],
  ['same password', {...passwordChange, newPassword: account.password, confirmPassword: account.password}],
  ['extra field', {...passwordChange, role: 'ADMIN'}],
] as const) test(`password change rejects ${name} without mutation`, async () => fixture(async ({store, request, registerAndLogin}) => {
  const data = await registerAndLogin(), before = [...store.users.values()][0]!.passwordHash;
  assert.equal((await request('/api/auth/change-password', 'POST', invalid, data.accessToken)).status, 400);
  assert.equal([...store.users.values()][0]!.passwordHash, before);
  assert.equal((await request('/api/auth/me', 'GET', undefined, data.accessToken)).status, 200);
}));
test('password change denies Guest, revoked/BANNED sessions and passwordless accounts', async () => fixture(async ({store, request, registerAndLogin}) => {
  assert.equal((await request('/api/auth/change-password', 'POST', passwordChange)).status, 401);
  const data = await registerAndLogin(), user = [...store.users.values()][0]!;
  user.passwordHash = null;
  assert.equal((await request('/api/auth/change-password', 'POST', passwordChange, data.accessToken)).status, 403);
  user.status = 'BANNED';
  assert.equal((await request('/api/auth/change-password', 'POST', passwordChange, data.accessToken)).status, 401);
  user.status = 'ACTIVE';
  for (const session of store.sessions.values()) session.revokedAt = new Date();
  assert.equal((await request('/api/auth/change-password', 'POST', passwordChange, data.accessToken)).status, 401);
}));
test('password change is rate limited without expiring the valid session on wrong passwords', async () => fixture(async ({request, registerAndLogin}) => {
  const data = await registerAndLogin();
  for (let n=0;n<5;n++) assert.equal((await request('/api/auth/change-password', 'POST', {...passwordChange, currentPassword:'Incorrect-password'}, data.accessToken)).status, 403);
  assert.equal((await request('/api/auth/change-password', 'POST', passwordChange, data.accessToken)).status, 429);
  assert.equal((await request('/api/auth/me', 'GET', undefined, data.accessToken)).status, 200);
}));
test('concurrent password changes accept only one verified snapshot', async () => {
  const store = new MemoryAuthStore(), service = createAuthService(store);
  await service.register(account); const login = await service.login(account.email, account.password);
  const context = await service.authenticate(login.accessToken);
  const results = await Promise.allSettled([
    service.changePassword(context.user.id, context.sessionId, passwordChange),
    service.changePassword(context.user.id, context.sessionId, {...passwordChange, newPassword:'Another-new-password', confirmPassword:'Another-new-password'}),
  ]);
  assert.equal(results.filter(r=>r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r=>r.status === 'rejected').length, 1);
});
test('a login verified before a password change cannot create a new session afterward', async () => {
  const store = new MemoryAuthStore(), service = createAuthService(store);
  await service.register(account); const login = await service.login(account.email, account.password);
  const context = await service.authenticate(login.accessToken);
  const original = store.createSession.bind(store);
  let ready!:()=>void, release!:()=>void;
  const arrived = new Promise<void>(r=>{ ready=r; }), gate = new Promise<void>(r=>{ release=r; });
  store.createSession = async (...args) => { ready(); await gate; return original(...args); };
  const delayed = service.login(account.email, account.password);
  const rejected = assert.rejects(delayed, {statusCode:401});
  await arrived;
  await service.changePassword(context.user.id, context.sessionId, passwordChange);
  release(); await rejected;
  assert.equal([...store.sessions.values()].filter(s=>!s.revokedAt).length, 0);
});
test('password persistence failures return a sanitized error without changing the mock state', async () => fixture(async ({store, request, registerAndLogin}) => {
  const data=await registerAndLogin(), before=[...store.users.values()][0]!.passwordHash;
  store.changePassword=async()=>{throw Error('private storage detail');};
  const response=await request('/api/auth/change-password','POST',passwordChange,data.accessToken);
  assert.equal(response.status,500);
  assert(!JSON.stringify(response.body).includes('private'));
  assert.equal([...store.users.values()][0]!.passwordHash,before);
  assert.equal((await request('/api/auth/me','GET',undefined,data.accessToken)).status,200);
}));
