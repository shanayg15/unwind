import type { Tx } from "../db/pool.js";
import { withTx } from "../db/pool.js";
import { mintToken, type Role } from "../auth/principals.js";
import { defaultPolicy } from "../catalog/policy.js";
import { UndoError } from "../lib/errors.js";
import { newId } from "../lib/util.js";

export interface FixtureProduct {
  key: string;
  sku: string;
  title: string;
  collection: "premium" | "clearance" | "core";
  price_minor: number;
  promo: string;
  sizing: string;
}

/** Initial catalog. This is the test oracle's starting point; recovery uses the journal, never this file. */
export const PRODUCTS: FixtureProduct[] = [
  { key: "jacket", sku: "PRM-JKT", title: "Alpine Shell Jacket", collection: "premium", price_minor: 12000, promo: "Our lightest storm shell for three-season trails.", sizing: "Runs true to size. Model is 6'0\" wearing M." },
  { key: "shoes", sku: "PRM-SHO", title: "Trail Runner Shoe", collection: "premium", price_minor: 15000, promo: "Grippy, cushioned and built for long miles.", sizing: "Half sizes available; order your usual size." },
  { key: "sweater", sku: "PRM-KNT", title: "Merino Crew Sweater", collection: "premium", price_minor: 9500, promo: "Soft merino that layers under any shell.", sizing: "Relaxed fit; size down for a closer fit." },
  { key: "pack", sku: "PRM-PCK", title: "Summit 28L Pack", collection: "premium", price_minor: 8000, promo: "A day pack with a weatherproof shell.", sizing: "One size; torso 16-21 in." },
  { key: "shirt", sku: "CLR-SHT", title: "Linen Camp Shirt", collection: "clearance", price_minor: 5000, promo: "Breathable linen for warm evenings.", sizing: "Classic fit." },
  { key: "shorts", sku: "CLR-SRT", title: "Trail Shorts", collection: "clearance", price_minor: 3500, promo: "Quick-dry shorts with a zip pocket.", sizing: "7 in inseam." },
  { key: "cap", sku: "CLR-CAP", title: "Five-Panel Cap", collection: "clearance", price_minor: 2000, promo: "Packable cap with a sweatband.", sizing: "Adjustable strap." },
  { key: "tote", sku: "COR-TOT", title: "Canvas Market Tote", collection: "core", price_minor: 3000, promo: "Heavy canvas tote for everyday errands.", sizing: "15 x 16 in." },
];

export const SLOTS = {
  premium_home: { title: "New season essentials", subtitle: "Technical layers for every trail", link: "/collections/premium" },
  clearance_home: { title: "Clearance", subtitle: "Last chance on summer gear", link: "/collections/clearance" },
  navigation: {
    title: "Main navigation",
    link: "/",
    items: [
      { label: "Shop", link: "/collections/premium" },
      { label: "Clearance", link: "/collections/clearance" },
    ],
  },
};

export interface StoreSpec {
  storeId: string;
  name: string;
  namespace: string;
  standingGrant: boolean;
  principals: { id: string; kind: Role | "owner"; role: Role; name: string; email?: string | null; phone?: string | null }[];
}

export function demoStoreSpec(): StoreSpec {
  return {
    storeId: "store_demo",
    name: "Trailhead Outfitters (demo)",
    namespace: "undo_demo",
    standingGrant: false,
    principals: [
      { id: "pr_owner", kind: "owner", role: "owner", name: "Store owner", phone: process.env.OWNER_PHONE_E164 ?? null },
      { id: "pr_operator", kind: "operator", role: "operator", name: "Catalog operator" },
      { id: "pr_agent", kind: "agent", role: "agent", name: "Shop agent" },
      { id: "pr_customer_a", kind: "customer", role: "customer", name: "Test customer A", email: process.env.CUSTOMER_TEST_EMAIL ?? null },
      { id: "pr_customer_b", kind: "customer", role: "customer", name: "Test customer B (automated test actor, never contacted)" },
    ],
  };
}

export function evalStoreSpec(): StoreSpec {
  return {
    storeId: "store_eval",
    name: "Trailhead Outfitters (evaluation)",
    namespace: "undo_eval",
    standingGrant: true,
    principals: [
      { id: "pr_eval_owner", kind: "owner", role: "owner", name: "Evaluation store owner (no contact)" },
      { id: "pr_eval_operator", kind: "operator", role: "operator", name: "Evaluation operator" },
      { id: "pr_evaluator", kind: "evaluator", role: "evaluator", name: "Armature tester" },
      { id: "pr_eval_customer", kind: "customer", role: "customer", name: "Evaluation customer (test actor)" },
    ],
  };
}

export function productId(storeId: string, key: string): string {
  return `prd_${storeId.replace(/^store_/, "")}_${key}`;
}
export function slotId(storeId: string, kind: string): string {
  return `slot_${storeId.replace(/^store_/, "")}_${kind}`;
}

