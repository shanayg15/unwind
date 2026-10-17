import { readComponent, valueToJson } from "../catalog/components.js";
import { query, withTx } from "../db/pool.js";
import { formatMoney, truncate } from "../lib/util.js";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
:root{--bg:#f7f6f2;--fg:#1d1d1b;--muted:#6b6a64;--card:#fff;--line:#e3e1d9;--accent:#1f5f4a;--warn:#9a5b00;--bad:#9b1c1c;--ok:#1f6b3a}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#a3a29b;--card:#1d1d1b;--line:#33322e;--accent:#6fbf9f;--warn:#e0a548;--bad:#f08a8a;--ok:#7cc79a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.price{font-size:20px;font-weight:600}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);margin-right:4px}
.banner{background:var(--card);border:1px dashed var(--line);border-radius:10px;padding:10px 14px;margin:12px 0}
nav a{margin-right:14px;color:var(--accent);text-decoration:none}table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
td,th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14px}th{color:var(--muted);font-weight:500}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid var(--line);cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}code{font-size:12px;word-break:break-all}
`;

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

const LABEL = `<div class="banner"><strong>Demo store.</strong> Shopify-style demonstration on a controlled Postgres database; not a Shopify integration. Test checkout only: no payment is processed.</div>`;

export async function storefrontPage(storeId: string): Promise<string> {
  return withTx(async (tx) => {
    const store = (await tx.query(`select name from stores where id=$1`, [storeId])).rows[0];
    if (!store) return layout("Store", "<h1>Store not found</h1>");
    const slots = Object.fromEntries((await tx.query(`select slot_kind, content, revision from store_slots where store_id=$1`, [storeId])).rows.map((s) => [s.slot_kind, s]));
    const products = (await tx.query(`select id, sku, title, collection from products where store_id=$1 order by collection desc, sku`, [storeId])).rows;
    const cards = [];
    for (const p of products) {
      const price = await readComponent(tx, storeId, { type: "price", id: p.id, key: "price" });
      const promo = await readComponent(tx, storeId, { type: "content", id: p.id, key: "promotional_copy" });
      const sizing = await readComponent(tx, storeId, { type: "content", id: p.id, key: "sizing_info" });
      const pj = price ? valueToJson(price.value) : null;
      cards.push(`<div class="card" data-sku="${esc(p.sku)}"><span class="tag">${esc(p.collection)}</span><span class="tag">${esc(p.sku)}</span>
<h3 style="margin:8px 0 2px">${esc(p.title)}</h3><div class="price" data-price-rev="${esc(price?.revision)}">${pj ? esc(formatMoney(Number(pj.amount_minor))) : "-"}</div>
<p>${esc(promo && promo.value.kind === "text" ? promo.value.text : "")}</p><p class="muted" style="font-size:13px"><strong>Sizing:</strong> ${esc(sizing && sizing.value.kind === "text" ? sizing.value.text : "")}</p></div>`);
    }
    const nav = slots.navigation?.content?.items ?? [];
    const tile = (k: string) =>
      slots[k] ? `<div class="card" data-slot="${esc(k)}"><span class="tag">${esc(k.replace("_", " "))}</span><h3 style="margin:6px 0 2px">${esc(slots[k].content.title)}</h3><div class="muted">${esc(slots[k].content.subtitle ?? "")}</div></div>` : "";
    return layout(
      store.name,
      `<h1>${esc(store.name)}</h1><nav data-slot="navigation">${nav.map((i: { label: string; link: string }) => `<a href="#">${esc(i.label)}</a>`).join("")}</nav>${LABEL}
