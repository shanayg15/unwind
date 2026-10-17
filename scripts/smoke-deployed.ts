/**
 * Deployed smoke: health, auth rejection, MCP initialize/tools/list, a real write + readback through the
 * deployed writers (eval store operator edit, then restored), and the MCP App view resources.
 * Writes reports/smoke-deployed.json; nonzero exit on failure.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { newId } from "../src/lib/util.js";

const BASE = (process.env.APP_BASE_URL ?? "https://bold-cloud-77gfl.run.mcp-use.com").replace(/\/$/, "");
const MCP = `${BASE}/mcp`;
const tokens: Record<string, string> = JSON.parse(readFileSync(".private/tokens.json", "utf8"));
const results: Array<{ check: string; pass: boolean; detail: string }> = [];
const check = (c: string, pass: boolean, detail = "") => {
  results.push({ check: c, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${c}${detail ? `  (${detail})` : ""}`);
};

async function rpc(token: string | null, method: string, params: unknown = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(MCP, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  let body: any = null;
  try {
    body = JSON.parse(line ? line.slice(6) : text);
  } catch {
    body = null;
  }
  return { status: r.status, body };
}

const t0 = Date.now();
const health = await fetch(`${BASE}/healthz`).then((r) => r.json()).catch(() => null);
check("health", health?.ok === true, JSON.stringify(health));
check("unauthenticated MCP rejected", (await rpc(null, "tools/list")).status === 401);
const agent = tokens["store_demo:pr_agent"];
const init = await rpc(agent, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
check("initialize", init.body?.result?.serverInfo?.name === "undo");
const list = await rpc(agent, "tools/list");
const tools = (list.body?.result?.tools ?? []) as Array<{ name: string; _meta?: Record<string, any> }>;
check("seven tools", tools.length === 7, tools.map((t) => t.name).join(","));
for (const name of ["undo_preview", "undo_verify"]) {
  const uri = tools.find((t) => t.name === name)?._meta?.ui?.resourceUri;
  const res = uri ? await rpc(agent, "resources/read", { uri }) : null;
  const html = res?.body?.result?.contents?.[0]?.text ?? "";
  check(`${name} App view resource served`, typeof uri === "string" && html.includes("<script"), `${uri} ${html.length} bytes`);
}
// Real write + readback on the evaluation store through the deployed operator writer.
const op = tokens["store_eval:pr_eval_operator"];
const caps = await rpc(op, "tools/call", { name: "undo_capabilities", arguments: {} });
const tote = (caps.body?.result?.structuredContent?.targets ?? []).find((t: { sku: string }) => t.sku === "COR-TOT");
const edit = async (amount: number, rev: number) => {
  const r = await fetch(`${BASE}/api/operator/edit`, {
    method: "POST",
    headers: { authorization: `Bearer ${op}`, "content-type": "application/json" },
    body: JSON.stringify({ sku: "COR-TOT", component: "price", amount_minor: amount, expected_revision: rev, idempotency_key: newId("smk") }),
  });
  return { status: r.status, body: await r.json() };
};
const w1 = await edit(tote.price.amount_minor + 100, tote.price.revision);
const caps2 = await rpc(op, "tools/call", { name: "undo_capabilities", arguments: {} });
const tote2 = (caps2.body?.result?.structuredContent?.targets ?? []).find((t: { sku: string }) => t.sku === "COR-TOT");
check("deployed write + readback", w1.status === 200 && tote2.price.amount_minor === tote.price.amount_minor + 100 && tote2.price.revision === tote.price.revision + 1, `rev ${tote.price.revision} -> ${tote2?.price?.revision}`);
const stale = await edit(tote.price.amount_minor, tote.price.revision);
check("stale expected_revision rejected", stale.status === 409, `HTTP ${stale.status}`);
const w2 = await edit(tote.price.amount_minor, tote2.price.revision);
check("restore smoke value", w2.status === 200);
const store = await fetch(`${BASE}/store`).then((r) => r.text());
check("public storefront", store.includes("Test checkout only") && store.includes("PRM-JKT"));
check("production Inspector not exposed", (await fetch(`${MCP}/inspector`)).status === 404);
mkdirSync("reports", { recursive: true });
writeFileSync("reports/smoke-deployed.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, duration_ms: Date.now() - t0, results }, null, 2));
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
