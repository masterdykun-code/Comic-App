// Import prepared user-supplied EPUB text into the primary DB as PRIVATE DRAFTS.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { createBackup, readEnvironment } from './library-expansion-db';
import { validatePrimaryUrl } from './sample-library-core';
import { chapterCreateSchema } from '../middlewares/chapter.validation';

type Bundle = { title:string; authorName:string; slug:string; chapters:Array<{chapterNumber:number;title:string;file:string;sha256:string}> };
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function main() {
  const [folder, flag] = process.argv.slice(2);
  if (!folder || (flag && flag !== '--apply') || process.argv.length > 4) throw Error('USAGE');
  const root = resolve('catalog'), directory = resolve(folder);
  if (!directory.startsWith(root+sep)) throw Error('LOCAL_CATALOG_REQUIRED');
  const book = JSON.parse(readFileSync(resolve(directory,'manifest.json'),'utf8')) as Bundle;
  if (!book.title || !book.authorName || !/^[a-z0-9-]+$/.test(book.slug) || !book.chapters.length) throw Error('INVALID_MANIFEST');
  const chapters = book.chapters.map((c,i)=>{
    const file = resolve(directory,c.file);
    if (!file.startsWith(directory+sep) || c.chapterNumber !== i+1) throw Error('INVALID_CHAPTER');
    const bytes = readFileSync(file);
    if (hash(bytes) !== c.sha256) throw Error('HASH_MISMATCH');
    return chapterCreateSchema.parse({chapterNumber:c.chapterNumber,title:c.title,content:bytes.toString('utf8')});
  });
  const env = await readEnvironment(); validatePrimaryUrl(env.DATABASE_URL);
  const prisma = new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000}),log:[]});
  try {
    const backup = flag === '--apply' ? await createBackup() : undefined;
    const result = await prisma.$transaction(async tx=>{
      const identity = await tx.$queryRaw<Array<{name:string;schema:string}>>`SELECT current_database() AS name,current_schema() AS schema`;
      if (identity[0]?.name !== 'webnovel_db' || identity[0]?.schema !== 'public') throw Error('WRONG_DATABASE');
      const lock = await tx.$queryRaw<Array<{locked:boolean}>>`SELECT pg_try_advisory_xact_lock(1464746330,1901) AS locked`;
      if (!lock[0]?.locked) throw Error('IMPORT_BUSY');
      const admins = await tx.user.findMany({where:{role:'ADMIN',status:'ACTIVE'},select:{id:true},take:2});
      if (admins.length !== 1) throw Error('EXACTLY_ONE_ADMIN_REQUIRED');
      const found = await tx.story.findMany({where:{OR:[{slug:book.slug},{title:{equals:book.title,mode:'insensitive'}}]},include:{chapters:true}});
      if (found.length) {
        const s = found[0]!;
        if (found.length !== 1 || s.slug !== book.slug || s.title !== book.title || s.authorName !== book.authorName || s.type !== 'NOVEL' || s.publishStatus !== 'DRAFT' || s.chapters.length !== chapters.length) throw Error('EXISTING_STORY_CONFLICT');
        const byNumber = new Map(s.chapters.map(c=>[c.chapterNumber,c]));
        for (const c of chapters) {
          const old = byNumber.get(c.chapterNumber);
          if (!old || old.title !== c.title || old.content !== c.content || old.publishStatus !== 'DRAFT') throw Error('EXISTING_CHAPTER_CONFLICT');
        }
        return {database:'webnovel_db/public',mode:'already-present',storyId:s.id,createdStories:0,createdChapters:0,totalChapters:chapters.length,status:'DRAFT'};
      }
      if (flag !== '--apply') return {database:'webnovel_db/public',mode:'dry-run',createdStories:1,createdChapters:chapters.length,status:'DRAFT'};
      const story = await tx.story.create({data:{title:book.title,authorName:book.authorName,slug:book.slug,type:'NOVEL',status:'ONGOING',publishStatus:'DRAFT',description:'',coverUrl:'',createdBy:admins[0]!.id}});
      await tx.chapter.createMany({data:chapters.map(c=>({...c,storyId:story.id,publishStatus:'DRAFT' as const}))});
      const stored = await tx.chapter.findMany({where:{storyId:story.id},orderBy:{chapterNumber:'asc'}});
      if (stored.length !== chapters.length || stored.some((c,i)=>c.content !== chapters[i]!.content || c.title !== chapters[i]!.title || c.chapterNumber !== i+1 || c.publishStatus !== 'DRAFT')) throw Error('VERIFY_FAILED');
      return {database:'webnovel_db/public',mode:'imported',storyId:story.id,createdStories:1,createdChapters:stored.length,totalChapters:stored.length,status:'DRAFT'};
    },{isolationLevel:'Serializable',timeout:60000,maxWait:5000});
    writeFileSync(resolve(directory,flag?'import-result.json':'dry-run.json'),JSON.stringify({...result,backupProof:backup?.proofPath??null,cloudinaryUploads:0},null,2));
    console.log(JSON.stringify(result));
  } finally { await prisma.$disconnect(); }
}
main().catch(()=>{console.error('Local EPUB import stopped safely; secrets suppressed. No automatic retry, overwrite or reset.');process.exitCode=1;});
