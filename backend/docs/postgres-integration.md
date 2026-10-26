# Step 13: isolated PostgreSQL integration tests

## Local configuration and commands

The target is **webnovel_test_db**, never webnovel_db. After explicit approval,
the local test database was created with `CREATE DATABASE "webnovel_test_db"`.
No roles/privileges were granted, production data was not copied, and no reset,
db push, DROP or migration editing was used.

For a new machine, an authorized PostgreSQL operator can run that single CREATE
DATABASE command in pgAdmin while connected to the maintenance `postgres`
database. If it already exists, inspect its contents before proceeding. The test
runner deliberately does not create databases or grant privileges automatically.

Copy `.env.integration.example` to `.env.integration` and fill only:

```dotenv
INTEGRATION_DATABASE_URL="postgresql://postgres:YOUR_URL_ENCODED_PASSWORD@localhost:5432/webnovel_test_db?schema=public"
```

URL-encode password characters. Do not paste credentials in chat. The actual
`.env.integration` is ignored by Git; the placeholder example is allowed.
The local file was prepared using the existing PostgreSQL account only after
the user's explicit approval. The runner never derives a test URL from `.env`
or an inherited DATABASE_URL. A dedicated test-only owner/account can be used
instead; no code requires a PostgreSQL superuser or CREATEDB at test runtime.

From `C:\Users\Admin\Desktop\QLDAPM\qldapm\backend`:

```powershell
npm run integration:prepare
npm run test:postgres
```

`integration:prepare` runs guarded preflight, existing `prisma migrate deploy`,
schema verification and migration status only. `test:postgres` runs the complete
existing regression suite on the empty test DB, then real integration tests,
cleanup verification and test migration status. `test:integration` runs just the
real integration suite with the same preflight/deploy/cleanup guards.

Use `test:postgres` for this step, rather than running the older `npm test` alone:
some legacy regression files perform read-only PostgreSQL smoke tests using the
ordinary DATABASE_URL. The guarded runner supplies the separate test URL to all
child processes so those smoke tests also use webnovel_test_db. It binds a fresh
HTTP server to an ephemeral loopback port and does not use/restart port 4000.

## Safety and migration checks

- Configuration requires an explicit local test URL with the exact database
  pathname; URL connection overrides and non-public schemas are rejected.
- `.env.integration` accepts only INTEGRATION_DATABASE_URL. A disposable JWT
  secret is generated in memory; production Cloudinary settings are removed.
- `current_database()` and `current_schema()` are checked independently of the
  URL before migration, test work and fixture cleanup. The suite checks the
  Prisma connection itself, and raw SQL connections are verified too.
- A test-database advisory lock prevents two guarded runners using the same DB.
- A preexisting nonempty application table stops execution. Even residual data
  from an interrupted previous run is not automatically erased. Inspect it
  manually, establish ownership and decide how to recover; no reset is offered.
- Unknown/partial tables, schemas, functions, triggers and mismatching migration
  history/checksums stop execution. A clean database or the project's exact,
  empty migrated schema is accepted.
- Verification compares application table/column sets, NOT NULL flags, enum
  labels, PK/FK definitions, unique/index definitions, CHECK names/types and
  validated constraints. Composite Chapter/Story and Comment/Story FKs are
  explicitly checked. The tests exercise every business CHECK with failing SQL.
- PostgreSQL's NOT NULL entries in newer pg_constraint catalogs are checked via
  pg_attribute, avoiding a false mismatch with migration names.
- Existing Prisma Config and migration files are reused unchanged. Deploy does
  not need a shadow database or migrate reset.

## Real database coverage

The suite uses the actual Express app, shared Prisma Client, PrismaPg adapter,
production services/stores, PostgreSQL constraints and multiple real sessions.
Only external Cloudinary storage is mocked; PostgreSQL behavior is not mocked.

1. Schema and distinct real backend connections.
2. Concurrent first ADMIN bootstrap creates exactly one **test** ADMIN.
3. USER registration/login, Argon2id storage, forbidden role assignment and
   USER/ADMIN authorization.
4. Refresh rotation, replay, logout and session revocation; refresh hashes only.
5. Preflight refuses populated data without deleting it.
6. Concurrent refresh accepts one rotation, detects replay and revokes access.
7. Controlled Genre fixture, NOVEL/COMIC Stories, StoryGenre relations,
   DRAFT-to-PUBLISHED transitions and draft visibility.
8. NOVEL text/COMIC page persistence and publication; concurrent duplicate
   chapterNumber returns one 201 and one 409.
