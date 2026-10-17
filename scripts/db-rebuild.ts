/**
 * Drop and recreate the schema. Guarded: refuses unless UNDO_ALLOW_SCHEMA_REBUILD=1 and the
 * database holds no non-demo stores. Intended only for the dedicated UNDO Neon branches.
 */
import { closePool, getPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

const pool = getPool();
try {
  if (process.env.UNDO_ALLOW_SCHEMA_REBUILD !== "1") throw new Error("refusing: set UNDO_ALLOW_SCHEMA_REBUILD=1");
  const t = await pool.query(`select to_regclass('public.stores') is not null as has`);
  if (t.rows[0].has) {
    const r = await pool.query(`select count(*)::int as n from stores where not is_demo`);
    if (r.rows[0].n > 0) throw new Error("refusing: non-demo stores exist");
  }
  await pool.query("drop schema public cascade; create schema public;");
  const ran = await migrate();
  console.log(`schema rebuilt; applied ${ran.join(", ")}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
