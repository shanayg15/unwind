/**
 * Ordinary post-launch activity through the deployed, authenticated writers:
 *  - test customer A buys the jacket at the launch price (checkout captures provenance)
 *  - test customer B (automated test actor) buys the tote (no rollout price link)
 *  - the operator improves jacket sizing and changes the shoe price to $139
 */
import { readFileSync } from "node:fs";
import { newId } from "../src/lib/util.js";

const BASE = (process.env.APP_BASE_URL ?? "https://bold-cloud-77gfl.run.mcp-use.com").replace(/\/$/, "");
const STORE = process.env.LAUNCH_STORE_ID ?? "store_demo";
const tokens: Record<string, string> = JSON.parse(readFileSync(".private/tokens.json", "utf8"));
const tok = (p: string) => tokens[`${STORE}:${p}`];
const ids = STORE === "store_eval" ? { a: "pr_eval_customer", b: "pr_eval_customer", op: "pr_eval_operator" } : { a: "pr_customer_a", b: "pr_customer_b", op: "pr_operator" };

async function post(path: string, token: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

async function caps(token: string) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "undo_capabilities", arguments: {} } }),
  });
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text).result.structuredContent as { targets: Array<{ sku: string; price: { revision: number }; sizing_info_revision: number }> };
}

const a = await post("/api/checkout", tok(ids.a), { items: [{ sku: "PRM-JKT", quantity: 1 }], idempotency_key: newId("ord") });
console.log(`order A ${a.order_id}: ${a.total} (${a.lines[0].price_source})`);
const b = await post("/api/checkout", tok(ids.b), { items: [{ sku: "COR-TOT", quantity: 2 }], idempotency_key: newId("ord") });
console.log(`order B ${b.order_id}: ${b.total} (${b.lines[0].price_source})`);
const c = await caps(tok(ids.op));
const jacket = c.targets.find((t) => t.sku === "PRM-JKT")!;
const shoes = c.targets.find((t) => t.sku === "PRM-SHO")!;
const s = await post("/api/operator/edit", tok(ids.op), { sku: "PRM-JKT", component: "sizing_info", text: "Runs small: size up if between sizes. Model is 6'0\" wearing L.", expected_revision: jacket.sizing_info_revision, idempotency_key: newId("op") });
console.log(`operator sizing edit: jacket sizing rev ${s.before_revision} -> ${s.revision}`);
const p = await post("/api/operator/edit", tok(ids.op), { sku: "PRM-SHO", component: "price", amount_minor: 13900, expected_revision: shoes.price.revision, idempotency_key: newId("op") });
console.log(`operator price edit: shoes $${(p.before.amount_minor / 100).toFixed(2)} -> $${(p.after.amount_minor / 100).toFixed(2)} (rev ${p.before_revision} -> ${p.revision})`);
