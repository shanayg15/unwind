import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./pool.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate(): Promise<string[]> {
  const pool = getPool();
  await pool.query(
    "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
  );
  const applied = new Set(
    (await pool.query<{ version: string }>("select version from schema_migrations")).rows.map((r) => r.version),
  );
  const ran: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations(version) values ($1)", [file]);
      await client.query("commit");
      ran.push(file);
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then((ran) => console.log(ran.length ? `applied: ${ran.join(", ")}` : "schema up to date"))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
