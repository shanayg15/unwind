import type { Tx } from "../db/pool.js";
import { withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { audit } from "../lib/idempotency.js";
import { newId, newSecret, sha256 } from "../lib/util.js";

export type ApprovalKind = "launch" | "recovery";

/** Owner principal for a store (server-derived; never from caller input). */
export async function storeOwner(tx: Tx, storeId: string): Promise<{ id: string; phone: string | null; email: string | null }> {
  const { rows } = await tx.query(
    `select p.id, p.phone_e164, p.email from store_memberships m join principals p on p.id = m.principal_id
      where m.store_id = $1 and m.role = 'owner' limit 1`,
    [storeId],
  );
  if (!rows[0]) throw new UndoError("internal", "Store has no owner");
  return { id: rows[0].id, phone: rows[0].phone_e164, email: rows[0].email };
}

async function currentSubjectHash(tx: Tx, storeId: string, kind: ApprovalKind, subjectId: string): Promise<string> {
  if (kind === "launch") {
    const { rows } = await tx.query(`select proposal_hash, state from rollouts where id=$1 and store_id=$2`, [subjectId, storeId]);
    if (!rows[0]) throw new UndoError("not_found", "Rollout not found");
    if (rows[0].state !== "awaiting_approval") throw new UndoError("invalid_input", `Rollout is ${rows[0].state}`);
    return rows[0].proposal_hash;
  }
  const { rows } = await tx.query(`select plan_hash, status, expires_at from recovery_plans where id=$1 and store_id=$2`, [subjectId, storeId]);
  if (!rows[0]) throw new UndoError("not_found", "Recovery plan not found");
  if (rows[0].status !== "open") throw new UndoError("stale_plan", `Plan is ${rows[0].status}`);
  if (new Date(rows[0].expires_at).getTime() < Date.now()) throw new UndoError("plan_expired", "Plan expired; preview again");
  return rows[0].plan_hash;
}

/**
 * Create a single-use approval link for the store owner. The plaintext token is returned
 * only to the comms layer that delivers it to the owner's verified channel; it is never
 * returned through an MCP tool, so an agent cannot approve its own plan (U-I3).
 */
export async function createApprovalRequest(
  tx: Tx,
  storeId: string,
  kind: ApprovalKind,
  subjectId: string,
  caseId: string | null,
  ttlMinutes = 30,
): Promise<{ requestId: string; token: string; subjectHash: string; expiresAt: string }> {
  const owner = await storeOwner(tx, storeId);
  const subjectHash = await currentSubjectHash(tx, storeId, kind, subjectId);
  const token = newSecret("apr");
  const requestId = newId("areq");
  const { rows } = await tx.query(
    `insert into approval_requests(id, store_id, kind, subject_id, subject_hash, owner_principal_id, token_hash, case_id, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9::int)) returning expires_at`,
    [requestId, storeId, kind, subjectId, subjectHash, owner.id, sha256(token), caseId, ttlMinutes],
  );
  return { requestId, token, subjectHash, expiresAt: new Date(rows[0].expires_at).toISOString() };
}

export interface ApprovalRequestView {
  requestId: string;
  storeId: string;
  kind: ApprovalKind;
  subjectId: string;
  subjectHash: string;
  expiresAt: string;
  usedAt: string | null;
  caseId: string | null;
}

export async function lookupApprovalToken(tx: Tx, token: string): Promise<ApprovalRequestView> {
  const { rows } = await tx.query(`select * from approval_requests where token_hash = $1`, [sha256(token)]);
  const r = rows[0];
  if (!r) throw new UndoError("approval_invalid", "Unknown or invalid approval link");
  return {
    requestId: r.id,
    storeId: r.store_id,
    kind: r.kind,
    subjectId: r.subject_id,
    subjectHash: r.subject_hash,
    expiresAt: new Date(r.expires_at).toISOString(),
    usedAt: r.used_at ? new Date(r.used_at).toISOString() : null,
    caseId: r.case_id,
  };
}

/** Owner confirms the exact subject hash through a single-use link. */
export async function approveViaToken(token: string, decision: "approve" | "reject"): Promise<{ approvalId: string | null; kind: ApprovalKind; subjectId: string; caseId: string | null }> {
  return withTx(async (tx) => {
    const { rows } = await tx.query(`select * from approval_requests where token_hash = $1 for update`, [sha256(token)]);
    const r = rows[0];
    if (!r) throw new UndoError("approval_invalid", "Unknown or invalid approval link");
    if (r.used_at) throw new UndoError("approval_invalid", "This approval link was already used");
    if (new Date(r.expires_at).getTime() < Date.now()) throw new UndoError("plan_expired", "This approval link expired");
    const liveHash = await currentSubjectHash(tx, r.store_id, r.kind, r.subject_id);
    if (liveHash !== r.subject_hash) throw new UndoError("stale_plan", "The plan changed after this link was sent; a new link is needed");
    await tx.query(`update approval_requests set used_at = now() where id = $1`, [r.id]);
    if (decision === "reject") {
      if (r.kind === "launch") await tx.query(`update rollouts set state='rejected' where id=$1 and store_id=$2`, [r.subject_id, r.store_id]);
      await audit(tx, r.store_id, r.owner_principal_id, `${r.kind}.rejected`, { subject_id: r.subject_id, request_id: r.id });
      return { approvalId: null, kind: r.kind, subjectId: r.subject_id, caseId: r.case_id };
    }
    const approvalId = await insertApproval(tx, r.store_id, r.owner_principal_id, r.kind, r.subject_id, r.subject_hash, "owner_link", r.id);
    if (r.kind === "launch") await tx.query(`update rollouts set state='approved' where id=$1 and state='awaiting_approval'`, [r.subject_id]);
    return { approvalId, kind: r.kind, subjectId: r.subject_id, caseId: r.case_id };
  });
}

/** Owner approves directly from an authenticated owner session (console or owner MCP credential). */
export async function approveAsOwner(
  ownerPrincipalId: string,
  storeId: string,
  kind: ApprovalKind,
  subjectId: string,
  subjectHash: string,
  via: string,
): Promise<string> {
  return withTx(async (tx) => {
    const owner = await storeOwner(tx, storeId);
    if (owner.id !== ownerPrincipalId) throw new UndoError("forbidden", "Only the store owner can approve");
    const liveHash = await currentSubjectHash(tx, storeId, kind, subjectId);
    if (liveHash !== subjectHash) throw new UndoError("stale_plan", "Hash does not match the current subject");
    const id = await insertApproval(tx, storeId, ownerPrincipalId, kind, subjectId, subjectHash, via, null);
    if (kind === "launch") await tx.query(`update rollouts set state='approved' where id=$1 and state='awaiting_approval'`, [subjectId]);
    return id;
  });
}

async function insertApproval(
  tx: Tx,
  storeId: string,
  principalId: string,
  kind: ApprovalKind,
  subjectId: string,
  subjectHash: string,
  via: string,
  requestId: string | null,
): Promise<string> {
  const id = newId("apv");
  await tx.query(
    `insert into approvals(id, store_id, principal_id, kind, subject_id, subject_hash, decided_via, request_id, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '30 minutes')`,
    [id, storeId, principalId, kind, subjectId, subjectHash, via, requestId],
  );
  await audit(tx, storeId, principalId, `${kind}.approved`, { approval_id: id, subject_id: subjectId, subject_hash: subjectHash, via });
  return id;
}
