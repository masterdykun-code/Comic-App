import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { parse } from "dotenv";
import { assertPrimary, validatePrimaryUrl } from "./sample-library-core";
import {
  digest,
  expansionRoot,
  type Inventory,
} from "./library-expansion-core";

export type Reader = {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
};
export async function readInventory(db: Reader): Promise<Inventory> {
  await assertPrimary(db);
  const read = async <T>(sql: string) => (await db.query(sql)).rows as T[];
  const admins = await read<{ id: string }>(
    "SELECT id FROM public.users WHERE role='ADMIN' AND status='ACTIVE' ORDER BY id",
  );
  const stories = await read<Inventory["stories"][number]>(
    "SELECT id,slug,title,description FROM public.stories ORDER BY id",
  );
  const genres = await read<Inventory["genres"][number]>(
    "SELECT id,slug,name FROM public.genres ORDER BY id",
  );
  const chapters = await read<Inventory["chapters"][number]>(
    'SELECT id,story_id AS "storyId" FROM public.chapters ORDER BY id',
  );
  const pages = await read<Inventory["pages"][number]>(
    'SELECT id,chapter_id AS "chapterId" FROM public.chapter_pages ORDER BY id',
  );
  const tables = await read<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const fingerprints: Inventory["fingerprints"] = {};
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    // Sensitive values never leave PostgreSQL; only opaque per-row fingerprints.
    const rows = await read<{ fingerprint: string }>(
      "SELECT md5(row_to_json(r)::text) AS fingerprint FROM public." +
        quoted +
        " r ORDER BY 1",
    );
    fingerprints[tablename] = {
      count: rows.length,
      sha256: digest(rows.map((r) => r.fingerprint).join("\n")),
    };
  }
  return { admins, stories, genres, chapters, pages, fingerprints };
}
export async function readEnvironment() {
  const env = parse(await readFile(resolve(__dirname, "../../.env"), "utf8"));
  validatePrimaryUrl(env.DATABASE_URL);
  return env;
}
export function readOnlyClient(raw: string) {
  validatePrimaryUrl(raw);
  return new Client({
    connectionString: raw,
    options: "-c default_transaction_read_only=on",
    connectionTimeoutMillis: 5000,
  });
}
export const backupRoot = resolve(homedir(), ".codex/backups/webnovel");
const pgBin = "C:/Program Files/PostgreSQL/18/bin";
export type BackupProof = {
  database: "webnovel_db/public";
  archive: string;
  archiveBytes: number;
  archiveSha256: string;
  createdAt: string;
  fingerprints: Inventory["fingerprints"];
  readVerification: {
    toc: boolean;
    fullSqlStreamDecoded: boolean;
    sqlBytes: number;
    sqlSha256: string;
    actualRestoreNotPerformed: true;
  };
};
async function pgTool(
  tool: "pg_dump" | "pg_restore",
  args: string[],
  env: NodeJS.ProcessEnv,
  capture = false,
) {
  return new Promise<{ bytes: number; sha256: string; text: string }>(
    (ok, fail) => {
      const child = spawn(resolve(pgBin, tool + ".exe"), args, {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const hash = createHash("sha256");
      let bytes = 0,
        text = "";
      child.stdout.on("data", (b: Buffer) => {
        hash.update(b);
        bytes += b.length;
        if (capture && text.length < 2_000_000) text += b.toString("utf8");
      });
      // Never propagate native tool stderr: it may contain credentials or SQL data.
      child.stderr.resume();
      child.once("error", () => fail(Error("BACKUP_TOOL_UNAVAILABLE")));
      child.once("close", (code) =>
        code === 0
          ? ok({ bytes, sha256: hash.digest("hex"), text })
          : fail(Error("BACKUP_TOOL_FAILED")),
      );
    },
  );
}
export function archiveDecodeArguments(file: string, sha256: string) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw Error("BACKUP_HASH_INVALID");
  return ["--restrict-key=Wn" + sha256, "--file=-", file];
}
export async function inspectArchive(
  archive: string,
  expectedTables: string[],
) {
  const base = await realpath(backupRoot),
    file = await realpath(archive);
  if (!file.startsWith(base + sep) || !file.endsWith(".dump"))
    throw Error("BACKUP_PATH_INVALID");
  const b = await readFile(file);
  if (b.subarray(0, 5).toString() !== "PGDMP")
    throw Error("BACKUP_FORMAT_INVALID");
  const toc = await pgTool("pg_restore", ["--list", file], process.env, true);
  for (const table of expectedTables)
    if (
      !toc.text
        .split(/\r?\n/)
        .some((line) => line.includes(`TABLE DATA public ${table} `))
    )
      throw Error("BACKUP_TABLE_MISSING");
  // Decode every compressed archive data stream to stdout and hash/discard it.
  // No --dbname: pg_restore cannot connect or write to a database here.
  // PostgreSQL 18 emits a random psql \restrict key on each decode by default.
  // Bind that marker to the archive hash for reproducible, discard-only checks.
  // This SQL stream is never executed or written to disk.
  const sql = await pgTool(
    "pg_restore",
    archiveDecodeArguments(file, digest(b)),
    process.env,
  );
  if (sql.bytes < 1000) throw Error("BACKUP_DECODE_EMPTY");
  return {
    archiveBytes: b.length,
    archiveSha256: digest(b),
    readVerification: {
      toc: true,
      fullSqlStreamDecoded: true,
      sqlBytes: sql.bytes,
      sqlSha256: sql.sha256,
      actualRestoreNotPerformed: true as const,
    },
  };
}
export async function createBackup() {
  const env = await readEnvironment(),
    raw = env.DATABASE_URL;
  const db = readOnlyClient(raw);
  try {
    await db.connect();
    await db.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const inventory = await readInventory(db);
    const snapshot = (await db.query("SELECT pg_export_snapshot() AS snapshot"))
      .rows[0].snapshot as string;
    if (!/^[a-f0-9-]+$/i.test(snapshot)) throw Error("SNAPSHOT_INVALID");
    await mkdir(backupRoot, { recursive: true });
    const createdAt = new Date().toISOString();
    const archive = resolve(
      backupRoot,
      `webnovel_db-before-library-v2-${createdAt.replace(/[:.]/g, "-")}.dump`,
    );
    const u = new URL(raw);
    const childEnv = {
      ...process.env,
      PGHOST: u.hostname === "[::1]" ? "::1" : u.hostname,
      PGPORT: u.port || "5432",
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: "webnovel_db",
      PGOPTIONS: "-c default_transaction_read_only=on",
      PGAPPNAME: "webnovel-v2-readonly-backup",
    };
    await pgTool(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--no-password",
        "--snapshot=" + snapshot,
        "--file=" + archive,
      ],
      childEnv,
    );
    const verified = await inspectArchive(
      archive,
      Object.keys(inventory.fingerprints),
    );
    await db.query("COMMIT");
    const proof: BackupProof = {
      database: "webnovel_db/public",
      archive,
      ...verified,
      createdAt,
      fingerprints: inventory.fingerprints,
    };
    const proofPath = archive + ".verification.json";
    await writeFile(proofPath, JSON.stringify(proof, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await mkdir(resolve(expansionRoot, ".import-state"), { recursive: true });
    await writeFile(
      resolve(expansionRoot, ".import-state/backup-pointer.json"),
      JSON.stringify({ proofPath }) + "\n",
      { mode: 0o600 },
    );
    return { proofPath, proof };
  } finally {
    await db.end();
  }
}
export async function verifyBackup(proofPath: string, inventory: Inventory) {
  const base = await realpath(backupRoot),
    file = await realpath(proofPath);
  if (!file.startsWith(base + sep)) throw Error("BACKUP_PATH_INVALID");
  const proof = JSON.parse(await readFile(file, "utf8")) as BackupProof;
  if (
    proof.database !== "webnovel_db/public" ||
    JSON.stringify(proof.fingerprints) !==
      JSON.stringify(inventory.fingerprints)
  )
    throw Error("BACKUP_STALE_OR_WRONG_TARGET");
  const actual = await inspectArchive(
    proof.archive,
    Object.keys(inventory.fingerprints),
  );
  if (
    actual.archiveBytes !== proof.archiveBytes ||
    actual.archiveSha256 !== proof.archiveSha256 ||
    actual.readVerification.sqlSha256 !== proof.readVerification.sqlSha256 ||
    !proof.readVerification.toc ||
    !proof.readVerification.fullSqlStreamDecoded
  )
    throw Error("BACKUP_CHANGED_OR_UNREADABLE");
  return proof;
}
if (require.main === module) {
  if (process.argv.slice(2).join() !== "--create-backup") {
    console.error(
      "Use --create-backup for a read-only export; no restore is supported.",
    );
    process.exitCode = 1;
  } else
    createBackup()
      .then(({ proofPath, proof }) =>
        console.log(
          JSON.stringify({
            database: proof.database,
            proofPath,
            archiveBytes: proof.archiveBytes,
            archiveSha256: proof.archiveSha256,
            readVerification: proof.readVerification,
          }),
        ),
      )
      .catch(() => {
        console.error(
          "Backup stopped safely; native errors and credentials suppressed. No database restore or write attempted.",
        );
        process.exitCode = 1;
      });
}
