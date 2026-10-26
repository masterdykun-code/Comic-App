import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { configureIntegration } from './environment';

test('EPUB PostgreSQL: atomic drafts, duplicate rejection and rollback; only owned test fixtures cleaned', async () => {
  configureIntegration();
  const { getPrismaClient, disconnectPrisma } =
    await import('../../src/config/prisma.js');
  const { prismaEpubImportStore: store } =
    await import('../../src/services/epub-import.store.js');
  const db = getPrismaClient(),
    actor = randomUUID(),
    success = randomUUID(),
    failure = randomUUID(),
    suffix = randomUUID().replaceAll('-', '');
  const identity = async () => {
    const rows = await db.$queryRaw<
      Array<{ db: string; schema: string }>
    >`SELECT current_database() AS db,current_schema() AS schema`;
    assert.equal(rows[0]?.db, 'webnovel_test_db');
    assert.equal(rows[0]?.schema, 'public');
  };
  try {
    await identity();
    await db.user.create({
      data: {
        id: actor,
        username: `epub_${suffix}`,
        email: `${suffix}@example.test`,
        displayName: 'EPUB fixture',
        passwordHash: null,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    const metadata = {
      title: `EPUB fixture ${suffix}`,
      authorName: 'QA',
      description: 'Fixture only',
      genreIds: [],
      useCover: false,
    };
    const chapters = [
      {
        chapterNumber: 1,
        title: 'Chương 1',
        content: 'Dòng đầu.\n\nDòng tiếp.',
      },
      { chapterNumber: 2, title: 'Chương 2', content: 'Kết thúc.' },
    ];
    await assert.rejects(
      () =>
        store.create(
          failure,
          actor,
          { ...metadata, title: `Rollback ${suffix}` },
          `epub-rollback-${suffix}`,
          '',
          [chapters[0]!, chapters[0]!],
        ),
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        'statusCode' in e &&
        e.statusCode === 409,
    );
    assert.equal(await db.story.count({ where: { id: failure } }), 0);
    assert.equal(await db.chapter.count({ where: { storyId: failure } }), 0);
    const result = await store.create(
      success,
      actor,
      metadata,
      `epub-${suffix}`,
      '',
      chapters,
    );
    assert.equal(result.chapterCount, 2);
    const row = await db.story.findUniqueOrThrow({
      where: { id: success },
      include: { chapters: { orderBy: { chapterNumber: 'asc' } } },
    });
    assert.equal(row.publishStatus, 'DRAFT');
    assert(row.chapters.every((c) => c.publishStatus === 'DRAFT'));
    assert.deepEqual(
      row.chapters.map((c) => c.content),
      chapters.map((c) => c.content),
    );
    await assert.rejects(() =>
      store.create(success, actor, metadata, `epub-${suffix}`, '', chapters),
    );
    assert.equal(await db.chapter.count({ where: { storyId: success } }), 2);
  } finally {
    await identity();
    await db.$transaction(async (tx) => {
      const owned = await tx.story.findMany({
        where: { id: { in: [success, failure] }, createdBy: actor },
        select: { id: true },
      });
      await tx.chapter.deleteMany({
        where: { storyId: { in: owned.map((s) => s.id) } },
      });
      await tx.story.deleteMany({
        where: { id: { in: owned.map((s) => s.id) }, createdBy: actor },
      });
      await tx.user.deleteMany({
        where: { id: actor, username: `epub_${suffix}` },
      });
    });
    assert.equal(
      await db.story.count({ where: { id: { in: [success, failure] } } }),
      0,
    );
    assert.equal(await db.user.count({ where: { id: actor } }), 0);
    await disconnectPrisma();
  }
});
