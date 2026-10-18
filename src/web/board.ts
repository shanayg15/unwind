import { query } from "../db/pool.js";
import { formatMoney } from "../lib/util.js";
import { esc } from "./pages.js";

/**
 * UNWIND recording board: one 16:9 read-only view of the live demo store, re-rendered from the database every
 * few seconds. Every number is read back (stock buckets, allocation, entitlements, plans, approvals, recovery,
 * agent tool calls, messages). Contacts, approval codes and signed links are masked; no controls live here.
 */

const CSS = `
:root{--bg:#f4f3ee;--fg:#1b1b19;--muted:#6d6c66;--card:#fff;--line:#dedcd3;--accent:#1f5f4a;--accent-bg:#e3efe8;--warn:#8a5300;--warn-bg:#fbefd9;--bad:#9b1c1c;--bad-bg:#fbe5e5;--held:#c98a1b}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1880px;margin:0 auto;padding:18px 24px 28px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:14px}
.brand{font-weight:800;letter-spacing:.06em;font-size:30px}.brand small{font-weight:500;letter-spacing:0;font-size:17px;color:var(--muted);margin-left:12px}
.pill{display:inline-block;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:3px 12px;font-size:14px;color:var(--muted)}
.live::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:#2e9d5b;margin-right:7px;vertical-align:1px}
.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
.stat .n{font-size:58px;font-weight:750;line-height:1.05;font-variant-numeric:tabular-nums}.stat .l{font-size:16px;color:var(--muted)}
.stat.held .n{color:var(--held)}.stat.committed .n{color:var(--accent)}
.grid{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:12px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;min-height:120px}
.panel h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px}
.chain{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.node{border:1px solid var(--line);border-radius:10px;padding:6px 10px;background:#fafaf7;font-size:15px}.arrow{color:var(--muted)}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);font-size:15px;vertical-align:top}th{color:var(--muted);font-weight:500}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.badge{display:inline-block;border-radius:999px;padding:1px 10px;font-size:13px;font-weight:600;white-space:nowrap}
.b-ok{background:var(--accent-bg);color:var(--accent)}.b-warn{background:var(--warn-bg);color:var(--warn)}.b-bad{background:var(--bad-bg);color:var(--bad)}.b-muted{border:1px solid var(--line);color:var(--muted)}
.plan{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:8px}.plan .row{display:flex;justify-content:space-between;gap:8px;align-items:center}
.counts{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.counts span{font-size:14px;font-weight:500;color:var(--muted)}
.msg{border-left:3px solid var(--line);padding:4px 10px;margin:6px 0;font-size:15px}.msg.in{border-color:#8aa1c9}.msg.out{border-color:var(--accent)}
.msg .meta{font-size:12px;color:var(--muted)}.tools{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}.tool{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:0 6px;background:#fafaf7}
.empty{color:var(--muted);font-size:15px}.foot{margin-top:10px;font-size:13px;color:var(--muted)}
@media (max-width:1100px){.cards{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
`;

