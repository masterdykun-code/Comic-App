import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client';
import { configureIntegration } from './environment';

test('U10 PostgreSQL: atomic password change, revocation, concurrency and owned cleanup', async t => {
  configureIntegration();
  const {getPrismaClient,disconnectPrisma}=await import('../../src/config/prisma.js');
  const {createPrismaAuthStore}=await import('../../src/services/auth.store.js');
  const {createAuthService}=await import('../../src/services/auth.service.js');
  const {hashPassword}=await import('../../src/utils/password.js');
  const argon2=await import('argon2');
  const db=getPrismaClient(), ids=[randomUUID(),randomUUID()], suffix=randomUUID().replaceAll('-','');
  const password=randomBytes(24).toString('hex'), next=randomBytes(24).toString('hex');
  const email=`u10-${suffix}@example.test`, store=createPrismaAuthStore(), service=createAuthService(store);
  const identity=async()=>{
    const rows=await db.$queryRaw<Array<{db:string;schema:string}>>`SELECT current_database() AS db,current_schema() AS schema`;
    assert.equal(rows[0]?.db,'webnovel_test_db'); assert.equal(rows[0]?.schema,'public');
  };
  const businessCounts=async()=>Promise.all([
    db.story.count(),db.chapter.count(),db.chapterPage.count(),db.bookmark.count(),db.readingProgress.count(),db.readingHistory.count(),db.favorite.count(),
  ]);
  let before:number[]=[];
  try {
    await identity(); before=await businessCounts();
    await db.user.createMany({data:ids.map((id,i)=>({id,username:`u10_${suffix.slice(0,16)}_${i}`,email:i===0?email:`other-${email}`,displayName:'U10 fixture',passwordHash:null}))});
    const originalHash=await hashPassword(password);
    await identity(); await db.user.update({where:{id:ids[0]!},data:{passwordHash:originalHash}});
    const first=await service.login(email,password), second=await service.login(email,password);
    const context=await service.authenticate(first.accessToken);
    const values={currentPassword:password,newPassword:next,confirmPassword:next};
    await t.test('wrong password and passwordless accounts do not mutate credentials or revoke sessions',async()=>{
      await assert.rejects(service.changePassword(context.user.id,context.sessionId,{...values,currentPassword:'Incorrect-value'}),{statusCode:403});
      const current=await db.user.findUniqueOrThrow({where:{id:ids[0]!}});
      assert.equal(current.passwordHash,originalHash);
      await service.authenticate(first.accessToken);
      const noPassword=await db.authSession.create({data:{userId:ids[1]!,expiresAt:new Date(Date.now()+60000)}});
      await assert.rejects(service.changePassword(ids[1]!,noPassword.id,values),{statusCode:403});
    });
    await t.test('failure while revoking sessions rolls back the real hash update',async()=>{
      const failingClient={
        $transaction: (work:(tx:Prisma.TransactionClient)=>Promise<boolean>)=>db.$transaction(tx=>work(new Proxy(tx,{
          get(target,key){
            if(key==='authSession')return new Proxy(target.authSession,{
              get(delegate,method){
                if(method==='updateMany')return async()=>{throw Error('Injected U10 rollback');};
                const value=Reflect.get(delegate,method); return typeof value==='function'?value.bind(delegate):value;
              },
            });
            const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
          },
        }))),
      } as unknown as PrismaClient;
      const failingStore=createPrismaAuthStore(()=>failingClient);
      await identity();
      await assert.rejects(failingStore.changePassword(ids[0]!,context.sessionId,originalHash,await hashPassword(next),new Date()),/Injected U10 rollback/);
      assert.equal((await db.user.findUniqueOrThrow({where:{id:ids[0]!}})).passwordHash,originalHash);
      await service.authenticate(first.accessToken); await service.authenticate(second.accessToken);
    });
    await t.test('two real concurrent password changes commit once and revoke all old access/refresh tokens',async()=>{
      await identity();
      const results=await Promise.allSettled([
        service.changePassword(context.user.id,context.sessionId,values),
        service.changePassword(context.user.id,context.sessionId,values),
      ]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.filter(r=>r.status==='rejected').length,1);
      for(const old of [first,second]){
        await assert.rejects(service.authenticate(old.accessToken),{statusCode:401});
        await assert.rejects(service.refresh(old.refreshToken),{statusCode:401});
      }
      const user=await db.user.findUniqueOrThrow({where:{id:ids[0]!}});
      assert(user.passwordHash?.startsWith('$argon2id$'));
      assert(await argon2.verify(user.passwordHash!,next));
      assert.equal(await db.authSession.count({where:{userId:ids[0]!,revokedAt:null}}),0);
      await assert.rejects(service.login(email,password),{statusCode:401});
      const fresh=await service.login(email,next);await service.authenticate(fresh.accessToken);
    });
    await t.test('a previously verified old password hash cannot create a new session',async()=>{
      await identity();
      const count=await db.authSession.count({where:{userId:ids[0]!}});
      assert.equal(await store.createSession(ids[0]!,randomBytes(32).toString('hex'),new Date(Date.now()+60000),originalHash),null);
      assert.equal(await db.authSession.count({where:{userId:ids[0]!}}),count);
    });
    await t.test('unrelated account and business data stay untouched',async()=>{
      assert.equal((await db.user.findUniqueOrThrow({where:{id:ids[1]!}})).passwordHash,null);
      assert.equal(await db.authSession.count({where:{userId:ids[1]!,revokedAt:null}}),1);
      assert.deepEqual(await businessCounts(),before);
    });
  } finally {
    await identity();
    await db.$transaction(async tx=>{
      await tx.refreshToken.deleteMany({where:{session:{userId:{in:ids}}}});
      await tx.authSession.deleteMany({where:{userId:{in:ids}}});
      await tx.user.deleteMany({where:{id:{in:ids},username:{startsWith:`u10_${suffix.slice(0,16)}`},email:{endsWith:'@example.test'}}});
    });
    assert.equal(await db.user.count({where:{id:{in:ids}}}),0);
    if(before.length)assert.deepEqual(await businessCounts(),before);
    await disconnectPrisma();
  }
});
