import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAsOwner } from "../../src/approvals/approvals.js";
import { operatorEdit } from "../../src/catalog/operator.js";
import { closePool, query } from "../../src/db/pool.js";
import { productId, slotId, weekendLaunchProposal } from "../../src/fixtures/demo.js";
import { undoImpact } from "../../src/impact/impact.js";
import { checkout } from "../../src/orders/checkout.js";
import { undoExecute, type Proposal } from "../../src/recovery/execute.js";
import { undoHistory } from "../../src/recovery/history.js";
import { undoApply, undoPreview } from "../../src/recovery/plan.js";
import { undoVerify } from "../../src/recovery/verify.js";
import { type Actors, component, freshStores, key, launch } from "../helpers.js";

const S = "store_demo";
const P = (k: string) => productId(S, k);

let a: Actors;
afterAll(() => closePool());

describe("UNDO engine on real Postgres (Neon test branch)", () => {
  let rollout: Awaited<ReturnType<typeof launch>>;
  let linkedOrderId: string;
  let ordersBefore: unknown;

  beforeAll(async () => {
    a = await freshStores();
  });

  it("U02 rejects a cap-breaking price and a forbidden field before any write", async () => {
    const before = (await query(`select count(*)::int n from component_writes where store_id=$1`, [S])).rows[0].n;
    const tooDeep: Proposal = { goal: "too deep", changes: [{ op: "set_price", product_id: P("jacket"), amount_minor: 8000 }] };
    await expect(undoExecute(a.agent, { proposal: tooDeep, idempotency_key: key("u02a") })).rejects.toMatchObject({ code: "policy_violation" });
    const sizing: Proposal = { goal: "edit sizing", changes: [{ op: "set_content", product_id: P("jacket"), component_key: "sizing_info", value: "x" }] };
    await expect(undoExecute(a.agent, { proposal: sizing, idempotency_key: key("u02b") })).rejects.toMatchObject({ code: "policy_violation" });
    const dup: Proposal = {
      goal: "dup",
      changes: [
        { op: "set_price", product_id: P("jacket"), amount_minor: 11000 },
        { op: "set_price", product_id: P("jacket"), amount_minor: 10900 },
      ],
    };
    await expect(undoExecute(a.agent, { proposal: dup, idempotency_key: key("u02c") })).rejects.toMatchObject({ code: "policy_violation" });
    const after = (await query(`select count(*)::int n from component_writes where store_id=$1`, [S])).rows[0].n;
    expect(after).toBe(before);
  });

  it("execute requires the owner's approval of the exact proposal hash", async () => {
    const proposal = weekendLaunchProposal(S) as unknown as Proposal;
    const proposed = (await undoExecute(a.agent, { proposal, idempotency_key: key("noapr") })) as { rollout_id: string; proposal_hash: string };
    await expect(undoExecute(a.agent, { rollout_id: proposed.rollout_id, proposal_hash: proposed.proposal_hash, idempotency_key: key("noapr-x") })).rejects.toMatchObject({
      code: "approval_required",
    });
    await expect(undoExecute(a.agent, { rollout_id: proposed.rollout_id, proposal_hash: "f".repeat(64), idempotency_key: key("badhash") })).rejects.toMatchObject({
      code: "approval_invalid",
    });
  });

  it("U03 a failure mid-write leaves no partial, unjournaled mutation", async () => {
    const proposal = weekendLaunchProposal(S) as unknown as Proposal;
    const proposed = (await undoExecute(a.agent, { proposal, idempotency_key: key("u03p") })) as { rollout_id: string; proposal_hash: string };
    await approveAsOwner(a.owner.principalId, S, "launch", proposed.rollout_id, proposed.proposal_hash, "test");
    const writesBefore = (await query(`select count(*)::int n from component_writes where store_id=$1`, [S])).rows[0].n;
    await expect(
      undoExecute(a.agent, { rollout_id: proposed.rollout_id, proposal_hash: proposed.proposal_hash, idempotency_key: key("u03x") }, { failAfterWrites: 3 }),
    ).rejects.toThrow(/injected failure/);
    expect((await component(S, "price", P("jacket"))).amount_minor).toBe(12000);
    expect((await query(`select count(*)::int n from component_writes where store_id=$1`, [S])).rows[0].n).toBe(writesBefore);
    expect((await query(`select count(*)::int n from action_changes where rollout_id=$1`, [proposed.rollout_id])).rows[0].n).toBe(0);
    expect((await query(`select state from rollouts where id=$1`, [proposed.rollout_id])).rows[0].state).toBe("approved");
  });

  it("U01 an approved, capped launch commits exact mutations with journal rows", async () => {
    rollout = await launch(a);
    expect(rollout.status).toBe("executed");
    expect(rollout.changes).toHaveLength(15);
    expect((await component(S, "price", P("jacket"))).amount_minor).toBe(10800);
    expect((await component(S, "price", P("shirt"))).amount_minor).toBe(4000);
    const journal = (await query(`select count(*)::int n from component_writes where store_id=$1 and action_id = (select id from actions where rollout_id=$2)`, [S, rollout.rollout_id])).rows[0].n;
    expect(journal).toBe(15);
    for (const c of rollout.changes) expect(c.after_revision).toBeGreaterThan(1);
  });

  it("U09/U10 duplicate execute key replays; same key with a different body conflicts", async () => {
    const proposal: Proposal = { goal: "small", changes: [{ op: "set_price", product_id: P("tote"), amount_minor: 3000 }] };
    const k = key("u10");
    const first = await undoExecute(a.agent, { proposal, idempotency_key: k });
    const again = await undoExecute(a.agent, { proposal, idempotency_key: k });
    expect(again).toEqual(first);
    const other: Proposal = { goal: "small", changes: [{ op: "set_price", product_id: P("tote"), amount_minor: 2900 }] };
    await expect(undoExecute(a.agent, { proposal: other, idempotency_key: k })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("captures order provenance; operator edits bump independent revisions", async () => {
    const linked = (await checkout(a.customerA, { items: [{ sku: "PRM-JKT", quantity: 1 }], idempotency_key: key("ord-a") })) as { order_id: string; total_minor: number };
    linkedOrderId = linked.order_id;
    expect(linked.total_minor).toBe(10800);
    await checkout(a.customerB, { items: [{ sku: "COR-TOT", quantity: 2 }], idempotency_key: key("ord-b") });
    const sizing = await component(S, "sizing", P("jacket"));
    await operatorEdit(a.operator, { sku: "PRM-JKT", component: "sizing_info", text: "Runs small: size up if between sizes. Model is 6'0\" wearing L.", expected_revision: sizing.revision, idempotency_key: key("op-size") });
    const shoe = await component(S, "price", P("shoes"));
    await operatorEdit(a.operator, { sku: "PRM-SHO", component: "price", amount_minor: 13900, expected_revision: shoe.revision, idempotency_key: key("op-shoe") });
    const sw = await component(S, "promo", P("sweater"));
    const launchCopy = sw.value;
    const away = (await operatorEdit(a.operator, { sku: "PRM-KNT", component: "promotional_copy", text: "temporary edit", expected_revision: sw.revision, idempotency_key: key("op-away") })) as { revision: number };
    await operatorEdit(a.operator, { sku: "PRM-KNT", component: "promotional_copy", text: launchCopy, expected_revision: away.revision, idempotency_key: key("op-back") });
    const line = (await query(`select source_change_id, source_rollout_id, unit_amount_minor from order_lines where order_id=$1`, [linkedOrderId])).rows[0];
    expect(line.source_rollout_id).toBe(rollout.rollout_id);
    expect(line.unit_amount_minor).toBe(10800);
    ordersBefore = (await query(`select o.*, l.* from orders o join order_lines l on l.order_id=o.id where o.store_id=$1 order by o.seq, l.id`, [S])).rows;
  });

  it("U22-shape: a fresh agent discovers the rollout from history alone", async () => {
    const h = (await undoHistory(a.agent, { state: "executed" })) as { rollouts: Array<{ rollout_id: string; changes: Array<{ change_id: string; labels: string[] }> }> };
    expect(h.rollouts[0].rollout_id).toBe(rollout.rollout_id);
    expect(h.rollouts[0].changes.filter((c) => c.labels.includes("premium")).length).toBe(9);
  });

  let premiumIds: string[];
  let shoeChange: string;
  let sweaterCopyChange: string;
  let packPriceChange: string;

  it("U04/U06/U07 preview: premium eligible; later shoe price and change-away-and-back are conflicts", async () => {
    premiumIds = rollout.changes.filter((c) => c.labels.includes("premium")).map((c) => c.change_id);
    shoeChange = rollout.changes.find((c) => c.component === `price:${P("shoes")}:price`)!.change_id;
    sweaterCopyChange = rollout.changes.find((c) => c.component === `content:${P("sweater")}:promotional_copy`)!.change_id;
    packPriceChange = rollout.changes.find((c) => c.component === `price:${P("pack")}:price`)!.change_id;
    const prev = (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: premiumIds })) as {
      items: Array<{ change_id: string; status: string; labels: string[] }>;
      counts: Record<string, number>;
    };
    expect(prev.items.every((i) => i.labels.includes("premium"))).toBe(true);
    const status = Object.fromEntries(prev.items.map((i) => [i.change_id, i.status]));
    expect(status[shoeChange]).toBe("conflict");
    expect(status[sweaterCopyChange]).toBe("conflict");
    expect(prev.counts.eligible).toBe(7);
  });

  it("U27/U28 impact: direct link from checkout provenance; unrelated and unknown are not attributed", async () => {
    const imp = (await undoImpact(a.agent, { rollout_id: rollout.rollout_id, change_ids: premiumIds })) as {
      counts: Record<string, number>;
      orders: Array<{ order_id: string; classification: string }>;
    };
    expect(imp.counts.direct_price_revision).toBe(1);
    expect(imp.counts.temporal_only).toBe(1);
    expect(imp.counts.unknown_provenance).toBe(1);
    expect(imp.orders.find((o) => o.order_id === linkedOrderId)?.classification).toBe("direct_price_revision");
  });

  it("U29 customers see only their own order", async () => {
    const mine = (await undoImpact(a.customerB, { rollout_id: rollout.rollout_id })) as { orders: Array<{ order_id: string }>; viewer: string };
    expect(mine.viewer).toBe("customer");
    expect(mine.orders.map((o) => o.order_id)).not.toContain(linkedOrderId);
    await expect(undoHistory(a.customerA, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(undoPreview(a.customerA, { rollout_id: rollout.rollout_id, change_ids: premiumIds })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("U14 cross-store: the eval store's evaluator cannot see or select demo changes", async () => {
    const h = (await undoHistory(a.evaluator, {})) as { rollouts: unknown[] };
    expect(h.rollouts).toHaveLength(0);
    await expect(undoPreview(a.evaluator, { rollout_id: rollout.rollout_id, change_ids: premiumIds })).rejects.toMatchObject({ code: "not_found" });
  });

  let recoveryId: string;

  it("U16 apply needs the owner's confirmation of this exact plan hash", async () => {
    const prev = (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: premiumIds, keep_current_change_ids: [shoeChange] })) as { plan_id: string; plan_hash: string };
    await expect(undoApply(a.agent, { plan_id: prev.plan_id, plan_hash: prev.plan_hash, idempotency_key: key("noauth") })).rejects.toMatchObject({ code: "approval_required" });
    const other = (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: [premiumIds[0]] })) as { plan_id: string; plan_hash: string };
    const wrongApproval = await approveAsOwner(a.owner.principalId, S, "recovery", other.plan_id, other.plan_hash, "test");
    await expect(undoApply(a.agent, { plan_id: prev.plan_id, plan_hash: prev.plan_hash, approval_id: wrongApproval, idempotency_key: key("forged") })).rejects.toMatchObject({
      code: "approval_invalid",
    });
  });

  it("U08 a write between preview and apply is not overwritten", async () => {
    const prev = (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: premiumIds, keep_current_change_ids: [shoeChange] })) as { plan_id: string; plan_hash: string };
    const pack = await component(S, "price", P("pack"));
    await operatorEdit(a.operator, { sku: "PRM-PCK", component: "price", amount_minor: 7400, expected_revision: pack.revision, idempotency_key: key("op-pack") });
    const approval = await approveAsOwner(a.owner.principalId, S, "recovery", prev.plan_id, prev.plan_hash, "test");
    const k = key("apply");
    const res = (await undoApply(a.agent, { plan_id: prev.plan_id, plan_hash: prev.plan_hash, approval_id: approval, idempotency_key: k })) as {
      status: string;
      recovery_id: string;
      results: Array<{ change_id: string; outcome: string }>;
      accepted_exceptions: Array<{ change_id: string }>;
    };
    recoveryId = res.recovery_id;
    const outcome = Object.fromEntries(res.results.map((r) => [r.change_id, r.outcome]));
    expect(outcome[packPriceChange]).toBe("withheld_changed_since_preview");
    expect((await component(S, "price", P("pack"))).amount_minor).toBe(7400);
    expect(outcome[shoeChange]).toBe("kept_by_new_decision");
    expect(outcome[sweaterCopyChange]).toBe("withheld_conflict");
    expect(res.status).toBe("partially_reverted");
    // U09: replaying the same apply key returns the stored result with no second effect.
    const replay = (await undoApply(a.agent, { plan_id: prev.plan_id, plan_hash: prev.plan_hash, approval_id: approval, idempotency_key: k })) as { recovery_id: string; replayed: boolean };
    expect(replay.recovery_id).toBe(recoveryId);
    expect(replay.replayed).toBe(true);
  });

  it("U05/U26/U11 exact restoration with new revisions; sizing edit and orders untouched", async () => {
    const jp = await component(S, "price", P("jacket"));
    expect(jp.amount_minor).toBe(12000);
    const jc = await component(S, "promo", P("jacket"));
    expect(jc.value).toBe("Our lightest storm shell for three-season trails.");
    const js = await component(S, "sizing", P("jacket"));
    expect(js.value).toMatch(/Runs small/);
    expect(js.last_actor).toBe("pr_operator");
    expect((await component(S, "price", P("shoes"))).amount_minor).toBe(13900);
    expect((await component(S, "price", P("shirt"))).amount_minor).toBe(4000);
    const nav = (await query(`select content from store_slots where slot_id=$1`, [slotId(S, "navigation")])).rows[0].content;
    expect(nav.items).toHaveLength(4);
    const home = (await query(`select content from store_slots where slot_id=$1`, [slotId(S, "premium_home")])).rows[0].content;
    expect(home.title).toBe("New season essentials");
    const ordersAfter = (await query(`select o.*, l.* from orders o join order_lines l on l.order_id=o.id where o.store_id=$1 order by o.seq, l.id`, [S])).rows;
    expect(ordersAfter).toEqual(ordersBefore);
  });

  it("verify derives its verdict from receipts plus readback", async () => {
    const v = (await undoVerify(a.agent, { recovery_id: recoveryId })) as { verdict: string; checks: Array<{ check: string; passed?: boolean; state?: string }> };
    expect(v.verdict).toBe("verified");
    expect(v.checks.find((c) => c.check === "independent_sizing_preserved")?.passed).toBe(true);
    expect(v.checks.find((c) => c.check === "order_snapshots_unchanged")?.passed).toBe(true);
    expect(v.checks.filter((c) => c.check === "unselected_change_preserved").every((c) => c.state === "launch value preserved")).toBe(true);
    // U30: an edit after recovery is reported honestly.
    const jp = await component(S, "price", P("jacket"));
    await operatorEdit(a.operator, { sku: "PRM-JKT", component: "price", amount_minor: 11900, expected_revision: jp.revision, idempotency_key: key("post") });
    const v2 = (await undoVerify(a.agent, { recovery_id: recoveryId })) as { checks: Array<{ check: string; component?: string; state?: string }> };
    expect(v2.checks.find((c) => c.check === "restored_component" && c.component === `price:${P("jacket")}:price`)?.state).toMatch(/subsequently changed/);
  });

  it("U12 an atomic group with one conflicting member is withheld as a whole", async () => {
    a = await freshStores();
    const proposal: Proposal = {
      goal: "bundle",
      changes: [
        { op: "set_price", product_id: P("pack"), amount_minor: 7200, atomic_group: "pack-bundle" },
        { op: "set_content", product_id: P("pack"), component_key: "promotional_copy", value: "Bundle: pack 10% off", atomic_group: "pack-bundle" },
      ],
    };
    const ro = await launch(a, proposal);
    const price = await component(S, "price", P("pack"));
    await operatorEdit(a.operator, { sku: "PRM-PCK", component: "price", amount_minor: 7300, expected_revision: price.revision, idempotency_key: key("grp") });
    const prev = (await undoPreview(a.owner, { rollout_id: ro.rollout_id, change_ids: ro.changes.map((c) => c.change_id) })) as { plan_id: string; plan_hash: string; items: Array<{ status: string; will_restore: boolean }> };
    expect(prev.items.some((i) => i.will_restore)).toBe(false);
    const res = (await undoApply(a.owner, { plan_id: prev.plan_id, plan_hash: prev.plan_hash, idempotency_key: key("grp-apply") })) as { status: string };
    expect(res.status).toBe("blocked");
    expect((await component(S, "promo", P("pack"))).value).toBe("Bundle: pack 10% off");
  });

  it("U13 owner-accepted exception yields resolved_with_exceptions, distinct from full restoration", async () => {
    a = await freshStores();
    const ro = await launch(a);
    const shoe = await component(S, "price", P("shoes"));
    await operatorEdit(a.operator, { sku: "PRM-SHO", component: "price", amount_minor: 13900, expected_revision: shoe.revision, idempotency_key: key("u13") });
    const ids = ro.changes.filter((c) => c.labels.includes("premium")).map((c) => c.change_id);
    const shoeId = ro.changes.find((c) => c.component === `price:${P("shoes")}:price`)!.change_id;
    const prev = (await undoPreview(a.owner, { rollout_id: ro.rollout_id, change_ids: ids, keep_current_change_ids: [shoeId] })) as { plan_id: string; plan_hash: string };
    const res = (await undoApply(a.owner, { plan_id: prev.plan_id, plan_hash: prev.plan_hash, idempotency_key: key("u13a") })) as { status: string; accepted_exceptions: unknown[] };
    expect(res.status).toBe("resolved_with_exceptions");
    expect(res.accepted_exceptions).toHaveLength(1);
    await expect(undoApply(a.owner, { plan_id: prev.plan_id, plan_hash: prev.plan_hash, idempotency_key: key("u13b") })).rejects.toMatchObject({ code: "stale_plan" });
  });

  it("database rejects writes that bypass the journaled writer and edits to history/orders", async () => {
    await expect(query(`update product_prices set amount_minor = 1 where store_id=$1`, [S])).rejects.toThrow(/undo.writer unset/);
    await expect(query(`update order_lines set unit_amount_minor = 1 where store_id=$1`, [S])).rejects.toThrow(/immutable/);
    await expect(query(`update action_changes set before_value='{}' where store_id=$1`, [S])).rejects.toThrow(/immutable/);
    await expect(query(`delete from audit_events where store_id=$1`, [S])).rejects.toThrow(/append-only/);
  });
});
