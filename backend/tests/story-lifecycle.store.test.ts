import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { createPrismaStoryStore } from '../src/services/story.store';
import { createStoryService } from '../src/services/story.service';

// Transaction/delegate simulation only. No database connection and no real Story deletions.
const target='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
function fixture(failAt=''){
 const updatedAt=new Date('2026-10-24T00:00:00Z');
 let state:any={
  story:[target,other].map(id=>({id,title:id,slug:id,type:'COMIC',authorName:'Mock author',description:'Mock text',coverUrl:'https://example.test/cover.png',status:'ONGOING',publishStatus:'PUBLISHED',createdBy:'mock-admin',createdAt:updatedAt,updatedAt})),
  chapter:[{id:'target-chapter',storyId:target},{id:'other-chapter',storyId:other}],
  chapterPage:[{id:'page1',chapterId:'target-chapter'},{id:'page2',chapterId:'target-chapter'},{id:'other-page',chapterId:'other-chapter'}],
  comment:[{id:'root',storyId:target,parentId:null},{id:'reply',storyId:target,parentId:'root'},{id:'nested',storyId:target,parentId:'reply'},{id:'other-comment',storyId:other,parentId:null}],
  rating:[{storyId:target},{storyId:other}],favorite:[{storyId:target},{storyId:other}],bookmark:[{storyId:target},{storyId:other}],
  readingHistory:[{storyId:target},{storyId:other}],readingProgress:[{storyId:target},{storyId:other}],storyGenre:[{storyId:target,genreId:'shared'},{storyId:other,genreId:'shared'}],
  genre:[{id:'shared'}],user:[{id:'mock-admin'}],cloudinary:[{publicId:'retained'}],
 };
 const original=structuredClone(state),calls:Array<{model:string;method:string;args:any}>=[];let rolledBack=false;
 const tx:any={
  $queryRaw:async(_sql:TemplateStringsArray,...values:unknown[])=>{calls.push({model:'story',method:'lock',args:values});return [{id:target}];},
  user:{findFirst:async()=>({id:'mock-admin'})},
 };
 for(const model of ['comment','rating','favorite','bookmark','readingHistory','readingProgress','chapterPage','chapter','storyGenre']){
  tx[model]={deleteMany:async(args:any)=>{
   calls.push({model,method:'deleteMany',args});if(model===failAt)throw Error('private simulated transaction failure');
   if(model==='chapterPage')assert.deepEqual(args.where,{chapter:{storyId:target}});else assert.deepEqual(args.where,{storyId:target});
   const match=(row:any)=>model==='chapterPage'?state.chapter.some((c:any)=>c.id===row.chapterId&&c.storyId===target):row.storyId===target;
   const count=state[model].filter(match).length;state[model]=state[model].filter((row:any)=>!match(row));return {count};
  }};
 }
 tx.comment.updateMany=async(args:any)=>{calls.push({model:'comment',method:'updateMany',args});assert.deepEqual(args,{where:{storyId:target,parentId:{not:null}},data:{parentId:null}});for(const row of state.comment)if(row.storyId===target)row.parentId=null;return {count:2};};
 tx.story={
  findUnique:async()=>({...state.story.find((s:any)=>s.id===target),genres:[{genre:state.genre[0]}],_count:{chapters:1}}),
  delete:async(args:any)=>{calls.push({model:'story',method:'delete',args});assert.deepEqual(args.where,{id:target});
   for(const model of ['comment','rating','favorite','bookmark','readingHistory','readingProgress','chapter','storyGenre'])assert(!state[model].some((row:any)=>row.storyId===target));
   assert(!state.chapterPage.some((row:any)=>row.chapterId==='target-chapter'));state.story=state.story.filter((s:any)=>s.id!==target);return {};},
 };
 const client={$transaction:async(work:(tx:Prisma.TransactionClient)=>Promise<unknown>,options:any)=>{
  assert.equal(options.isolationLevel,'Serializable');const snapshot=structuredClone(state);
  try{return await work(tx);}catch(error){state=snapshot;rolledBack=true;throw error;}
 }} as unknown as PrismaClient;
 const service=createStoryService(createPrismaStoryStore(()=>client));
 return {service,original,calls,state:()=>state,rolledBack:()=>rolledBack,updatedAt};
}
test('permanent deletion scopes every dependent operation, orders child cleanup and retains shared/storage data (mock)',async()=>{
 const f=fixture();await f.service.remove('mock-admin',target,{confirm:true,expectedUpdatedAt:f.updatedAt.toISOString()});
 assert.equal(f.calls[0]!.method,'lock');assert.deepEqual(f.calls[0]!.args,[target]);
 assert.equal(f.calls.at(-1)!.model,'story');assert.equal(f.calls.at(-1)!.method,'delete');
 const s=f.state();assert.equal(s.story.length,1);assert.equal(s.story[0].id,other);
 for(const model of ['comment','rating','favorite','bookmark','readingHistory','readingProgress','chapter','storyGenre'])assert.equal(s[model].length,1);
 assert.deepEqual(s.chapterPage,[{id:'other-page',chapterId:'other-chapter'}]);
 for(const model of ['genre','user','cloudinary'])assert.deepEqual(s[model],f.original[model]);
 assert.equal(s.comment[0].id,'other-comment');
});
test('a child cleanup error rolls the entire deletion back, including detached comment parents (mock)',async()=>{
 const f=fixture('chapter');await assert.rejects(f.service.remove('mock-admin',target,{confirm:true,expectedUpdatedAt:f.updatedAt.toISOString()}));
 assert(f.rolledBack());assert.deepEqual(f.state(),f.original);assert(!f.calls.some(c=>c.model==='story'&&c.method==='delete'));
});
test('stale deletion never reaches any destructive Prisma delegate (mock)',async()=>{
 const f=fixture();await assert.rejects(f.service.remove('mock-admin',target,{confirm:true,expectedUpdatedAt:'2000-01-01T00:00:00Z'}),{statusCode:409});
 assert.deepEqual(f.state(),f.original);assert(!f.calls.some(c=>['deleteMany','updateMany','delete'].includes(c.method)));
});
