import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from 'pg';
import { validateIntegrationUrl, assertTestDatabase } from './integration/environment';
import { isTransactionConflict } from '../src/utils/transaction-conflict';
import { createStoryService } from '../src/services/story.service';
import { createChapterService } from '../src/services/chapter.service';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { MemoryStoryStore } from './helpers/memory-story.store';
import { MemoryChapterStore } from './helpers/memory-chapter.store';
import type { ChapterStore } from '../src/types/chapter.types';
import type { StoryStore } from '../src/types/story.types';

for (const [name, url] of [
  ['main database','postgresql://test:synthetic@localhost:5432/webnovel_db'],
  ['database query override','postgresql://test:synthetic@localhost/webnovel_test_db?database=webnovel_db'],
  ['foreign host','postgresql://test:synthetic@external.invalid/webnovel_test_db'],
  ['wrong schema','postgresql://test:synthetic@localhost/webnovel_test_db?schema=other'],
  ['query options','postgresql://test:synthetic@localhost/webnovel_test_db?options=unsafe'],
  ['missing URL',''],
] as const) test(`integration safety rejects ${name}`, () => { assert.throws(() => validateIntegrationUrl(url)); });
test('integration guard checks actual connected database and schema independently of URL', async () => {
  const fake = (name: string, schema: string) => ({ query: async () => ({ rows: [{ name, schema }] }) }) as unknown as Pick<Client,'query'>;
  await assert.rejects(assertTestDatabase(fake('webnovel_db','public')));
  await assert.rejects(assertTestDatabase(fake('webnovel_test_db','other')));
  await assertTestDatabase(fake('webnovel_test_db','public'));
  validateIntegrationUrl('postgresql://test:synthetic@localhost/webnovel_test_db?schema=public');
});
test('transaction conflict detection recognizes Prisma raw SQLSTATE without retrying unknown errors', () => {
  for (const error of [{code:'P2034'},{code:'P2010',meta:{code:'40001'}},{code:'P2010',meta:{code:'40P01'}},{code:'P2010',meta:{code:'N/A',driverAdapterError:{cause:{originalCode:'40001'}}}}]) assert.equal(isTransactionConflict(error),true);
  for (const error of [null,{},new Error('unknown'),{code:'P2010',meta:{code:'23505'}},{code:'P2002'}]) assert.equal(isTransactionConflict(error),false);
});
test('Stories and Chapters retry raw serialization failure and cap retry exhaustion', async () => {
  const auth = new MemoryAuthStore(); const user=await auth.createUser({username:'test_admin',email:'admin@example.test',displayName:'Admin',passwordHash:''}); user.role='ADMIN';
  const stories = new MemoryStoryStore(auth); let storyAttempts=0;
  const error=()=>Object.assign(new Error('synthetic'),{code:'P2010',meta:{code:'40001'}});
  const storyStore: StoryStore={transaction:async(work,mode)=>{if(storyAttempts++===0)throw error();return stories.transaction(work,mode);}};
  const story=await createStoryService(storyStore).create(user.id,{title:'Test',type:'NOVEL',authorName:'Author'}); assert.equal(storyAttempts,2);
  const chapters=new MemoryChapterStore(stories);let chapterAttempts=0;
  const chapterStore: ChapterStore={transaction:async(work,mode)=>{if(chapterAttempts++===0)throw error();return chapters.transaction(work,mode);}};
  await createChapterService(chapterStore).create(user.id,story.id,{chapterNumber:1,title:'Chapter',content:'Content'});assert.equal(chapterAttempts,2);
  let exhausted=0;
  const failing: ChapterStore={transaction:async()=>{exhausted++;throw error();}};
  await assert.rejects(createChapterService(failing).create(user.id,story.id,{chapterNumber:2,title:'Chapter'}),(e:any)=>e.statusCode===409);
  assert.equal(exhausted,5);assert.equal(chapters.chapters.size,1);
});
