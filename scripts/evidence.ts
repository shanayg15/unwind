/**
 * Capture redacted evidence for the current demo run into reports/runs/<label>.json:
 * rollout, recovery receipt + live verify readback, case timelines (tool calls, not chat text
 * beyond agent messages), message transport states with redacted provider refs, inbox events.
 *   pnpm exec tsx --env-file=.env scripts/evidence.ts <label>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { verifyToken } from "../src/auth/principals.js";
import { outboxEvidence } from "../src/comms/outbox.js";
import { closePool, query } from "../src/db/pool.js";
import { redactContact } from "../src/lib/util.js";
import { undoVerify } from "../src/recovery/verify.js";

const label = process.argv[2] ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const STORE = process.env.PUBLIC_DEMO_STORE_ID ?? "store_demo";
const tokens: Record<string, string> = JSON.parse(readFileSync(".private/tokens.json", "utf8"));
try {
  const agent = await verifyToken(tokens[`${STORE}:pr_agent`]);
  const ro = (await query(`select id, goal, state, executed_at, created_by from rollouts where store_id=$1 and state='executed' order by created_at desc limit 1`, [STORE])).rows[0];
  const att = (await query(`select id, status, authorization_ref, created_at, plan_id from recovery_attempts where store_id=$1 order by created_at desc limit 1`, [STORE])).rows[0];
  const verify = att ? await undoVerify(agent, { recovery_id: att.id }) : null;
  const cases = (await query(`select id, role, state, intent_version, rollout_id, plan_id, created_at from cases where store_id=$1 and created_at > coalesce($2, now() - interval '1 day') order by created_at`, [STORE, ro?.executed_at ?? null])).rows;
  const timelines = [];
  for (const c of cases) {
    const ev = (await query(`select kind, data, at from case_events where case_id=$1 order by id`, [c.id])).rows;
    timelines.push({
      case_id: c.id,
      role: c.role,
      state: c.state,
      intent_version: c.intent_version,
      events: ev.map((e) => ({
        at: new Date(e.at).toISOString(),
        kind: e.kind,
        ...(e.kind === "agent_run"
          ? { model: e.data.model, stop: e.data.stop, num_turns: e.data.num_turns, duration_ms: e.data.duration_ms, tool_calls: e.data.tool_calls?.map((t: { name: string }) => t.name) }
          : e.kind === "outbound"
            ? { purpose: e.data.purpose, text: e.data.text }
            : e.kind === "inbound"
              ? { channel: e.data.channel, chars: String(e.data.text ?? "").length, note: "participant text kept private" }
              : { text: e.data.text }),
      })),
      messages: await outboxEvidence(c.id),
    });
  }
  const inbox = (await query(`select provider, event_type, status, received_at, handled_at, attempts from inbox_events where received_at > coalesce($1, now() - interval '1 day') order by received_at`, [ro?.executed_at ?? null])).rows;
  const owner = (await query(`select phone_e164 from principals where id='pr_owner'`)).rows[0];
  const out = {
    label,
    captured_at: new Date().toISOString(),
    store: STORE,
    deployment_mcp: process.env.MCP_PUBLIC_URL,
    owner_contact: redactContact(owner?.phone_e164),
    rollout: ro ? { id: ro.id, goal: ro.goal, executed_at: ro.executed_at, launched_by: ro.created_by } : null,
    recovery: att ? { id: att.id, status: att.status, authorization: String(att.authorization_ref).split(":")[0], at: att.created_at } : null,
    verify,
    cases: timelines,
    inbox_events: inbox.map((i) => ({ provider: i.provider, type: i.event_type, status: i.status, attempts: i.attempts, received_at: i.received_at, handled_at: i.handled_at })),
  };
  mkdirSync("reports/runs", { recursive: true });
  writeFileSync(`reports/runs/${label}.json`, JSON.stringify(out, null, 2));
  console.log(`saved reports/runs/${label}.json: recovery ${att?.status ?? "none"}, verify ${(verify as { verdict?: string } | null)?.verdict ?? "-"}, ${cases.length} case(s), ${inbox.length} inbox events`);
} finally {
  await closePool();
}
