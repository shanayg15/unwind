/**
 * Read-only provider smoke (pnpm test:providers): proves each external dependency answers right now,
 * without sending messages, placing calls, or writing store data. Report: reports/provider-smoke.json.
 *   Manufact: deployed health + MCP auth gate + authenticated tools/list (exactly seven tools)
 *   Neon: migrations applied, both stores present
 *   Inkbox: identity, mailbox, iMessage, subscriptions covering every queued event type, latest delivery states
 *   Claude: the local headless login answers (no API key needed; CLAUDE_CODE_OAUTH_TOKEN must be unset)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Inkbox } from "@inkbox/sdk";
import { closePool, query } from "../src/db/pool.js";

const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
const MCP = process.env.MCP_PUBLIC_URL ?? `${BASE}/mcp`;
const results: Array<{ provider: string; check: string; pass: boolean; detail: string }> = [];
const add = (provider: string, check: string, pass: boolean, detail: string) => {
  results.push({ provider, check, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${provider}: ${check}  (${detail})`);
};
const attempt = async (provider: string, check: string, fn: () => Promise<[boolean, string]>) => {
  try {
    const [ok, d] = await fn();
    add(provider, check, ok, d);
  } catch (e) {
    add(provider, check, false, (e as Error).message.slice(0, 160));
  }
};

await attempt("Manufact", "deployed health", async () => {
  const r = await fetch(`${BASE}/healthz`);
  const j = (await r.json()) as { ok: boolean; commit: string | null };
  return [r.ok && j.ok, `HTTP ${r.status}, commit ${j.commit ?? "n/a"}`];
});
await attempt("Manufact", "MCP refuses unauthenticated calls", async () => {
  const r = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  return [r.status === 401, `HTTP ${r.status}`];
});
await attempt("Manufact", "authenticated tools/list", async () => {
  const token = JSON.parse(readFileSync(".private/tokens.json", "utf8"))["store_demo:pr_agent"];
  const r = await fetch(MCP, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  const tools = (JSON.parse(line ? line.slice(6) : text).result?.tools ?? []) as Array<{ name: string }>;
  return [tools.length === 7, tools.map((t) => t.name).join(", ")];
});
await attempt("Neon", "migrations and stores", async () => {
  const m = (await query(`select count(*)::int n from schema_migrations`)).rows[0].n;
  const s = (await query(`select string_agg(id, ',' order by id) s from stores`)).rows[0].s;
  return [m >= 4 && /store_demo/.test(s) && /store_eval/.test(s), `${m} migrations; stores ${s}`];
});
await attempt("Inkbox", "identity, mailbox, iMessage, subscriptions", async () => {
  const ik = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
  const id = await ik.getIdentity(process.env.INKBOX_IDENTITY ?? "yc-hack-shanay");
  const subs = (await (ik.webhooks.subscriptions as unknown as { list(o: object): Promise<Array<{ url: string; status?: string; eventTypes?: string[] }>> }).list({})).filter((x) => x.url === `${BASE}/webhooks/inkbox`);
  const covered = new Set(subs.flatMap((x) => x.eventTypes ?? []));
  const need = ["imessage.received", "message.received", "call.ended"];
  return [!!id.emailAddress && id.imessageEnabled && need.every((t) => covered.has(t)), `mailbox present, imessage ${id.imessageEnabled}, events ${need.filter((t) => covered.has(t)).join("/")}`];
});
await attempt("Inkbox", "latest real deliveries", async () => {
  const r = (await query(`select channel, status from outbox_messages where provider_message_id is not null order by created_at desc limit 6`)).rows;
  const delivered = r.filter((x) => x.status === "delivered").length;
  return [delivered > 0, r.map((x) => `${x.channel}=${x.status}`).join(", ")];
});
await attempt("Claude", "local headless login answers", async () => {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const out = execFileSync("claude", ["-p", "Reply with exactly: OK", "--output-format", "json", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'], { env, encoding: "utf8", cwd: "/tmp", timeout: 120_000 });
  const j = JSON.parse(out) as { result: string; is_error: boolean };
  return [!j.is_error && /OK/.test(j.result), `result ${JSON.stringify(j.result.slice(0, 20))}`];
});

writeFileSync("reports/provider-smoke.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} provider checks passed`);
if (failed) process.exitCode = 1;
await closePool();
