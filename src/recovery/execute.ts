import { z } from "zod";
import type { Principal } from "../auth/principals.js";
import { requireRole } from "../auth/principals.js";
import {
  type ComponentRef,
  type ComponentValue,
  readComponent,
  refKey,
  SlotContent,
  sortRefs,
  valueToJson,
  writeComponent,
} from "../catalog/components.js";
import { StorePolicy } from "../catalog/policy.js";
import type { Tx } from "../db/pool.js";
import { setActionId, withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { audit, reserveKey, storeResponse } from "../lib/idempotency.js";
import { formatMoney, hashOf, newId } from "../lib/util.js";

export const ProposalChange = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set_price"),
    product_id: z.string().max(40),
    amount_minor: z.number().int().positive().max(10_000_000),
    group: z.string().max(40).optional(),
  }),
  z.object({
    op: z.literal("set_content"),
    product_id: z.string().max(40),
    component_key: z.enum(["promotional_copy", "sizing_info"]),
    value: z.string().min(1).max(2000),
    group: z.string().max(40).optional(),
  }),
  z.object({
    op: z.literal("set_slot"),
    slot_id: z.string().max(40),
    content: SlotContent,
    group: z.string().max(40).optional(),
  }),
]);
export type ProposalChange = z.infer<typeof ProposalChange>;

export const Proposal = z.object({
  goal: z.string().min(3).max(300),
  changes: z.array(ProposalChange).min(1).max(50),
});
export type Proposal = z.infer<typeof Proposal>;

interface NormalizedChange {
  ref: ComponentRef;
  value: ComponentValue;
  observed_revision: number;
  observed_value: Record<string, unknown>;
  scope_labels: string[];
  group: string | null;
  product_id: string | null;
  check: string;
  discount_pct: number | null;
}

export async function loadPolicy(tx: Tx, storeId: string): Promise<StorePolicy> {
  const { rows } = await tx.query(`select policy from stores where id = $1`, [storeId]);
  if (!rows[0]) throw new UndoError("not_found", "Store not found");
  return StorePolicy.parse(rows[0].policy);
}

function refFor(c: ProposalChange): ComponentRef {
  if (c.op === "set_price") return { type: "price", id: c.product_id, key: "price" };
  if (c.op === "set_content") return { type: "content", id: c.product_id, key: c.component_key };
  return { type: "slot", id: c.slot_id, key: "" };
}

/** Validate a proposal against current state and store policy. Throws before any write (U02). */
async function normalize(tx: Tx, storeId: string, policy: StorePolicy, proposal: Proposal, lock: boolean): Promise<NormalizedChange[]> {
  if (proposal.changes.length > policy.max_targets) {
    throw new UndoError("limit_exceeded", `A rollout may change at most ${policy.max_targets} components`);
  }
  const out: NormalizedChange[] = [];
  const seen = new Set<string>();
  // Resolve slot kinds first so refs are complete before locking in a stable order.
  const pending: { change: ProposalChange; ref: ComponentRef }[] = [];
  for (const change of proposal.changes) {
    const ref = refFor(change);
    if (ref.type === "slot") {
      const { rows } = await tx.query(`select slot_kind from store_slots where store_id=$1 and slot_id=$2`, [storeId, ref.id]);
      if (!rows[0]) throw new UndoError("not_found", `Unknown slot ${ref.id}`, { slot_id: ref.id });
      ref.key = rows[0].slot_kind;
    }
    const k = refKey(ref);
    if (seen.has(k)) {
      throw new UndoError("policy_violation", "A rollout may change each component at most once", { component: k });
    }
    seen.add(k);
    pending.push({ change, ref });
  }
  for (const { change, ref } of sortRefs(pending.map((p) => ({ ...p, ref: p.ref })))) {
    const cur = await readComponent(tx, storeId, ref, lock);
    if (!cur) throw new UndoError("not_found", `Unknown component ${refKey(ref)}`, { component: refKey(ref) });
    let value: ComponentValue;
    let check = "allowed";
    let discount: number | null = null;
    const labels: string[] = [];
    if (change.op === "set_price") {
      if (cur.value.kind !== "price") throw new UndoError("internal", "price component mismatch");
      const before = cur.value.amount_minor;
      const after = change.amount_minor;
      const discountPct = ((before - after) / before) * 100;
      const cap = policy.max_discount_pct[cur.collection ?? ""] ?? 0;
      if (after < policy.min_price_minor) {
        throw new UndoError("policy_violation", `Price ${formatMoney(after)} is below the store floor ${formatMoney(policy.min_price_minor)}`, {
          product_id: ref.id,
        });
      }
      if (discountPct > cap + 1e-9) {
        throw new UndoError("policy_violation", `Discount ${discountPct.toFixed(1)}% exceeds the ${cur.collection} cap of ${cap}%`, {
          product_id: ref.id,
          discount_pct: Number(discountPct.toFixed(2)),
          cap_pct: cap,
        });
      }
      if (-discountPct > policy.max_increase_pct + 1e-9) {
        throw new UndoError("policy_violation", `Price increase exceeds ${policy.max_increase_pct}%`, { product_id: ref.id });
      }
      value = { kind: "price", amount_minor: after, currency: cur.value.currency };
      check = `discount ${discountPct.toFixed(1)}% within ${cur.collection} cap ${cap}%`;
      discount = discountPct;
      labels.push(cur.collection ?? "unknown", "price");
    } else if (change.op === "set_content") {
      if (!policy.rollout_content_keys.includes(change.component_key)) {
        throw new UndoError("policy_violation", `Rollouts may not change ${change.component_key}`, {
          product_id: ref.id,
          component_key: change.component_key,
        });
      }
      value = { kind: "text", text: change.value };
      labels.push(cur.collection ?? "unknown", change.component_key);
    } else {
      value = { kind: "slot", content: change.content };
      const kind = ref.key;
      labels.push(kind === "premium_home" ? "premium" : kind === "clearance_home" ? "clearance" : "navigation", "placement", kind);
    }
    out.push({
      ref,
      value,
      observed_revision: cur.revision,
      observed_value: valueToJson(cur.value),
      scope_labels: labels,
      group: change.group ?? null,
      product_id: cur.productId,
      check,
      discount_pct: discount,
    });
  }
  return out;
}

