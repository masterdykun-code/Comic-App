# Ratings and Comments

This module reuses the existing Rating and Comment models and the shared Prisma
Client. No schema, migration, Authentication behavior or other module changes
are required. All mutations in automated tests use isolated memory/mock stores;
the real webnovel_db is not seeded, modified or reset.

## API

| Method | Path | Access / behavior |
| --- | --- | --- |
| GET | `/api/stories/:storyId/ratings` | Public, PUBLISHED Story only |
| PUT | `/api/stories/:storyId/my-rating` | Authenticated owner; upsert |
| DELETE | `/api/stories/:storyId/my-rating` | Authenticated owner; idempotent |
| GET | `/api/stories/:storyId/comments` | Public visible root threads |
| POST | `/api/stories/:storyId/comments` | Authenticated, PUBLISHED Story only |
| GET | `/api/comments/:id/replies` | Public visible root's replies, paginated |
| PATCH | `/api/comments/:id` | Owner only; visible comment/thread, PUBLISHED Story |
| DELETE | `/api/comments/:id` | Owner only; leaf comments only |
| PATCH | `/api/admin/comments/:id/moderate` | Active ADMIN only |

All list APIs accept `page` (default 1), `limit` (default 20, maximum 100), and
`sort=newest|oldest`. Defaults are newest for ratings/root comments and oldest
for replies. Sorting uses creation time and UUID as a stable tie breaker.
Editing a record does not change its creation order.

List responses use `{ success, message, data, pagination }`. Pagination includes
`page`, `limit`, `total`, `totalPages`. All responses have `Cache-Control: no-store`
to avoid retaining content after moderation. Unknown body/query fields, repeated
query keys, invalid UUIDs, numeric overflow and invalid sort values return 400.
Guests may read public data; all mutations require the existing Bearer Access
Token middleware. Client-supplied userId, role/status reassignment and foreign
Story IDs in request bodies are rejected by strict Zod schemas.

## Ratings

PUT body: `{ "score": 5, "reviewText": "An enjoyable story" }`.
Score must be an integer 1..5. Optional reviewText supports null (clear review)
or a nonblank plain-text string up to 2000 UTF-16 code units. Omitting reviewText
while updating preserves the previous review. Upsert uses the existing unique
`(userId, storyId)` key; concurrent requests cannot create duplicate ratings.
The last serialized PUT wins; no rating version protocol is introduced.

GET includes `summary` independent of page size:

```json
{
  "averageScore": 3.33,
  "totalRatings": 3,
  "distribution": { "1": 1, "2": 0, "3": 0, "4": 1, "5": 1 }
}
```

The average is rounded to two decimal places. For no ratings it is null, with
zero totals and all five star buckets present. Summary and page rows share one
RepeatableRead transaction snapshot. Ratings include only record metadata and
`user: { username, displayName, avatarUrl }`; no account IDs, email, role, hashes
or tokens are exposed. Draft/missing Stories return 404 for public reads/PUT.
DELETE removes only the authenticated user's rating, returning
`{ removed: boolean }`; withdrawal is allowed even after the Story becomes DRAFT.

## Comments and replies

POST body: `{ "content": "A comment", "parentId": null }`, with optional parentId
for replies. PATCH body: `{ "content": "Updated text" }` only. Text is trimmed,
nonblank and limited to 3000 UTF-16 code units. Control characters, invisible-only
input and angle brackets/HTML are rejected. Newlines/tabs remain plain text.
The API stores plain text; clients must render it as text instead of interpreting
it as HTML. Validation does not attempt arbitrary HTML rewriting or sanitization.

A reply must reference a VISIBLE root belonging to the same Story. Replying to a
reply returns 400 `REPLY_DEPTH_EXCEEDED`; missing, hidden or cross-story parents
return 404. Existing composite parent/story foreign keys remain unchanged.

GET comments paginates **roots**, including up to 20 visible replies per root
(oldest first) and `repliesPagination` with the visible reply total. Use
GET `/api/comments/:rootId/replies?page=2&limit=20` for the rest. The extra endpoint
prevents silently truncating large discussions while bounding each response.
At most 100 roots and 20 replies/root are included in a root-list request.
Hidden replies never contribute to public reply counts. Hidden roots suppress
the entire thread, including visible children and the direct replies endpoint.
Draft Story threads likewise return 404. No recursion or grandchildren are
included in public responses.

