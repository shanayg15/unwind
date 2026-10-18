/**
 * Drive one on-camera UNWIND take on the user's own screen (they start/stop the screen recording).
 * Runs the demo commands visibly in their Terminal window, sends the owner texts from their Messages
 * into the shop thread, sends the customer email from their OpenSwarm Gmail (Composio), and switches
 * the demo Chrome tabs at each beat. Waits are real; every count comes from the database.
 *   pnpm exec tsx --env-file=.env scripts/record-take.ts
 */
import { execFileSync } from "node:child_process";
import { closePool, query } from "../src/db/pool.js";

const SHOP_THREAD = "any;-;+19378962724";
const SHOP_MAILBOX = "yc-hack-shanay@inkboxmail.com";
const STOP = "Stop the free-pouch experiment. Restore the campaign pages, honor every accepted order, and release only unused promotional stock.";
const t0 = Date.now();
const log = (s: string) => console.log(`[take] +${Math.round((Date.now() - t0) / 1000)}s ${s}`);
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const osa = (script: string, ...args: string[]) => execFileSync("osascript", ["-e", script, ...args], { encoding: "utf8" }).trim();

function tab(prefix: string) {
  osa(`on run argv
tell application "Google Chrome"
  repeat with w in windows
    repeat with i from 1 to (count of tabs of w)
      if title of tab i of w starts with (item 1 of argv) then
        set active tab index of w to i
        set index of w to 1
        return "ok"
      end if
    end repeat
  end repeat
end tell
end run`, prefix);
}
function terminal(cmd: string) {
  osa(`on run argv
tell application "Terminal" to do script (item 1 of argv) in window 1
end run`, cmd);
}
function text(body: string) {
  osa(`on run argv
tell application "Messages" to send (item 2 of argv) to chat id (item 1 of argv)
end run`, SHOP_THREAD, body);
}
async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined>, timeoutS = 300): Promise<T> {
  const until = Date.now() + timeoutS * 1000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}
const stock = async () => (await query(`select held, committed, on_hand - held - committed as available from inventory where product_id='prd_demo_pouch'`)).rows[0];

try {
  const pre = await stock();
  const promos = (await query(`select count(*)::int n from promotions where store_id='store_demo'`)).rows[0].n;
  if (promos !== 0 || pre.held !== 0) throw new Error("store is not at the clean pre-launch fixture; run pnpm demo:reset first");
  const startedAt = new Date().toISOString();
  tab("UNWIND");
  log("board: pre-launch");
  await sleep(4);

  // A1: the agent launches the offer
  terminal("cd ~/yc_hack_1017 && env -u CLAUDE_CODE_OAUTH_TOKEN pnpm demo:launch -- --scenario pouch");
  log("launch command running");
  await waitFor("offer active", async () => ((await stock()).held === 10 ? true : null), 180);
  log("10 set aside");
  await sleep(4);
  tab("Trailhead Outfitters (demo)");
  await sleep(5);
  tab("UNWIND");
  await sleep(2);

  // A2: four accepted test orders
  terminal("pnpm demo:activity -- --scenario pouch");
  await waitFor("4 committed", async () => ((await stock()).committed === 4 ? true : null), 60);
  log("6 held / 4 committed");
  await sleep(4);
  tab("Trailhead Outfitters (demo) pick list");
  await sleep(5);
  tab("UNWIND");
  await sleep(2);

  // B: owner's stop text -> preview 4/6
  text(STOP);
  log("owner stop text sent");
  const caseId = await waitFor("owner case", async () => (await query(`select id from cases where store_id='store_demo' and role='owner' and created_at > $1 order by created_at desc limit 1`, [startedAt])).rows[0]?.id as string | undefined, 90);
  const req1 = await waitFor("plan text", async () => (await query(`select body from outbox_messages where case_id=$1 and purpose='request_approval' and status in ('accepted','delivered') order by created_at limit 1`, [caseId])).rows[0] as { body: string } | undefined);
  log("plan 4/6 texted to owner");
  await sleep(6);

  // C: fifth order at the review gate, then YES to the old plan
  terminal("pnpm demo:activity -- --scenario pouch-one");
  await waitFor("5 committed", async () => ((await stock()).committed === 5 ? true : null), 60);
  log("fifth order: 5 held / 5 committed");
  await sleep(5);
  text(`YES ${/Reply YES (\d{4})/.exec(req1.body)![1]}`);
  log("owner YES (old plan)");
  const req2 = await waitFor(
    "refreshed plan text",
    async () => (await query(`select body from outbox_messages where case_id=$1 and purpose='request_approval' and status in ('accepted','delivered') order by created_at offset 1 limit 1`, [caseId])).rows[0] as { body: string } | undefined,
  );
  log("stale plan refused; refreshed 5/5 texted");
  await sleep(7);

  // D: YES to the refreshed plan -> apply + verify
  text(`YES ${/Reply YES (\d{4})/.exec(req2.body)![1]}`);
  log("owner YES (refreshed plan)");
  await waitFor("completion text", async () => (await query(`select 1 from outbox_messages where case_id=$1 and purpose='completion_summary' and status in ('accepted','delivered')`, [caseId])).rows[0]);
  log("applied and verified: 0 held / 5 committed / 5 available");
  await sleep(6);
  tab("Trailhead Outfitters (demo)");
  await sleep(6);
  tab("Trailhead Outfitters (demo) pick list");
  await sleep(5);
  tab("UNWIND");
  await sleep(3);

  // E: customer email -> grounded reply
  const sentAt = new Date().toISOString();
  execFileSync("composio", ["execute", "GMAIL_SEND_EMAIL", "--account", "gmail_wading-tuth", "-d", JSON.stringify({ recipient_email: SHOP_MAILBOX, subject: "My pouch", body: "The free-pouch offer disappeared. Is mine still included in my order?" })], { stdio: "ignore" });
  log("customer email sent");
  await waitFor("customer reply", async () => (await query(`select 1 from outbox_messages m join cases c on c.id=m.case_id where c.store_id='store_demo' and c.role='customer' and m.purpose='order_answer' and m.created_at > $1 and m.status in ('accepted','delivered')`, [sentAt])).rows[0]);
  log("customer reply sent; take complete");
  await sleep(10);
  log("done");
} catch (e) {
  log(`STOPPED: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
