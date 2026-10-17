import type { Tx } from "../db/pool.js";
import { UndoError } from "./errors.js";

/**
 * Reserve an idempotency key inside the caller's transaction.
 * - same key + same request hash with a stored response -> return it (no second effect)
 * - same key + different request hash -> idempotency_conflict (U-I8, U10)
 * The row lock serializes concurrent retries of the same key.
 */
export async function reserveKey(
  tx: Tx,
  storeId: string,
  scope: string,
  key: string,
  requestHash: string,
): Promise<{ replay: unknown | null }> {
  if (!/^[A-Za-z0-9_\-:.]{8,120}$/.test(key)) {
    throw new UndoError("invalid_input", "idempotency_key must be 8-120 chars of [A-Za-z0-9_-:.]");
  }
  await tx.query(
    `insert into idempotency_keys(store_id, scope, key, request_hash) values ($1,$2,$3,$4)
     on conflict (store_id, scope, key) do nothing`,
    [storeId, scope, key, requestHash],
  );
  const { rows } = await tx.query(
    `select request_hash, response from idempotency_keys where store_id=$1 and scope=$2 and key=$3 for update`,
    [storeId, scope, key],
  );
  const row = rows[0];
  if (row.request_hash !== requestHash) {
    throw new UndoError("idempotency_conflict", "This idempotency key was already used with a different request", {
      scope,
      key,
    });
  }
  return { replay: row.response ?? null };
}

export async function storeResponse(tx: Tx, storeId: string, scope: string, key: string, response: unknown): Promise<void> {
  await tx.query(`update idempotency_keys set response = $4 where store_id=$1 and scope=$2 and key=$3`, [
    storeId,
    scope,
    key,
    JSON.stringify(response),
  ]);
}

export async function audit(
  tx: Tx,
  storeId: string | null,
  actor: string,
  kind: string,
  data: Record<string, unknown>,
  correlationId?: string,
): Promise<void> {
  await tx.query(`insert into audit_events(store_id, actor, kind, data, correlation_id) values ($1,$2,$3,$4,$5)`, [
    storeId,
    actor,
    kind,
    JSON.stringify(data),
    correlationId ?? null,
  ]);
}