async function ensureStore(tx: Tx, spec: StoreSpec): Promise<void> {
  const policy = defaultPolicy({
    recovery_grant: spec.standingGrant ? { scope: "eligible_restorations_only", granted_by: spec.principals.find((p) => p.role === "owner")!.id, granted_at: new Date().toISOString() } : null,
  });
  await tx.query(
    `insert into stores(id, name, namespace, is_demo, policy) values ($1,$2,$3,true,$4)
     on conflict (id) do update set name = excluded.name, policy = excluded.policy`,
    [spec.storeId, spec.name, spec.namespace, JSON.stringify(policy)],
  );
  for (const pr of spec.principals) {
    await tx.query(
      `insert into principals(id, kind, display_name, email, phone_e164) values ($1,$2,$3,$4,$5)
       on conflict (id) do update set display_name = excluded.display_name,
         email = coalesce(excluded.email, principals.email), phone_e164 = coalesce(excluded.phone_e164, principals.phone_e164)`,
      [pr.id, pr.kind, pr.name, pr.email ?? null, pr.phone ?? null],
    );
    await tx.query(`insert into store_memberships(store_id, principal_id, role) values ($1,$2,$3) on conflict do nothing`, [spec.storeId, pr.id, pr.role]);
  }
}

/** Mint long-lived demo credentials for principals that have none yet. Plaintext is returned once. */
export async function ensureTokens(spec: StoreSpec): Promise<Record<string, string>> {
  return withTx(async (tx) => {
    const out: Record<string, string> = {};
    for (const pr of spec.principals) {
      const has = await tx.query(`select 1 from api_tokens where principal_id=$1 and store_id=$2 and case_id is null and revoked_at is null and expires_at is null`, [pr.id, spec.storeId]);
      if (has.rowCount) continue;
      const { token } = await mintToken(tx, { principalId: pr.id, storeId: spec.storeId, role: pr.role, label: `${spec.namespace}:${pr.role}` });
      out[`${spec.storeId}:${pr.id}`] = token;
    }
    return out;
  });
}

/**
 * Reset ONE tagged demo/eval store to the initial fixture. Refuses non-demo stores and requires
 * UNDO_ALLOW_RESET=1. Keeps principals, memberships, tokens, cases and outbox history (provider
 * history is never deleted); closes open cases and expires unused approval links.
 */
export async function resetStore(spec: StoreSpec): Promise<{ storeId: string; runLabel: string }> {
  if (process.env.UNDO_ALLOW_RESET !== "1") throw new UndoError("forbidden", "Reset refused: set UNDO_ALLOW_RESET=1");
  if (!/^undo_(demo|eval)$/.test(spec.namespace)) throw new UndoError("forbidden", "Reset refused: not a tagged UNDO namespace");
  const runLabel = newId("run");
  await withTx(async (tx) => {
    const st = (await tx.query(`select is_demo, namespace from stores where id=$1`, [spec.storeId])).rows[0];
    if (st && (!st.is_demo || st.namespace !== spec.namespace)) throw new UndoError("forbidden", "Reset refused: store is not a tagged demo store");
    await ensureStore(tx, spec);
    const s = spec.storeId;
    await tx.query(`select set_config('undo.reset_store', $1, true)`, [s]);
    await tx.query(`update cases set state='resolved', summary = summary || ' [closed by reset ${runLabel}]', updated_at=now() where store_id=$1 and state <> 'resolved'`, [s]);
    await tx.query(`update approval_requests set used_at = coalesce(used_at, now()) where store_id=$1`, [s]);
    await tx.query(`update approvals set revoked_at = coalesce(revoked_at, now()) where store_id=$1`, [s]);
    await tx.query(`update inbox_events set status='rejected', error='superseded by reset' where status in ('queued','processing') and case_id in (select id from cases where store_id=$1)`, [s]);
    await tx.query(`update outbox_messages set status='failed', error='cancelled by reset' where status='pending' and store_id=$1`, [s]);
    await tx.query(`delete from order_lines where store_id=$1`, [s]);
    await tx.query(`delete from orders where store_id=$1`, [s]);
    await tx.query(`delete from impact_reports where store_id=$1`, [s]);
    await tx.query(`delete from recovery_attempts where store_id=$1`, [s]);
    await tx.query(`delete from recovery_plans where store_id=$1`, [s]);
    await tx.query(`delete from action_changes where store_id=$1`, [s]);
    await tx.query(`delete from actions where store_id=$1`, [s]);
    await tx.query(`delete from approvals where store_id=$1`, [s]);
    await tx.query(`delete from approval_requests where store_id=$1`, [s]);
    await tx.query(`delete from rollouts where store_id=$1`, [s]);
    await tx.query(`delete from idempotency_keys where store_id=$1`, [s]);
    await tx.query(`delete from component_writes where store_id=$1`, [s]);
    await tx.query(`delete from products where store_id=$1`, [s]);
    await tx.query(`delete from store_slots where store_id=$1`, [s]);
    await tx.query(`select set_config('undo.writer', 'fixture', true), set_config('undo.action_id', $1, true)`, [`fixture_${runLabel}`]);
    for (const p of PRODUCTS) {
      const pid = productId(s, p.key);
      await tx.query(`insert into products(id, store_id, collection, sku, title) values ($1,$2,$3,$4,$5)`, [pid, s, p.collection, p.sku, p.title]);
      await tx.query(`insert into product_prices(product_id, store_id, amount_minor, currency) values ($1,$2,$3,'USD')`, [pid, s, p.price_minor]);
      await tx.query(`insert into product_content(product_id, store_id, component_key, value) values ($1,$2,'promotional_copy',$3), ($1,$2,'sizing_info',$4)`, [pid, s, p.promo, p.sizing]);
      await tx.query(`insert into inventory(product_id, store_id, on_hand) values ($1,$2,25)`, [pid, s]);
    }
    for (const [kind, content] of Object.entries(SLOTS)) {
      await tx.query(`insert into store_slots(slot_id, store_id, slot_kind, content) values ($1,$2,$3,$4)`, [slotId(s, kind), s, kind, JSON.stringify(content)]);
    }
    // One imported legacy order with no captured price provenance (stays unknown_provenance, U28).
    const customerB = spec.principals.find((p) => p.role === "customer" && p.id !== "pr_customer_a")?.id ?? spec.principals.find((p) => p.role === "customer")!.id;
    const legacy = newId("ord");
    await tx.query(`insert into orders(id, store_id, customer_principal_id, status, total_minor, currency, is_test, created_at) values ($1,$2,$3,'imported',3000,'USD',true, now() - interval '30 days')`, [legacy, s, customerB]);
    await tx.query(
      `insert into order_lines(id, order_id, store_id, product_id, sku, quantity, unit_amount_minor, currency, source_price_revision, source_change_id, source_rollout_id)
       values ($1,$2,$3,$4,'COR-TOT',1,3000,'USD',null,null,null)`,
      [newId("ol"), legacy, s, productId(s, "tote")],
    );
  });
  return { storeId: spec.storeId, runLabel };
}

