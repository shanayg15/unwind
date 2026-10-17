import { Inkbox } from "@inkbox/sdk";
import { createApprovalRequest } from "../approvals/approvals.js";
import { addCaseEvent, type CaseRow } from "../cases/cases.js";
import { query, withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { newId, redactContact, sha256, truncate } from "../lib/util.js";

export type Purpose = "reply" | "conflict_question" | "request_approval" | "completion_summary" | "order_answer" | "clarification";

const OWNER_PURPOSES: Purpose[] = ["reply", "conflict_question", "request_approval", "completion_summary", "clarification"];
const CUSTOMER_PURPOSES: Purpose[] = ["reply", "order_answer", "clarification"];

/** Count a live message against the approved cap (MAX_LIVE_MESSAGES). */
async function consumeBudget(): Promise<void> {
  const cap = Number(process.env.MAX_LIVE_MESSAGES ?? 0);
  await query(`insert into usage_counters(name, used, cap) values ('live_messages', 0, $1) on conflict (name) do update set cap = $1`, [cap]);
  const { rowCount } = await query(`update usage_counters set used = used + 1 where name='live_messages' and used < cap`);
  if (!rowCount) throw new UndoError("limit_exceeded", `Live message budget exhausted (cap ${cap})`);
}

/**
 * Queue a message for this case's own principal only (owner -> iMessage, customer -> email).
 * Recipient is derived from the case, never from model input. request_approval attaches a
 * single-use, plan-hash-bound link that the agent never sees.
 */
export async function enqueueCaseMessage(
  c: CaseRow,
  opts: { purpose: Purpose; body: string; planId?: string; triggerEventId: string; inReplyTo?: string | null; subject?: string | null },
): Promise<{ outbox_id: string; status: string; duplicate: boolean; approval_link_attached: boolean }> {
  const allowed = c.role === "owner" ? OWNER_PURPOSES : CUSTOMER_PURPOSES;
  if (!allowed.includes(opts.purpose)) throw new UndoError("forbidden", `Purpose ${opts.purpose} is not allowed in a ${c.role} case`);
  const body = truncate(opts.body.trim(), 1500);
  if (!body) throw new UndoError("invalid_input", "Message body is empty");
  let link = "";
  let planRef = "";
  if (opts.purpose === "request_approval") {
    if (c.role !== "owner") throw new UndoError("forbidden", "Only owner cases can request approval");
    if (!opts.planId) throw new UndoError("invalid_input", "request_approval needs plan_id");
    const plan = (await query(`select id, store_id, status from recovery_plans where id=$1`, [opts.planId])).rows[0];
    if (!plan || plan.store_id !== c.store_id) throw new UndoError("forbidden", "Plan is not in this case's store");
    planRef = plan.id;
  }
  const dedupeKey = `${c.id}:${opts.triggerEventId}:${opts.purpose}:${planRef}`;
  const existing = (await query(`select id, status from outbox_messages where dedupe_key=$1`, [dedupeKey])).rows[0];
  if (existing) return { outbox_id: existing.id, status: existing.status, duplicate: true, approval_link_attached: opts.purpose === "request_approval" };
  if (process.env.LIVE_SEND_ENABLED !== "true") throw new UndoError("forbidden", "Live sending is disabled (LIVE_SEND_ENABLED != true)");
  await consumeBudget();
  if (opts.purpose === "request_approval") {
    const req = await withTx((tx) => createApprovalRequest(tx, c.store_id, "recovery", planRef, c.id, 30));
    const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
    link = `\n\nReview and approve this exact plan (single use, expires in 30 min): ${base}/approve/${req.token}`;
  }
  const id = newId("msg");
  const channel = c.role === "owner" ? "imessage" : "email";
  const text = `${body}${link}${c.role === "customer" ? "\n\n(Test environment: this is a demo store; no payment was processed.)" : ""}`;
  await query(
    `insert into outbox_messages(id, case_id, store_id, dedupe_key, channel, recipient_principal_id, purpose, body, in_reply_to, subject)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, c.id, c.store_id, dedupeKey, channel, c.principal_id, opts.purpose, text, opts.inReplyTo ?? null, opts.subject ?? null],
  );
  // The transcript stores the agent-visible text only (link token stays in the outbox row).
  await addCaseEvent(c.id, "outbound", { text: body + (link ? " [approval link attached]" : ""), purpose: opts.purpose, outbox_id: id });
  return { outbox_id: id, status: "pending", duplicate: false, approval_link_attached: !!link };
}

let inkbox: Inkbox | undefined;
async function identity() {
  if (!inkbox) inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
  return inkbox.getIdentity(process.env.INKBOX_IDENTITY ?? "yc-hack-shanay");
}

/**
 * Deliver pending outbox rows through the ONE shop identity. Provider idempotency keys are the
 * outbox ids. A network failure after submit becomes outcome_unknown (never blindly resent).
 */
export async function deliverPending(limit = 5): Promise<Array<{ id: string; status: string }>> {
  const out: Array<{ id: string; status: string }> = [];
  for (let i = 0; i < limit; i++) {
    const row = (
      await query(
        `update outbox_messages set status='sending', attempts = attempts + 1
          where id = (select id from outbox_messages where status='pending' order by created_at for update skip locked limit 1)
          returning *`,
      )
    ).rows[0];
    if (!row) break;
    const principal = (await query(`select phone_e164, email from principals where id=$1`, [row.recipient_principal_id])).rows[0];
    try {
      const ident = await identity();
      let providerId: string | undefined;
      if (row.channel === "imessage") {
        if (!principal?.phone_e164) throw new UndoError("invalid_input", "Recipient has no phone");
        const m = await ident.sendIMessage({ to: principal.phone_e164, text: row.body, idempotencyKey: row.id });
        providerId = (m as { id?: string }).id;
      } else {
        if (!principal?.email) throw new UndoError("invalid_input", "Recipient has no email");
        const m = await ident.sendEmail({
          to: [principal.email],
          subject: row.subject ?? "Your order at Trailhead Outfitters (demo)",
          bodyText: row.body,
          inReplyToMessageId: row.in_reply_to ?? undefined,
          idempotencyKey: row.id,
        });
        providerId = (m as { id?: string }).id;
      }
      await query(`update outbox_messages set status='accepted', provider_message_id=$2, sent_at=now(), error=null where id=$1`, [row.id, providerId ?? null]);
      out.push({ id: row.id, status: "accepted" });
    } catch (e) {
      const status = (e as { status?: number }).status;
      const definite = typeof status === "number" && status >= 400 && status < 500;
      const next = isUndoErrorLike(e) || definite ? "failed" : "outcome_unknown";
      await query(`update outbox_messages set status=$2, error=$3 where id=$1`, [row.id, next, truncate(String((e as Error).message ?? e), 300)]);
      out.push({ id: row.id, status: next });
    }
  }
  return out;
}

function isUndoErrorLike(e: unknown): boolean {
  return e instanceof UndoError;
}

/** Redacted delivery evidence for public reports. */
export async function outboxEvidence(caseId: string) {
  const { rows } = await query(
    `select m.id, m.channel, m.purpose, m.status, m.provider_message_id, m.created_at, m.sent_at, p.phone_e164, p.email
       from outbox_messages m join principals p on p.id = m.recipient_principal_id where m.case_id=$1 order by m.created_at`,
    [caseId],
  );
  return rows.map((r) => ({
    outbox_id: r.id,
    channel: r.channel,
    purpose: r.purpose,
    status: r.status,
    provider_message_ref: r.provider_message_id ? `${String(r.provider_message_id).slice(0, 8)}…${sha256(String(r.provider_message_id)).slice(0, 6)}` : null,
    recipient: redactContact(r.phone_e164 ?? r.email),
    created_at: new Date(r.created_at).toISOString(),
    sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
  }));
}
