/**
 * Drive one rehearsal's human turns with the user's approval (DECISIONS 2026-10-17 20:35): owner texts go
 * from the user's own Mac Messages app (their Apple ID) to the shop's Inkbox router; the customer email goes
 * from their approved OpenSwarm Gmail via Composio. Everything else is the real deployed system.
 *   pnpm exec tsx --env-file=.env scripts/rehearsal-drive.ts <n>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { closePool, query } from "../src/db/pool.js";

const n = process.argv[2];
const SHOP_IMESSAGE = "+19378962724"; // the shared line the shop texts the owner from (the owner's real shop thread)
const SHOP_MAILBOX = "yc-hack-shanay@inkboxmail.com";
const prep = JSON.parse(readFileSync(`reports/runs/.rehearsal-${n}-prep.json`, "utf8")) as { prepared_at: string };
const log = (s: string) => console.log(`[drive ${n}] ${new Date().toISOString().slice(11, 19)} ${s}`);

function imessage(text: string) {
  execFileSync(
    "osascript",
    [
      "-e", "on run argv",
      "-e", 'tell application "Messages"',
      "-e", "send (item 2 of argv) to chat id (item 1 of argv)",
      "-e", "end tell",
      "-e", "end run",
      `any;-;${SHOP_IMESSAGE}`, // the owner's existing conversation with the shop router
      text,
    ],
    { stdio: "ignore" },
  );
  log(`owner text sent: "${text.replace(/\d{4}$/, "####")}"`);
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined>, timeoutS = 240): Promise<T> {
  const until = Date.now() + timeoutS * 1000;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const ownerCase = () =>
  query(`select id from cases where store_id='store_demo' and role='owner' and created_at > $1 order by created_at desc limit 1`, [prep.prepared_at]).then((r) => r.rows[0]?.id as string | undefined);
const outbox = (caseId: string, purpose: string) =>
  query(`select body, status from outbox_messages where case_id=$1 and purpose=$2 and status in ('accepted','delivered') order by created_at desc limit 1`, [caseId, purpose]).then((r) => r.rows[0] as { body: string } | undefined);

try {
  imessage("Withdraw premium from the weekend campaign. Restore premium prices, promotional copy, and homepage placement. Keep clearance, navigation, current orders, and later independent edits.");
  const caseId = await waitFor("the owner case (is the text arriving from the owner number?)", ownerCase, 120);
  log(`case ${caseId}`);
  await waitFor("the conflict question", () => outbox(caseId, "conflict_question"));
  log("conflict question delivered");
  imessage("Keep $139. Restore the rest.");
  const req = await waitFor("the approval request", () => outbox(caseId, "request_approval"));
  const code = /Reply YES (\d{4})/.exec(req.body)?.[1];
  if (!code) throw new Error("approval request has no code");
  log("approval request delivered");
  imessage(`YES ${code}`);
  await waitFor("the completion summary", () => outbox(caseId, "completion_summary"), 300);
  log("completion summary delivered");
  const sentAt = new Date().toISOString();
  execFileSync(
    "composio",
    ["execute", "GMAIL_SEND_EMAIL", "--account", "gmail_wading-tuth", "-d", JSON.stringify({ recipient_email: SHOP_MAILBOX, subject: `My jacket order (rehearsal ${n})`, body: "Hi, I ordered the jacket for $108. The promotion is gone now. Is my order still confirmed at that amount?" })],
    { stdio: "ignore" },
  );
  log("customer email sent");
  await waitFor(
    "the customer reply",
    () => query(`select m.status from outbox_messages m join cases c on c.id=m.case_id where c.store_id='store_demo' and c.role='customer' and m.purpose='order_answer' and m.created_at > $1 and m.status in ('accepted','delivered')`, [sentAt]).then((r) => r.rows[0]),
    300,
  );
  log("customer reply sent");
} finally {
  await closePool();
}
