import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { APP_TABLES, assertTestDatabase } from './environment';

export function migrationFiles() {
  return readdirSync('prisma/migrations', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({
    name: d.name, sql: readFileSync(join('prisma/migrations', d.name, 'migration.sql'), 'utf8'),
  })).sort((a,b) => a.name.localeCompare(b.name));
}
export async function preflight(client: Client): Promise<void> {
  await assertTestDatabase(client);
  const unknown = await client.query("SELECT (SELECT count(*) FROM pg_namespace WHERE nspname<>'public' AND nspname<>'information_schema' AND nspname NOT LIKE 'pg_%') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public') + (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND NOT t.tgisinternal) AS count");
  if (Number(unknown.rows[0].count) !== 0) throw new Error('Unknown schemas/functions/triggers in test database; manual inspection required.');
  const objects = await client.query("SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')");
  if (!objects.rowCount) {
    const types = await client.query("SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'");
    if (types.rowCount) throw new Error('Unknown enum objects in test database; manual inspection required.');
    return;
  }
  const allowed: string[] = [...APP_TABLES, '_prisma_migrations'];
  if (objects.rows.some((r) => r.relkind !== 'r' || !allowed.includes(r.relname)) || objects.rowCount !== allowed.length) throw new Error('Unknown/partial schema in test database; refusing migration or cleanup.');
  await verifySchema(client);
  await assertEmpty(client);
}
export async function assertEmpty(client: Client): Promise<void> {
  await assertTestDatabase(client);
  for (const table of APP_TABLES) {
    // Identifier is taken only from this immutable allowlist.
    const r = await client.query(`SELECT EXISTS(SELECT 1 FROM public."${table}") AS populated`);
    if (r.rows[0].populated) throw new Error(`Test table ${table} is not empty; unknown/residual data must be inspected manually. No cleanup performed.`);
  }
}
export async function verifySchema(client: Client): Promise<void> {
  await assertTestDatabase(client);
  const files = migrationFiles();
  const applied = await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name');
  if (applied.rows.length !== files.length || applied.rows.some((r, i) => !r.finished_at || r.rolled_back_at || r.migration_name !== files[i].name || r.checksum !== createHash('sha256').update(files[i].sql).digest('hex'))) throw new Error('Migration history/checksums do not match this project.');
  const sql = files.map((f) => f.sql).join('\n');
  const names = (pattern: RegExp) => [...sql.matchAll(pattern)].map((m) => m[1]).sort();
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map((r) => r.tablename);
  if (JSON.stringify(tables) !== JSON.stringify(names(/CREATE TABLE "([^"]+)"/g))) throw new Error('Unexpected application table set.');
  // PostgreSQL 18 also represents NOT NULL in pg_constraint (contype=n).
  // Verify those via pg_attribute below, consistently across server versions.
  const constraints = (await client.query("SELECT conname,contype,convalidated,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid JOIN pg_namespace n ON t.relnamespace=n.oid WHERE n.nspname='public' AND t.relname<>'_prisma_migrations' AND c.contype<>'n' ORDER BY conname")).rows;
  if (constraints.some((r) => !r.convalidated) || JSON.stringify(constraints.map((r) => r.conname)) !== JSON.stringify(names(/(?:ADD CONSTRAINT|CONSTRAINT) "([^"]+)"/g))) throw new Error('Database PK/FK/CHECK constraints do not match migrations.');
  const normalize = (value: string) => value.replace(/ON DELETE (RESTRICT|CASCADE|SET NULL|SET DEFAULT|NO ACTION)\s+ON UPDATE (RESTRICT|CASCADE|SET NULL|SET DEFAULT|NO ACTION)/gi,'ON UPDATE $2 ON DELETE $1').replaceAll('"','').replaceAll('public.','').replace(/ON UPDATE NO ACTION/gi,'').replace(/\s+/g,'').toLowerCase();
  for (const match of sql.matchAll(/CONSTRAINT "([^"]+)" (PRIMARY KEY \([^\n]+\))/g)) {
    const actual = constraints.find((c) => c.conname===match[1]);
    if (!actual || actual.contype!=='p' || normalize(actual.definition)!==normalize(match[2])) throw new Error('Database PK definition differs from migrations.');
  }
  for (const match of sql.matchAll(/ADD CONSTRAINT "([^"]+)" (FOREIGN KEY [^;]+);/g)) {
    const actual = constraints.find((c) => c.conname===match[1]);
    if (!actual || actual.contype!=='f' || normalize(actual.definition)!==normalize(match[2])) throw new Error('Database FK definition differs from migrations.');
  }
  if (constraints.some((c) => c.conname.endsWith('_check') && c.contype!=='c')) throw new Error('Database CHECK constraint type mismatch.');
  const columns = (await client.query("SELECT c.relname AS table_name,a.attname AS column_name,a.attnotnull AS required FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname<>'_prisma_migrations' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped")).rows;
  const expectedColumns = [...sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)].flatMap((table) => [...table[2].matchAll(/^\s+"([^"]+)" ([^\n]+)/gm)].map((column) => ({ table: table[1], name: column[1], required: column[2].includes('NOT NULL') })));
  // Additive migrations may introduce columns after a table's initial CREATE.
  for (const alter of sql.matchAll(/ALTER TABLE "([^"]+)"\s+([\s\S]*?);/g)) {
    for (const column of alter[2].matchAll(/ADD COLUMN\s+"([^"]+)" ([^,\n;]+)/g)) {
      expectedColumns.push({table:alter[1],name:column[1],required:column[2].includes('NOT NULL')});
    }
  }
  if (columns.length !== expectedColumns.length || expectedColumns.some((e) => !columns.some((c) => c.table_name===e.table && c.column_name===e.name && c.required===e.required))) throw new Error('Unexpected column set or NOT NULL constraints.');
  const indexes = (await client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename<>'_prisma_migrations' AND indexname NOT LIKE '%_pkey' ORDER BY indexname")).rows;
  if (JSON.stringify(indexes.map((r) => r.indexname)) !== JSON.stringify(names(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g))) throw new Error('Unique/index set differs from migrations.');
  for (const match of sql.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\(([^;]+)\);/g)) {
    const actual = indexes.find((i) => i.indexname===match[2]);
    const expected = `CREATE ${match[1] ?? ''}INDEX ${match[2]} ON ${match[3]} USING btree (${match[4]})`;
    if (!actual || normalize(actual.indexdef)!==normalize(expected)) throw new Error('Unique/index definition differs from migrations.');
  }
  for (const name of ['reading_progress_chapter_id_story_id_fkey','reading_history_chapter_id_story_id_fkey','comments_parent_id_story_id_fkey','bookmarks_chapter_id_story_id_fkey']) {
    const c = constraints.find((r) => r.conname === name);
    if (!c || !/FOREIGN KEY \([^)]*, story_id\) REFERENCES (?:public\.)?(?:chapters|comments)\(id, story_id\) ON DELETE RESTRICT/.test(c.definition)) throw new Error('Composite story foreign key definition mismatch.');
  }
  const enums = (await client.query("SELECT t.typname,array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname")).rows;
  const expectedEnums = [...sql.matchAll(/CREATE TYPE "([^"]+)" AS ENUM \(([^;]+)\);/g)].map((m) => ({ typname: m[1], labels: [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1]) })).sort((a,b) => a.typname.localeCompare(b.typname));
  // enumlabel[] may arrive as PostgreSQL's textual array type; compare via JSON.
  const actualEnums = await client.query("SELECT t.typname,json_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname");
  if (enums.length !== expectedEnums.length || JSON.stringify(actualEnums.rows) !== JSON.stringify(expectedEnums)) throw new Error('Enum labels differ from migrations.');
}
