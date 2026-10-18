import type { Principal } from "../auth/principals.js";
import { requireRole } from "../auth/principals.js";
import { readComponent } from "../catalog/components.js";
import { query, withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { truncate } from "../lib/util.js";
import { activeOffers, GIFT_MAX_CAP, promotionState, retirementFacts } from "../promotions/gift.js";
import { loadPolicy } from "./execute.js";

export interface HistoryInput {
  rollout_id?: string;
  goal_contains?: string;
  state?: "awaiting_approval" | "approved" | "executed" | "rejected";
  cursor?: string;
  limit?: number;
}

function shortValue(v: Record<string, unknown>): unknown {
  if ("text" in v) return { text: truncate(String(v.text), 160) };
  return v;
}

/** The shared pool exposes the same query interface as a transaction client for read-only adapter calls. */
async function withTxless() {
  return { query } as unknown as Parameters<typeof promotionState>[0];
}

/** Discoverable rollout and change metadata so a fresh agent never needs the old conversation. */
export async function undoHistory(p: Principal, input: HistoryInput): Promise<Record<string, unknown>> {
  requireRole(p, ["owner", "agent", "evaluator", "operator"], "read change history");
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const params: unknown[] = [p.storeId];
  let where = "r.store_id = $1";
  if (input.rollout_id) {
    params.push(input.rollout_id);
    where += ` and r.id = $${params.length}`;
  }
  if (input.state) {
    params.push(input.state);
    where += ` and r.state = $${params.length}`;
  }
  if (input.goal_contains) {
    params.push(`%${input.goal_contains.replace(/[%_\\]/g, "\\$&")}%`);
    where += ` and r.goal ilike $${params.length}`;
  }
  if (input.cursor) {
    const c = /^c_(\d+)$/.exec(input.cursor);
    if (!c) throw new UndoError("invalid_input", "Bad cursor");
    params.push(new Date(Number(c[1])));
    where += ` and r.created_at < $${params.length}`;
  }
  params.push(limit + 1);
  const { rows } = await query(
    `select r.id, r.goal, r.state, r.proposal_hash, r.created_at, r.executed_at, r.created_by, r.needs_review
       from rollouts r where ${where} order by r.created_at desc limit $${params.length}`,
    params,
  );
  const page = rows.slice(0, limit);
  const rollouts = [];
  for (const r of page) {
    const ch = await query(
      `select c.id, c.component_type, c.component_id, c.component_key, c.product_id, c.scope_labels, c.group_id,
              c.before_value, c.after_value, c.before_revision, c.after_revision, c.recovery_status, c.reverted_by,
              pr.sku, pr.title
         from action_changes c left join products pr on pr.id = c.product_id
        where c.rollout_id = $1 and c.store_id = $2 order by c.committed_at, c.id`,
      [r.id, p.storeId],
    );
    const promotions = [];
    for (const c of ch.rows.filter((x) => x.component_type === "promotion")) {
      const st = await promotionState(await withTxless(), p.storeId, c.component_id, false);
      if (st) promotions.push({ change_id: c.id, ...retirementFacts(st), terms: st.terms, allocation_id: st.allocation.allocation_id, retired_at: st.retired_at });
    }
    rollouts.push({
      rollout_id: r.id,
      goal: r.goal,
      state: r.state,
      proposal_hash: r.proposal_hash,
      review_required: r.needs_review,
      created_at: new Date(r.created_at).toISOString(),
      executed_at: r.executed_at ? new Date(r.executed_at).toISOString() : null,
      change_count: ch.rowCount,
      changes: ch.rows.map((c) => ({
        change_id: c.id,
        component: `${c.component_type}:${c.component_id}:${c.component_key}`,
        product: c.sku ? `${c.sku} ${c.title}` : null,
        labels: c.scope_labels,
        group_id: c.group_id,
        before: shortValue(c.before_value),
        after: shortValue(c.after_value),
        before_revision: Number(c.before_revision),
        after_revision: Number(c.after_revision),
        recovery_status: c.recovery_status,
      })),
      ...(promotions.length ? { promotions } : {}),
    });
  }
  const next = rows.length > limit ? `c_${new Date(page[page.length - 1].created_at).getTime()}` : null;
  return { store_id: p.storeId, rollouts, next_cursor: next };
}

/** Supported operations, limits, auth scope, and current targetable components (bounded). */
export async function undoCapabilities(p: Principal): Promise<Record<string, unknown>> {
  return withTx(async (tx) => {
    const policy = await loadPolicy(tx, p.storeId);
    const store = (await tx.query(`select id, name, is_demo from stores where id=$1`, [p.storeId])).rows[0];
    const products = (
      await tx.query(`select id, sku, title, collection from products where store_id=$1 order by collection, sku limit 50`, [p.storeId])
    ).rows;
    const slots = (await tx.query(`select slot_id, slot_kind, revision, content from store_slots where store_id=$1 order by slot_kind`, [p.storeId])).rows;
    const targets = [];
    if (p.role !== "customer") {
      for (const pr of products) {
        const price = await readComponent(tx, p.storeId, { type: "price", id: pr.id, key: "price" });
        const promo = await readComponent(tx, p.storeId, { type: "content", id: pr.id, key: "promotional_copy" });
        const sizing = await readComponent(tx, p.storeId, { type: "content", id: pr.id, key: "sizing_info" });
        const inv = (await tx.query(`select on_hand, held, committed from inventory where store_id=$1 and product_id=$2`, [p.storeId, pr.id])).rows[0];
        targets.push({
          product_id: pr.id,
          sku: pr.sku,
          title: pr.title,
          collection: pr.collection,
          stock: inv ? { on_hand: inv.on_hand, available: inv.on_hand - inv.held - inv.committed, held_for_campaigns: inv.held, committed_to_orders: inv.committed } : null,
          price: price && price.value.kind === "price" ? { amount_minor: price.value.amount_minor, currency: price.value.currency, revision: price.revision } : null,
          promotional_copy_revision: promo?.revision ?? null,
          sizing_info_revision: sizing?.revision ?? null,
        });
      }
    }
    const roleOps: Record<string, string[]> = {
      owner: ["undo_history", "undo_execute", "undo_preview", "undo_impact", "undo_apply (direct owner confirmation)", "undo_verify"],
      agent: ["undo_history", "undo_execute (owner-approved proposals)", "undo_preview", "undo_impact", "undo_apply (owner approval or standing grant)", "undo_verify"],
      evaluator: ["undo_history", "undo_execute (owner-approved proposals)", "undo_preview", "undo_impact", "undo_apply (owner approval or standing grant)", "undo_verify"],
      operator: ["undo_history"],
      customer: ["undo_impact (own orders only)"],
    };
    return {
      principal: { role: p.role, store_id: p.storeId, store_name: store.name, demo_store: store.is_demo },
      allowed_tools: roleOps[p.role],
      supported_components: {
        price: "product price (integer minor units, USD)",
        promotional_copy: "product promotional copy text",
        sizing_info: "product sizing text (operator-edited; rollouts may not change it)",
        slots: "premium_home, clearance_home, navigation (typed content)",
        gift_promotion:
          "start_gift_promotion: one free gift item per qualifying order, capped; exactly `cap` units of the gift are set aside (held) from available stock when the rollout executes",
      },
      limits: {
        max_targets_per_rollout: policy.max_targets,
        max_discount_pct: policy.max_discount_pct,
        review_threshold_pct: policy.review_threshold_pct,
        min_price_minor: policy.min_price_minor,
        rollout_content_keys: policy.rollout_content_keys,
        one_write_per_component_per_rollout: true,
        plan_ttl_minutes: policy.plan_ttl_minutes,
        gift_promotion_max_cap: GIFT_MAX_CAP,
        gifts_per_order: 1,
      },
      recovery_conditions: [
        "Recovery targets recorded change_ids from undo_history; never supply before-values yourself.",
        "A change is eligible only while its component is still at the recorded after_revision.",
        "Later edits to the same component are conflicts: withheld, or kept as an owner-accepted exception.",
        "Independent components (e.g. sizing_info) are never rewritten by recovery.",
        "Order snapshots are immutable; recovery never changes existing orders.",
        "Gift promotions are retired, not value-restored: retire_future_use closes the offer to new orders, release_remaining returns ONLY units the campaign still holds to available stock, preserve_order_commitment keeps every accepted order's gift and its committed unit.",
        "A retirement plan is bound to the current committed/held counts. If an order accepts the gift after preview, undo_apply returns stale_dependency_state with a fresh plan that needs its own confirmation.",
        "Guarantee boundary: one gift-rule adapter on this controlled store's inventory pool; no shipping, refunds, payments, or external platform inventory.",
        policy.recovery_grant
          ? "This store has a standing owner grant: eligible restorations may be applied without a per-plan approval."
          : "Applying a plan needs the owner's confirmation of the exact plan_hash.",
      ],
      targets,
      active_offers: p.role === "customer" ? [] : await activeOffers(tx, p.storeId),
      slots: p.role === "customer" ? [] : slots.map((s) => ({ slot_id: s.slot_id, slot_kind: s.slot_kind, revision: Number(s.revision), title: s.content.title })),
    };
  });
}