9. Favorites create/delete, ownership and concurrent duplicate prevention.
10. NOVEL/COMIC progress, resume, version conflicts and published chapter checks.
11. ReadingHistory concurrent deduplication and isolated deletion.
12. Rating upsert concurrency, summary and own-rating deletion.
13. One-level comments, cross-story/deep reply rejection, ownership, moderation,
    hidden-thread suppression and protected parent deletion.
14. Reply/delete and reply/moderation races across real transactions.
15. Reading/Feedback requests visibly wait on locks held by separate PostgreSQL
    connections; pg_locks confirms a real waiter before the holder releases.
16. Direct SQLSTATE checks for unique chapter/page/rating/favorite keys; all seven
    CHECK constraints; composite Progress/History/Comment FKs; RESTRICT deletes.
17. Intentional transaction failure rolls back updates and releases its lock.
18. Upload authenticates a real test ADMIN/session and uses mocked storage,
    leaving story/page counts unchanged. No actual Cloudinary upload occurs.

Fixtures use a random run prefix and random in-memory password, never a real
ADMIN. Cleanup verifies test identity and ownership again, then deletes only
this run's verified users/resources in foreign-key order inside a transaction.
It does not use TRUNCATE, DROP, cascaded global cleanup or production connections.
On an unexpected extra user/story/genre, cleanup refuses to guess ownership.
Successful completion confirms all 13 application tables empty; migrations stay.

The custom reporter omits raw errors, SQL, request bodies, stacks, token values,
passwords and connection strings. It permits machine error codes/numeric assertion
values for diagnosis. Failed test labels are shown; raw Prisma CLI stderr is not.
The suite reports through Node's test runner (18 scenarios plus their parent test).

## Bug found and Backend fix

Concurrent chapter creation originally produced `[201, 500]`. A serialization
failure at the raw `SELECT ... FOR UPDATE` was surfaced by Prisma 7 as
`P2010` with SQLSTATE `40001`, bypassing code that retried only `P2034`.

`src/utils/transaction-conflict.ts` now recognizes P2034 and known aborted
serialization/deadlock SQLSTATEs (40001/40P01), including raw-query error metadata.
Stories/Chapters reuse it with their existing maximum of five attempts. Unknown
errors are not retried. Exhaustion remains a safe 409. Both mock regressions and
the original real race verify the fix; the real duplicate race now returns
`[201, 409]` with one row. No API contract or migration changed.

Test-only corrections: schema inspection accounts for NOT NULL catalog entries;
RESTRICT delete assertions use SQLSTATE 23001, distinct from insert/update FK
violations (23503). These are not application data/constraint failures.

## Limits

This is a repeatable functional/concurrency suite, not a sustained load test or
proof of every possible interleaving. An external actor bypassing the runner's
lock can still interfere with a test database; do not share it for manual work.
A crash may leave fixtures behind; the next run stops rather than erasing them.
Production credentials are never needed by the test runner. Production integrity
was checked separately using a READ ONLY before/after digest of every public
table's rows (including migrations) and constraint definitions, without logging
or saving raw rows/hash/password/token values.

## Files

Created:

- `.env.integration` (local secret; ignored)
- `.env.integration.example` (placeholder only)
- `tests/integration/environment.ts`
- `tests/integration/database.ts`
- `tests/integration/run.ts`
- `tests/integration/safe-reporter.cjs`
- `tests/integration/postgres.test.ts`
- `tests/integration-safety.test.ts`
- `src/utils/transaction-conflict.ts`
- `docs/postgres-integration.md`

Updated: `.gitignore`, `package.json`, `src/services/story.service.ts`,
`src/services/chapter.service.ts`. No new dependencies, schema/migration changes,
frontend or Admin Web/Mobile work.

## Final verification on 2026-10-18

- TypeScript and build passed; Prisma Client 7.10.1 generated successfully.
- Regression: 238/238 passed (229 existing + 9 safety/retry regressions), all
  PostgreSQL smoke queries redirected to the separate test database.
- Real integration: 19/19 passed (18 scenarios plus the parent suite).
- Existing two migrations applied; test migration status up to date.
- Test fixture cleanup: all 13 application tables empty, migrations preserved.
- Final READ ONLY primary audit matched the baseline: every row in all 14 public
  tables (including migration metadata) and constraint definitions unchanged.
- No real Cloudinary upload, main ADMIN changes, production test fixtures or
  destructive database operations occurred. No remaining failing checks.
