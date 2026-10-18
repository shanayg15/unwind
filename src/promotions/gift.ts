import { z } from "zod";
import type { StorePolicy } from "../catalog/policy.js";
import type { Tx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { hashOf, newId, sha256 } from "../lib/util.js";

/**
 * Purchase-aware gift-promotion adapter. Units for an experiment are set aside (held) from the shared
 * inventory pool; an accepted order moves one held unit to committed; retiring the experiment closes
 * future eligibility and releases ONLY the units the campaign still holds. Every stock writer (ordinary
 * checkout, gift acceptance, setup, retirement) uses this one protocol and lock order:
 *   promotion row -> allocation row -> inventory rows (product_id order).
 */

export const GIFT_MAX_CAP = 25;

export const StartGiftPromotion = z.object({
  op: z.literal("start_gift_promotion"),
  gift_product_id: z.string().max(40).describe("product_id of the gift item from undo_capabilities (it must have enough available stock to set aside `cap` units)"),
  qualifying_collection: z.enum(["premium", "clearance", "core"]).describe("An order qualifies when it contains at least one item from this collection"),
  cap: z.number().int().min(1).max(GIFT_MAX_CAP).describe("Maximum accepted gifts (one per order). Exactly this many units are set aside from available stock."),
  title: z.string().min(3).max(80).describe("Short offer name shown to customers"),
  terms: z.string().min(10).max(300).describe("Customer-facing terms the customer sees and accepts at checkout"),
  atomic_group: z
    .string()
    .max(40)
    .optional()
    .describe("Optional atomic recovery group shared with the presentation (banner/copy) that announces this offer"),
});
export type StartGiftPromotion = z.infer<typeof StartGiftPromotion>;

export interface StockRow {
  product_id: string;
  on_hand: number;
  held: number;
  committed: number;
  available: number;
  revision: number;
}

async function lockStock(tx: Tx, storeId: string, productIds: string[]): Promise<Map<string, StockRow>> {
  const ids = [...new Set(productIds)].sort();
  const out = new Map<string, StockRow>();
  for (const id of ids) {
    const r = (await tx.query(`select product_id, on_hand, held, committed, revision from inventory where store_id=$1 and product_id=$2 for update`, [storeId, id])).rows[0];
    if (!r) throw new UndoError("not_found", `No inventory record for ${id}`);
    out.set(id, { product_id: id, on_hand: r.on_hand, held: r.held, committed: r.committed, available: r.on_hand - r.held - r.committed, revision: Number(r.revision) });
  }
  return out;
}

export interface MoveRefs {
  promotionId?: string | null;
  allocationId?: string | null;
  orderId?: string | null;
  actionId?: string | null;
  recoveryId?: string | null;
  idempotencyRef?: string | null;
  actor: string;
}

type MoveKind = "reserve_campaign" | "commit_gift" | "commit_order" | "release_remaining";
const BUCKETS: Record<MoveKind, { from: "available" | "held"; to: "available" | "held" | "committed" }> = {
  reserve_campaign: { from: "available", to: "held" },
  commit_gift: { from: "held", to: "committed" },
  commit_order: { from: "available", to: "committed" },
  release_remaining: { from: "held", to: "available" },
};

/** One typed quantity transfer on a locked inventory row, journaled with the balances it produced. */
async function move(tx: Tx, storeId: string, row: StockRow, kind: MoveKind, quantity: number, refs: MoveRefs): Promise<StockRow> {
  const b = BUCKETS[kind];
  const have = b.from === "available" ? row.available : row.held;
  if (quantity <= 0 || have < quantity) {
    throw new UndoError("policy_violation", `Not enough ${b.from} stock for ${row.product_id} (${have} < ${quantity})`, { product_id: row.product_id, bucket: b.from, have, needed: quantity });
  }
  const held = row.held + (b.to === "held" ? quantity : 0) - (b.from === "held" ? quantity : 0);
  const committed = row.committed + (b.to === "committed" ? quantity : 0);
  const r = (
    await tx.query(`update inventory set held=$3, committed=$4 where store_id=$1 and product_id=$2 and revision=$5 returning on_hand, held, committed, revision`, [
      storeId,
      row.product_id,
      held,
      committed,
      row.revision,
    ])
  ).rows[0];
  if (!r) throw new UndoError("revision_conflict", "Inventory changed while locked (unexpected)", { product_id: row.product_id });
  const next: StockRow = { product_id: row.product_id, on_hand: r.on_hand, held: r.held, committed: r.committed, available: r.on_hand - r.held - r.committed, revision: Number(r.revision) };
  await tx.query(
    `insert into inventory_moves(store_id, product_id, kind, quantity, from_bucket, to_bucket, promotion_id, allocation_id, order_id, action_id, recovery_id, idempotency_ref, actor, balances_after)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      storeId,
      row.product_id,
      kind,
      quantity,
      b.from,
      b.to,
      refs.promotionId ?? null,
      refs.allocationId ?? null,
      refs.orderId ?? null,
      refs.actionId ?? null,
      refs.recoveryId ?? null,
      refs.idempotencyRef ?? null,
      refs.actor,
      JSON.stringify({ on_hand: next.on_hand, available: next.available, held: next.held, committed: next.committed }),
    ],
  );
  return next;
}

// ---------------------------------------------------------------- setup (undo_execute)

export interface NormalizedPromotion {
  gift_product_id: string;
  gift_sku: string;
  gift_title: string;
  qualifying_collection: string;
  cap: number;
  title: string;
  terms: string;
  terms_hash: string;
  available_before: number;
  stock_revision: number;
}

/** Validate a gift-promotion op against current stock and policy. Throws before any write. */
export async function normalizePromotion(tx: Tx, storeId: string, _policy: StorePolicy, op: StartGiftPromotion, lock: boolean): Promise<NormalizedPromotion> {
  const pr = (await tx.query(`select id, sku, title, collection from products where store_id=$1 and id=$2`, [storeId, op.gift_product_id])).rows[0];
  if (!pr) throw new UndoError("not_found", `Unknown gift product ${op.gift_product_id}`, { product_id: op.gift_product_id });
  if (pr.collection === op.qualifying_collection) throw new UndoError("policy_violation", "The gift item cannot be in the qualifying collection", { product_id: pr.id });
  const active = (await tx.query(`select id from promotions where store_id=$1 and gift_product_id=$2 and state='active'`, [storeId, pr.id])).rows[0];
  if (active) throw new UndoError("policy_violation", "A gift promotion for this item is already active", { promotion_id: active.id });
  const stock = lock
    ? (await lockStock(tx, storeId, [pr.id])).get(pr.id)!
    : await (async () => {
        const r = (await tx.query(`select on_hand, held, committed, revision from inventory where store_id=$1 and product_id=$2`, [storeId, pr.id])).rows[0];
        return { product_id: pr.id, on_hand: r.on_hand, held: r.held, committed: r.committed, available: r.on_hand - r.held - r.committed, revision: Number(r.revision) };
      })();
  if (stock.available < op.cap) {
    throw new UndoError("policy_violation", `Only ${stock.available} ${pr.title} available; cannot set aside ${op.cap}`, { product_id: pr.id, available: stock.available, cap: op.cap });
  }
  return {
    gift_product_id: pr.id,
    gift_sku: pr.sku,
    gift_title: pr.title,
    qualifying_collection: op.qualifying_collection,
    cap: op.cap,
    title: op.title,
    terms: op.terms,
    terms_hash: sha256(`${op.title}\n${op.terms}\n${pr.id}\n${op.qualifying_collection}\n${op.cap}`),
    available_before: stock.available,
    stock_revision: stock.revision,
  };
}

/** Create the active promotion version and reserve its allocation in the rollout's transaction. */
export async function startPromotion(tx: Tx, storeId: string, rolloutId: string, actionId: string, actor: string, n: NormalizedPromotion) {
  const promotionId = newId("promo");
  const allocationId = newId("alloc");
  const promo = (
    await tx.query(
      `insert into promotions(id, store_id, rollout_id, title, gift_product_id, qualifying_collection, cap, terms, terms_hash, state, created_action_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10) returning revision, version`,
      [promotionId, storeId, rolloutId, n.title, n.gift_product_id, n.qualifying_collection, n.cap, n.terms, n.terms_hash, actionId],
    )
  ).rows[0];
  await tx.query(
    `insert into campaign_allocations(id, store_id, promotion_id, product_id, initial_quantity, remaining_quantity, state) values ($1,$2,$3,$4,$5,$5,'holding')`,
    [allocationId, storeId, promotionId, n.gift_product_id, n.cap],
  );
  const stock = (await lockStock(tx, storeId, [n.gift_product_id])).get(n.gift_product_id)!;
  const after = await move(tx, storeId, stock, "reserve_campaign", n.cap, { promotionId, allocationId, actionId, actor });
  return { promotion_id: promotionId, allocation_id: allocationId, revision: Number(promo.revision), version: promo.version as number, stock_after: after };
}

// ---------------------------------------------------------------- state readback

export interface PromotionState {
  promotion_id: string;
  version: number;
  title: string;
  state: "active" | "retired";
  revision: number;
  gift_product_id: string;
  gift_sku: string;
  gift_title: string;
  qualifying_collection: string;
  cap: number;
  terms: string;
  terms_hash: string;
  allocation: { allocation_id: string; initial: number; remaining: number; released: number; state: string; revision: number };
  committed_orders: Array<{ order_id: string; entitlement_id: string; quantity: number; accepted_at: string }>;
  committed_quantity: number;
  stock: { on_hand: number; available: number; held: number; committed: number };
  retired_at: string | null;
}

/** Current promotion facts; with lock=true, rows are locked in the global order (promotion -> allocation -> inventory). */
export async function promotionState(tx: Tx, storeId: string, promotionId: string, lock: boolean): Promise<PromotionState | null> {
  const fu = lock ? " for update" : "";
  const p = (
    await tx.query(
      `select p.*, pr.sku, pr.title as gift_title from promotions p join products pr on pr.id = p.gift_product_id where p.store_id=$1 and p.id=$2${lock ? " for update of p" : ""}`,
      [storeId, promotionId],
    )
  ).rows[0];
  if (!p) return null;
  const a = (await tx.query(`select * from campaign_allocations where promotion_id=$1 order by id${fu}`, [promotionId])).rows[0];
  const stock: { on_hand: number; held: number; committed: number } = lock
    ? (await lockStock(tx, storeId, [p.gift_product_id])).get(p.gift_product_id)!
    : (await tx.query(`select on_hand, held, committed from inventory where store_id=$1 and product_id=$2`, [storeId, p.gift_product_id])).rows[0];
  const ents = (await tx.query(`select id, order_id, quantity, accepted_at from order_entitlements where promotion_id=$1 order by accepted_at, id`, [promotionId])).rows;
  const committed = ents.reduce((s, e) => s + Number(e.quantity), 0);
  return {
    promotion_id: p.id,
    version: p.version,
    title: p.title,
    state: p.state,
    revision: Number(p.revision),
    gift_product_id: p.gift_product_id,
    gift_sku: p.sku,
    gift_title: p.gift_title,
    qualifying_collection: p.qualifying_collection,
    cap: p.cap,
    terms: p.terms,
    terms_hash: p.terms_hash,
    allocation: { allocation_id: a.id, initial: a.initial_quantity, remaining: a.remaining_quantity, released: a.released_quantity, state: a.state, revision: Number(a.revision) },
    committed_orders: ents.map((e) => ({ order_id: e.order_id, entitlement_id: e.id, quantity: Number(e.quantity), accepted_at: new Date(e.accepted_at).toISOString() })),
    committed_quantity: committed,
    stock: { on_hand: stock.on_hand, held: stock.held, committed: stock.committed, available: stock.on_hand - stock.held - stock.committed },
    retired_at: p.retired_at ? new Date(p.retired_at).toISOString() : null,
  };
}

/** The dependency watermark a retirement plan is bound to: if any of these move, the plan is stale. */
export function dependencyWatermark(s: PromotionState) {
  return {
    promotion_revision: s.revision,
    allocation_revision: s.allocation.revision,
    held_unallocated: s.allocation.remaining,
    committed_to_orders: s.committed_quantity,
    entitlements_hash: hashOf(s.committed_orders.map((o) => o.entitlement_id)),
  };
}
export type DependencyWatermark = ReturnType<typeof dependencyWatermark>;

/** Retirement plan facts shown in preview (read-only; reserves nothing). */
export function retirementFacts(s: PromotionState) {
  return {
    promotion_id: s.promotion_id,
    version: s.version,
    title: s.title,
    gift: `${s.gift_sku} ${s.gift_title}`,
    state: s.state,
    initially_allocated: s.allocation.initial,
    committed_to_accepted_orders: s.committed_quantity,
    held_unallocated: s.allocation.remaining,
    releasable_on_apply: s.state === "active" ? s.allocation.remaining : 0,
    accepted_order_ids: s.committed_orders.map((o) => o.order_id),
    gift_stock_now: s.stock,
    outcomes_on_apply:
      s.state === "active"
        ? ["retire_future_use: no new order can accept this offer", `release_remaining: ${s.allocation.remaining} held unit(s) return to available stock`, `preserve_order_commitment: ${s.committed_quantity} gift(s) stay committed to ${s.committed_orders.length} accepted order(s)`]
        : [],
  };
}

/** Retire one locked promotion: close eligibility, release exactly the campaign-held remainder, keep order commitments. */
export async function retirePromotion(tx: Tx, storeId: string, s: PromotionState, refs: { actionId: string; recoveryId: string; actor: string; idempotencyRef: string }) {
  if (s.state !== "active") throw new UndoError("invalid_input", "Promotion is not active", { promotion_id: s.promotion_id });
  const p = (
    await tx.query(`update promotions set state='retired', retired_at=now(), retired_action_id=$3, retired_by_recovery=$4 where id=$1 and store_id=$2 and revision=$5 returning revision`, [
      s.promotion_id,
      storeId,
      refs.actionId,
      refs.recoveryId,
      s.revision,
    ])
  ).rows[0];
  if (!p) throw new UndoError("revision_conflict", "Promotion changed while locked (unexpected)");
  const release = s.allocation.remaining;
  await tx.query(`update campaign_allocations set remaining_quantity=0, released_quantity=released_quantity+$2, state='released', released_at=now() where id=$1 and revision=$3`, [
    s.allocation.allocation_id,
    release,
    s.allocation.revision,
  ]);
  let stockAfter = s.stock;
  if (release > 0) {
    const row = (await lockStock(tx, storeId, [s.gift_product_id])).get(s.gift_product_id)!;
    const after = await move(tx, storeId, row, "release_remaining", release, {
      promotionId: s.promotion_id,
      allocationId: s.allocation.allocation_id,
      actionId: refs.actionId,
      recoveryId: refs.recoveryId,
      idempotencyRef: refs.idempotencyRef,
      actor: refs.actor,
    });
    stockAfter = { on_hand: after.on_hand, available: after.available, held: after.held, committed: after.committed };
  }
  return {
    promotion_revision: Number(p.revision),
    effects: [
      { label: "retire_future_use", detail: `${s.title} closed to new orders; version ${s.version} kept for receipts and fulfillment` },
      { label: "release_remaining", quantity: release, allocation_id: s.allocation.allocation_id, detail: `${release} unallocated ${s.gift_title} returned to available stock` },
      {
        label: "preserve_order_commitment",
        quantity: s.committed_quantity,
        order_ids: s.committed_orders.map((o) => o.order_id),
        detail: `${s.committed_quantity} gift(s) stay committed to accepted orders`,
      },
    ],
    gift_stock_after: stockAfter,
  };
}

// ---------------------------------------------------------------- checkout participation

export interface CheckoutStockLine {
  product_id: string;
  quantity: number;
  collection: string;
}

export interface AcceptedOffer {
  promotion_id: string;
  terms_hash: string;
}

/**
 * Inside the checkout transaction: lock the accepted promotion, its allocation, and every stock row the
 * order touches (global order), recheck eligibility, then commit purchased lines and the gift together.
 * A closed/changed offer returns OFFER_CHANGED_RECONFIRM: nothing is recorded, the gift is never silently dropped.
 */
export async function commitOrderStock(tx: Tx, storeId: string, orderLines: CheckoutStockLine[], offer: AcceptedOffer | null, refs: { orderId: string; actor: string; idempotencyRef: string }) {
  let promo: PromotionState | null = null;
  if (offer) {
    promo = await promotionState(tx, storeId, offer.promotion_id, true);
    const reason = !promo
      ? "this offer does not exist"
      : promo.state !== "active"
        ? "this offer has ended"
        : promo.terms_hash !== offer.terms_hash
          ? "the offer terms changed after you saw them"
          : promo.allocation.remaining < 1
            ? "all gifts set aside for this offer have been claimed"
            : null;
    if (reason) {
      throw new UndoError(
        "offer_changed_reconfirm",
        `OFFER_CHANGED_RECONFIRM: ${reason}. No order was recorded and nothing was charged. Review the current offer and confirm again, or place the order without the gift.`,
        { promotion_id: offer.promotion_id, offer_state: promo?.state ?? "unknown", remaining: promo?.allocation.remaining ?? 0 },
        "reconfirm_checkout",
      );
    }
    if (!orderLines.some((l) => l.collection === promo!.qualifying_collection)) {
      throw new UndoError("policy_violation", `This offer needs at least one ${promo!.qualifying_collection} item in the order`, { promotion_id: promo!.promotion_id });
    }
  }
  const stock = await lockStock(tx, storeId, [...orderLines.map((l) => l.product_id), ...(promo ? [promo.gift_product_id] : [])]);
  const byProduct = new Map<string, number>();
  for (const l of orderLines) byProduct.set(l.product_id, (byProduct.get(l.product_id) ?? 0) + l.quantity);
  for (const [pid, q] of [...byProduct].sort(([a], [b]) => a.localeCompare(b))) {
    const row = stock.get(pid)!;
    if (row.available < q) throw new UndoError("policy_violation", `Only ${row.available} available for ordinary sale`, { product_id: pid, available: row.available });
    stock.set(pid, await move(tx, storeId, row, "commit_order", q, { orderId: refs.orderId, actor: refs.actor, idempotencyRef: refs.idempotencyRef }));
  }
  if (!promo) return null;
  const upd = await tx.query(`update campaign_allocations set remaining_quantity = remaining_quantity - 1 where id=$1 and revision=$2 and remaining_quantity >= 1 returning revision`, [
    promo.allocation.allocation_id,
    promo.allocation.revision,
  ]);
  if (!upd.rowCount) throw new UndoError("revision_conflict", "Allocation changed while locked (unexpected)");
  stock.set(
    promo.gift_product_id,
    await move(tx, storeId, stock.get(promo.gift_product_id)!, "commit_gift", 1, {
      promotionId: promo.promotion_id,
      allocationId: promo.allocation.allocation_id,
      orderId: refs.orderId,
      actor: refs.actor,
      idempotencyRef: refs.idempotencyRef,
    }),
  );
  return promo;
}

export async function recordEntitlement(tx: Tx, storeId: string, orderId: string, promo: PromotionState) {
  const id = newId("ent");
  await tx.query(
    `insert into order_entitlements(id, order_id, store_id, promotion_id, promotion_version, allocation_id, gift_product_id, gift_sku, gift_title, quantity, unit_amount_minor, terms, terms_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,0,$10,$11)`,
    [id, orderId, storeId, promo.promotion_id, promo.version, promo.allocation.allocation_id, promo.gift_product_id, promo.gift_sku, promo.gift_title, promo.terms, promo.terms_hash],
  );
  return { entitlement_id: id, gift_sku: promo.gift_sku, gift_title: promo.gift_title, quantity: 1, unit_amount_minor: 0, promotion_id: promo.promotion_id, promotion_version: promo.version, terms: promo.terms };
}

// ---------------------------------------------------------------- storefront + accounting readback

export async function activeOffers(tx: Tx, storeId: string) {
  const { rows } = await tx.query(
    `select p.id, p.title, p.terms, p.terms_hash, p.cap, p.qualifying_collection, pr.title as gift_title, pr.sku as gift_sku, a.remaining_quantity
       from promotions p join products pr on pr.id = p.gift_product_id join campaign_allocations a on a.promotion_id = p.id
      where p.store_id=$1 and p.state='active' order by p.created_at`,
    [storeId],
  );
  return rows.map((r) => ({
    promotion_id: r.id,
    title: r.title,
    terms: r.terms,
    terms_hash: r.terms_hash,
    gift: `${r.gift_sku} ${r.gift_title}`,
    qualifying_collection: r.qualifying_collection,
    remaining: r.remaining_quantity,
    cap: r.cap,
  }));
}

/**
 * Reconcile every stock bucket with its owners: held == units still owned by holding allocations;
 * committed == purchased order lines + accepted gift entitlements; available never negative.
 */
export async function stockAccounting(tx: Tx, storeId: string, productIds?: string[]) {
  const { rows } = await tx.query(
    `select i.product_id, pr.sku, pr.title, i.on_hand, i.held, i.committed,
            coalesce((select sum(a.remaining_quantity) from campaign_allocations a where a.product_id=i.product_id and a.state='holding'), 0)::int as held_by_allocations,
            coalesce((select sum(l.quantity) from order_lines l where l.product_id=i.product_id), 0)::int as committed_by_lines,
            coalesce((select sum(e.quantity) from order_entitlements e where e.gift_product_id=i.product_id), 0)::int as committed_by_gifts
       from inventory i join products pr on pr.id = i.product_id
      where i.store_id=$1 ${productIds ? "and i.product_id = any($2)" : ""} order by pr.sku`,
    productIds ? [storeId, productIds] : [storeId],
  );
  return rows.map((r) => {
    const available = r.on_hand - r.held - r.committed;
    const balanced = r.held === r.held_by_allocations && r.committed === r.committed_by_lines + r.committed_by_gifts && available >= 0 && available + r.held + r.committed === r.on_hand;
    return {
      product_id: r.product_id,
      sku: r.sku,
      title: r.title,
      on_hand: r.on_hand,
      available,
      held: r.held,
      committed: r.committed,
      owners: { held_by_allocations: r.held_by_allocations, committed_by_order_lines: r.committed_by_lines, committed_by_gift_entitlements: r.committed_by_gifts },
      balanced,
    };
  });
}

/** Pick/pack readback built only from immutable order snapshots and gift entitlements (no active-rule lookup). */
export async function pickList(tx: Tx, storeId: string) {
  const { rows } = await tx.query(
    `select o.id, o.seq, o.status, o.created_at,
            coalesce((select json_agg(json_build_object('sku', l.sku, 'title', pr.title, 'quantity', l.quantity) order by l.id) from order_lines l join products pr on pr.id=l.product_id where l.order_id=o.id), '[]') as lines,
            coalesce((select json_agg(json_build_object('sku', e.gift_sku, 'title', e.gift_title, 'quantity', e.quantity, 'terms', e.terms, 'promotion_version', e.promotion_version) order by e.id) from order_entitlements e where e.order_id=o.id), '[]') as gifts
       from orders o where o.store_id=$1 and o.status='placed_test' order by o.seq`,
    [storeId],
  );
  return rows.map((r) => ({
    order_id: r.id,
    order_seq: Number(r.seq),
    placed_at: new Date(r.created_at).toISOString(),
    pick: [
      ...(r.lines as Array<{ sku: string; title: string; quantity: number }>).map((l) => ({ ...l, kind: "purchased" })),
      ...(r.gifts as Array<{ sku: string; title: string; quantity: number; terms: string; promotion_version: number }>).map((g) => ({ sku: g.sku, title: g.title, quantity: g.quantity, kind: "gift (accepted offer)", terms: g.terms, promotion_version: g.promotion_version })),
    ],
  }));
}