<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${tile("premium_home")}${tile("clearance_home")}</div>
<h2>Products</h2><div class="grid">${cards.join("")}</div>
<p class="muted" style="margin-top:24px">Live view of store state. <a href="/">UNDO overview</a></p>`,
    );
  });
}

export async function overviewPage(storeId: string, mcpUrl: string): Promise<string> {
  const ro = (await query(`select id, goal, state, executed_at from rollouts where store_id=$1 and state='executed' order by created_at desc limit 1`, [storeId])).rows[0];
  const att = (
    await query(
      `select a.id, a.status, a.created_at, a.result from recovery_attempts a where a.store_id=$1 order by a.created_at desc limit 3`,
      [storeId],
    )
  ).rows;
  const counts = (await query(`select (select count(*) from orders where store_id=$1)::int as orders, (select count(*) from action_changes where store_id=$1)::int as changes`, [storeId])).rows[0];
  const attempts = att
    .map((a) => {
      const r = a.result as { restored_change_ids: string[]; withheld: unknown[]; accepted_exceptions: unknown[] };
      return `<tr><td><code>${esc(a.id)}</code></td><td>${esc(a.status)}</td><td>${r.restored_change_ids.length} restored · ${r.accepted_exceptions.length} kept · ${r.withheld.length} withheld</td><td class="muted">${esc(new Date(a.created_at).toISOString())}</td></tr>`;
    })
    .join("");
  return layout(
    "UNDO",
    `<h1>UNDO</h1><p class="muted">Ctrl+Z for a shop agent's live changes. Recorded history, selective recovery, order-aware impact, verified readback.</p>${LABEL}
<h2>Connect an MCP client</h2><div class="card"><p>MCP endpoint (authenticated, bearer token): <code>${esc(mcpUrl)}</code></p>
<p class="muted">Seven tools: undo_capabilities, undo_history, undo_execute, undo_preview, undo_impact, undo_apply, undo_verify. Mutations require a scoped credential and owner confirmation; this page is read-only.</p></div>
<h2>Current demo state</h2><div class="card"><p>Latest rollout: ${ro ? `<code>${esc(ro.id)}</code> · ${esc(truncate(ro.goal, 120))}` : "none yet"}</p><p>${counts.changes} recorded changes · ${counts.orders} orders (test orders, no payment)</p><p><a href="/store">Open the storefront</a></p></div>
<h2>Recent recovery receipts (sanitized)</h2>${attempts ? `<table><tr><th>Recovery</th><th>Status</th><th>Outcome</th><th>At (UTC)</th></tr>${attempts}</table>` : `<p class="muted">No recoveries yet.</p>`}`,
  );
}

export function approvalPage(opts: {
  kind: string;
  store: string;
  subjectHash: string;
  expiresAt: string;
  usedAt: string | null;
  rows: Array<{ label: string; from: string | null; to: string | null; status: string }>;
  csrf: string;
  token: string;
  message?: string;
}): string {
  const rows = opts.rows
    .map((r) => {
      const cls = r.status === "eligible" || r.status === "will_apply" ? "ok" : r.status.startsWith("kept") ? "warn" : r.status === "conflict" || r.status.startsWith("withheld") ? "bad" : "muted";
      return `<tr><td>${esc(r.label)}</td><td>${esc(r.from ?? "")}</td><td>${esc(r.to ?? "")}</td><td class="${cls}">${esc(r.status.replaceAll("_", " "))}</td></tr>`;
    })
    .join("");
  const form = opts.usedAt
    ? `<p class="muted">This link was used at ${esc(opts.usedAt)}. Each link works once.</p>`
    : `<form method="post" action="/approve/${esc(opts.token)}" style="display:flex;gap:10px;margin-top:16px">
<input type="hidden" name="csrf" value="${esc(opts.csrf)}"><button class="primary" name="decision" value="approve">Approve this exact ${esc(opts.kind)} plan</button>
<button name="decision" value="reject">Reject</button></form>`;
  return layout(
    "Approve",
    `<h1>Owner approval: ${esc(opts.kind)}</h1><p class="muted">${esc(opts.store)} · link expires ${esc(opts.expiresAt)}</p>
${opts.message ? `<div class="banner">${esc(opts.message)}</div>` : ""}
<table><tr><th>Component</th><th>Current / launch</th><th>After approval</th><th>Plan status</th></tr>${rows}</table>
<p class="muted" style="margin-top:10px">Plan hash <code>${esc(opts.subjectHash)}</code>. Approval covers only this hash; if the store changes, the agent must preview again and send a new link.</p>${form}`,
  );
}