export function boardShell(storeName: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UNWIND · live board</title><style>${CSS}</style></head><body><div class="wrap" id="board">Loading live store state…</div>
<script>
async function tick(){try{const r=await fetch("/unwind/panel",{cache:"no-store"});if(r.ok){document.getElementById("board").innerHTML=await r.text();}}catch(e){}}
tick();setInterval(tick,3000);
</script></body></html>`.replace("__STORE__", esc(storeName));
}

const mask = (s: string) =>
  s
    .replace(/(Reply YES|YES|NO)\s+\d{4}/gi, "$1 ••••")
    .replace(/\n?Details \(optional\):\s*\S+/g, "")
    .replace(/https?:\/\/\S+\/approve\/\S+/g, "[approval link]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g, "[email]")
    .replace(/\+?1?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[phone]");
const short = (id: string | null | undefined) => (id ? String(id).slice(-6) : "—");
const time = (d: string | Date) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/Los_Angeles" });

export async function boardPanel(storeId: string): Promise<string> {
  const store = (await query(`select name from stores where id=$1`, [storeId])).rows[0]?.name ?? storeId;
  const promo = (
    await query(
      `select p.*, pr.title as gift_title, pr.sku as gift_sku from promotions p join products pr on pr.id=p.gift_product_id where p.store_id=$1 order by p.created_at desc limit 1`,
      [storeId],
    )
  ).rows[0];
  const giftId = promo?.gift_product_id ?? (await query(`select id from products where store_id=$1 and sku='COR-PCH'`, [storeId])).rows[0]?.id;
  const inv = giftId ? (await query(`select on_hand, held, committed from inventory where product_id=$1`, [giftId])).rows[0] : null;
  const alloc = promo ? (await query(`select * from campaign_allocations where promotion_id=$1`, [promo.id])).rows[0] : null;
  // Only this run: activity after the latest fixture reset (and after the offer, once there is one).
  const resetAt = (await query(`select max(written_at) as t from component_writes where store_id=$1 and actor='fixture'`, [storeId])).rows[0]?.t ?? new Date(0);
  const since = promo && new Date(promo.created_at) > new Date(resetAt) ? promo.created_at : resetAt;

  const available = inv ? inv.on_hand - inv.held - inv.committed : 0;
  const state = !promo ? "Pre-launch: no offer yet" : promo.state === "active" ? "Offer active" : "Offer retired: closed to new orders";
  const cards = `<div class="cards">
    <div class="stat"><div class="n">${esc(alloc?.initial_quantity ?? 0)}</div><div class="l">Set aside for the offer</div></div>
    <div class="stat held"><div class="n">${esc(inv?.held ?? 0)}</div><div class="l">Held by the offer</div></div>
    <div class="stat committed"><div class="n">${esc(inv?.committed ?? 0)}</div><div class="l">Committed to accepted orders</div></div>
    <div class="stat"><div class="n">${esc(available)}</div><div class="l">Available for ordinary sale</div></div>
    <div class="stat"><div class="n">${esc(inv?.on_hand ?? 0)}</div><div class="l">Physical on hand</div></div>
  </div>`;

  // promotion -> allocation -> accepted orders
  let lineage = `<div class="empty">No gift offer yet. The agent launches it through undo_execute after the owner approves.</div>`;
  if (promo) {
    const orders = (
      await query(
        `select e.order_id, e.gift_title, e.quantity, e.accepted_at, e.promotion_version, o.total_minor, o.customer_principal_id,
                (select string_agg(pr.title, ', ' order by l.id) from order_lines l join products pr on pr.id=l.product_id where l.order_id=o.id) as items
           from order_entitlements e join orders o on o.id=e.order_id where e.promotion_id=$1 order by e.accepted_at`,
        [promo.id],
      )
    ).rows;
    lineage = `<div class="chain"><span class="node"><b>${esc(promo.title)}</b> v${esc(promo.version)} · <span class="badge ${promo.state === "active" ? "b-ok" : "b-muted"}">${esc(promo.state)}</span></span>
      <span class="arrow">→</span><span class="node">Allocation …${esc(short(alloc?.id))} · ${esc(alloc?.initial_quantity)} set aside · ${esc(alloc?.remaining_quantity)} held${alloc?.released_quantity ? ` · ${esc(alloc.released_quantity)} released` : ""}</span>
      <span class="arrow">→</span><span class="node">${esc(orders.length)} accepted order${orders.length === 1 ? "" : "s"}</span></div>
      <table><thead><tr><th>Order</th><th>Items</th><th>Gift</th><th>Total</th><th>Accepted</th></tr></thead><tbody>${
        orders
          .map(
            (o) =>
              `<tr><td class="mono">…${esc(short(o.order_id))}${o.customer_principal_id === "pr_customer_a" ? ` <span class="badge b-ok">test customer</span>` : ""}</td><td>${esc(o.items)}</td><td>${esc(o.quantity)} × ${esc(o.gift_title)} <span class="badge b-ok">$0 · committed</span></td><td>${esc(formatMoney(o.total_minor))}</td><td>${esc(time(o.accepted_at))}</td></tr>`,
          )
          .join("") || `<tr><td colspan="5" class="empty">No accepted gift orders yet.</td></tr>`
      }</tbody></table>`;
  }

  // recovery plans: preview -> stale -> refreshed -> applied
  let plans = `<div class="empty">No recovery plan yet. The owner's text starts one.</div>`;
  if (promo) {
    const rows = (
      await query(
        `select p.id, p.status, p.created_at, p.items,
                (select max(created_at) from approval_requests r where r.subject_id=p.id) as requested_at,
                (select max(created_at) from approvals a where a.subject_id=p.id and a.kind='recovery') as approved_at,
                (select id from recovery_attempts t where t.plan_id=p.id order by created_at desc limit 1) as attempt_id,
                (select status from recovery_attempts t where t.plan_id=p.id order by created_at desc limit 1) as attempt_status
           from recovery_plans p where p.store_id=$1 and p.rollout_id=$2 order by p.created_at`,
        [storeId, promo.rollout_id],
      )
    ).rows;
    const shown = rows.filter((r) => r.requested_at || r.approved_at || r.attempt_id || r.status === "superseded");
    const list = (shown.length ? shown : rows.slice(-1)).slice(-4);
    plans = list
      .map((r) => {
        const it = (r.items as Array<{ retirement?: { committed_to_accepted_orders: number; releasable_on_apply: number } }>).find((i) => i.retirement)?.retirement;
        const badge =
          r.status === "superseded"
            ? `<span class="badge b-bad">stale: an order arrived · not applied</span>`
            : r.attempt_id
              ? `<span class="badge b-ok">applied · ${esc(r.attempt_status)}</span>`
              : r.status === "expired"
                ? `<span class="badge b-muted">expired</span>`
                : r.approved_at
                  ? `<span class="badge b-warn">owner approved</span>`
                  : r.requested_at
                    ? `<span class="badge b-warn">awaiting owner approval</span>`
                    : `<span class="badge b-muted">preview</span>`;
        return `<div class="plan"><div class="row"><span class="mono">plan …${esc(short(r.id))} · ${esc(time(r.created_at))}</span>${badge}</div>
          ${it ? `<div class="counts">${esc(it.committed_to_accepted_orders)} <span>stay committed</span> · ${esc(it.releasable_on_apply)} <span>releasable</span></div>` : ""}</div>`;
      })
      .join("");
  }
  const lastAttempt = promo
    ? (await query(`select a.id, a.status, a.result from recovery_attempts a join recovery_plans p on p.id=a.plan_id where p.rollout_id=$1 order by a.created_at desc limit 1`, [promo.rollout_id])).rows[0]
    : null;
  const books = giftId
    ? (
        await query(
          `select i.held = coalesce((select sum(remaining_quantity) from campaign_allocations where product_id=i.product_id and state='holding'),0)
              and i.committed = coalesce((select sum(quantity) from order_lines where product_id=i.product_id),0) + coalesce((select sum(quantity) from order_entitlements where gift_product_id=i.product_id),0) as ok
             from inventory i where i.product_id=$1`,
          [giftId],
        )
      ).rows[0]?.ok
    : null;
  const effects = (lastAttempt?.result?.purchase_aware?.[0]?.effects ?? []) as Array<{ label: string; quantity?: number }>;
  const result = lastAttempt
    ? `<div class="plan"><div class="row"><b>Recovery …${esc(short(lastAttempt.id))}</b><span class="badge b-ok">${esc(lastAttempt.status)}</span></div>
       <div>${effects.map((e) => `<span class="badge b-muted">${esc(e.label)}${e.quantity !== undefined ? ` ${esc(e.quantity)}` : ""}</span>`).join(" ")}</div></div>`
    : "";

  // conversations (this store's owner and customer cases since the offer)
  const msgs = (
    await query(
      `select * from (
         select c.role, 'in' as dir, e.at, coalesce(e.data->>'text','') as text, coalesce(e.data->>'channel', c.channel) as channel, null as status
           from case_events e join cases c on c.id=e.case_id where c.store_id=$1 and e.kind='inbound' and e.at >= $2
         union all
         select c.role, 'out', m.created_at, m.body, m.channel, m.status
           from outbox_messages m join cases c on c.id=m.case_id where c.store_id=$1 and m.created_at >= $2
       ) x order by at desc limit 12`,
      [storeId, since],
    )
  ).rows.reverse();
  const convo = (role: string) =>
    msgs
      .filter((m) => m.role === role)
      .slice(-5)
      .map(
        (m) =>
          `<div class="msg ${m.dir}"><div class="meta">${m.dir === "in" ? (role === "owner" ? "Owner → shop" : "Customer → shop") : role === "owner" ? "Shop agent → owner" : "Shop agent → customer"} · ${esc(m.channel === "voice" ? "call" : m.channel === "imessage" ? "text" : m.channel)} · ${esc(time(m.at))}${m.status ? ` · <b>${esc(m.status)}</b>` : ""}</div>${esc(mask(String(m.text)).slice(0, 360))}</div>`,
      )
      .join("") || `<div class="empty">No messages yet.</div>`;

  // agent activity: real tool calls from the worker's agent runs
  const runs = (
    await query(
      `select c.role, e.at, e.data from case_events e join cases c on c.id=e.case_id where c.store_id=$1 and e.kind='agent_run' and e.at >= $2 order by e.at desc limit 6`,
      [storeId, since],
    )
  ).rows.reverse();
  const activity =
    runs
      .map(
        (r) =>
          `<div class="msg"><div class="meta">${r.role === "owner" ? "Owner case" : "Customer case"} agent · ${esc(r.data.model ?? "")} · ${esc(time(r.at))} · ${esc(Math.round(Number(r.data.duration_ms ?? 0) / 1000))}s</div><div class="tools">${(r.data.tool_calls ?? [])
            .map((t: { name: string; is_error?: boolean }) => `<span class="tool"${t.is_error ? ' style="color:var(--bad)"' : ""}>${esc(t.name.replace("undo__", "").replace("case__", "case."))}</span>`)
            .join("")}</div></div>`,
      )
      .join("") || `<div class="empty">No agent turns yet.</div>`;

  return `<header><div class="brand">UNWIND<small>${esc(store)} · test store · no real payments</small></div>
    <div><span class="pill">${esc(state)}</span> <span class="pill">${books === null ? "stock books: n/a" : books ? "stock books reconcile" : "stock books DO NOT reconcile"}</span> <span class="pill live">live · ${esc(time(new Date()))}</span></div></header>
    ${cards}
    <div class="grid">
      <section class="panel"><h2>Promotion → allocation → accepted orders</h2>${lineage}</section>
      <section class="panel"><h2>Recovery plan</h2>${plans}${result}<h2 style="margin-top:12px">Agent tool calls (MCP)</h2>${activity}</section>
      <section class="panel"><h2>Owner · Inkbox text</h2>${convo("owner")}<h2 style="margin-top:12px">Customer · Inkbox email</h2>${convo("customer")}</section>
    </div>
    <div class="foot">Live readback from the store database every 3 s. Approval codes, links and contacts are masked. Gifts are allocated to orders, not shipped.</div>`;
}