/** The approved weekend launch (valid: within caps). Used by the launch brief and tests. */
export function weekendLaunchProposal(storeId: string) {
  const pid = (k: string) => productId(storeId, k);
  return {
    goal: "Weekend launch: 10% off premium, 20% off clearance, weekend copy, premium homepage tile, improved navigation",
    changes: [
      { op: "set_price", product_id: pid("jacket"), amount_minor: 10800 },
      { op: "set_price", product_id: pid("shoes"), amount_minor: 13500 },
      { op: "set_price", product_id: pid("sweater"), amount_minor: 8550 },
      { op: "set_price", product_id: pid("pack"), amount_minor: 7200 },
      { op: "set_price", product_id: pid("shirt"), amount_minor: 4000 },
      { op: "set_price", product_id: pid("shorts"), amount_minor: 2800 },
      { op: "set_price", product_id: pid("cap"), amount_minor: 1600 },
      { op: "set_content", product_id: pid("jacket"), component_key: "promotional_copy", value: "Weekend Premium Event: 10% off our lightest storm shell." },
      { op: "set_content", product_id: pid("shoes"), component_key: "promotional_copy", value: "Weekend Premium Event: 10% off the trail runner built for long miles." },
      { op: "set_content", product_id: pid("sweater"), component_key: "promotional_copy", value: "Weekend Premium Event: 10% off soft merino layers." },
      { op: "set_content", product_id: pid("pack"), component_key: "promotional_copy", value: "Weekend Premium Event: 10% off the Summit 28L." },
      { op: "set_content", product_id: pid("shirt"), component_key: "promotional_copy", value: "Clearance: an extra 20% off breathable linen." },
      { op: "set_slot", slot_id: slotId(storeId, "premium_home"), content: { title: "Weekend Premium Event", subtitle: "10% off technical layers, this weekend only", link: "/collections/premium" } },
      { op: "set_slot", slot_id: slotId(storeId, "clearance_home"), content: { title: "Clearance: extra 20% off", subtitle: "Summer gear, final markdowns", link: "/collections/clearance" } },
      {
        op: "set_slot",
        slot_id: slotId(storeId, "navigation"),
        content: {
          title: "Main navigation",
          link: "/",
          items: [
            { label: "New arrivals", link: "/collections/premium" },
            { label: "Premium", link: "/collections/premium" },
            { label: "Clearance", link: "/collections/clearance" },
            { label: "Size guide", link: "/size-guide" },
          ],
        },
      },
    ],
  } as const;
}
