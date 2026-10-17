import type { Principal } from "../auth/principals.js";
import { requireRole } from "../auth/principals.js";
import { readComponent, type ComponentRef, valueToJson } from "../catalog/components.js";
import { withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { truncate } from "../lib/util.js";
import { orderSnapshot } from "../orders/snapshot.js";

export interface VerifyInput {
  recovery_id?: string;
  plan_id?: string;
  rollout_id?: string;
}

function short(v: Record<string, unknown>): unknown {
  if ("text" in v) return { text: truncate(String(v.text), 100) };
  if ("content" in v) return { title: (v.content as { title?: string }).title };
  return v;
}

/** Readback-based verification. No mutation. The verdict comes from stored receipts plus current state. */
export async function undoVerify(p: Principal, input: VerifyInput): Promise<Record<string, unknown>> {
  requireRole(p, ["owner", "agent", "evaluator"], "verify recovery");
  return withTx(async (tx) => {
    let attempt;
    if (input.recovery_id) {
      attempt = (await tx.query(`select * from recovery_attempts where id=$1 and store_id=$2`, [input.recovery_id, p.storeId])).rows[0];
      if (!attempt) throw new UndoError("not_found", "Recovery not found in this store");
    } else if (input.plan_id) {
      attempt = (await tx.query(`select * from recovery_attempts where plan_id=$1 and store_id=$2 order by created_at desc limit 1`, [input.plan_id, p.storeId])).rows[0];
    } else if (input.rollout_id) {
      attempt = (
        await tx.query(
          `select a.* from recovery_attempts a join recovery_plans pl on pl.id = a.plan_id where pl.rollout_id=$1 and a.store_id=$2 order by a.created_at desc limit 1`,
          [input.rollout_id, p.storeId],
        )
      ).rows[0];
    } else {
      throw new UndoError("invalid_input", "Provide recovery_id, plan_id, or rollout_id");
    }
    if (!attempt) {
      const rid = input.rollout_id ?? (input.plan_id ? (await tx.query(`select rollout_id from recovery_plans where id=$1 and store_id=$2`, [input.plan_id, p.storeId])).rows[0]?.rollout_id : null);
      if (!rid) throw new UndoError("not_found", "Nothing to verify");
      const ch = (await tx.query(`select id, component_type, component_id, component_key, after_revision, recovery_status from action_changes where rollout_id=$1 and store_id=$2`, [rid, p.storeId])).rows;
      const states = [];
      for (const c of ch) {
        const cur = await readComponent(tx, p.storeId, { type: c.component_type, id: c.component_id, key: c.component_key });
        states.push({ change_id: c.id, component: `${c.component_type}:${c.component_id}:${c.component_key}`, recovery_status: c.recovery_status, at_launch_revision: cur?.revision === Number(c.after_revision) });
      }
      return { verdict: "no_recovery_applied", rollout_id: rid, changes: states, next_action: "preview a recovery if the owner wants changes withdrawn" };
    }
    const plan = (await tx.query(`select * from recovery_plans where id=$1`, [attempt.plan_id])).rows[0];
    const result = attempt.result as {
      status: string;
      results: Array<{ change_id: string; component: string; outcome: string; restored_revision?: number; labels: string[] }>;
      accepted_exceptions: Array<{ change_id: string; component: string }>;
      compensation_action_id: string;
    };
    const checks: Record<string, unknown>[] = [];
    let ok = true;

    // 1. Restored components: still restored, or honestly "subsequently changed".
    for (const r of result.results.filter((x) => x.outcome === "restored")) {
      const [type, id, key] = r.component.split(":");
      const cur = await readComponent(tx, p.storeId, { type: type as ComponentRef["type"], id, key });
      const same = cur?.revision === r.restored_revision;
      checks.push({
        check: "restored_component",
        change_id: r.change_id,
        component: r.component,
        restored_revision: r.restored_revision,
        current_revision: cur?.revision ?? null,
        current_value: cur ? short(valueToJson(cur.value)) : null,
        state: same ? "restored" : `recovered at revision ${r.restored_revision}; subsequently changed (now revision ${cur?.revision})`,
      });
    }
    // 2. Recovery wrote nothing outside the restored set (protects sizing, clearance, navigation, other edits).
    const writes = (
      await tx.query(`select component_type, component_id, component_key, revision_after from component_writes where store_id=$1 and action_id=$2`, [p.storeId, result.compensation_action_id])
    ).rows;
    const restoredComponents = new Set(result.results.filter((x) => x.outcome === "restored").map((x) => x.component));
    const unexpected = writes.filter((w) => !restoredComponents.has(`${w.component_type}:${w.component_id}:${w.component_key}`));
    if (unexpected.length) ok = false;
    checks.push({ check: "no_unselected_writes", passed: unexpected.length === 0, recovery_writes: writes.length, unexpected });

    // 3. Non-selected rollout changes kept their launch values (e.g. clearance price, navigation).
    const selected = new Set<string>(plan.selected_change_ids);
    const others = (
      await tx.query(`select id, component_type, component_id, component_key, scope_labels, after_revision from action_changes where rollout_id=$1 and store_id=$2`, [plan.rollout_id, p.storeId])
    ).rows.filter((c) => !selected.has(c.id));
    for (const c of others) {
      const cur = await readComponent(tx, p.storeId, { type: c.component_type, id: c.component_id, key: c.component_key });
      checks.push({
        check: "unselected_change_preserved",
        change_id: c.id,
        component: `${c.component_type}:${c.component_id}:${c.component_key}`,
        labels: c.scope_labels,
        state: cur?.revision === Number(c.after_revision) ? "launch value preserved" : `changed later by another writer (revision ${cur?.revision})`,
      });
    }
    // 4. Independent components on the same products (e.g. a later sizing correction) were not touched.
    const products = (
      await tx.query(`select distinct product_id from action_changes where id = any($1) and product_id is not null`, [plan.selected_change_ids])
    ).rows.map((r) => r.product_id);
    if (products.length) {
      const indep = (
        await tx.query(
          `select c.product_id, c.component_key, c.revision, c.value, c.last_actor, pr.sku from product_content c join products pr on pr.id = c.product_id
            where c.store_id=$1 and c.product_id = any($2) and c.component_key = 'sizing_info'`,
          [p.storeId, products],
        )
      ).rows;
      for (const s of indep) {
        const touched = writes.some((w) => w.component_type === "content" && w.component_id === s.product_id && w.component_key === "sizing_info");
        if (touched) ok = false;
        checks.push({
          check: "independent_sizing_preserved",
          product: s.sku,
          component: `content:${s.product_id}:sizing_info`,
          current_revision: Number(s.revision),
          last_writer: s.last_actor,
          current_value: truncate(s.value, 100),
          passed: !touched,
        });
      }
    }
    // 5. Order snapshots byte-identical at the plan cutoff; later orders reported separately.
    const snap = await orderSnapshot(tx, p.storeId, Number(plan.order_cutoff_seq));
    const latest = Number((await tx.query(`select coalesce(max(seq),0) as m from orders where store_id=$1`, [p.storeId])).rows[0].m);
    const ordersOk = snap.hash === plan.order_snapshot_hash;
    if (!ordersOk) ok = false;
    checks.push({
      check: "order_snapshots_unchanged",
      passed: ordersOk,
      orders_checked: snap.count,
      cutoff_order_seq: Number(plan.order_cutoff_seq),
      orders_after_cutoff: Math.max(0, latest - Number(plan.order_cutoff_seq)),
    });
    // 6. Communications linked to the case (transport state only; not agreement).
    const comms = plan.case_id
      ? (await tx.query(`select id, channel, purpose, status, provider_message_id is not null as has_provider_id from outbox_messages where case_id=$1 order by created_at`, [plan.case_id])).rows
      : [];
    const customerCases = (
      await tx.query(`select id, state from cases where store_id=$1 and role='customer' and state <> 'resolved' and rollout_id = $2`, [p.storeId, plan.rollout_id])
    ).rows;
    const pending = comms.filter((c) => ["pending", "sending", "outcome_unknown"].includes(c.status));
    return {
      verdict: ok ? "verified" : "verification_failed",
      recovery_id: attempt.id,
      recovery_status: attempt.status,
      authorization: String(attempt.authorization_ref).split(":")[0],
      rollout_id: plan.rollout_id,
      accepted_exceptions: result.accepted_exceptions,
      withheld: result.results.filter((r) => r.outcome.startsWith("withheld")).map((r) => ({ change_id: r.change_id, component: r.component, outcome: r.outcome })),
      checks,
      communications: comms.map((c) => ({ message_id: c.id, channel: c.channel, purpose: c.purpose, status: c.status })),
      open_customer_cases: customerCases.length,
      next_action: pending.length
        ? "deliver pending communications"
        : customerCases.length
          ? "answer_customer_from_verified_order"
          : "none",
      checked_at: new Date().toISOString(),
    };
  });
}
