/**
 * Redacted provider/config checks. Nonzero exit when a mandatory dependency is missing.
 * No secrets are printed. Optional: --model runs one tiny headless Claude call.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Inkbox } from "@inkbox/sdk";
import { closePool, query } from "../src/db/pool.js";

const rows: Array<{ item: string; status: "READY" | "BLOCKED" | "WARN"; evidence: string; mandatory: boolean }> = [];
const add = (item: string, ok: boolean | "warn", evidence: string, mandatory = true) => rows.push({ item, status: ok === "warn" ? "WARN" : ok ? "READY" : "BLOCKED", evidence, mandatory });
const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");

const need = ["DATABASE_URL", "DATABASE_URL_TEST", "APP_BASE_URL", "MCP_PUBLIC_URL", "INKBOX_API_KEY", "INKBOX_IDENTITY", "INKBOX_WEBHOOK_SECRET", "INKBOX_WEBHOOK_AUTH_TOKEN", "OWNER_PHONE_E164", "CUSTOMER_TEST_EMAIL", "MAX_LIVE_MESSAGES"];
const missing = need.filter((k) => !process.env[k]);
add("local private config (.env)", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `${need.length} keys present (values not shown)`);
add(".private/tokens.json", existsSync(".private/tokens.json"), existsSync(".private/tokens.json") ? `${Object.keys(JSON.parse(readFileSync(".private/tokens.json", "utf8"))).length} demo credentials` : "run pnpm demo:reset -- --all");

try {
  const m = (await query(`select array_agg(version order by version) v from schema_migrations`)).rows[0].v;
  const stores = (await query(`select id from stores order by id`)).rows.map((r) => r.id);
  add("Postgres (Neon main) + migrations", m?.length >= 2, `migrations ${m?.join(",")}; stores ${stores.join(",")}`);
} catch (e) {
  add("Postgres (Neon main) + migrations", false, (e as Error).message.slice(0, 120));
}

try {
  const h = await fetch(`${BASE}/healthz`).then((r) => r.json());
  add("deployed server health", h.ok === true, `${BASE}/healthz ok`);
  const unauth = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  add("deployed MCP requires auth", unauth.status === 401, `HTTP ${unauth.status} without token`);
} catch (e) {
  add("deployed server health", false, (e as Error).message);
}

try {
  const who = execFileSync("npx", ["-y", "mcp-use@latest", "whoami"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop() ?? "";
  add("Manufact CLI login", /—/.test(who), who.replace(/\S+@\S+/, "<account>"));
} catch {
  add("Manufact CLI login", false, "mcp-use whoami failed");
}

try {
  const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
  const id = await inkbox.getIdentity(process.env.INKBOX_IDENTITY ?? "yc-hack-shanay");
  const subs = (await (inkbox.webhooks.subscriptions as unknown as { list(o: object): Promise<Array<{ url: string }>> }).list({})) as Array<{ url: string; status?: string }>;
  const mine = subs.filter((s) => s.url === `${BASE}/webhooks/inkbox` && (s.status ?? "active") === "active").length;
  add("Inkbox identity + mailbox", !!id.emailAddress, `@${process.env.INKBOX_IDENTITY} mailbox ${String(id.emailAddress).replace(/^(.{3}).*@/, "$1…@")}; imessage ${id.imessageEnabled}`);
  add("Inkbox webhook subscription to UNDO receiver", mine === 1, `${mine} subscription(s) to /webhooks/inkbox`);
} catch (e) {
  add("Inkbox identity + mailbox", false, (e as Error).message.slice(0, 120));
}

const lim = await query(`select used, cap from usage_counters where name='live_messages'`).catch(() => ({ rows: [] as Array<{ used: number; cap: number }> }));
add("live message budget", true, lim.rows[0] ? `${lim.rows[0].used}/${lim.rows[0].cap} used` : `0/${process.env.MAX_LIVE_MESSAGES} used`, false);
add("owner voice", "warn", `OWNER_VOICE_ENABLED=${process.env.OWNER_VOICE_ENABLED ?? "false"} (NOT_ENABLED)`, false);
add("Armature API key", process.env.ARMATURE_API_KEY ? true : "warn", process.env.ARMATURE_API_KEY ? "present (not shown)" : "not set; see evals/ARMATURE_SETUP.md", false);

if (process.argv.includes("--model")) {
  try {
    const env = { ...process.env };
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    const dir = readdirSync("node_modules/.pnpm").find((d) => d.startsWith("@anthropic-ai+claude-agent-sdk-darwin-arm64@"));
    const bin = `node_modules/.pnpm/${dir}/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`;
    const out = execFileSync(bin, ["-p", "Reply with exactly: OK", "--max-turns", "1", "--output-format", "json"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] });
    const j = JSON.parse(out);
    add("runtime model (local Claude login)", !j.is_error && /OK/.test(j.result), `${Object.keys(j.modelUsage ?? {}).join(",")} result=${String(j.result).slice(0, 20)}`);
  } catch (e) {
    add("runtime model (local Claude login)", false, (e as Error).message.slice(0, 120));
  }
}

for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.item}: ${r.evidence}`);
const blocked = rows.filter((r) => r.mandatory && r.status === "BLOCKED");
console.log(blocked.length ? `\n${blocked.length} mandatory item(s) blocked` : "\nall mandatory items ready");
if (blocked.length) process.exitCode = 1;
await closePool();
