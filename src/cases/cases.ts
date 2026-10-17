import type { Tx } from "../db/pool.js";
import { query, withTx } from "../db/pool.js";
import { newId, truncate } from "../lib/util.js";

export type CaseRole = "owner" | "customer";

export interface CaseRow {
  id: string;
  store_id: string;
  role: CaseRole;
  principal_id: string;
  channel: "imessage" | "email" | "sms" | "web";
  thread_ref: string | null;
  intent_version: number;
  rollout_id: string | null;
  plan_id: string | null;
  state: string;
  summary: string;
  run_label: string | null;
}

/** Find this principal's open case in the store or open a new one (new case id per run/reset). */
export async function openCase(storeId: string, role: CaseRole, principalId: string, channel: CaseRow["channel"], threadRef: string | null): Promise<CaseRow> {
  return withTx(async (tx) => {
    const existing = (
      await tx.query(
        `select * from cases where store_id=$1 and role=$2 and principal_id=$3 and state not in ('resolved','failed') order by created_at desc limit 1 for update`,
        [storeId, role, principalId],
      )
    ).rows[0];
    if (existing) {
      if (threadRef && existing.thread_ref !== threadRef) await tx.query(`update cases set thread_ref=$2, updated_at=now() where id=$1`, [existing.id, threadRef]);
      return { ...existing, thread_ref: threadRef ?? existing.thread_ref };
    }
    const id = newId("case");
    const { rows } = await tx.query(
      `insert into cases(id, store_id, role, principal_id, channel, thread_ref) values ($1,$2,$3,$4,$5,$6) returning *`,
      [id, storeId, role, principalId, channel, threadRef],
    );
    return rows[0];
  });
}

export async function getCase(caseId: string): Promise<CaseRow | null> {
  return (await query<CaseRow>(`select * from cases where id=$1`, [caseId])).rows[0] ?? null;
}

export async function addCaseEvent(caseId: string, kind: string, data: Record<string, unknown>, tx?: Tx): Promise<void> {
  const q = tx ? tx.query.bind(tx) : query;
  await q(`insert into case_events(case_id, kind, data) values ($1,$2,$3)`, [caseId, kind, JSON.stringify(data)]);
  await q(`update cases set updated_at = now() where id = $1`, [caseId]);
}

export async function bumpIntent(caseId: string): Promise<number> {
  const { rows } = await query(`update cases set intent_version = intent_version + 1, updated_at=now() where id=$1 returning intent_version`, [caseId]);
  return rows[0].intent_version;
}

export async function updateCase(caseId: string, fields: { rollout_id?: string | null; plan_id?: string | null; state?: string; summary?: string }): Promise<CaseRow> {
  const cur = await getCase(caseId);
  if (!cur) throw new Error("case not found");
  const { rows } = await query<CaseRow>(
    `update cases set rollout_id = $2, plan_id = $3, state = $4, summary = $5, updated_at = now() where id = $1 returning *`,
    [caseId, fields.rollout_id !== undefined ? fields.rollout_id : cur.rollout_id, fields.plan_id !== undefined ? fields.plan_id : cur.plan_id, fields.state ?? cur.state, truncate(fields.summary ?? cur.summary, 1000)],
  );
  return rows[0];
}

/** Role-scoped transcript of THIS case only (never other customers' or the owner's private threads). */
export async function caseTranscript(caseId: string, limit = 20): Promise<Array<{ at: string; kind: string; text: string }>> {
  const { rows } = await query(`select kind, data, at from case_events where case_id=$1 and kind in ('inbound','outbound','approval','system') order by id desc limit $2`, [caseId, limit]);
  return rows
    .reverse()
    .map((r) => ({ at: new Date(r.at).toISOString(), kind: r.kind, text: truncate(String(r.data.text ?? r.data.note ?? ""), 600) }));
}