export interface ExecuteInput {
  proposal?: Proposal;
  rollout_id?: string;
  proposal_hash?: string;
  idempotency_key: string;
}

/** Test-only fault injection for U03 (never reachable from MCP input). */
export interface ExecuteTestHooks {
  failAfterWrites?: number;
}

export async function undoExecute(p: Principal, input: ExecuteInput, hooks: ExecuteTestHooks = {}): Promise<Record<string, unknown>> {
  requireRole(p, ["agent", "evaluator", "owner"], "execute rollouts");
  if (input.proposal && !input.rollout_id) return propose(p, input.proposal, input.idempotency_key);
  if (input.rollout_id && input.proposal_hash) return run(p, input.rollout_id, input.proposal_hash, input.idempotency_key, hooks);
  throw new UndoError("invalid_input", "Provide either {proposal} to create a rollout, or {rollout_id, proposal_hash} to execute an approved one");
}

async function propose(p: Principal, proposal: Proposal, key: string) {
  const parsed = Proposal.parse(proposal);
  return withTx(async (tx) => {
    const requestHash = hashOf({ proposal: parsed });
    const { replay } = await reserveKey(tx, p.storeId, "execute.propose", key, requestHash);
    if (replay) return replay as Record<string, unknown>;
    const policy = await loadPolicy(tx, p.storeId);
    const changes = await normalize(tx, p.storeId, policy, parsed, false);
    const reviewRequired = changes.some((c) => (c.discount_pct ?? 0) > policy.review_threshold_pct);
    const stored = {
      goal: parsed.goal,
      changes: changes.map((c) => ({
        component: c.ref,
        value: valueToJson(c.value),
        observed_revision: c.observed_revision,
        observed_value: c.observed_value,
        scope_labels: c.scope_labels,
        group: c.group,
        product_id: c.product_id,
        check: c.check,
      })),
    };
    const proposalHash = hashOf({ store: p.storeId, ...stored });
    const rolloutId = newId("ro");
    const ownerProposed = p.role === "owner";
    await tx.query(
      `insert into rollouts(id, store_id, goal, proposal, proposal_hash, state, needs_review, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [rolloutId, p.storeId, parsed.goal, JSON.stringify(stored), proposalHash, ownerProposed ? "approved" : "awaiting_approval", reviewRequired, p.principalId],
    );
    await audit(tx, p.storeId, p.principalId, "rollout.proposed", { rollout_id: rolloutId, proposal_hash: proposalHash });
    const result = {
      status: ownerProposed ? "approved_by_owner" : "needs_owner_approval",
      rollout_id: rolloutId,
      proposal_hash: proposalHash,
      review_required: reviewRequired,
      checks: stored.changes.map((c) => ({ component: refKey(c.component), check: c.check, labels: c.scope_labels })),
      next_action: ownerProposed
        ? "call undo_execute with {rollout_id, proposal_hash, idempotency_key}"
        : "owner must approve this exact proposal_hash in the owner console; then call undo_execute with {rollout_id, proposal_hash, idempotency_key}",
    };
    await storeResponse(tx, p.storeId, "execute.propose", key, result);
    return result;
  });
}

async function run(p: Principal, rolloutId: string, proposalHash: string, key: string, hooks: ExecuteTestHooks) {
  const actionId = newId("act");
  return withTx(
    async (tx) => {
      const requestHash = hashOf({ rollout_id: rolloutId, proposal_hash: proposalHash });
      const { replay } = await reserveKey(tx, p.storeId, "execute.run", key, requestHash);
      if (replay) return { ...(replay as Record<string, unknown>), replayed: true };

      const { rows } = await tx.query(`select * from rollouts where id = $1 and store_id = $2 for update`, [rolloutId, p.storeId]);
      const ro = rows[0];
      if (!ro) throw new UndoError("not_found", "Rollout not found in this store");
      if (ro.proposal_hash !== proposalHash) throw new UndoError("approval_invalid", "proposal_hash does not match the recorded proposal");
      if (ro.state === "executed") throw new UndoError("invalid_input", "Rollout already executed; use undo_history for its receipt", { rollout_id: rolloutId });
      if (ro.state === "rejected") throw new UndoError("forbidden", "Rollout was rejected");

      let approvalId: string | null = null;
      if (p.role !== "owner") {
        const appr = await tx.query(
          `select id from approvals where store_id=$1 and kind='launch' and subject_id=$2 and subject_hash=$3
              and consumed_at is null and revoked_at is null and expires_at > now() order by created_at desc limit 1 for update`,
          [p.storeId, rolloutId, proposalHash],
        );
        if (!appr.rows[0]) {
          throw new UndoError("approval_required", "Owner has not approved this exact proposal", { rollout_id: rolloutId, proposal_hash: proposalHash }, "ask_owner_to_approve");
        }
        approvalId = appr.rows[0].id;
      }

      const policy = await loadPolicy(tx, p.storeId);
      const recorded = ro.proposal as { goal: string; changes: Array<{ component: ComponentRef; value: Record<string, unknown>; observed_revision: number; scope_labels: string[]; group: string | null }> };
      // Re-validate the same proposal against current, locked state (caps stay enforced at execution).
      const reproposal: Proposal = {
        goal: recorded.goal,
        changes: recorded.changes.map((c) =>
          c.component.type === "price"
            ? { op: "set_price" as const, product_id: c.component.id, amount_minor: Number(c.value.amount_minor), group: c.group ?? undefined }
            : c.component.type === "content"
              ? { op: "set_content" as const, product_id: c.component.id, component_key: c.component.key as "promotional_copy", value: String(c.value.text), group: c.group ?? undefined }
              : { op: "set_slot" as const, slot_id: c.component.id, content: SlotContent.parse(c.value.content), group: c.group ?? undefined },
        ),
      };
      const current = await normalize(tx, p.storeId, policy, reproposal, true);
      const stale = current.filter((c) => {
        const rec = recorded.changes.find((r) => refKey(r.component) === refKey(c.ref));
        return !rec || rec.observed_revision !== c.observed_revision;
      });
      if (stale.length) {
        return { status: "replan_required", rollout_id: rolloutId, stale_components: stale.map((s) => refKey(s.ref)), next_action: "create a new proposal from current state" };
      }

      await tx.query(`insert into actions(id, store_id, rollout_id, kind, actor, idempotency_key, request_hash) values ($1,$2,$3,'rollout',$4,$5,$6)`, [
        actionId,
        p.storeId,
        rolloutId,
        p.principalId,
        key,
        requestHash,
      ]);
      await setActionId(tx, actionId);
      const groupIds = new Map<string, string>();
      const changes: Record<string, unknown>[] = [];
      let writes = 0;
      for (const c of current) {
        const { revision } = await writeComponent(tx, p.storeId, c.ref, c.value, c.observed_revision);
        writes++;
        if (hooks.failAfterWrites !== undefined && writes >= hooks.failAfterWrites) {
          throw new Error("injected failure after write (test hook)");
        }
        const changeId = newId("chg");
        let groupId: string | null = null;
        if (c.group) {
          if (!groupIds.has(c.group)) groupIds.set(c.group, newId("grp"));
          groupId = groupIds.get(c.group)!;
        }
        await tx.query(
          `insert into action_changes(id, action_id, rollout_id, store_id, component_type, component_id, component_key, product_id,
                                      scope_labels, group_id, before_value, after_value, before_revision, after_revision)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            changeId,
            actionId,
            rolloutId,
            p.storeId,
            c.ref.type,
            c.ref.id,
            c.ref.key,
            c.product_id,
            c.scope_labels,
            groupId,
            JSON.stringify(c.observed_value),
            JSON.stringify(valueToJson(c.value)),
            c.observed_revision,
            revision,
          ],
        );
        changes.push({
          change_id: changeId,
          component: refKey(c.ref),
          labels: c.scope_labels,
          group_id: groupId,
          before: c.observed_value,
          after: valueToJson(c.value),
          before_revision: c.observed_revision,
          after_revision: revision,
        });
      }
      await tx.query(`update rollouts set state='executed', executed_at=now(), approval_id=$2 where id=$1`, [rolloutId, approvalId]);
      if (approvalId) await tx.query(`update approvals set consumed_at = now() where id = $1`, [approvalId]);
      await audit(tx, p.storeId, p.principalId, "rollout.executed", { rollout_id: rolloutId, action_id: actionId, changes: changes.length });
      const result = {
        status: "executed",
        rollout_id: rolloutId,
        action_id: actionId,
        authorized_by: approvalId ? { approval_id: approvalId } : { owner_principal: p.principalId },
        change_count: changes.length,
        changes,
        reversibility: "Each recorded change can be previewed for recovery while its component is still at after_revision.",
      };
      await storeResponse(tx, p.storeId, "execute.run", key, result);
      return result;
    },
    { writer: p.principalId },
  );
}
