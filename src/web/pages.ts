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

export interface ApprovalItem {
  title: string;
  lines: Array<{ what: string; from: string | null; to: string | null; note?: string }>;
}
export interface ApprovalModel {
  kind: "launch" | "recovery";
  store: string;
  headline: string;
  lede: string;
  goesBack: ApprovalItem[];
  stays: ApprovalItem[];
  heldBack: ApprovalItem[];
  untouched: string[];
  planHash: string;
  expiresAt: string;
  usedAt: string | null;
  csrf: string;
  token: string;
  replyHint: boolean;
}

const APPROVE_CSS = `
:root{--paper:#eef1ec;--card:#f8faf7;--ink:#17302a;--muted:#5d6b65;--line:#cbd3cd;--go:#4f7a2e;--go-bg:#dce8d2;--keep:#c99812;--keep-bg:#f6ebc8;--hold:#a33a2b;--hold-bg:#f5dcd6}
@media (prefers-color-scheme:dark){:root{--paper:#0f1d19;--card:#15261f;--ink:#e5ece7;--muted:#9caba4;--line:#2a3b35;--go:#9bc77a;--go-bg:#1d3324;--keep:#e8c35a;--keep-bg:#3a3117;--hold:#f0a092;--hold-bg:#3d1f1a}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.5 "Atkinson Hyperlegible",ui-sans-serif,system-ui,sans-serif}
main{max-width:620px;margin:0 auto;padding:28px 18px 140px}
.eyebrow{font-size:13px;letter-spacing:.04em;color:var(--muted)}
h1{font-family:"Big Shoulders Display",ui-sans-serif,sans-serif;font-weight:800;font-size:46px;line-height:1;letter-spacing:.005em;margin:10px 0 12px;text-wrap:balance}
.lede{font-size:18px;margin:0 0 26px;color:var(--ink)}
section{margin:26px 0 0}
.sec-head{display:flex;align-items:center;gap:12px;margin:0 0 10px}
.blaze{flex:none;width:9px;height:24px;border-radius:2px 3px 2px 4px;background:var(--go);box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
.blaze.keep{background:var(--keep)}.blaze.hold{background:var(--hold)}.blaze.none{background:transparent;box-shadow:inset 0 0 0 2px var(--muted)}
.sec-head h2{font-size:15px;font-weight:700;margin:0;letter-spacing:.02em}
.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 10px}
.item h3{font-size:17px;margin:0 0 6px}
.line{display:grid;grid-template-columns:96px 1fr;gap:4px 12px;padding:6px 0;border-top:1px dashed var(--line)}
.line:first-of-type{border-top:0}
.what{color:var(--muted);font-size:14px;padding-top:2px}
.from{color:var(--muted);text-decoration:line-through;text-decoration-thickness:1px;font-size:15px}
.to{font-weight:700}
.note{grid-column:2;font-size:14px;color:var(--muted)}
.go .item{border-left:4px solid var(--go)}.keep .item{border-left:4px solid var(--keep)}.hold .item{border-left:4px solid var(--hold)}
ul.plain{list-style:none;margin:0;padding:0}ul.plain li{padding:8px 0;border-top:1px dashed var(--line)}ul.plain li:first-child{border-top:0}
.fine{font-size:13px;color:var(--muted);margin-top:22px}
code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;word-break:break-all}
.bar{position:fixed;left:0;right:0;bottom:0;background:linear-gradient(to top,var(--paper) 70%,transparent);padding:18px 18px calc(18px + env(safe-area-inset-bottom))}
.bar form{max-width:620px;margin:0 auto;display:flex;gap:10px}
button{font:inherit;font-weight:700;border-radius:12px;padding:15px 18px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.primary{flex:1;background:var(--ink);color:var(--paper);border-color:var(--ink)}
button:focus-visible{outline:3px solid var(--go);outline-offset:2px}
.done{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin-top:20px}
`;

function approveLayout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Big+Shoulders+Display:wght@800&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>${APPROVE_CSS}</style></head><body><main>${body}</main></body></html>`;
}

function itemHtml(it: ApprovalItem): string {
  return `<div class="item"><h3>${esc(it.title)}</h3>${it.lines
    .map(
      (l) =>
        `<div class="line"><div class="what">${esc(l.what)}</div><div>${l.from && l.from !== l.to ? `<div class="from">${esc(l.from)}</div>` : ""}<div class="to">${esc(l.to ?? "")}</div></div>${l.note ? `<div class="note">${esc(l.note)}</div>` : ""}</div>`,
    )
    .join("")}</div>`;
}

function sectionHtml(cls: string, blaze: string, heading: string, items: ApprovalItem[]): string {
  if (!items.length) return "";
  return `<section class="${cls}"><div class="sec-head"><span class="blaze ${blaze}" aria-hidden="true"></span><h2>${esc(heading)}</h2></div>${items.map(itemHtml).join("")}</section>`;
}

function ptTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }) + " PT";
}

export function approvalPage(m: ApprovalModel): string {
  const verb = m.kind === "launch" ? "Launch" : "Apply";
  const body = `<div class="eyebrow">${esc(m.store)} · owner approval</div>
<h1>${esc(m.headline)}</h1><p class="lede">${esc(m.lede)}</p>
${sectionHtml("go", "", m.kind === "launch" ? "Will change" : "Goes back to how it was", m.goesBack)}
${sectionHtml("keep", "keep", "Stays as you decided", m.stays)}
${sectionHtml("hold", "hold", "Held back (changed after the launch, not overwritten)", m.heldBack)}
${m.untouched.length ? `<section><div class="sec-head"><span class="blaze none" aria-hidden="true"></span><h2>Not touched</h2></div><div class="item"><ul class="plain">${m.untouched.map((u) => `<li>${esc(u)}</li>`).join("")}</ul></div></section>` : ""}
<p class="fine">${m.usedAt ? "This link has already been used." : `This link works once and expires at ${esc(ptTime(m.expiresAt))}.`}${m.replyHint ? " You can also approve by replying to the text message." : ""} If the store changes before you approve, your agent will check again and ask you again.<br>Plan <code>${esc(m.planHash.slice(0, 16))}…</code></p>
${
  m.usedAt
    ? ""
    : `<div class="bar"><form method="post" action="/approve/${esc(m.token)}"><input type="hidden" name="csrf" value="${esc(m.csrf)}">
<button class="primary" name="decision" value="approve">${verb} this plan</button><button name="decision" value="reject">Don't apply</button></form></div>`
}`;
  return approveLayout(`${m.headline} · ${m.store}`, body);
}

export function approvalDonePage(store: string, approved: boolean, kind: string, detail: string): string {
  const head = approved ? (kind === "launch" ? "Launch approved" : "Recovery approved") : "Nothing will be applied";
  return approveLayout(
    head,
    `<div class="eyebrow">${esc(store)} · owner approval</div><h1>${esc(head)}</h1>
<div class="done"><div class="sec-head"><span class="blaze ${approved ? "" : "none"}" aria-hidden="true"></span><h2>${esc(detail)}</h2></div></div>`,
  );
}

export function approvalErrorPage(message: string): string {
  return approveLayout("Approval link", `<div class="eyebrow">Owner approval</div><h1>This link can't be used</h1><div class="done"><p style="margin:0">${esc(message)}</p><p class="fine">Reply to your shop agent's text and it will check the store again and send a fresh plan.</p></div>`);
}
