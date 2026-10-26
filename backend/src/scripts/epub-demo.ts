// Local test-database demo only. Never loads backend/.env or uploads resources.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { parse } from 'dotenv';
import { Client } from 'pg';

const catalog = resolve('catalog/tien-cong-khai-vat-review');
const slug = 'local-epub-tien-cong-khai-vat';
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export function assertTestUrl(raw: string): void {
  const u = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) ||
      decodeURIComponent(u.pathname) !== '/webnovel_test_db' || !u.username ||
      [...u.searchParams].some(([k,v]) => k !== 'schema' || v !== 'public')) throw new Error('TEST_TARGET_REQUIRED');
}
export function demoAddress(raw: string): URL {
  const u = new URL(raw);
  const parts = u.hostname.split('.').map(Number);
  const local = isIP(u.hostname) === 4 && (parts[0] === 127 || parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31));
  if (!local || u.protocol !== 'http:' || u.username || u.password || u.search || u.hash ||
      !['','/'].includes(u.pathname) || !u.port || ['4000','5173','8082'].includes(u.port)) throw new Error('PRIVATE_DEMO_ADDRESS_REQUIRED');
  return u;
}
function environment(): string {
  const values = parse(readFileSync(resolve('.env.integration')));
  if (Object.keys(values).some(k => k !== 'INTEGRATION_DATABASE_URL')) throw new Error('TEST_ENV_REQUIRED');
  const raw = values.INTEGRATION_DATABASE_URL;
  if (!raw) throw new Error('TEST_ENV_REQUIRED');
  assertTestUrl(raw);
  process.env.DATABASE_URL = raw;
  process.env.DOTENV_CONFIG_PATH = resolve('.env.integration');
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  delete process.env.CLOUDINARY_URL;
  for (const key of ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) process.env[key] = '';
  return raw;
}
async function verifyConnection(raw: string) {
  const db = new Client({ connectionString: raw, connectionTimeoutMillis: 5000 });
  try {
    await db.connect();
    const r = (await db.query('SELECT current_database() AS db, current_schema() AS schema')).rows[0];
    if (r.db !== 'webnovel_test_db' || r.schema !== 'public') throw new Error('TEST_TARGET_REQUIRED');
  } finally { await db.end(); }
}
type ChapterInput = { chapterNumber: number; title: string; file: string; sha256: string };
function staged() {
  const proposal = JSON.parse(readFileSync(resolve(catalog, 'proposal.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(catalog, 'chapters.json'), 'utf8')) as ChapterInput[];
  if (manifest.length !== 785 || proposal.story.title !== 'Tiên Công Khai Vật' || proposal.story.authorName !== 'Cổ Chân Nhân') throw new Error('STAGING_MISMATCH');
  const chapters = manifest.map((c, i) => {
    if (c.chapterNumber !== i+1 || c.file !== `text/${String(i+1).padStart(4,'0')}.txt`) throw new Error('STAGING_MISMATCH');
    const content = readFileSync(resolve(catalog, c.file), 'utf8');
    if (sha(Buffer.from(content)) !== c.sha256 || !content.trim() || content.includes('\0') || content.length > 200000 || c.title.length > 200) throw new Error('STAGING_MISMATCH');
    return { chapterNumber: c.chapterNumber, title: c.title, content };
  });
  const audit = JSON.parse(readFileSync(resolve(catalog, 'audit.json'), 'utf8'));
  if (sha(readFileSync(resolve(catalog, 'assets/cover.jpg'))) !== audit.cover.sha256) throw new Error('COVER_MISMATCH');
  return { proposal, chapters };
}
async function importBook(base: URL, apply: boolean) {
  const { chapters, proposal } = staged();
  const { getPrismaClient, disconnectPrisma } = await import('../config/prisma.js');
  const prisma = getPrismaClient();
  const coverUrl = `${base.origin}/demo-assets/tien-cong-khai-vat-cover.jpg`;
  try {
    const result = await prisma.$transaction(async tx => {
      const identity = await tx.$queryRaw<Array<{db:string; schema:string}>>`SELECT current_database() AS db, current_schema() AS schema`;
      if (identity[0]?.db !== 'webnovel_test_db' || identity[0]?.schema !== 'public') throw new Error('TEST_TARGET_REQUIRED');
      const lock = await tx.$queryRaw<Array<{locked:boolean}>>`SELECT pg_try_advisory_xact_lock(1464746330,13) AS locked`;
      if (!lock[0]?.locked) throw new Error('TEST_DATABASE_BUSY');
      const admins = await tx.user.findMany({ where: {role:'ADMIN',status:'ACTIVE'}, select:{id:true}, take:2 });
      if (admins.length !== 1) throw new Error('EXACTLY_ONE_ACTIVE_TEST_ADMIN_REQUIRED');
      const matches = await tx.story.findMany({where:{OR:[{slug},{title:{equals:proposal.story.title,mode:'insensitive'}}]},include:{chapters:{select:{id:true,chapterNumber:true,title:true,content:true,publishStatus:true}},genres:true}});
      if (matches.length > 1) throw new Error('DUPLICATE_STORY_CONFLICT');
      const existing = matches[0];
      const description = 'Demo EPUB cục bộ: 785 chương từ file người dùng cung cấp. Tác giả: Cổ Chân Nhân. Nguồn EPUB ghi DTV EBOOK / truyenyy.pro; dịch giả và quyền phân phối chưa xác minh. Chỉ dùng trong môi trường test cá nhân.';
      if (existing && (existing.slug !== slug || existing.title !== proposal.story.title || existing.type !== 'NOVEL' || existing.authorName !== proposal.story.authorName || existing.coverUrl !== coverUrl || existing.description !== description || existing.publishStatus !== 'PUBLISHED')) throw new Error('EXISTING_STORY_CONFLICT');
      const known = new Map((existing?.chapters ?? []).map(c=>[c.chapterNumber,c]));
      for (const c of known.values()) {
        const wanted = chapters[c.chapterNumber-1];
        if (!wanted || c.title !== wanted.title || c.content !== wanted.content || c.publishStatus !== 'PUBLISHED') throw new Error('EXISTING_CHAPTER_CONFLICT');
      }
      const genres = await tx.genre.findMany({where:{OR:[{slug:'tien-hiep'},{name:{equals:'Tiên hiệp',mode:'insensitive'}}]},take:2});
      if (genres.length > 1) throw new Error('GENRE_CONFLICT');
      const genre = genres[0];
      if (existing && (!genre || existing.genres.length !== 1 || existing.genres[0]?.genreId !== genre.id)) throw new Error('EXISTING_GENRE_LINK_CONFLICT');
      const missing = chapters.filter(c=>!known.has(c.chapterNumber));
      const planned = { Story:existing?0:1, Chapter:missing.length, Genre:genre?0:1, StoryGenre:existing?0:1 };
      if (!apply) return {mode:'dry-run',planned,storyId:existing?.id??null,chapterCount:known.size};
      // All changes are inserts in one transaction. Never upsert/update/delete existing records.
      const g = genre ?? await tx.genre.create({data:{name:'Tiên hiệp',slug:'tien-hiep'}});
      const story = existing ?? await tx.story.create({data:{title:proposal.story.title,authorName:proposal.story.authorName,slug,type:'NOVEL',status:'ONGOING',publishStatus:'PUBLISHED',description,coverUrl,createdBy:admins[0]!.id,genres:{create:{genreId:g.id}}}});
      if (missing.length) await tx.chapter.createMany({data:missing.map(c=>({...c,storyId:story.id,publishStatus:'PUBLISHED' as const}))});
      const count = await tx.chapter.count({where:{storyId:story.id,publishStatus:'PUBLISHED'}});
      if (count !== 785) throw new Error('CHAPTER_COUNT_MISMATCH');
      return {mode:'applied',planned,storyId:story.id,chapterCount:count};
    }, {isolationLevel:'Serializable',timeout:60000,maxWait:5000});
    mkdirSync(resolve(catalog,'.demo-state'),{recursive:true});
    writeFileSync(resolve(catalog,'.demo-state',apply?'import.json':'dry-run.json'),JSON.stringify({at:new Date().toISOString(),database:'webnovel_test_db/public',...result},null,2));
    console.log(JSON.stringify(result));
  } finally { await disconnectPrisma(); }
}
async function serve(base: URL) {
  const express = (await import('express')).default;
  const app = require('../app').default as import('express').Express;
  const wrapper = express();
  wrapper.get('/demo-assets/tien-cong-khai-vat-cover.jpg',(_req,res)=>{
    res.setHeader('Cache-Control','private, max-age=3600');
    res.sendFile(resolve(catalog,'assets/cover.jpg'));
  });
  wrapper.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  wrapper.use(app);
  const server = wrapper.listen(Number(base.port),base.hostname,()=>console.log(`Local EPUB demo: ${base.origin}/api; verified webnovel_test_db/public. No Cloudinary configured.`));
  server.on('error',()=>{console.error('Demo server could not listen; no automatic retry.');process.exitCode=1;});
}
async function main() {
  const [mode, raw, ...flags] = process.argv.slice(2);
  if (!['import','serve'].includes(mode??'') || !raw || flags.some(f=>f!=='--apply') || (mode==='serve'&&flags.length)) throw new Error('Use: npm run demo:epub -- import|serve http://PRIVATE_IP:4001 [--apply]');
  const base = demoAddress(raw);
  const db = environment();
  await verifyConnection(db);
  if (mode==='import') await importBook(base,flags.includes('--apply'));
  else await serve(base);
}
if (require.main === module) main().catch(()=>{console.error('Local EPUB demo stopped; credentials suppressed. Verify test DB, active test ADMIN, staging and duplicate conflicts. No reset or automatic retry.');process.exitCode=1;});
