const { backendRequire, APP_TABLES, assertEmpty, assertTestDatabase } = require('./safety.cjs');
const { createFixtures, assertPrismaTest, runPrefix } = backendRequire(
  './tests/browser/fixtures.ts',
);
const novelText = () =>
  'Dòng mở đầu.\nDòng thứ hai được giữ nguyên.\n\n' +
  Array.from(
    { length: 180 },
    (_, i) =>
      `Đoạn ${i + 1}: Người đọc bước qua khu vườn xanh và lắng nghe câu chuyện trong gió.\n`,
  ).join('');
async function identity(tx) {
  const rows = await tx.$queryRawUnsafe(
    'SELECT current_database() AS name, current_schema() AS schema',
  );
  if (rows[0]?.name !== 'webnovel_test_db' || rows[0]?.schema !== 'public')
    throw new Error('Fixture transaction target refused');
}
async function createContent(db, runId, imageBase, manifest) {
  await assertPrismaTest(db);
  const actors = await createFixtures(db, runId);
  Object.assign(manifest, actors, { prefix: runPrefix(runId) });
  const prefix = manifest.prefix;
  await db.$transaction(
    async (tx) => {
      await identity(tx);
      manifest.genre = await tx.genre.create({
        data: { name: prefix + 'Fantasy', slug: prefix + 'fantasy' },
      });
      manifest.otherGenre = await tx.genre.create({
        data: { name: prefix + 'Other', slug: prefix + 'other' },
      });
      for (let i = 0; i < 15; i++) {
        const kind = i === 0 ? 'NOVEL' : i === 1 ? 'COMIC' : 'NOVEL';
        const name =
          i === 0
            ? 'NOVEL'
            : i === 1
              ? 'COMIC'
              : i === 2
                ? 'DRAFT'
                : `Catalog ${String(i).padStart(2, '0')}`;
        const row = await tx.story.create({
          data: {
            title: prefix + name,
            slug: prefix + name.toLowerCase().replaceAll(' ', '-'),
            type: kind,
            authorName: 'Mobile E2E fixture',
            description: 'Nội dung fixture kiểm thử, không phải truyện thật.',
            coverUrl: imageBase + '/cover.png',
            publishStatus: i === 2 ? 'DRAFT' : 'PUBLISHED',
            createdBy: actors.admin.id,
            createdAt: new Date(i < 3 ? Date.now() - i * 1000 : Date.UTC(2020, 0, i)),
            genres: { create: { genreId: i < 2 ? manifest.genre.id : manifest.otherGenre.id } },
          },
        });
        manifest.storyIds.push(row.id);
        if (i === 0) manifest.novel = row;
        if (i === 1) manifest.comic = row;
        if (i === 2) manifest.draft = row;
      }
      for (const [story, type] of [
        [manifest.novel, 'NOVEL'],
        [manifest.comic, 'COMIC'],
      ]) {
        const chapters = [];
        for (const number of [1, 3, 9]) {
          const chapter = await tx.chapter.create({
            data: {
              storyId: story.id,
              chapterNumber: number,
              title: `${type} chapter ${number}`,
              publishStatus: number === 9 ? 'DRAFT' : 'PUBLISHED',
              content: type === 'NOVEL' ? novelText() : null,
            },
          });
          chapters.push(chapter);
          manifest.chapterIds.push(chapter.id);
          if (type === 'COMIC')
            for (const page of number === 1 ? [7, 1, 3] : [1]) {
              const row = await tx.chapterPage.create({
                data: {
                  chapterId: chapter.id,
                  pageNumber: page,
                  imageUrl: imageBase + (page === 7 ? '/missing.png' : `/page-${page}.png`),
                },
              });
              manifest.pageIds.push(row.id);
            }
        }
        manifest[type === 'NOVEL' ? 'novelChapters' : 'comicChapters'] = chapters.map(
          ({ content: _content, ...row }) => row,
        );
      }
      const hidden = await tx.comment.create({
        data: {
          userId: actors.admin.id,
          storyId: manifest.novel.id,
          content: 'HIDDEN_MOBILE_FIXTURE',
          status: 'HIDDEN',
        },
      });
      manifest.hiddenId = hidden.id;
    },
    { timeout: 15000 },
  );
  return manifest;
}
async function cleanup(db, guard, runId, manifest) {
  await assertTestDatabase(guard);
  await assertPrismaTest(db);
  const prefix = runPrefix(runId);
  await db.$transaction(
    async (tx) => {
      await identity(tx);
      const users = await tx.user.findMany({ select: { id: true, username: true, email: true } });
      if (
        users.some(
          (u) =>
            !['admin', 'reader', 'new'].some(
              (suffix) =>
                u.username === prefix + suffix && u.email === `${prefix}${suffix}@example.invalid`,
            ),
        )
      )
        throw new Error('Unknown users; cleanup refused');
      const owned = users.map((u) => u.id);
      const stories = await tx.story.findMany({
        select: { id: true, createdBy: true, title: true },
      });
      if (
        stories.some(
          (s) =>
            !manifest.storyIds.includes(s.id) ||
            !owned.includes(s.createdBy) ||
            !s.title.startsWith(prefix),
        )
      )
        throw new Error('Unknown stories; cleanup refused');
      const storyIds = stories.map((s) => s.id);
      const genres = await tx.genre.findMany({ select: { id: true } });
      const genreIds = [manifest.genre?.id, manifest.otherGenre?.id].filter(Boolean);
      if (genres.some((g) => !genreIds.includes(g.id)))
        throw new Error('Unknown genres; cleanup refused');
      const chapters = await tx.chapter.findMany({ select: { id: true } });
      const pages = await tx.chapterPage.findMany({ select: { id: true } });
      if (
        chapters.some((r) => !manifest.chapterIds.includes(r.id)) ||
        pages.some((r) => !manifest.pageIds.includes(r.id))
      )
        throw new Error('Unknown chapters/pages; cleanup refused');
      for (const model of ['comment', 'rating', 'favorite', 'readingHistory', 'readingProgress']) {
        const rows = await tx[model].findMany({ select: { userId: true, storyId: true } });
        if (rows.some((r) => !owned.includes(r.userId) || !storyIds.includes(r.storyId)))
          throw new Error('Unknown interactions; cleanup refused');
      }
      await tx.comment.deleteMany({
        where: { userId: { in: owned }, storyId: { in: storyIds }, parentId: { not: null } },
      });
      await tx.comment.deleteMany({
        where: { userId: { in: owned }, storyId: { in: storyIds }, parentId: null },
      });
      for (const model of ['rating', 'favorite', 'readingHistory', 'readingProgress'])
        await tx[model].deleteMany({ where: { userId: { in: owned }, storyId: { in: storyIds } } });
      await tx.chapterPage.deleteMany({ where: { id: { in: manifest.pageIds } } });
      await tx.chapter.deleteMany({ where: { id: { in: manifest.chapterIds } } });
      await tx.storyGenre.deleteMany({
        where: { storyId: { in: storyIds }, genreId: { in: genreIds } },
      });
      await tx.story.deleteMany({ where: { id: { in: storyIds } } });
      await tx.genre.deleteMany({ where: { id: { in: genreIds } } });
      await tx.passwordReset.deleteMany({ where: { userId: { in: owned } } });
      await tx.refreshToken.deleteMany({ where: { session: { userId: { in: owned } } } });
      await tx.authSession.deleteMany({ where: { userId: { in: owned } } });
      await tx.coinTransaction.deleteMany({ where: { userId: { in: owned } } });
      await tx.coinWallet.deleteMany({ where: { userId: { in: owned } } });
      await tx.coinDailyActivity.deleteMany({ where: { userId: { in: owned } } });
      await tx.chapterUnlock.deleteMany({ where: { userId: { in: owned } } });
      await tx.user.deleteMany({ where: { id: { in: owned } } });
      for (const table of APP_TABLES) {
        const rows = await tx.$queryRawUnsafe(
          `SELECT EXISTS(SELECT 1 FROM public."${table}") AS populated`,
        );
        if (rows[0].populated) throw new Error('Unknown residual data; cleanup rolled back');
      }
    },
    { timeout: 15000 },
  );
  await assertEmpty(guard);
}
module.exports = { createContent, cleanup, novelText };
