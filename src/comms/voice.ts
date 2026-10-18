import { Inkbox } from "@inkbox/sdk";
import type { CaseRow } from "../cases/cases.js";
import { addCaseEvent } from "../cases/cases.js";
import { query, withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { newId, truncate } from "../lib/util.js";

export const MAX_CALL_SECONDS = () => Number(process.env.MAX_CALL_DURATION_SECONDS ?? 180);

/** Bounded, case-only brief. No customer data, no other contacts, no store-changing claims (V04). */
export function callBrief(storeName: string, caseId: string, question: string): string {
  return truncate(
    [
      `You are the AI assistant for the shop "${storeName}" (a demo store), calling the store owner about recovery case ${caseId.slice(-6)}.`,
      `Ask the owner exactly this and listen for their choice: ${truncate(question.trim(), 450)}`,
      "Confirm their choice back in one sentence. Tell them nothing is changed until they confirm the plan by text message, which they will receive right after this call.",
      "Record the owner's decision as one action item in their own words. Keep the call under two minutes and end it politely.",
      "Do not say you changed the store. Do not send texts or emails. Do not discuss customers, orders of other people, or any other contact. No transfers.",
    ].join(" "),
    1400,
  );
}

async function consumeCallBudget(): Promise<void> {
  const cap = Number(process.env.MAX_LIVE_CALLS ?? 0);
  await query(`insert into usage_counters(name, used, cap) values ('live_calls', 0, $1) on conflict (name) do update set cap = $1`, [cap]);
  const { rowCount } = await query(`update usage_counters set used = used + 1 where name='live_calls' and used < cap`);
  if (!rowCount) throw new UndoError("limit_exceeded", `Owner call budget exhausted (cap ${cap})`);
}

let inkbox: Inkbox | undefined;
async function identity() {
  inkbox ??= new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
  return inkbox.getIdentity(process.env.INKBOX_IDENTITY ?? "yc-hack-shanay");
}

/**
 * Place ONE bounded owner call for an open plan. Bound to the owner principal, case, intent version and
 * plan hash before dialing. Authority is explicitly contact_scoped; voicemail hangs up (no message left).
 */
export async function placeOwnerCall(c: CaseRow, planId: string, question: string): Promise<Record<string, unknown>> {
  if (process.env.OWNER_VOICE_ENABLED !== "true") throw new UndoError("forbidden", "Owner voice is not enabled");
  if (c.role !== "owner") throw new UndoError("forbidden", "Only owner cases can place calls");
  const plan = (await query(`select id, store_id, plan_hash, status, expires_at from recovery_plans where id=$1`, [planId])).rows[0];
  if (!plan || plan.store_id !== c.store_id || plan.status !== "open") throw new UndoError("invalid_input", "Plan is not open in this case's store");
  const active = (await query(`select id from voice_sessions where case_id=$1 and status in ('placing','in_progress')`, [c.id])).rowCount;
  if (active) throw new UndoError("limit_exceeded", "A call for this case is already in progress");
  const perPlan = (await query(`select count(*)::int n from voice_sessions where case_id=$1 and plan_id=$2`, [c.id, planId])).rows[0].n;
  if (perPlan >= 1) throw new UndoError("limit_exceeded", "This plan already had a call; use one text instead of calling again");
  const owner = (await query(`select p.phone_e164 from store_memberships m join principals p on p.id=m.principal_id where m.store_id=$1 and m.role='owner' and p.id=$2`, [c.store_id, c.principal_id])).rows[0];
  if (!owner?.phone_e164) throw new UndoError("invalid_input", "Owner has no consented phone number");
  if (process.env.LIVE_SEND_ENABLED !== "true") throw new UndoError("forbidden", "Live sending is disabled");
  await consumeCallBudget();
  const id = newId("call");
  await query(`insert into voice_sessions(id, case_id, store_id, plan_id, plan_hash, intent_version, question) values ($1,$2,$3,$4,$5,$6,$7)`, [id, c.id, c.store_id, planId, plan.plan_hash, c.intent_version, truncate(question.trim(), 600)]);
  const store = (await query(`select name from stores where id=$1`, [c.store_id])).rows[0].name as string;
  let call: { id: string; hostedAgentAuthorityMode?: string };
  try {
    call = await (await identity()).placeCall({
      toNumber: owner.phone_e164,
      origination: "shared_imessage_number" as never,
      mode: "hosted_agent" as never,
      hostedAgentAuthorityMode: "contact_scoped" as never,
      onVoicemail: "hang_up" as never,
      reason: callBrief(store, c.id, question),
    });
  } catch (e) {
    const status = (e as { status?: number }).status;
    // Ambiguous placement is not retried blindly (V05): the session stays unknown and the per-plan limit holds.
    await query(`update voice_sessions set status=$2, error=$3 where id=$1`, [id, status && status >= 400 && status < 500 ? "failed" : "unknown", truncate((e as Error).message, 300)]);
    throw new UndoError("internal", "Call could not be placed; send one text instead", { status });
  }
  const mode = call.hostedAgentAuthorityMode ?? "contact_scoped(requested)";
  try {
    await query(`update voice_sessions set provider_call_id=$2, status='in_progress', authority_mode=$3 where id=$1`, [id, call.id, mode]);
  } catch (e) {
    // A call we cannot track must not keep running: its result could never be bound to this case.
    await (await identity()).hangupCall(call.id).catch(() => {});
    await query(`update voice_sessions set status='cancelled', error=$2 where id=$1`, [id, truncate((e as Error).message, 300)]).catch(() => {});
    throw e;
  }
  await addCaseEvent(c.id, "outbound", { text: `[placed owner call about plan ${planId}] ${truncate(question, 300)}`, purpose: "owner_call", voice_session: id });
  return { call_session: id, status: "ringing", authority_mode: mode, max_seconds: MAX_CALL_SECONDS(), note: "Wait for the call result event; do not text the owner the same question now." };
}

/** Kill switch: end calls that exceed the approved duration (V05). Returns ids hung up. */
export async function enforceCallLimits(): Promise<string[]> {
  const { rows } = await query(
    `select id, provider_call_id from voice_sessions
      where status = 'in_progress' and hangup_requested_at is null and provider_call_id is not null
        and created_at < now() - make_interval(secs => $1::int)`,
    [MAX_CALL_SECONDS() + 60], // allow up to 60 s of ringing before the conversation clock
  );
  const out: string[] = [];
  for (const r of rows) {
    try {
      await (await identity()).hangupCall(r.provider_call_id);
    } catch {
      /* the call may already be over; the call.ended event settles state */
    }
    await query(`update voice_sessions set hangup_requested_at = now() where id=$1`, [r.id]);
    out.push(r.id);
  }
  return out;
}

const speaker = (party?: string) => (party === "local" ? "Shop assistant" : party === "remote" ? "Owner" : party ?? "?");

export interface CallEndedFacts {
  duplicate: boolean;
  session: { id: string; case_id: string; plan_id: string | null; plan_hash: string | null; intent_version: number; question: string } | null;
  outcome: string | null;
  hangup_reason: string | null;
  answered_by_person: boolean;
  remote_matches_owner: boolean;
  authority_mode: string | null;
  transcript: string;
  action_items: string[];
  stale: boolean;
}

/**
 * Settle one call.ended event exactly once (V03). Returns structured facts for the agent; the
 * transcript and action items are proposed intent only and never authorize anything (U-I16).
 */
export async function settleCallEnded(payload: Record<string, any>): Promise<CallEndedFacts> {
  const call = payload?.data?.call ?? {};
  const providerId = String(call.id ?? "");
  const outcome = (payload?.data?.outcome ?? null) as string | null;
  const hangup = (call.hangup_reason ?? null) as string | null;
  const items = ((payload?.data?.post_call_action_items ?? []) as Array<{ action?: string; details?: string }>).map((i) => truncate(`${i.action ?? ""}${i.details ? ` — ${i.details}` : ""}`, 300));
  // Inline transcript may be abridged (middle cut); only a complete one is used without a lookup (U10).
  const t = payload?.data?.transcript as { entries?: Array<{ party?: string; text?: string; marker?: string }>; abridged?: boolean } | null;
  const inlineComplete = !!t && Array.isArray(t.entries) && !t.abridged;
  let transcript = inlineComplete ? t!.entries!.filter((e) => !e.marker).map((e) => `${speaker(e.party)}: ${e.text ?? ""}`).join("\n") : "";
  const result = await withTx(async (tx) => {
    const s = (await tx.query(`select * from voice_sessions where provider_call_id=$1 for update`, [providerId])).rows[0];
    if (!s) return { duplicate: false, session: null };
    if (s.processed_at) return { duplicate: true, session: s };
    await tx.query(`update voice_sessions set status='ended', outcome=$2, hangup_reason=$3, ended_at=now(), processed_at=now() where id=$1`, [s.id, outcome, hangup]);
    return { duplicate: false, session: s };
  });
  if (!result.session) return { duplicate: false, session: null, outcome, hangup_reason: hangup, answered_by_person: false, remote_matches_owner: false, authority_mode: null, transcript: "", action_items: [], stale: false };
  const s = result.session;
  if (!inlineComplete && !result.duplicate && outcome === "completed") {
    try {
      const segs = await (await identity()).listTranscripts(providerId);
      transcript = [...segs].sort((a, b) => a.seq - b.seq).map((x) => `${speaker(x.party)}: ${x.text ?? ""}`).join("\n");
    } catch {
      transcript = ""; // authoritative transcript unavailable -> treated as unclear, never as a decision
    }
  }
  const owner = (await query(`select p.phone_e164 from cases c join principals p on p.id=c.principal_id where c.id=$1`, [s.case_id])).rows[0];
  const remote = String(call.remote_phone_number ?? "");
  const plan = s.plan_id ? (await query(`select plan_hash, status, expires_at from recovery_plans where id=$1`, [s.plan_id])).rows[0] : null;
  const caseNow = (await query(`select intent_version from cases where id=$1`, [s.case_id])).rows[0];
  const stale = !plan || plan.status !== "open" || plan.plan_hash !== s.plan_hash || new Date(plan.expires_at).getTime() < Date.now() || caseNow.intent_version !== s.intent_version;
  return {
    duplicate: result.duplicate,
    session: { id: s.id, case_id: s.case_id, plan_id: s.plan_id, plan_hash: s.plan_hash, intent_version: s.intent_version, question: s.question },
    outcome,
    hangup_reason: hangup,
    // A connected call is not a decision: the owner must actually have spoken on a non-voicemail call.
    answered_by_person: outcome === "completed" && hangup !== "voicemail" && /^Owner: \S/m.test(transcript),
    remote_matches_owner: !!remote && remote === owner?.phone_e164,
    authority_mode: (call.hosted_agent_authority_mode ?? s.authority_mode ?? null) as string | null,
    transcript: truncate(transcript, 4000),
    action_items: items,
    stale,
  };
}
