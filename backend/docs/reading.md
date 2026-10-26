# Favorites, reading progress and reading history

All nine endpoints require `Authorization: Bearer <access-token>`. USER and ADMIN
operate on their own data, using the existing Authentication middleware. Never
send a `userId`: unknown body/query fields are rejected. Responses use
`Cache-Control: no-store` and the existing sanitized error handler.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/me/favorites` | Paginated favorites, newest addition first |
| POST | `/api/me/favorites` | Add `{ "storyId": "UUID" }`, HTTP 201 |
| DELETE | `/api/me/favorites/:storyId` | Idempotent removal, `{ removed: boolean }` |
| GET | `/api/me/reading-progress` | Paginated recent reading positions |
| GET | `/api/me/reading-progress/:storyId` | Resume position and current version |
| PUT | `/api/me/reading-progress/:storyId` | Save chapter position, HTTP 200 |
| GET | `/api/me/reading-history` | Paginated chapter visits, newest first |
| POST | `/api/me/reading-history` | `{ "storyId": "UUID", "chapterId": "UUID" }` |
| DELETE | `/api/me/reading-history` | Clear own visits, `{ deletedCount: number }` |

List query parameters: `page=1`, `limit=20`, maximum `limit=100`. Integers only;
overflowing pagination, repeated query keys and unknown parameters return 400.
Lists use descending timestamps and descending UUIDs as a stable tie breaker.
List response: `{ success, message, data: [], pagination: { page, limit, total, totalPages } }`.
Story metadata includes `id`, `title`, `slug`, `coverUrl`, `type`, `authorName`;
chapter metadata includes `id`, `chapterNumber`, `title`. No chapter text, image
storage identifiers, account details or tokens are included in these lists.

## Favorites

Only PUBLISHED stories can be added; duplicate addition returns 409
`FAVORITE_EXISTS` without inserting another row. Lists exclude unpublished
stories; their existing favorites remain stored, allowing later republication.
Removal can still delete one's favorite for an unpublished story and never
deletes a Story. Another user's rows cannot be selected or removed.

## Save and resume protocol

1. GET `/api/me/reading-progress/:storyId` before saving.
2. For a new reader, the response has `data: null`, `version: null`,
   `resume: "FIRST_PUBLISHED_CHAPTER"`. The frontend can fetch the first public
   chapter from the existing public chapter-list API. There may be no published
   chapters yet; this response does not assert one exists.
3. PUT the new position with `expectedUpdatedAt` set to the returned `version`.
4. Store the new returned `version` for the next PUT.
5. On HTTP 409 `PROGRESS_VERSION_CONFLICT`, re-fetch the position. Reconcile the
   user's current intent; do not blindly refresh the version and replay an old
   request, which would defeat protection against stale updates.

First NOVEL save example (UUIDs must refer to actual published data):

```json
{
  "chapterId": "20000000-0000-4000-8000-000000000001",
  "progressPercent": 25.25,
  "expectedUpdatedAt": null,
  "textOffset": 120
}
```

COMIC save example:

```json
{
  "chapterId": "20000000-0000-4000-8000-000000000002",
  "progressPercent": 50,
  "expectedUpdatedAt": null,
  "pageNumber": 2,
  "scrollOffset": 180
}
```

`expectedUpdatedAt` is required, either null for initial creation or a valid
ISO timestamp from the server. Saved versions increase by at least 1ms per row,
including saves within the same millisecond. A first request with a non-null
version, or a later request with null/stale version, receives 409. Timestamps
are server-generated; a client cannot set the next version. Two devices with
the same version cannot both overwrite the position. Backward reading is
allowed when the supplied version is current.

`progressPercent` is a **chapter-level** value from 0 to 100, with at most two
decimal places, returned as a JSON number and stored in existing Decimal(5,2).
It is not an aggregate completion percentage for the whole Story. The client
computes this value; the server validates its range/precision, not its relation
to the supplied offset or rendered screen dimensions.

NOVEL: `textOffset` defaults to zero, uses JavaScript UTF-16 code units of the
stored plain text, and must not exceed `content.length`. Non-null comic fields
are rejected. COMIC: `pageNumber` is required and must match an actual
ChapterPage.pageNumber; page labels may have gaps under the existing schema.
`scrollOffset` defaults to zero and is a nonnegative integer pixel offset within
that page. Non-null `textOffset` is rejected. Pixel height is client-rendering
dependent, so scrollOffset cannot be checked against a server-known height.
All offsets/page numbers are bounded by PostgreSQL INTEGER limits.

The chapter must belong to the supplied story. Both must be PUBLISHED, and the
chapter must satisfy the same published-content validation as the public reader
(nonblank NOVEL text without pages, or valid COMIC pages without text).
Unpublished/missing resources return 404, with no draft content exposed.

GET detail revalidates saved positions against the current chapter. If an
editor shortened text, the returned offset is clamped; if a comic page was
removed, it falls back to the first existing page with scroll zero.
`positionAdjusted: true` marks such a correction. GET does not write data.
If the saved chapter is no longer public/readable, GET returns null data and
the first-chapter state, preserving the saved `version` so a new public chapter
can be saved. An unpublished Story returns 404. List endpoints filter by current
publication status; use GET detail to revalidate a selected resume position
against editorial content changes.

## History

Record a visit when opening a chapter, not on scroll events. Saving progress
does not create history. A visit to the same user/story/chapter in the previous
30 seconds (inclusive) returns the existing entry: HTTP 200, `recorded: false`.
A new visit returns HTTP 201, `recorded: true`. Repeated calls do not extend the
window; another visit after it may create a new row. This is debouncing, not
permanent idempotency or an anti-spam quota. Multiple distinct chapters can
still produce multiple entries. Lists exclude unpublished stories/chapters.
Clearing history affects only the authenticated user's history and never
removes progress, favorites or anyone else's history.

## Transactions and limits

The shared `src/config/prisma.ts` client is reused. Writes acquire a PostgreSQL
transaction advisory lock derived from user UUID, shared by all three modules.
ReadCommitted takes fresh reads after waiting for that lock, serializing
duplicate favorites, progress version checks, history deduplication and clears
across application processes. Locks release on commit/rollback. A 5-second
lock wait and 10-second transaction timeout bound contention. Serializable
conflicts retry at most three attempts; uniqueness/lock conflicts yield safe
409 responses. Unexpected exceptions use the existing generic HTTP 500 handler.

Story and Chapter share locks use the existing writer order (parent then child),
protecting publication/type/page validation while the personal-data transaction
commits. Lists use RepeatableRead so counts and rows share a snapshot. The
existing unique keys and composite chapter/story foreign keys remain intact.
No schema/migration changes are needed.

Advisory locking is cooperative: scripts or future writers bypassing these
services can bypass the version/dedup protocol. No additional DB CHECK or trigger
enforces cross-table publication or debounce rules. Serialization/rollback and
concurrency tests use isolated memory stores and a mock Prisma transaction;
they do not claim a real PostgreSQL write/concurrency load test. Existing smoke
tests query real PostgreSQL read-only. No real user/story/reading data is seeded
or changed by this feature's automated tests.

## Files

Created:

- `src/types/reading.types.ts`
- `src/middlewares/reading.validation.ts`
- `src/routes/reading.router.ts`
- `src/routes/favorite.routes.ts`
- `src/routes/reading-progress.routes.ts`
- `src/routes/reading-history.routes.ts`
- `src/controllers/favorite.controller.ts`
- `src/controllers/reading-progress.controller.ts`
- `src/controllers/reading-history.controller.ts`
- `src/services/reading.store.ts`
- `src/services/reading.service.ts`
- `src/services/favorite.service.ts`
- `src/services/reading-progress.service.ts`
- `src/services/reading-history.service.ts`
- `tests/helpers/memory-reading.store.ts`
- `tests/reading.test.ts`
- `tests/reading.store.test.ts`
- `docs/reading.md`

Updated:

- `src/app.ts`: mount three personal routers.
- `src/services/chapter.service.ts`: export the existing published-data predicate
  for reuse, with no change to its behavior.
- `package.json`: include new tests and `npm run test:reading`.

Run focused mock tests with `npm run test:reading`, or all tests with `npm test`.
No new dependencies, schema, migrations, HTTP Authentication behavior, frontend
or Cloudinary operations are introduced.

## Verification on 2026-10-18

- Prisma Validate/Generate, TypeScript and build passed.
- Full suite: 176/176 tests passed (136 existing + 40 new).
- Migration Status: both existing migrations applied; database schema up to date.
- Real PostgreSQL smoke check ran in READ ONLY transactions: active-user lookup,
  all three list queries, and advisory-lock SQL succeeded.
- Final read-only counts: users 1; stories, chapters, chapter_pages, favorites,
  reading_progress, reading_history all 0. No test data was inserted.
- Running backend on port 4000: health 200; all three private list endpoints
  returned 401 to unauthenticated requests.
