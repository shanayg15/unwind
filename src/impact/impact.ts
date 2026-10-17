import type { Principal } from "../auth/principals.js";
import { requireRole } from "../auth/principals.js";
import { withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { formatMoney, hashOf, newId } from "../lib/util.js";

export interface ImpactInput {
  rollout_id?: string;
  change_ids?: string[];
  plan_id?: string;
  cutoff_seq?: number;
  cursor?: string;
  limit?: number;
}

const CLAIMS_BOUNDARY =
  "direct_price_revision means the order line captured a price revision written by a selected rollout change at checkout. " +
  "temporal_only means the order happened after the rollout with no captured link; it is not attributed to the rollout. " +
  "unknown_provenance means the order has no captured price revision. No claim is made about who saw the campaign, marketing causation, revenue, or margin.";

type OrderClass = "direct_price_revision" | "linked_unselected_change" | "temporal_only" | "unknown_provenance";

/** Read-only order impact from captured checkout provenance (F4, U27-U30). Never sends messages or mutates orders. */
export async function undoImpact(p: Principal, input: ImpactInput): Promise<Record<string, unknown>> {
  if (p.role === "customer") return customerView(p);
  requireRole(p, ["owner", "agent", "evaluator"], "query order impact");
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  return withTx(async (tx) => {
    let rolloutId = input.rollout_id;
    let selected = input.change_ids;
    if (input.plan_id) {
      const plan = (await tx.query(`select rollout_id, selected_change_ids from recovery_plans where id=$1 and store_id=$2`, [input.plan_id, p.storeId])).rows[0];
      if (!plan) throw new UndoError("not_found", "Recovery plan not found in this store");
      rolloutId = plan.rollout_id;
      selected = plan.selected_change_ids;
    }
    if (!rolloutId) throw new UndoError("invalid_input", "Provide plan_id, or rollout_id with optional change_ids");
    const ro = (await tx.query(`select id, executed_at, state from rollouts where id=$1 and store_id=$2`, [rolloutId, p.storeId])).rows[0];
    if (!ro) throw new UndoError("not_found", "Rollout not found in this store");
    if (!ro.executed_at) throw new UndoError("invalid_input", "Rollout has not executed; it has no order impact");
    const changes = (
      await tx.query(`select id, component_type, component_id, scope_labels from action_changes where rollout_id=$1 and store_id=$2`, [rolloutId, p.storeId])
    ).rows;
    const allIds = new Set(changes.map((c) => c.id));
    if (selected) {
      const stray = selected.filter((s) => !allIds.has(s));
      if (stray.length) throw new UndoError("forbidden", "change_ids not recorded in this rollout", { stray });
    }
    const selectedSet = new Set(selected ?? changes.map((c) => c.id));
    const selectedPrice = changes.filter((c) => c.component_type === "price" && selectedSet.has(c.id)).map((c) => c.id);
    const maxSeq = Number((await tx.query(`select coalesce(max(seq),0) as m from orders where store_id=$1`, [p.storeId])).rows[0].m);
    const cutoff = Math.min(input.cutoff_seq ?? maxSeq, maxSeq);
    const { rows } = await tx.query(
      `select o.id, o.seq, o.status, o.total_minor, o.currency, o.created_at, o.is_test, o.customer_principal_id,
              json_agg(json_build_object('sku', l.sku, 'q', l.quantity, 'u', l.unit_amount_minor, 'rev', l.source_price_revision,
                                         'chg', l.source_change_id, 'ro', l.source_rollout_id) order by l.id) as lines
         from orders o join order_lines l on l.order_id = o.id
        where o.store_id = $1 and o.seq <= $2
          and (o.created_at >= $3 or l.source_rollout_id = $4 or l.source_price_revision is null)
        group by o.id order by o.seq`,
      [p.storeId, cutoff, ro.executed_at, rolloutId],
    );
    const classified = rows.map((o) => {
      const lines = o.lines as Array<{ sku: string; q: number; u: number; rev: number | null; chg: string | null; ro: string | null }>;
      let cls: OrderClass;
      if (lines.some((l) => l.chg && selectedPrice.includes(l.chg))) cls = "direct_price_revision";
      else if (lines.some((l) => l.ro === rolloutId)) cls = "linked_unselected_change";
      else if (lines.some((l) => l.rev === null)) cls = "unknown_provenance";
      else cls = "temporal_only";
      return { o, lines, cls };
    });
    const counts: Record<OrderClass, number> = { direct_price_revision: 0, linked_unselected_change: 0, temporal_only: 0, unknown_provenance: 0 };
    for (const c of classified) counts[c.cls]++;
    const start = input.cursor ? Number(/^s_(\d+)$/.exec(input.cursor)?.[1] ?? NaN) : 0;
    if (Number.isNaN(start)) throw new UndoError("invalid_input", "Bad cursor");
    const page = classified.filter((c) => Number(c.o.seq) > start).slice(0, limit);
    const customerIds = [...new Set(page.map((c) => c.o.customer_principal_id).filter(Boolean))];
    const comms = customerIds.length
      ? (await tx.query(`select id, principal_id, channel, state from cases where store_id=$1 and role='customer' and principal_id = any($2)`, [p.storeId, customerIds])).rows
      : [];
    const orders = page.map(({ o, lines, cls }) => ({
      order_id: o.id,
      order_seq: Number(o.seq),
      created_at: new Date(o.created_at).toISOString(),
      status: o.status,
      test_order: o.is_test,
      total: formatMoney(o.total_minor),
      classification: cls,
      wording:
        cls === "direct_price_revision"
          ? "used a price from this rollout"
          : cls === "linked_unselected_change"
            ? "used a price from a rollout change outside this selection"
            : cls === "temporal_only"
              ? "placed during the rollout period; no captured price link (not attributed)"
              : "no captured price provenance; unknown",
      lines: lines.map((l) => ({ sku: l.sku, quantity: l.q, unit: formatMoney(l.u), price_revision: l.rev, source_change_id: l.chg })),
      communication_refs: comms.filter((c) => c.principal_id === o.customer_principal_id).map((c) => ({ case_id: c.id, channel: c.channel, state: c.state })),
    }));
    const lastSeq = page.length ? page[page.length - 1].o.seq : null;
    const hasMore = lastSeq !== null && classified.some((c) => Number(c.o.seq) > Number(lastSeq));
    const reportId = newId("imp");
    const selectionHash = hashOf({ rolloutId, selected: [...selectedSet].sort() });
    const report = { counts, cutoff_seq: cutoff, order_ids: classified.map((c) => c.o.id), classes: Object.fromEntries(classified.map((c) => [c.o.id, c.cls])) };
    await tx.query(
      `insert into impact_reports(id, store_id, rollout_id, selection_hash, cutoff_seq, viewer_role, report, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [reportId, p.storeId, rolloutId, selectionHash, cutoff, p.role, JSON.stringify(report), p.principalId],
    );
    return {
      impact_report_id: reportId,
      rollout_id: rolloutId,
      selection: { change_ids: [...selectedSet].length, price_change_ids: selectedPrice },
      as_of: { cutoff_order_seq: cutoff, latest_order_seq: maxSeq, generated_at: new Date().toISOString() },
      coverage: `${classified.length} orders examined at or before order_seq ${cutoff} (orders after the rollout, plus any linked to it or lacking provenance)`,
      counts,
      orders,
      next_cursor: hasMore ? `s_${lastSeq}` : null,
      claims_boundary: CLAIMS_BOUNDARY,
      mutations: "none; no messages sent",
    };
  });
}

/** A customer sees only their own authorized orders, never store-wide impact or other customers. */
async function customerView(p: Principal): Promise<Record<string, unknown>> {
  return withTx(async (tx) => {
    const { rows } = await tx.query(
      `select o.id, o.status, o.total_minor, o.created_at, o.is_test,
              json_agg(json_build_object('sku', l.sku, 'title', pr.title, 'q', l.quantity, 'u', l.unit_amount_minor) order by l.id) as lines
         from order_access_grants g join orders o on o.id = g.order_id
         join order_lines l on l.order_id = o.id join products pr on pr.id = l.product_id
        where g.store_id = $1 and g.customer_principal_id = $2 and g.revoked_at is null and g.expires_at > now()
        group by o.id order by o.created_at desc limit 5`,
      [p.storeId, p.principalId],
    );
    return {
      viewer: "customer",
      scope: "your own test orders only",
      orders: rows.map((o) => ({
        order_id: o.id,
        status: o.status,
        label: o.is_test ? "Test order; no payment processed" : "order",
        total: formatMoney(o.total_minor),
        placed_at: new Date(o.created_at).toISOString(),
        lines: (o.lines as Array<{ sku: string; title: string; q: number; u: number }>).map((l) => ({ item: l.title, quantity: l.q, unit_price: formatMoney(l.u) })),
        note: "Order amounts are immutable snapshots; later catalog changes do not alter them.",
      })),
      mutations: "none",
    };
  });
}