## Ownership, deletion and moderation

Only the owner can edit or delete, including when a non-owner happens to be an
ADMIN. An owner cannot edit a hidden comment or a reply under a hidden root:
409 `COMMENT_HIDDEN`. Editing cannot change status, parent, Story or ownership.

The current schema has no deletedAt/deletion-state field. HIDDEN is reserved for
moderation, not used as a pretend soft-delete flag. Therefore DELETE permanently
removes an owned **leaf**, including a hidden leaf or one on a DRAFT Story. A
comment with any replies, even hidden ones, returns 409 `COMMENT_HAS_REPLIES`.
This preserves replies and never deletes someone else's content. Leaf deletion
is not reversible; implementing recoverable deletion/tombstones would need a
separate schema design and explicit migration approval.

Moderation body: `{ "status": "VISIBLE" }` or `{ "status": "HIDDEN" }`. Both
middleware authorization and a transaction-time active ADMIN check are enforced.
Moderation works on published and unpublished Stories. The response confirms
only id, storyId, status and updatedAt, without returning hidden content. Hiding
a root does not rewrite its children's statuses. Restoring a root restores
visibility of children that are themselves VISIBLE; hidden children stay hidden.
Restoring a child under a hidden root does not expose it publicly.

Create and edit share a limit of 10 attempts/minute per authenticated account,
plus 60 attempts/minute per IP. Failed attempts also count. Token refresh does
not reset the account key. Limits use the existing express-rate-limit MemoryStore,
so they are per process and reset on restart; multiple application processes
would need a shared rate-limit store for a global quota. Public reads and ADMIN
moderation are not counted in the comment create/edit quota.

## Concurrency and operational limits

Writes use a PostgreSQL transaction-scoped advisory lock per Story, with a
separate namespace from reading/bootstrap locks. ReadCommitted ensures a fresh
view after acquiring a waiting lock. Story row locks use FOR SHARE, matching the
existing parent-before-child writer order and protecting publication checks.
Rating upserts, reply creation, root deletion and moderation are serialized
within a Story; a raced deletion/reply cannot orphan a reply. Comment identity
is resolved read-only, then the record is re-read inside the write transaction.

Lock wait is bounded to 5 seconds and the transaction to 10 seconds. P2034 retries
up to three attempts; uniqueness/FK/lock conflicts return sanitized 409; missing
records return 404. Unexpected errors use the existing safe HTTP 500 handler.
All transactions roll back on exceptions.

The lock protocol is cooperative; future direct SQL writers must preserve it.
A particularly hot Story can contend because its feedback writes serialize.
Concurrency and rollback tests use safe mocks, not a real PostgreSQL write/load
test. No moderation audit log or recoverable deletion exists in the current
schema; this implementation does not claim otherwise. Rating review moderation,
comment likes and multi-criteria scores are outside this step.

## Files

Created:

- `src/types/feedback.types.ts`
- `src/middlewares/feedback.validation.ts`
- `src/middlewares/comment.rate-limit.ts`
- `src/services/feedback.store.ts`
- `src/services/feedback.service.ts`
- `src/services/rating.service.ts`
- `src/services/comment.service.ts`
- `src/controllers/rating.controller.ts`
- `src/controllers/comment.controller.ts`
- `src/routes/rating.routes.ts`
- `src/routes/comment.routes.ts`
- `tests/helpers/memory-feedback.store.ts`
- `tests/feedback.test.ts`
- `tests/feedback.store.test.ts`
- `docs/feedback.md`

Updated: `src/app.ts` (mount routers) and `package.json` (test scripts).
No new dependencies or environment variables are needed.

Focused tests: `npm run test:feedback`. Full regression: `npm test`.

## Verification on 2026-10-18

- Prisma Validate/Generate, TypeScript and build passed.
- Full suite: 229/229 passed, including 53 new feedback tests.
- Migration Status: the two existing migrations are applied; schema up to date.
- Real PostgreSQL READ ONLY smoke: rating aggregation, root/reply list queries,
  and advisory-lock SQL succeeded. Final counts: users 1, stories 0, ratings 0,
  comments 0; no fixtures were inserted into webnovel_db.
- Existing backend on port 4000: health 200; absent Story/Comment public reads
  return 404; unauthenticated rating/comment/moderation writes return 401.
