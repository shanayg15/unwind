/**
 * One complete UNWIND recording rehearsal on the deployed build (RECORDING_READY.md beats B-E), with the
 * user's approval for owner texts (their Mac Messages -> their shop thread) and the rehearsal customer email
 * (their OpenSwarm Gmail via Composio). Everything else is the real system: agent launch, checkouts through
 * the deployed API, signed Inkbox events, the worker's fresh agent turns, YES-code approvals, MCP tool calls.
 *   pnpm exec tsx --env-file=.env scripts/unwind-rehearsal.ts <n>
 * Writes reports/runs/unwind-<n>.json with the beat-by-beat counts read back from the database.
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { closePool, query } from "../src/db/pool.js";

const n = process.argv[2];
if (!/^\d$/.test(n ?? "")) throw new Error("usage: unwind-rehearsal.ts <n>");
const SHOP_THREAD = "any;-;+19378962724"; // the owner's real shop thread on this Mac
const SHOP_MAILBOX = "yc-hack-shanay@inkboxmail.com";
const STOP = "Stop the free-pouch experiment. Restore the campaign pages, honor every accepted order, and release only unused promotional stock.";
const CUSTOMER_Q = "The free-pouch offer disappeared. Is mine still included in my order?";
const env = { ...process.env, NODE_NO_WARNINGS: "1", UNDO_ALLOW_RESET: "1" } as NodeJS.ProcessEnv;
delete env.CLAUDE_CODE_OAUTH_TOKEN;
const beats: Array<{ beat: string; at: string; detail: Record<string, unknown> }> = [];
const t0 = Date.now();
const log = (beat: string, detail: Record<string, unknown> = {}) => {
  beats.push({ beat, at: new Date().toISOString(), detail });
  console.log(`[unwind ${n}] +${Math.round((Date.now() - t0) / 1000)}s ${beat} ${JSON.stringify(detail)}`);
};
const sh = (cmd: string) => execSync(cmd, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter((l) => l.trim() && !/sslmode|libpq|SECURITY WARNING/i.test(l));

function text(body: string) {
  execFileSync("osascript", ["-e", "on run argv", "-e", 'tell application "Messages"', "-e", "send (item 2 of argv) to chat id (item 1 of argv)", "-e", "end tell", "-e", "end run", SHOP_THREAD, body], { stdio: "ignore" });
}
async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined>, timeoutS = 240): Promise<T> {
  const until = Date.now() + timeoutS * 1000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2500));
  }
}
const stock = async () => (await query(`select held, committed, on_hand, on_hand-held-committed as available from inventory where store_id='store_demo' and product_id='prd_demo_pouch'`)).rows[0] as { held: number; committed: number; on_hand: number; available: number };
const promoState = async () => (await query(`select state from promotions where store_id='store_demo' order by created_at desc limit 1`)).rows[0]?.state as string | undefined;

try {
  // A. Campaign and commitments (pre-launch -> 10 set aside -> 4 accepted)
  sh("pnpm -s demo:reset");
  log("reset", await stock());
  const launched = sh("pnpm -s demo:launch -- --scenario pouch").slice(-1)[0];
  log("agent launched the offer (owner-approved, owner credential test actor)", { line: launched, stock: await stock() });
  sh("pnpm -s demo:activity -- --scenario pouch");
  const s4 = await stock();
  log("four accepted gift orders via deployed checkout", s4);
  if (!(s4.held === 6 && s4.committed === 4 && s4.available === 0 && s4.on_hand === 10)) throw new Error(`unexpected 4-order stock ${JSON.stringify(s4)}`);
  const startedAt = new Date().toISOString();

  // B. Owner's stop text -> preview 4/6 + approval request
  text(STOP);
  log("owner stop text sent (owner's Messages -> shop thread)");
  const caseId = await waitFor("owner case", async () => (await query(`select id from cases where store_id='store_demo' and role='owner' and created_at > $1 order by created_at desc limit 1`, [startedAt])).rows[0]?.id as string | undefined, 90);
  const req1 = await waitFor("first approval request", async () => (await query(`select body from outbox_messages where case_id=$1 and purpose='request_approval' and status in ('accepted','delivered') order by created_at limit 1`, [caseId])).rows[0] as { body: string } | undefined);
  const plan1 = (await query(`select id, items from recovery_plans where case_id=$1 order by created_at desc limit 1`, [caseId])).rows[0];
  const r1 = (plan1.items as any[]).find((i) => i.retirement)?.retirement;
  log("preview + approval request delivered", { plan: plan1.id, committed: r1?.committed_to_accepted_orders, releasable: r1?.releasable_on_apply });
  if (!(r1?.committed_to_accepted_orders === 4 && r1?.releasable_on_apply === 6)) throw new Error("first plan is not 4/6");

  // C. Fifth order at the review gate; the owner approves the old plan; apply must refuse it
  sh("pnpm -s demo:activity -- --scenario pouch-one");
  const s5 = await stock();
  log("fifth accepted order via deployed checkout", s5);
  if (!(s5.held === 5 && s5.committed === 5)) throw new Error(`unexpected 5-order stock ${JSON.stringify(s5)}`);
  const code1 = /Reply YES (\d{4})/.exec(req1.body)?.[1];
  text(`YES ${code1}`);
  log("owner YES (old plan code) sent");
  const req2 = await waitFor(
    "refreshed approval request after the stale plan",
    async () => (await query(`select body from outbox_messages where case_id=$1 and purpose='request_approval' and status in ('accepted','delivered') order by created_at offset 1 limit 1`, [caseId])).rows[0] as { body: string } | undefined,
    300,
  );
  const superseded = (await query(`select id from recovery_plans where case_id=$1 and status='superseded'`, [caseId])).rows.map((r) => r.id);
  const plan2 = (await query(`select id, items from recovery_plans where case_id=$1 and status='open' order by created_at desc limit 1`, [caseId])).rows[0];
  const r2 = (plan2?.items as any[] | undefined)?.find((i) => i.retirement)?.retirement;
  const sStale = await stock();
  log("stale plan refused, refreshed plan requested", { superseded, fresh_plan: plan2?.id, committed: r2?.committed_to_accepted_orders, releasable: r2?.releasable_on_apply, stock_after_stale: sStale });
  if (!superseded.includes(plan1.id) || sStale.held !== 5 || sStale.available !== 0) throw new Error("stale plan was not refused cleanly");
  if (!(r2?.committed_to_accepted_orders === 5 && r2?.releasable_on_apply === 5)) throw new Error("refreshed plan is not 5/5");

  // D. Renewed approval -> apply -> verify
  const code2 = /Reply YES (\d{4})/.exec(req2.body)?.[1];
  text(`YES ${code2}`);
  log("owner YES (refreshed plan code) sent");
  await waitFor("completion summary", async () => (await query(`select 1 from outbox_messages where case_id=$1 and purpose='completion_summary' and status in ('accepted','delivered')`, [caseId])).rows[0], 300);
  const sDone = await stock();
  const attempt = (await query(`select id, status, plan_id from recovery_attempts where store_id='store_demo' order by created_at desc limit 1`)).rows[0];
  log("applied and verified; completion text delivered", { stock: sDone, offer: await promoState(), recovery: attempt?.status, applied_plan: attempt?.plan_id });
  if (!(sDone.held === 0 && sDone.committed === 5 && sDone.available === 5 && sDone.on_hand === 10 && (await promoState()) === "retired")) throw new Error("final state is not 0/5/5/10 retired");

  // E. Customer email -> grounded reply
  const sentAt = new Date().toISOString();
  execFileSync("composio", ["execute", "GMAIL_SEND_EMAIL", "--account", "gmail_wading-tuth", "-d", JSON.stringify({ recipient_email: SHOP_MAILBOX, subject: `My pouch (UNWIND rehearsal ${n})`, body: CUSTOMER_Q })], { stdio: "ignore" });
  log("customer email sent (OpenSwarm Gmail via Composio)");
  const reply = await waitFor(
    "customer reply",
    async () => (await query(`select m.status, m.body from outbox_messages m join cases c on c.id=m.case_id where c.store_id='store_demo' and c.role='customer' and m.purpose='order_answer' and m.created_at > $1 and m.status in ('accepted','delivered') limit 1`, [sentAt])).rows[0] as { status: string; body: string } | undefined,
    300,
  );
  log("customer reply sent from the shop mailbox", { status: reply.status, mentions_pouch: /pouch/i.test(reply.body), claims_shipped: /\bshipped\b|delivered to you/i.test(reply.body) });

  sh(`pnpm -s exec tsx --env-file=.env scripts/evidence.ts unwind-${n}`);
  const ev = JSON.parse(readFileSync(`reports/runs/unwind-${n}.json`, "utf8"));
  ev.unwind = { n: Number(n), build: execSync("git rev-parse --short HEAD").toString().trim(), deployed: JSON.parse(readFileSync("reports/deploy.json", "utf8")).commit?.slice(0, 7), duration_s: Math.round((Date.now() - t0) / 1000), beats };
  writeFileSync(`reports/runs/unwind-${n}.json`, JSON.stringify(ev, null, 2));
  log("evidence saved", { verify: ev.verify?.verdict, file: `reports/runs/unwind-${n}.json` });
} catch (e) {
  log("FAILED", { error: (e as Error).message });
  writeFileSync(`reports/runs/.unwind-${n}-failed.json`, JSON.stringify({ beats }, null, 2));
  process.exitCode = 1;
} finally {
  await closePool();
}
