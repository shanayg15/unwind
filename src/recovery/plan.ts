import type { Principal } from "../auth/principals.js";
import { requireRole } from "../auth/principals.js";
import { readComponent, refKey, sameValue, sortRefs, valueFromJson, valueToJson, writeComponent, type ComponentRef } from "../catalog/components.js";
import type { Tx } from "../db/pool.js";
import { setActionId, withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { audit, reserveKey, storeResponse } from "../lib/idempotency.js";
import { hashOf, newId, truncate } from "../lib/util.js";
import { orderSnapshot } from "../orders/snapshot.js";
import { type DependencyWatermark, dependencyWatermark, type PromotionState, promotionState, retirePromotion, retirementFacts } from "../promotions/gift.js";
import { loadPolicy } from "./execute.js";

export type ItemStatus = "eligible" | "conflict" | "already_reverted" | "kept_by_new_decision" | "unsupported" | "unknown";

export interface PlanItem {
  change_id: string;
  component: string;
  ref: ComponentRef;
  labels: string[];
  group_id: string | null;
  status: ItemStatus;
  group_blocked: boolean;
  group_block_reason: string | null;
  recorded_after_revision: number;
  current_revision: number | null;
  recorded_after: Record<string, unknown>;
  current_value: Record<string, unknown> | null;
  inverse_value: Record<string, unknown>;
  will_write: boolean;
  note: string;
  /** Promotion items only: order-dependency watermark the plan is bound to, and the retirement facts. */
  dependency?: DependencyWatermark;
  retirement?: ReturnType<typeof retirementFacts>;
}

interface ChangeRow {
  id: string;
  rollout_id: string;
  component_type: "price" | "content" | "slot" | "promotion";
  component_id: string;
  component_key: string;
  scope_labels: string[];
  group_id: string | null;
  before_value: Record<string, unknown>;
  after_value: Record<string, unknown>;
  after_revision: string | number;
  recovery_status: "active" | "reverted";
}

async function loadChanges(tx: Tx, storeId: string, rolloutId: string, changeIds: string[]): Promise<ChangeRow[]> {
  const { rows } = await tx.query<ChangeRow>(
    `select id, rollout_id, component_type, component_id, component_key, scope_labels, group_id, before_value, after_value,
            after_revision, recovery_status
       from action_changes where store_id = $1 and rollout_id = $2 and id = any($3)`,
    [storeId, rolloutId, changeIds],
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = changeIds.filter((id) => !found.has(id));
  if (missing.length) {
    throw new UndoError("forbidden", "Selection contains change_ids that are not recorded in this rollout and store", { missing });
  }
  return rows;
}

/** Classify each selected change against current (optionally locked) state. Pure read. */
async function classify(tx: Tx, storeId: string, changes: ChangeRow[], keep: Set<string>, lock: boolean, states?: Map<string, PromotionState>): Promise<PlanItem[]> {
  const ordered = sortRefs(
    changes.map((c) => ({ c, ref: { type: c.component_type, id: c.component_id, key: c.component_key } as ComponentRef })),
  );
  const items: PlanItem[] = [];
  for (const { c, ref } of ordered) {
    const afterRev = Number(c.after_revision);
    const base = {
      change_id: c.id,
      component: refKey(ref),
      ref,
      labels: c.scope_labels,
      group_id: c.group_id,
      group_blocked: false,
      group_block_reason: null,
      recorded_after_revision: afterRev,
      recorded_after: c.after_value,
      inverse_value: c.before_value,
    };
    if (c.component_type === "promotion") {
      // Purchase-aware adapter: an experiment is retired, not value-restored. Orders that accepted the gift
      // own their units; only the campaign-held remainder is releasable. Consumption is not a conflict.
      const st = await promotionState(tx, storeId, c.component_id, lock);
      if (st && states) states.set(c.id, st);
      const cur = st ? { state: st.state, held_unallocated: st.allocation.remaining, committed_to_orders: st.committed_quantity } : null;
      const promo = { ...base, inverse_value: { state: "retired" }, current_revision: st?.revision ?? null, current_value: cur };
      if (!st) items.push({ ...promo, status: "unknown", will_write: false, note: "promotion no longer exists" });
      else if (c.recovery_status === "reverted" || st.state === "retired") items.push({ ...promo, status: "already_reverted", will_write: false, note: "experiment already retired", retirement: retirementFacts(st) });
      else if (st.revision !== afterRev) items.push({ ...promo, status: "conflict", will_write: false, note: `promotion changed after launch (revision ${afterRev} -> ${st.revision}); withheld` });
      else if (keep.has(c.id)) items.push({ ...promo, status: "kept_by_new_decision", will_write: false, note: "owner decided to keep the experiment running" });
      else
        items.push({
          ...promo,
          status: "eligible",
          will_write: true,
          note: `retire: close to new orders, release ${st.allocation.remaining} held, keep ${st.committed_quantity} committed to accepted orders`,
          dependency: dependencyWatermark(st),
          retirement: retirementFacts(st),
        });
      continue;
    }
    if (c.recovery_status === "reverted") {
      const cur = await readComponent(tx, storeId, ref, lock);
      items.push({ ...base, status: "already_reverted", current_revision: cur?.revision ?? null, current_value: cur ? valueToJson(cur.value) : null, will_write: false, note: "already restored by an earlier recovery" });
      continue;
    }
    const cur = await readComponent(tx, storeId, ref, lock);
    if (!cur) {
      items.push({ ...base, status: "unknown", current_revision: null, current_value: null, will_write: false, note: "component no longer exists" });
      continue;
    }
    const curJson = valueToJson(cur.value);
    if (cur.revision === afterRev) {
      if (keep.has(c.id)) {
        items.push({ ...base, status: "kept_by_new_decision", current_revision: cur.revision, current_value: curJson, will_write: false, note: "owner decided to keep the launch value" });
      } else {
        items.push({ ...base, status: "eligible", current_revision: cur.revision, current_value: curJson, will_write: true, note: "unchanged since launch; recorded before-value can be restored" });
      }
      continue;
    }
    const equalValue = sameValue(cur.value, valueFromJson(c.component_type, c.after_value));
    const why = equalValue
      ? `changed after launch and changed back (revision ${afterRev} -> ${cur.revision}); revision shows intervening activity`
      : `changed after launch by another writer (revision ${afterRev} -> ${cur.revision})`;
    if (keep.has(c.id)) {
      items.push({ ...base, status: "kept_by_new_decision", current_revision: cur.revision, current_value: curJson, will_write: false, note: `${why}; owner accepted the current value` });
    } else {
      items.push({ ...base, status: "conflict", current_revision: cur.revision, current_value: curJson, will_write: false, note: `${why}; withheld` });
    }
  }
  // Atomic recovery groups: one non-eligible member (or a partial selection) withholds the whole group.
  const groups = new Map<string, PlanItem[]>();
  for (const it of items) if (it.group_id) groups.set(it.group_id, [...(groups.get(it.group_id) ?? []), it]);
  for (const [gid, members] of groups) {
    const { rows } = await tx.query(`select count(*)::int as n from action_changes where store_id=$1 and group_id=$2`, [storeId, gid]);
    let reason: string | null = null;
    if (rows[0].n !== members.length) reason = "only part of an atomic recovery group was selected";
    else if (members.some((m) => m.status !== "eligible" && m.status !== "already_reverted")) reason = "a member of this atomic recovery group is not restorable";
    if (reason) {
      for (const m of members) {
        if (m.will_write) {
          m.will_write = false;
          m.group_blocked = true;
          m.group_block_reason = reason;
          m.note = `withheld: ${reason}`;
        }
      }
    }
  }
  return items;
}

export interface PreviewInput {
  rollout_id: string;
  change_ids: string[];
  keep_current_change_ids?: string[];
  intent_note?: string;
}

function planHash(storeId: string, rolloutId: string, selected: string[], keep: string[], items: PlanItem[], orderHash: string): string {
  return hashOf({
    store: storeId,
    rollout: rolloutId,
    selected: [...selected].sort(),
    keep: [...keep].sort(),
    items: items.map((i) => ({ c: i.change_id, s: i.status, r: i.current_revision, w: i.will_write, inv: i.inverse_value, d: i.dependency })),
    orders: orderHash,
  });
}

function itemSummary(i: PlanItem) {
  return {
    change_id: i.change_id,
    component: i.component,
    labels: i.labels,
    status: i.status,
    will_restore: i.will_write,
    group_blocked: i.group_blocked || undefined,
    recorded_after: shortJson(i.recorded_after),
    current: i.current_value ? shortJson(i.current_value) : null,
    restore_to: shortJson(i.inverse_value),
    recorded_after_revision: i.recorded_after_revision,
    current_revision: i.current_revision,
    note: i.note,
    ...(i.retirement ? { retirement: i.retirement } : {}),
  };
}

function shortJson(v: Record<string, unknown>): unknown {
  if ("text" in v) return { text: truncate(String(v.text), 120) };
  if ("content" in v) return { title: (v.content as { title?: string }).title };
  return v;
}

export async function undoPreview(p: Principal, input: PreviewInput): Promise<Record<string, unknown>> {
  requireRole(p, ["agent", "evaluator", "owner"], "preview recovery");
  if (!input.change_ids.length || input.change_ids.length > 50) throw new UndoError("invalid_input", "Select between 1 and 50 change_ids");
  const keep = [...new Set(input.keep_current_change_ids ?? [])];
  const selected = [...new Set(input.change_ids)];
  const stray = keep.filter((k) => !selected.includes(k));
  if (stray.length) throw new UndoError("invalid_input", "keep_current_change_ids must be a subset of change_ids", { stray });
  return withTx(async (tx) => {
    const ro = (await tx.query(`select id, state from rollouts where id=$1 and store_id=$2`, [input.rollout_id, p.storeId])).rows[0];
    if (!ro) throw new UndoError("not_found", "Rollout not found in this store");
    if (ro.state !== "executed") throw new UndoError("invalid_input", `Rollout is ${ro.state}; only executed rollouts can be recovered`);
    const policy = await loadPolicy(tx, p.storeId);
    const changes = await loadChanges(tx, p.storeId, input.rollout_id, selected);
    const items = await classify(tx, p.storeId, changes, new Set(keep), false);
    const snap = await orderSnapshot(tx, p.storeId);
    const hash = planHash(p.storeId, input.rollout_id, selected, keep, items, snap.hash);
    const planId = newId("plan");
    const { rows } = await tx.query(
      `insert into recovery_plans(id, store_id, rollout_id, selected_change_ids, keep_current_change_ids, items, plan_hash,
                                  order_snapshot_hash, order_cutoff_seq, case_id, intent_note, created_by, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + make_interval(mins => $13::int)) returning expires_at`,
      [
        planId,
        p.storeId,
        input.rollout_id,
        selected,
        keep,
        JSON.stringify(items),
        hash,
        snap.hash,
        snap.maxSeq,
        p.caseId,
        input.intent_note ? truncate(input.intent_note, 300) : null,
        p.principalId,
        policy.plan_ttl_minutes,
      ],
    );
    await audit(tx, p.storeId, p.principalId, "recovery.previewed", { plan_id: planId, plan_hash: hash, selected: selected.length });
    const counts = countBy(items);
    const conflicts = items.filter((i) => i.status === "conflict");
    const purchase = items.filter((i) => i.retirement).map((i) => ({ change_id: i.change_id, will_retire: i.will_write, ...i.retirement! }));
    const approval =
      p.role === "owner"
        ? "owner_may_apply_directly"
        : policy.recovery_grant && keep.length === 0
          ? "covered_by_standing_owner_grant"
          : "owner_confirmation_required";
    return {
      plan_id: planId,
      plan_hash: hash,
      rollout_id: input.rollout_id,
      expires_at: new Date(rows[0].expires_at).toISOString(),
      counts,
      will_restore: items.filter((i) => i.will_write).length,
      conflicts: conflicts.map(itemSummary),
      items: items.map(itemSummary),
      order_snapshot: { orders_checked: snap.count, max_order_seq: snap.maxSeq, hash: snap.hash },
      ...(purchase.length
        ? {
            purchase_dependencies: purchase,
            purchase_guarantee:
              "Accepted orders keep their gift and its committed unit (preserve_order_commitment). Only units the campaign still holds are released (release_remaining). New orders can no longer accept the offer (retire_future_use). This plan is bound to these counts: if an order arrives before apply, apply returns stale_dependency_state with a fresh plan.",
          }
        : {}),
      approval,
      mutations: "none (preview reserves nothing; apply re-checks every component and order dependency)",
      next_action:
        conflicts.length > 0
          ? "ask the owner whether to keep each conflicting current value; re-preview with keep_current_change_ids, then get owner confirmation"
          : approval === "owner_confirmation_required"
            ? "get the owner's confirmation of this plan_hash, then call undo_apply"
            : "call undo_apply with plan_id and plan_hash",
    };
  });
}

function countBy(items: PlanItem[]) {
  const c: Record<string, number> = {};
  for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
  c.group_withheld = items.filter((i) => i.group_blocked).length;
  return c;
}

export interface ApplyInput {
  plan_id: string;
  plan_hash: string;
  approval_id?: string;
  idempotency_key: string;
}

/** Test-only fault injection and barriers (never reachable from MCP input). */
export interface ApplyTestHooks {
  afterLock?: () => Promise<void>;
  failAfterRetire?: boolean;
}

class StaleDependency extends Error {
  constructor(
    public plan: { id: string; rollout_id: string; selected_change_ids: string[]; keep_current_change_ids: string[]; intent_note: string | null },
    public diffs: Array<{ change_id: string; previewed: unknown; current: unknown }>,
  ) {
    super("stale dependency state");
  }
}

export async function undoApply(p: Principal, input: ApplyInput, hooks: ApplyTestHooks = {}): Promise<Record<string, unknown>> {
  requireRole(p, ["agent", "evaluator", "owner"], "apply recovery");
  try {
    return await applyLocked(p, input, hooks);
  } catch (e) {
    if (!(e instanceof StaleDependency)) throw e;
    // The exact plan's order dependencies moved (e.g. a gift order arrived after preview). Never re-scope the
    // approval: supersede the plan, build a fresh preview from current state, and persist this outcome for the key.
    const requestHash = hashOf({ plan_id: input.plan_id, plan_hash: input.plan_hash, approval_id: input.approval_id ?? null });
    const prior = await withTx(async (tx) => {
      const { replay } = await reserveKey(tx, p.storeId, "apply", input.idempotency_key, requestHash);
      if (replay) return replay as Record<string, unknown>;
      await tx.query(`update recovery_plans set status='superseded' where id=$1 and status='open'`, [e.plan.id]);
      return null;
    });
    if (prior) return { ...prior, replayed: true };
    const fresh = await undoPreview(p, {
      rollout_id: e.plan.rollout_id,
      change_ids: e.plan.selected_change_ids,
      keep_current_change_ids: e.plan.keep_current_change_ids,
      intent_note: e.plan.intent_note ?? undefined,
    });
    const result = {
      status: "stale_dependency_state",
      code: "STALE_DEPENDENCY_STATE",
      plan_id: e.plan.id,
      message: "Order dependencies changed after preview, so this exact plan was not applied and nothing was written. A fresh plan was created from current state; it needs its own confirmation.",
      changed: e.diffs,
      fresh_plan: { plan_id: fresh.plan_id, plan_hash: fresh.plan_hash, approval: fresh.approval, purchase_dependencies: fresh.purchase_dependencies ?? [] },
      mutations: "none",
      next_action: fresh.approval === "owner_confirmation_required" ? "get the owner's confirmation of fresh_plan.plan_hash, then call undo_apply with the fresh plan" : "call undo_apply with fresh_plan.plan_id and fresh_plan.plan_hash",
    };
    await withTx((tx) => storeResponse(tx, p.storeId, "apply", input.idempotency_key, result));
    return result;
  }
}

async function applyLocked(p: Principal, input: ApplyInput, hooks: ApplyTestHooks): Promise<Record<string, unknown>> {
  const compensationActionId = newId("act");
  return withTx(
    async (tx) => {
      const requestHash = hashOf({ plan_id: input.plan_id, plan_hash: input.plan_hash, approval_id: input.approval_id ?? null });
      const { replay } = await reserveKey(tx, p.storeId, "apply", input.idempotency_key, requestHash);
      if (replay) return { ...(replay as Record<string, unknown>), replayed: true };

      const plan = (await tx.query(`select * from recovery_plans where id=$1 and store_id=$2 for update`, [input.plan_id, p.storeId])).rows[0];
      if (!plan) throw new UndoError("not_found", "Recovery plan not found in this store");
      if (plan.plan_hash !== input.plan_hash) throw new UndoError("stale_plan", "plan_hash does not match this plan", {}, "preview again");
      if (plan.status !== "open") throw new UndoError("stale_plan", `Plan is ${plan.status}; it cannot be applied twice`, {}, "use undo_verify for the earlier result");
      if (new Date(plan.expires_at).getTime() < Date.now()) {
        await tx.query(`update recovery_plans set status='expired' where id=$1`, [plan.id]);
        throw new UndoError("plan_expired", "Plan expired; preview again (an expired plan never overwrites newer edits)", {}, "preview again");
      }

      // Re-check every component and order dependency under lock (U-I9: preview reserved nothing). Locks follow
      // the global order shared with checkout: components, then promotion -> allocation -> inventory.
      const changes = await loadChanges(tx, p.storeId, plan.rollout_id, plan.selected_change_ids);
      const states = new Map<string, PromotionState>();
      const fresh = await classify(tx, p.storeId, changes, new Set(plan.keep_current_change_ids), true, states);
      const previewed = new Map<string, PlanItem>((plan.items as PlanItem[]).map((i) => [i.change_id, i]));
      if (hooks.afterLock) await hooks.afterLock();
      const moved = fresh
        .filter((it) => it.ref.type === "promotion" && previewed.get(it.change_id)?.will_write)
        .filter((it) => !it.will_write || hashOf(it.dependency ?? null) !== hashOf(previewed.get(it.change_id)?.dependency ?? null))
        .map((it) => ({ change_id: it.change_id, previewed: previewed.get(it.change_id)?.retirement ?? null, current: it.retirement ?? it.current_value }));
      if (moved.length) throw new StaleDependency(plan, moved);

      // Authorization: owner direct, an owner approval bound to this exact plan hash, or a narrow standing grant.
      const policy = await loadPolicy(tx, p.storeId);
      let authRef: string;
      if (p.role === "owner") {
        authRef = `owner_direct:${p.principalId}`;
      } else if (input.approval_id) {
        const a = (
          await tx.query(
            `select a.* from approvals a join store_memberships m on m.store_id=a.store_id and m.principal_id=a.principal_id and m.role='owner'
              where a.id=$1 and a.store_id=$2 for update of a`,
            [input.approval_id, p.storeId],
          )
        ).rows[0];
        if (!a || a.kind !== "recovery") throw new UndoError("approval_invalid", "Approval not found for this store");
        if (a.subject_id !== plan.id || a.subject_hash !== plan.plan_hash) throw new UndoError("approval_invalid", "Approval is bound to a different plan or plan_hash");
        if (a.consumed_at) throw new UndoError("approval_invalid", "Approval already consumed");
        if (a.revoked_at || new Date(a.expires_at).getTime() < Date.now()) throw new UndoError("approval_invalid", "Approval expired or revoked");
        await tx.query(`update approvals set consumed_at=now() where id=$1`, [a.id]);
        authRef = `owner_approval:${a.id}`;
      } else if (policy.recovery_grant && (plan.keep_current_change_ids as string[]).length === 0) {
        authRef = `standing_grant:${policy.recovery_grant.scope}`;
      } else {
        throw new UndoError("approval_required", "The owner must confirm this exact plan_hash before it is applied", { plan_id: plan.id }, "request_owner_approval");
      }

      const attemptId = newId("rec");
      await tx.query(`insert into actions(id, store_id, rollout_id, kind, actor, idempotency_key, request_hash) values ($1,$2,$3,'compensation',$4,$5,$6)`, [
        compensationActionId,
        p.storeId,
        plan.rollout_id,
        p.principalId,
        input.idempotency_key,
        requestHash,
      ]);
      await setActionId(tx, compensationActionId);
      const results = [];
      for (const it of fresh) {
        const before = previewed.get(it.change_id);
        const changedSincePreview = before?.will_write === true && !it.will_write;
        if (it.will_write && it.ref.type === "promotion") {
          const st = states.get(it.change_id)!;
          const r = await retirePromotion(tx, p.storeId, st, { actionId: compensationActionId, recoveryId: attemptId, actor: p.principalId, idempotencyRef: input.idempotency_key });
          if (hooks.failAfterRetire) throw new Error("injected failure after retirement writes (test hook)");
          await tx.query(`update action_changes set recovery_status='reverted', reverted_by=$2, reverted_at=now() where id=$1`, [it.change_id, attemptId]);
          results.push({
            change_id: it.change_id,
            component: it.component,
            labels: it.labels,
            outcome: "retired",
            restored_revision: r.promotion_revision,
            from_revision: it.current_revision,
            effects: r.effects,
            gift_stock_after: r.gift_stock_after,
          });
        } else if (it.will_write) {
          const value = valueFromJson(it.ref.type, it.inverse_value);
          const { revision } = await writeComponent(tx, p.storeId, it.ref, value, it.current_revision!);
          await tx.query(`update action_changes set recovery_status='reverted', reverted_by=$2, reverted_at=now() where id=$1`, [it.change_id, attemptId]);
          results.push({ change_id: it.change_id, component: it.component, labels: it.labels, outcome: "restored", restored_value: shortJson(it.inverse_value), restored_revision: revision, from_revision: it.current_revision });
        } else {
          results.push({
            change_id: it.change_id,
            component: it.component,
            labels: it.labels,
            outcome: changedSincePreview ? "withheld_changed_since_preview" : it.group_blocked ? "withheld_group" : it.status === "conflict" ? "withheld_conflict" : it.status,
            current_value: it.current_value ? shortJson(it.current_value) : null,
            current_revision: it.current_revision,
            note: changedSincePreview ? "component changed between preview and apply; not overwritten" : it.note,
          });
        }
      }
      const restored = results.filter((r) => r.outcome === "restored" || r.outcome === "retired");
      const withheld = results.filter((r) => String(r.outcome).startsWith("withheld"));
      const kept = results.filter((r) => r.outcome === "kept_by_new_decision");
      const status =
        restored.length === 0 && withheld.length > 0
          ? "blocked"
          : withheld.length > 0
            ? "partially_reverted"
            : kept.length > 0
              ? "resolved_with_exceptions"
              : "fully_reverted";
      const snap = await orderSnapshot(tx, p.storeId, Number(plan.order_cutoff_seq));
      const result = {
        status,
        recovery_id: attemptId,
        plan_id: plan.id,
        rollout_id: plan.rollout_id,
        authorization: authRef.split(":")[0],
        restored_change_ids: restored.map((r) => r.change_id),
        withheld,
        accepted_exceptions: kept.map((k) => ({ change_id: k.change_id, component: k.component, decision: "keep_current", current_value: k.current_value })),
        ...(results.some((r) => r.outcome === "retired") ? { purchase_aware: results.filter((r) => r.outcome === "retired").map((r) => ({ change_id: r.change_id, effects: r.effects, gift_stock_after: r.gift_stock_after })) } : {}),
        results,
        compensation_action_id: compensationActionId,
        order_snapshot_check: snap.hash === plan.order_snapshot_hash ? "unchanged" : "changed",
        next_action: "call undo_verify with recovery_id to confirm readback and preservation",
      };
      await tx.query(`insert into recovery_attempts(id, store_id, plan_id, status, result, authorization_ref, actor) values ($1,$2,$3,$4,$5,$6,$7)`, [
        attemptId,
        p.storeId,
        plan.id,
        status,
        JSON.stringify(result),
        authRef,
        p.principalId,
      ]);
      await tx.query(`update recovery_plans set status='applied' where id=$1`, [plan.id]);
      await audit(tx, p.storeId, p.principalId, "recovery.applied", { recovery_id: attemptId, status, restored: restored.length, withheld: withheld.length });
      await storeResponse(tx, p.storeId, "apply", input.idempotency_key, result);
      return result;
    },
    { writer: p.principalId },
  );
}
