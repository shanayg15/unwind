import type { Tx } from "../db/pool.js";
import { query } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { newId, newSecret, sha256 } from "../lib/util.js";

export type Role = "owner" | "operator" | "agent" | "customer" | "evaluator";

/** Verified caller identity. Store and role come from the credential, never from tool input. */
export interface Principal {
  principalId: string;
  storeId: string;
  role: Role;
  tokenId: string;
  caseId: string | null;
}

export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  // "Bearer" per RFC 6750; "Token" because some MCP clients (e.g. Armature's bearer profile) send that scheme.
  const m = /^(?:Bearer|Token)\s+([A-Za-z0-9_\-.~+/=]{16,200})$/i.exec(header.trim());
  return m ? m[1] : null;
}

const cache = new Map<string, { p: Principal; at: number }>();
const CACHE_MS = 5_000;

export async function verifyToken(raw: string | null): Promise<Principal> {
  if (!raw) throw new UndoError("unauthenticated", "Missing bearer token", {}, "configure_credentials");
  const hash = sha256(raw);
  const hit = cache.get(hash);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const { rows } = await query<{
    id: string;
    principal_id: string;
    store_id: string;
    role: Role;
    case_id: string | null;
    expires_at: Date | null;
    revoked_at: Date | null;
    member_role: Role | null;
  }>(
    `select t.id, t.principal_id, t.store_id, t.role, t.case_id, t.expires_at, t.revoked_at, m.role as member_role
       from api_tokens t
       left join store_memberships m on m.store_id = t.store_id and m.principal_id = t.principal_id
      where t.token_hash = $1`,
    [hash],
  );
  const row = rows[0];
  if (!row) throw new UndoError("unauthenticated", "Unknown credential");
  if (row.revoked_at) throw new UndoError("unauthenticated", "Credential revoked");
  if (row.expires_at && row.expires_at.getTime() < Date.now()) throw new UndoError("unauthenticated", "Credential expired");
  if (row.member_role !== row.role) throw new UndoError("forbidden", "Credential role is not a current store membership");
  const p: Principal = {
    principalId: row.principal_id,
    storeId: row.store_id,
    role: row.role,
    tokenId: row.id,
    caseId: row.case_id,
  };
  cache.set(hash, { p, at: Date.now() });
  return p;
}

export function clearTokenCache(): void {
  cache.clear();
}

export function requireRole(p: Principal, allowed: Role[], action: string): void {
  if (!allowed.includes(p.role)) {
    throw new UndoError("forbidden", `Role '${p.role}' may not ${action}`, { role: p.role, allowed });
  }
}

export async function mintToken(
  tx: Tx,
  opts: { principalId: string; storeId: string; role: Role; label: string; ttlMinutes?: number; caseId?: string },
): Promise<{ token: string; tokenId: string }> {
  const token = newSecret(`undo_${opts.role.slice(0, 4)}`);
  const tokenId = newId("tok");
  await tx.query(
    `insert into api_tokens(id, token_hash, principal_id, store_id, role, label, case_id, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7, case when $8::int is null then null else now() + make_interval(mins => $8::int) end)`,
    [tokenId, sha256(token), opts.principalId, opts.storeId, opts.role, opts.label, opts.caseId ?? null, opts.ttlMinutes ?? null],
  );
  return { token, tokenId };
}
