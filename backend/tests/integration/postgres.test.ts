import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client, Pool } from 'pg';
import sharp from 'sharp';
import argon2 from 'argon2';
import { configureIntegration, assertTestDatabase, APP_TABLES } from './environment';
import { assertEmpty, verifySchema, preflight } from './database';
import { getPrismaClient, disconnectPrisma } from '../../src/config/prisma';
import app from '../../src/app';
import { cloudinaryStorage } from '../../src/config/cloudinary';
import { v2 as cloudinary } from 'cloudinary';
import { createAdminBootstrapService } from '../../src/services/admin-bootstrap.service';
import { commentService } from '../../src/services/comment.service';

test('Real PostgreSQL integration on verified isolated webnovel_test_db', { timeout: 120_000 }, async (t) => {
  if (!/^[a-f0-9]{32}$/.test(process.env.INTEGRATION_RUN_ID ?? '')) throw new Error('Use the guarded integration runner.');
  const runId = process.env.INTEGRATION_RUN_ID!;
  const prefix = `it_${runId.slice(0,12)}_`;
  const password = `Test!${randomBytes(32).toString('hex')}`;
  const url = configureIntegration();
  const guard = new Client({ connectionString: url });
  const pool = new Pool({ connectionString: url, max: 6 });
  await guard.connect(); await assertTestDatabase(guard); await verifySchema(guard); await assertEmpty(guard);
  const db = getPrismaClient();
  const actual = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(actual[0].name, 'webnovel_test_db');
  const genreIds: string[] = [];
  const ids: Record<string,string> = {};
  const tokens: Record<string,string> = {};
  let novel = ''; let comic = ''; let draft = ''; let novelChapter = ''; let comicChapter = ''; let draftChapter = '';
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  // No external Cloudinary calls, even if a developer configures credentials.
  t.mock.method(cloudinary.uploader, 'upload_stream', () => { throw new Error('Real Cloudinary blocked in integration tests'); });
  t.mock.method(cloudinaryStorage, 'assertReady', () => {});
  t.mock.method(cloudinaryStorage, 'upload', async () => ({ secureUrl: 'https://example.invalid/integration-cover.png', publicId: 'integration/mock-cover' }));
  async function request(path: string, method = 'GET', body?: unknown, actor = 'guest') {
    const response = await fetch(base + path, { method, headers: {
      ...(tokens[actor] ? { Authorization: `Bearer ${tokens[actor]}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
    return { status: response.status, body: await response.json() };
  }
  async function expect(path: string, method: string, body: unknown, actor: string, status: number) {
    const result = await request(path, method, body, actor);
    assert.equal(result.status, status, `${method} ${path}: HTTP status`); return result.body;
  }
  async function login(actor: string) {
    const value = await expect('/api/auth/login', 'POST', { email: `${prefix}${actor}@integration.invalid`, password }, 'guest', 200);
    tokens[actor] = value.data.accessToken; return value.data;
  }
  async function assertConstraint(sql: string, values: unknown[], expected: string) {
    const connection = await pool.connect();
    try {
      await assertTestDatabase(connection); await connection.query('BEGIN');
      let code = '';
      try { await connection.query(sql, values); } catch (error) { code = String((error as { code?: string }).code ?? 'UNKNOWN'); }
      finally { await connection.query('ROLLBACK'); }
      assert.equal(code, expected, 'PostgreSQL constraint SQLSTATE');
    } finally { connection.release(); }
  }
  async function holdRealAdvisoryLock(key: string, seed: number, work: () => Promise<unknown>) {
    const connection = await pool.connect();
    const observer = await pool.connect();
    try {
      await assertTestDatabase(connection); await assertTestDatabase(observer);
      const one = (await connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const two = (await observer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      assert.notEqual(one, two, 'Distinct real PostgreSQL connections');
      await connection.query('BEGIN');
      await connection.query('SELECT 1 FROM pg_advisory_xact_lock(hashtextextended($1::text,$2::bigint))', [key,seed]);
      const pending = work(); void pending.catch(() => {});
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const state = await observer.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS waiting");
        if (state.rows[0].waiting) { waiting = true; break; }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      await connection.query('ROLLBACK'); await pending;
      assert.equal(waiting, true, 'Application waited for the real PostgreSQL advisory lock');
    } finally { await connection.query('ROLLBACK').catch(() => {}); connection.release(); observer.release(); }
  }
  async function cleanup() {
    await assertTestDatabase(guard);
    await db.$transaction(async (tx) => {
      const identity = await tx.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
      if (identity[0].name !== 'webnovel_test_db') throw new Error('Cleanup target rejected');
      const users = await tx.user.findMany({ select: { id: true, username: true, email: true } });
      if (users.some((u) => !u.username.startsWith(prefix) || u.email !== `${u.username}@integration.invalid`)) throw new Error('Unknown user data: cleanup refused');
      const owned = users.map((u) => u.id);
      const stories = await tx.story.findMany({ select: { id: true, createdBy: true } });
      if (stories.some((s) => !owned.includes(s.createdBy))) throw new Error('Unknown story data: cleanup refused');
      const genres = await tx.genre.findMany({ select: { id: true } });
      if (genres.some((g) => !genreIds.includes(g.id))) throw new Error('Unknown genre data: cleanup refused');
      const ownedStories = stories.map((s) => s.id);
      // Target only this run's verified resources; no TRUNCATE/reset/global delete.
      await tx.comment.deleteMany({ where: { storyId: { in: ownedStories }, userId: { in: owned }, parentId: { not: null } } });
      await tx.comment.deleteMany({ where: { storyId: { in: ownedStories }, userId: { in: owned }, parentId: null } });
      await tx.rating.deleteMany({ where: { userId: { in: owned }, storyId: { in: ownedStories } } });
      await tx.favorite.deleteMany({ where: { userId: { in: owned }, storyId: { in: ownedStories } } });
      await tx.readingProgress.deleteMany({ where: { userId: { in: owned }, storyId: { in: ownedStories } } });
      await tx.readingHistory.deleteMany({ where: { userId: { in: owned }, storyId: { in: ownedStories } } });
      await tx.chapterPage.deleteMany({ where: { chapter: { storyId: { in: ownedStories } } } });
      await tx.chapter.deleteMany({ where: { storyId: { in: ownedStories } } });
      await tx.storyGenre.deleteMany({ where: { storyId: { in: ownedStories }, genreId: { in: genreIds } } });
      await tx.story.deleteMany({ where: { id: { in: ownedStories } } });
      await tx.genre.deleteMany({ where: { id: { in: genreIds } } });
      await tx.passwordReset.deleteMany({ where: { userId: { in: owned } } });
      await tx.refreshToken.deleteMany({ where: { session: { userId: { in: owned } } } });
      await tx.authSession.deleteMany({ where: { userId: { in: owned } } });
      await tx.coinTransaction.deleteMany({ where: { userId: { in: owned } } });
      await tx.coinWallet.deleteMany({ where: { userId: { in: owned } } });
      await tx.coinDailyActivity.deleteMany({ where: { userId: { in: owned } } });
      await tx.chapterUnlock.deleteMany({ where: { userId: { in: owned } } });
      await tx.user.deleteMany({ where: { id: { in: owned } } });
    }, { timeout: 15_000 });
    await assertEmpty(guard);
  }
  try {
    await t.test('Schema has 19 tables, all migration constraints and real independent connections', async () => {
      assert.equal(APP_TABLES.length, 19);
      const a = await pool.connect(); const b = await pool.connect();
      try { await assertTestDatabase(a); await assertTestDatabase(b); assert.notEqual((await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); }
      finally { a.release(); b.release(); }
    });
    await t.test('First ADMIN bootstrap races across real transactions and creates one fixture ADMIN', async () => {
      const bootstrap = createAdminBootstrapService();
      const results = await Promise.allSettled(['admin','admin2'].map((name) => bootstrap.create({ username: prefix + name, email: `${prefix}${name}@integration.invalid`, displayName: 'Integration ADMIN', password })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const admin = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true, username: true, email: true } });
      ids.admin = admin.id;
      const auth = await expect('/api/auth/login','POST',{email:admin.email,password},'guest',200); tokens.admin = auth.data.accessToken;
      assert.equal(await db.user.count({ where: { role: 'ADMIN' } }), 1);
    });
    await t.test('Register/login store Argon2id hashes and enforce USER/ADMIN authorization', async () => {
      for (const actor of ['user','other']) {
        const body = { username: prefix + actor, email: `${prefix}${actor}@integration.invalid`, password };
        const registered = await expect('/api/auth/register','POST',body,'guest',201); ids[actor] = registered.data.id;
        assert.equal(registered.data.role,'USER'); assert(!('passwordHash' in registered.data));
        await login(actor);
      }
      const stored = await db.user.findUniqueOrThrow({ where: { id: ids.user }, select: { passwordHash: true } });
      assert(stored.passwordHash?.startsWith('$argon2id$')); assert(await argon2.verify(stored.passwordHash!,password));
      await expect('/api/stories','POST',{},'guest',401); await expect('/api/stories','POST',{},'user',403);
      await expect('/api/auth/register','POST',{username:prefix+'forged',email:`${prefix}forged@integration.invalid`,password,role:'ADMIN'},'guest',400);
    });
    await t.test('Refresh rotation/replay/logout revoke persisted sessions without storing plaintext tokens', async () => {
      const first = await login('user');
      const rotated = await expect('/api/auth/refresh','POST',{refreshToken:first.refreshToken},'guest',200);
      assert(first.refreshToken !== rotated.data.refreshToken); tokens.user = rotated.data.accessToken;
      const stored = await db.refreshToken.findMany({ where: { session: { userId: ids.user } }, select: { tokenHash: true } });
      assert(stored.every((r) => /^[a-f0-9]{64}$/.test(r.tokenHash) && r.tokenHash !== first.refreshToken));
      await expect('/api/auth/refresh','POST',{refreshToken:first.refreshToken},'guest',401);
      await expect('/api/auth/me','GET',undefined,'user',401);
      const second = await login('user'); await expect('/api/auth/logout','POST',{refreshToken:second.refreshToken},'guest',200);
      await expect('/api/auth/me','GET',undefined,'user',401); await login('user');
    });
    await t.test('Preflight refuses a populated database without deleting any existing rows', async () => {
      const before = await db.user.count();
      await assert.rejects(preflight(guard), /not empty/);
      assert.equal(await db.user.count(), before);
    });
    await t.test('Concurrent refresh on multiple real connections accepts one rotation and revokes on replay', async () => {
      const session = await login('user');
      const results = await Promise.all([request('/api/auth/refresh','POST',{refreshToken:session.refreshToken}),request('/api/auth/refresh','POST',{refreshToken:session.refreshToken})]);
      assert.deepEqual(results.map((r) => r.status).sort(),[200,401]);
      tokens.user = results.find((r) => r.status === 200)!.body.data.accessToken;
      await expect('/api/auth/me','GET',undefined,'user',401); await login('user');
    });
    await t.test('Genres fixtures and NOVEL/COMIC Story publication use real relations and hide DRAFT', async () => {
      const genre = await db.genre.create({ data: { name: prefix+'Adventure', slug: prefix+'adventure' } }); genreIds.push(genre.id);
      const genres = await expect('/api/genres','GET',undefined,'guest',200); assert(genres.data.some((g: { id: string }) => g.id === genre.id));
      for (const type of ['NOVEL','COMIC'] as const) {
        const created = await expect('/api/stories','POST',{title:prefix+type,type,authorName:'Integration author',description:'Controlled integration fixture',coverUrl:'https://example.invalid/cover.png',genreIds},'admin',201);
        if(type==='NOVEL')novel=created.data.id;else comic=created.data.id;
        await expect(`/api/stories/${created.data.id}`,'GET',undefined,'guest',404);
        await expect(`/api/stories/${created.data.id}/publish`,'PATCH',{},'admin',200);
      }
      draft=(await expect('/api/stories','POST',{title:prefix+'draft',type:'NOVEL',authorName:'Integration author'},'admin',201)).data.id;
      const published = await expect('/api/stories','GET',undefined,'guest',200); assert.equal(published.data.length,2); assert(!published.data.some((s:{id:string})=>s.id===draft));
      assert.equal(await db.storyGenre.count(),2);
    });
    await t.test('NOVEL and COMIC Chapters persist, publish and expose the correct reader data', async () => {
      novelChapter=(await expect(`/api/admin/stories/${novel}/chapters`,'POST',{chapterNumber:1,title:'Novel chapter',content:'Integration novel text with sufficient length.'},'admin',201)).data.id;
      await expect(`/api/chapters/${novelChapter}`,'GET',undefined,'guest',404);
      await expect(`/api/admin/chapters/${novelChapter}/publish`,'PATCH',{},'admin',200);
      assert.equal((await expect(`/api/chapters/${novelChapter}`,'GET',undefined,'guest',200)).data.content,'Integration novel text with sufficient length.');
      comicChapter=(await expect(`/api/admin/stories/${comic}/chapters`,'POST',{chapterNumber:1,title:'Comic chapter'},'admin',201)).data.id;
      await expect(`/api/admin/chapters/${comicChapter}/publish`,'PATCH',{},'admin',400);
      await expect(`/api/admin/chapters/${comicChapter}/pages`,'PUT',{pages:[1,2].map((pageNumber)=>({pageNumber,imageUrl:`https://example.invalid/page-${pageNumber}.png`,storagePublicId:`mock/page-${pageNumber}`}))},'admin',200);
      await expect(`/api/admin/chapters/${comicChapter}/publish`,'PATCH',{},'admin',200);
      const reader=await expect(`/api/chapters/${comicChapter}`,'GET',undefined,'guest',200); assert.equal(reader.data.pages.length,2); assert(!('storagePublicId' in reader.data.pages[0]));
      draftChapter=(await expect(`/api/admin/stories/${novel}/chapters`,'POST',{chapterNumber:9,title:'Draft chapter',content:'Draft text'},'admin',201)).data.id;
      const duplicate=await Promise.all(['A','B'].map((title)=>request(`/api/admin/stories/${novel}/chapters`,'POST',{chapterNumber:2,title,content:'A draft race chapter'},'admin')));
      assert.deepEqual(duplicate.map((r)=>r.status).sort(),[201,409]);
    });
    await t.test('Favorites are isolated, idempotently removed and safe under real concurrent insert', async () => {
      const results=await Promise.all([request('/api/me/favorites','POST',{storyId:novel},'user'),request('/api/me/favorites','POST',{storyId:novel},'user')]);
      assert.deepEqual(results.map((r)=>r.status).sort(),[201,409]);
      assert.equal((await expect('/api/me/favorites','GET',undefined,'other',200)).data.length,0);
      await expect(`/api/me/favorites/${novel}`,'DELETE',undefined,'other',200); assert.equal(await db.favorite.count(),1);
      await expect(`/api/me/favorites/${novel}`,'DELETE',undefined,'user',200);
      await expect('/api/me/favorites','POST',{storyId:novel},'user',201);
    });
    await t.test('Progress NOVEL/COMIC persists and stale or concurrent versions return HTTP 409', async () => {
      const body={chapterId:novelChapter,progressPercent:25.25,expectedUpdatedAt:null,textOffset:5};
      const results=await Promise.all([request(`/api/me/reading-progress/${novel}`,'PUT',body,'user'),request(`/api/me/reading-progress/${novel}`,'PUT',{...body,textOffset:10},'user')]);
      assert.deepEqual(results.map((r)=>r.status).sort(),[200,409]);
      const saved=results.find((r)=>r.status===200)!.body;
      const read=await expect(`/api/me/reading-progress/${novel}`,'GET',undefined,'user',200); assert.equal(read.data.textOffset,saved.data.textOffset);
      const next=await expect(`/api/me/reading-progress/${novel}`,'PUT',{...body,expectedUpdatedAt:read.version,textOffset:15},'user',200);
      await expect(`/api/me/reading-progress/${novel}`,'PUT',{...body,expectedUpdatedAt:read.version},'user',409); assert(next.version!==read.version);
      await expect(`/api/me/reading-progress/${comic}`,'PUT',{chapterId:comicChapter,progressPercent:50,expectedUpdatedAt:null,pageNumber:2,scrollOffset:80},'user',200);
      assert.equal((await expect(`/api/me/reading-progress/${comic}`,'GET',undefined,'user',200)).data.pageNumber,2);
      await expect(`/api/me/reading-progress/${novel}`,'PUT',{...body,chapterId:comicChapter,expectedUpdatedAt:next.version},'user',404);
      await expect(`/api/me/reading-progress/${novel}`,'PUT',{...body,chapterId:draftChapter,expectedUpdatedAt:next.version},'user',404);
    });
    await t.test('History deduplicates concurrent opens and clearing preserves other reading data', async () => {
      const body={storyId:novel,chapterId:novelChapter};
      const results=await Promise.all([request('/api/me/reading-history','POST',body,'user'),request('/api/me/reading-history','POST',body,'user')]);
      assert.deepEqual(results.map((r)=>r.status).sort(),[200,201]); assert.equal(await db.readingHistory.count({where:{userId:ids.user}}),1);
      await expect('/api/me/reading-history','POST',body,'other',201);
      await expect('/api/me/reading-history','DELETE',undefined,'user',200);
      assert.equal(await db.readingHistory.count(),1); assert.equal(await db.readingProgress.count(),2); assert.equal(await db.favorite.count(),1);
    });
    await t.test('Ratings upsert concurrently, aggregate correctly and delete only the current rating', async () => {
      const results=await Promise.all([1,5].map((score)=>request(`/api/stories/${novel}/my-rating`,'PUT',{score},'user')));
      assert(results.every((r)=>r.status===200)); assert.equal(await db.rating.count(),1);
      await expect(`/api/stories/${novel}/my-rating`,'PUT',{score:4,reviewText:'Integration review'},'user',200);
      await expect(`/api/stories/${novel}/my-rating`,'PUT',{score:2},'other',200);
      const list=await expect(`/api/stories/${novel}/ratings`,'GET',undefined,'guest',200); assert.equal(list.summary.averageScore,3); assert.equal(list.summary.totalRatings,2);
      await expect(`/api/stories/${novel}/my-rating`,'DELETE',undefined,'other',200); assert.equal(await db.rating.count(),1);
    });
    await t.test('Comments replies, ownership, hidden moderation and protected root deletion use real FKs', async () => {
      const root=(await expect(`/api/stories/${novel}/comments`,'POST',{content:'Root integration comment'},'user',201)).data;
      const child=(await expect(`/api/stories/${novel}/comments`,'POST',{content:'Reply integration comment',parentId:root.id},'other',201)).data;
      await expect(`/api/stories/${comic}/comments`,'POST',{content:'Wrong story',parentId:root.id},'user',404);
      await expect(`/api/stories/${novel}/comments`,'POST',{content:'Too deep',parentId:child.id},'user',400);
      await expect(`/api/comments/${root.id}`,'PATCH',{content:'Not owner'},'other',403);
      await expect(`/api/admin/comments/${root.id}/moderate`,'PATCH',{status:'HIDDEN'},'user',403);
      await expect(`/api/admin/comments/${child.id}/moderate`,'PATCH',{status:'HIDDEN'},'admin',200);
      assert.equal((await expect(`/api/stories/${novel}/comments`,'GET',undefined,'guest',200)).data[0].replies.length,0);
      await expect(`/api/admin/comments/${root.id}/moderate`,'PATCH',{status:'HIDDEN'},'admin',200);
      assert.equal((await expect(`/api/stories/${novel}/comments`,'GET',undefined,'guest',200)).data.length,0);
      await expect(`/api/comments/${root.id}/replies`,'GET',undefined,'guest',404);
      await expect(`/api/comments/${root.id}`,'DELETE',undefined,'user',409);
      await expect(`/api/comments/${child.id}`,'DELETE',undefined,'other',200);
      await expect(`/api/comments/${root.id}`,'DELETE',undefined,'user',200);
    });
    await t.test('Reply creation vs deletion and moderation serialize across real transactions', async () => {
      const root=await commentService.create(ids.user,novel,{content:'Race root'});
      const results=await Promise.allSettled([commentService.create(ids.other,novel,{content:'Race reply',parentId:root.id}),commentService.remove(ids.user,root.id)]);
      assert.equal(results.filter((r)=>r.status==='fulfilled').length,1);
      const next=await commentService.create(ids.user,novel,{content:'Moderation race root'});
      await Promise.allSettled([commentService.moderate(ids.admin,next.id,'HIDDEN'),commentService.create(ids.other,novel,{content:'Moderation race reply',parentId:next.id})]);
      assert.equal((await db.comment.findUniqueOrThrow({where:{id:next.id},select:{status:true}})).status,'HIDDEN');
      const orphan=await guard.query('SELECT count(*)::int AS count FROM comments c LEFT JOIN comments p ON p.id=c.parent_id AND p.story_id=c.story_id WHERE c.parent_id IS NOT NULL AND p.id IS NULL'); assert.equal(orphan.rows[0].count,0);
    });
    await t.test('Reading and Feedback requests actually wait on advisory locks from independent connections', async () => {
      await holdRealAdvisoryLock(ids.user,1464746310,async()=>{await expect('/api/me/favorites','POST',{storyId:comic},'user',201);});
      await holdRealAdvisoryLock(novel,1464746320,async()=>{await expect(`/api/stories/${novel}/my-rating`,'PUT',{score:4},'user',200);});
    });
    await t.test('Real unique, CHECK, composite FK and Restrict constraints reject invalid SQL', async () => {
      await assertConstraint('INSERT INTO chapters(id,story_id,chapter_number,title) VALUES($1,$2,1,$3)',[randomUUID(),novel,'Duplicate'],'23505');
      await assertConstraint('INSERT INTO chapter_pages(id,chapter_id,page_number,image_url) VALUES($1,$2,1,$3)',[randomUUID(),comicChapter,'https://example.invalid/duplicate.png'],'23505');
      await assertConstraint('INSERT INTO ratings(id,user_id,story_id,score) VALUES($1,$2,$3,3)',[randomUUID(),ids.user,novel],'23505');
      await assertConstraint('INSERT INTO favorites(id,user_id,story_id) VALUES($1,$2,$3)',[randomUUID(),ids.user,novel],'23505');
      const checks: Array<[string,unknown[]]>=[
        ['UPDATE ratings SET score=0 WHERE user_id=$1',[ids.user]],
        ['UPDATE reading_progress SET progress_percent=101 WHERE user_id=$1',[ids.user]],
        ['UPDATE chapters SET chapter_number=0 WHERE id=$1',[novelChapter]],
        ['UPDATE chapter_pages SET page_number=0 WHERE chapter_id=$1',[comicChapter]],
        ['UPDATE reading_progress SET text_offset=-1 WHERE user_id=$1',[ids.user]],
        ['UPDATE reading_progress SET scroll_offset=-1 WHERE user_id=$1',[ids.user]],
        ['UPDATE reading_progress SET page_number=0 WHERE user_id=$1',[ids.user]],
      ];for(const [sql,values]of checks)await assertConstraint(sql,values,'23514');
      await assertConstraint('UPDATE reading_progress SET chapter_id=$1 WHERE user_id=$2 AND story_id=$3',[comicChapter,ids.user,novel],'23503');
      await assertConstraint('INSERT INTO reading_history(id,user_id,story_id,chapter_id) VALUES($1,$2,$3,$4)',[randomUUID(),ids.user,novel,comicChapter],'23503');
      const foreignRoot=await commentService.create(ids.user,comic,{content:'Composite FK root'});
      await assertConstraint('INSERT INTO comments(id,user_id,story_id,parent_id,content) VALUES($1,$2,$3,$4,$5)',[randomUUID(),ids.user,novel,foreignRoot.id,'Wrong parent story'],'23503');
      await assertConstraint('DELETE FROM users WHERE id=$1',[ids.admin],'23001');
      await assertConstraint('DELETE FROM genres WHERE id=$1',[genreIds[0]],'23001');
    });
    await t.test('Prisma rollback leaves no partial write and releases locks after error', async () => {
      const before=await db.rating.findUniqueOrThrow({where:{userId_storyId:{userId:ids.user,storyId:novel}},select:{score:true}});
      let rolledBack=false;
      try{await db.$transaction(async(tx)=>{
        const current=await tx.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;assert.equal(current[0].name,'webnovel_test_db');
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${novel}::text,1464746320::bigint))`;
        await tx.rating.update({where:{userId_storyId:{userId:ids.user,storyId:novel}},data:{score:1}});throw new Error('Intentional integration rollback');
      });}catch{rolledBack=true;}
      assert(rolledBack);assert.equal((await db.rating.findUniqueOrThrow({where:{userId_storyId:{userId:ids.user,storyId:novel}},select:{score:true}})).score,before.score);
      await expect(`/api/stories/${novel}/my-rating`,'PUT',{score:4},'user',200);
    });
    await t.test('Upload uses real ADMIN/session checks and mock storage without DB writes or Cloudinary', async () => {
      const before={stories:await db.story.count(),pages:await db.chapterPage.count()};
      const png=await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).png().toBuffer();
      const form=new FormData();form.append('file',new Blob([new Uint8Array(png)],{type:'image/png'}),'test.png');
      const result=await fetch(base+'/api/admin/uploads/cover',{method:'POST',headers:{Authorization:`Bearer ${tokens.admin}`},body:form});assert.equal(result.status,201);
      const body=await result.json();assert.equal(body.data.publicId,'integration/mock-cover');
      assert.equal(await db.story.count(),before.stories);assert.equal(await db.chapterPage.count(),before.pages);
    });
  } finally {
    await new Promise<void>((resolve,reject)=>{server.close((e)=>e?reject(e):resolve());server.closeAllConnections();});
    try { await cleanup(); } finally { t.mock.restoreAll(); await disconnectPrisma(); await pool.end(); await guard.end(); }
  }
});
