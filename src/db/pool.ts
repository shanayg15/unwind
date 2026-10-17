import pg from "pg";

// Revisions and order sequences are bigint columns but stay far below 2^53; parse them as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

export type Tx = pg.PoolClient;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not configured");
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

export interface TxOptions {
  /** Principal written into undo.writer; component triggers reject writes without it. */
  writer?: string;
  /** Action id stamped on component rows and journal entries. */
  actionId?: string;
  isolation?: "read committed" | "repeatable read" | "serializable";
}

const RETRYABLE = new Set(["40001", "40P01"]);

/**
 * Run fn in one transaction. Serialization/deadlock failures retry a bounded
 * number of times with jitter; callers keep idempotency keys so a retry never
 * applies a second effect.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query(`begin isolation level ${opts.isolation ?? "read committed"}`);
      if (opts.writer) await client.query("select set_config('undo.writer', $1, true)", [opts.writer]);
      if (opts.actionId) await client.query("select set_config('undo.action_id', $1, true)", [opts.actionId]);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 50));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Set the action id for subsequent component writes inside an open transaction. */
export async function setActionId(tx: Tx, actionId: string | null): Promise<void> {
  await tx.query("select set_config('undo.action_id', $1, true)", [actionId ?? ""]);
}

export async function setWriter(tx: Tx, writer: string): Promise<void> {
  await tx.query("select set_config('undo.writer', $1, true)", [writer]);
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}
