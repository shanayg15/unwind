/**
 * One complete demo rehearsal on the release build (DEMO_RUNBOOK section 4), identical every time.
 *   pnpm exec tsx --env-file=.env scripts/rehearsal.ts prep <n>     reset -> before-check -> real-agent launch -> activity -> before-check
 *   pnpm exec tsx --env-file=.env scripts/rehearsal.ts finish <n>   after-check -> evidence reports/runs/rehearsal-<n>.json -> consistency
 * Between prep and finish: the owner texts, decides the conflict and approves by code; the customer emails.
 * Reset never deletes provider history; each run gets new case ids (open cases are closed by the reset).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [phase, n] = [process.argv[2], process.argv[3]];
if (!["prep", "finish"].includes(phase) || !/^\d$/.test(n ?? "")) throw new Error("usage: rehearsal.ts prep|finish <n>");
const env = { ...process.env, NODE_NO_WARNINGS: "1", UNDO_ALLOW_RESET: "1" } as NodeJS.ProcessEnv;
delete env.CLAUDE_CODE_OAUTH_TOKEN; // local Claude login, never the capped shell token
const noise = /sslmode|libpq|SECURITY WARNING|trace-warnings/i;
const run = (label: string, cmd: string) => {
  const t = Date.now();
  const out = execSync(cmd, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const lines = out.split("\n").filter((l) => l.trim() && !noise.test(l));
  console.log(`[rehearsal ${n}] ${label} (${Math.round((Date.now() - t) / 1000)}s): ${lines.slice(-3).join(" | ")}`);
  return lines;
};

if (phase === "prep") {
  run("reset", "pnpm -s demo:reset");
  run("before-check (fixture)", "pnpm -s demo:verify -- --before");
  run("launch (real agent, owner credential test actor)", "pnpm -s demo:launch");
  run("activity (checkout + operator edits)", "pnpm -s demo:activity");
  run("before-check (post-activity)", "pnpm -s demo:verify -- --before");
  const head = execSync("git rev-parse --short HEAD").toString().trim();
  writeFileSync(`reports/runs/.rehearsal-${n}-prep.json`, JSON.stringify({ n, head, prepared_at: new Date().toISOString() }));
  console.log(`[rehearsal ${n}] ready on ${head}. Owner: text the withdrawal; reply keep $139 to the conflict question; reply YES <code>. Then the customer emails about the jacket order.`);
} else {
  const after = run("after-check", "pnpm -s demo:verify -- --after");
  run("evidence", `pnpm -s exec tsx --env-file=.env scripts/evidence.ts rehearsal-${n}`);
  const ev = JSON.parse(readFileSync(`reports/runs/rehearsal-${n}.json`, "utf8"));
  const prep = existsSync(`reports/runs/.rehearsal-${n}-prep.json`) ? JSON.parse(readFileSync(`reports/runs/.rehearsal-${n}-prep.json`, "utf8")) : null;
  ev.rehearsal = {
    n: Number(n),
    build: prep?.head ?? null,
    deployed_commit: JSON.parse(readFileSync("reports/deploy.json", "utf8")).commit ?? null,
    after_check: after.filter((l) => /^(PASS|FAIL)|passed/.test(l)),
    consistent_outcome: {
      recovery_status: ev.recovery?.status,
      verify: ev.verify?.verdict,
      owner_messages: ev.cases.filter((c: { role: string }) => c.role === "owner").flatMap((c: { messages: Array<{ purpose: string; status: string }> }) => c.messages.map((m) => `${m.purpose}=${m.status}`)),
      customer_messages: ev.cases.filter((c: { role: string }) => c.role === "customer").flatMap((c: { messages: Array<{ purpose: string; status: string }> }) => c.messages.map((m) => `${m.purpose}=${m.status}`)),
    },
  };
  writeFileSync(`reports/runs/rehearsal-${n}.json`, JSON.stringify(ev, null, 2));
  console.log(`[rehearsal ${n}] ${JSON.stringify(ev.rehearsal.consistent_outcome)}`);
}
