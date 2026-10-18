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

const scenario = process.argv.includes("--scenario") ? process.argv[process.argv.indexOf("--scenario") + 1] : "weekend";
if (scenario === "pouch-one") {
  // Optional live variation: one more customer accepts the gift (e.g. between the owner's preview and YES).
  const html = await (await fetch(`${BASE}/store`)).text();
  const m = /data-offer="([^"]+)" data-terms-hash="([a-f0-9]{64})"/.exec(html);
  if (!m) throw new Error("no active offer on the storefront");
  const o = await post("/api/checkout", tok(ids.b), { items: [{ sku: "PRM-JKT", quantity: 1 }], accept_offer: { promotion_id: m[1], terms_hash: m[2] }, idempotency_key: newId("ord") });
  console.log(`extra gift order ${o.order_id}: ${o.lines[0].title} ${o.total} + ${o.gift?.title ?? "no gift"}`);
  process.exit(0);
}
if (scenario === "pouch") {
  // Free-pouch experiment: four customers' checkouts accept the offer they saw on the live storefront.
  const html = await (await fetch(`${BASE}/store`)).text();
  const m = /data-offer="([^"]+)" data-terms-hash="([a-f0-9]{64})"/.exec(html);
  if (!m) throw new Error("no active offer on the storefront; launch the pouch experiment first");
  const accept_offer = { promotion_id: m[1], terms_hash: m[2] };
  for (const [who, sku] of [[ids.a, "PRM-JKT"], [ids.b, "PRM-SHO"], [ids.a, "PRM-KNT"], [ids.b, "PRM-PCK"]] as const) {
    const o = await post("/api/checkout", tok(who), { items: [{ sku, quantity: 1 }], accept_offer, idempotency_key: newId("ord") });
    console.log(`gift order ${o.order_id}: ${o.lines[0].title} ${o.total} + ${o.gift?.title ?? "no gift"} (${o.gift?.state ?? "-"})`);
  }
  const after = await (await fetch(`${BASE}/store`)).text();
  const pouch = /data-sku="COR-PCH"[\s\S]*?data-available="(\d+)" data-held="(\d+)"/.exec(after);
  console.log(`pouch stock on the storefront: ${pouch?.[1]} available, ${pouch?.[2]} still set aside for the offer`);
  process.exit(0);
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
