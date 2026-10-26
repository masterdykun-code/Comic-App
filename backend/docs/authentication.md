# Authentication

## Files created or changed (paths relative to backend)

Created:
- `src/config/auth.ts`, `src/types/auth.types.ts`
- `src/services/auth.service.ts`, `src/services/auth.store.ts`
- `src/controllers/auth.controller.ts`, `src/routes/auth.routes.ts`
- `src/middlewares/auth.middleware.ts`, `src/middlewares/auth.validation.ts`, `src/middlewares/auth.rate-limit.ts`
- `prisma/migrations/20261017160606_auth_sessions/migration.sql`
- `tests/auth.test.ts`, `tests/helpers/memory-auth.store.ts`
- `docs/authentication.md`

Changed:
- `src/app.ts`, `src/server.ts`, `src/middlewares/error-handler.ts`
- `prisma/schema.prisma`, `package.json`, `package-lock.json`
- `.env` (ignored local secret only), `.env.example` (placeholder only)

Generated artifacts: `src/generated/prisma/` and `dist/` (both ignored).

## API contract

All responses use the existing `success`, `message`, `data` / `error.code`
envelope. Auth responses set `Cache-Control: no-store`.

| Method | Path | JSON body / authorization | Result |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `username`, `email`, `password` | 201, public user; no automatic login |
| POST | `/api/auth/login` | `email`, `password` | 200, `data.user`, `accessToken`, `refreshToken`, `tokenType`, `expiresIn` |
| POST | `/api/auth/refresh` | `refreshToken` | 200, replacement access + refresh token pair |
| POST | `/api/auth/logout` | `refreshToken` | 200, idempotent session revocation |
| GET | `/api/auth/me` | `Authorization: Bearer <accessToken>` | 200, public user |
| PATCH | `/api/auth/me` | Bearer token; `displayName` and/or `avatarUrl` | 200, updated public user |

Username: 3–30 ASCII letters/digits/underscores; normalized to lowercase.
Email: validated, max 254 characters, normalized to lowercase.
Password: 8–128 characters, never trimmed; Argon2id (19 MiB, 2 iterations,
parallelism 1, random salt). Registration rejects unknown fields, including
`role`, `status` and `passwordHash`; new accounts are always ACTIVE / USER.
Unique conflicts, including concurrent registration, return generic 409.

Profile updates reject unknown fields. `displayName` is 1–100 characters after
trimming. `avatarUrl` accepts HTTP/HTTPS URLs up to 2048 characters or `null`;
the server does not fetch the URL. No password/email/role/status update is exposed.

Login failures for missing accounts, wrong passwords, BANNED users and OAuth-only
users all return the same 401. A dummy Argon2 hash verification is used for accounts
without a password hash. Invalid bodies return 400; rate limits return 429;
unexpected errors return generic 500. No credential values are logged or echoed.

## Token/session lifecycle

Access JWT: HS256 only, expires after 900 seconds, with fixed issuer/audience,
subject user UUID, session UUID, token-use claim and random JWT ID. The secret
comes exclusively from `JWT_SECRET`. Startup rejects a missing/placeholder key
or a key shorter than 32 bytes. `.env` is ignored by Git; `.env.example` contains
only a placeholder. A random local key was generated without printing it.

Refresh token: 48 random bytes, base64url encoded. The database stores only its
SHA-256 hash. A session expires absolutely after 30 days (rotation does not extend
it). Each refresh transaction locks the session with `SELECT ... FOR UPDATE`,
then rechecks the token, session and account, consumes the old token and inserts
its replacement. A consumed-token replay revokes the entire session and commits
that revocation before returning 401. Concurrent refreshes of the same token
therefore revoke the session; clients must serialize refresh requests.

Logout accepts a current or previously consumed refresh token and revokes its
session, including outstanding access tokens. Unknown well-formed tokens return
the same success response. Other device sessions are unaffected. Consumed token
hashes must be retained until the session has expired to support replay detection.
There is no scheduled cleanup job in this step.

Every authenticated request verifies the JWT and loads the live session/user.
Expired/revoked sessions and non-ACTIVE users return 401. Roles are read from the
database rather than trusted from old JWT claims. Authorization middleware usage:

```ts
router.get('/admin-resource', authenticate, authorizeRole('ADMIN'), controller);
```

The ADMIN resource exists only in tests; no production administration API or
default ADMIN account was added. Protect token transport with HTTPS in deployment.
Tokens are returned in JSON for the requested API contract; no cookies or browser
token storage are introduced by this backend step.

## Rate limits and deployment

Per source IP, per process: register 5/hour; login 10/15 minutes; refresh and
logout each 60/15 minutes. Includes failed validation attempts. Uses the default
in-memory store of express-rate-limit and Express's default `trust proxy=false`.
For deployment behind a proxy, configure only trusted proxy hops. Multiple app
instances need a shared rate-limit store to enforce one global quota; no Redis
or tech stack change is introduced here.

## Migration and tests

`20261017160606_auth_sessions` adds only `auth_sessions` and `refresh_tokens`,
their primary keys, five indexes (including unique token hash) and two restrictive
foreign keys. It is transactional and preserves existing business tables and
the seven SQL CHECK constraints from the initial migration.

`npm test` runs Auth and Genres suites; `npm run test:auth` and
`npm run test:genres` run them individually. Auth tests use an injected memory
store and ephemeral signing key, with real HTTP requests, JWT and Argon2id.
They never write to PostgreSQL or create real ADMIN users. Multi-process row-lock
behavior is implemented in the Prisma store but the memory tests do not prove
PostgreSQL concurrency behavior. Genres retains its read-only integration suite
against the existing empty database; it expects empty business tables and never
seeds or clears them.

The SQL schema, migration checksum and row counts are checked separately after
deployment. Test servers use ephemeral loopback ports and close after tests.

Implementation references:
[node-argon2](https://github.com/ranisalt/node-argon2),
[jsonwebtoken](https://github.com/auth0/node-jsonwebtoken),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[OWASP OAuth2 rotation](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html).
