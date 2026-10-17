import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveViaCode, createApprovalRequest } from "../../src/approvals/approvals.js";
import { openCase } from "../../src/cases/cases.js";
import { operatorEdit } from "../../src/catalog/operator.js";
import { closePool, query, withTx } from "../../src/db/pool.js";
import { productId } from "../../src/fixtures/demo.js";
import { undoApply, undoPreview } from "../../src/recovery/plan.js";
import { type Actors, component, freshStores, key, launch } from "../helpers.js";

const S = "store_demo";
let a: Actors;
afterAll(() => closePool());

async function premiumPlan(rollout: Awaited<ReturnType<typeof launch>>) {
  const ids = rollout.changes.filter((c) => c.labels.includes("premium")).map((c) => c.change_id);
  return (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: ids })) as { plan_id: string; plan_hash: string };
}

describe("reply-to-approve (U16, U18, U31)", () => {
  let rollout: Awaited<ReturnType<typeof launch>>;
  let caseId: string;
  beforeAll(async () => {
    a = await freshStores();
    rollout = await launch(a);
    caseId = (await openCase(S, "owner", "pr_owner", "imessage", "conv_test")).id;
  });

  it("ignores ordinary text and rejects a wrong code", async () => {
    const plan = await premiumPlan(rollout);
    const req = await withTx((tx) => createApprovalRequest(tx, S, "recovery", plan.plan_id, caseId, 30, "imessage"));
    expect(await approveViaCode(caseId, "pr_owner", "Keep $139. Restore the rest.")).toEqual({ matched: false });
    const wrong = req.code === "1234" ? "4321" : "1234";
    const bad = await approveViaCode(caseId, "pr_owner", `YES ${wrong}`);
    expect(bad).toMatchObject({ matched: true, ok: false });
    expect((await query(`select count(*)::int n from approvals where subject_id=$1`, [plan.plan_id])).rows[0].n).toBe(0);
  });

  it("only the owner principal can approve; a customer reply with the right code is refused", async () => {
    const plan = await premiumPlan(rollout);
    const req = await withTx((tx) => createApprovalRequest(tx, S, "recovery", plan.plan_id, caseId, 30, "imessage"));
    const res = await approveViaCode(caseId, "pr_customer_a", `yes ${req.code}`);
    expect(res).toMatchObject({ matched: true, ok: false, reason: "only the store owner can approve" });
  });

  it("an old code cannot approve a newer plan (out-of-order reply)", async () => {
    const first = await premiumPlan(rollout);
    const oldReq = await withTx((tx) => createApprovalRequest(tx, S, "recovery", first.plan_id, caseId, 30, "imessage"));
    const second = await premiumPlan(rollout);
    const newReq = await withTx((tx) => createApprovalRequest(tx, S, "recovery", second.plan_id, caseId, 30, "imessage"));
    if (oldReq.code !== newReq.code) {
      const stale = await approveViaCode(caseId, "pr_owner", `YES ${oldReq.code}`);
      expect(stale).toMatchObject({ matched: true, ok: false });
    }
    expect((await query(`select count(*)::int n from approvals where subject_id=$1`, [first.plan_id])).rows[0].n).toBe(0);
  });

  it("a plan that changed after the code was sent is not approved", async () => {
    const plan = await premiumPlan(rollout);
    const req = await withTx((tx) => createApprovalRequest(tx, S, "recovery", plan.plan_id, caseId, 30, "imessage"));
    await query(`update recovery_plans set expires_at = now() - interval '1 minute' where id=$1`, [plan.plan_id]);
    const res = await approveViaCode(caseId, "pr_owner", `YES ${req.code}`);
    expect(res).toMatchObject({ matched: true, ok: false });
  });

  it("the current code from the owner approves exactly that plan once, and apply consumes it", async () => {
    const shoe = await component(S, "price", productId(S, "shoes"));
    await operatorEdit(a.operator, { sku: "PRM-SHO", component: "price", amount_minor: 13900, expected_revision: shoe.revision, idempotency_key: key("op") });
    const shoeId = rollout.changes.find((c) => c.component === `price:${productId(S, "shoes")}:price`)!.change_id;
    const ids = rollout.changes.filter((c) => c.labels.includes("premium")).map((c) => c.change_id);
    const plan = (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: ids, keep_current_change_ids: [shoeId] })) as { plan_id: string; plan_hash: string };
    const req = await withTx((tx) => createApprovalRequest(tx, S, "recovery", plan.plan_id, caseId, 30, "imessage"));
    const ok = await approveViaCode(caseId, "pr_owner", `Yes ${req.code} thanks`);
    expect(ok).toMatchObject({ matched: true, ok: true, decision: "approve" });
    const again = await approveViaCode(caseId, "pr_owner", `YES ${req.code}`);
    expect(again).toMatchObject({ matched: true, ok: false });
    const approvalId = (ok as { approvalId: string }).approvalId;
    const res = (await undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: approvalId, idempotency_key: key("apply") })) as { status: string };
    expect(res.status).toBe("resolved_with_exceptions");
    const via = (await query(`select decided_via, consumed_at from approvals where id=$1`, [approvalId])).rows[0];
    expect(via.decided_via).toBe("owner_text_code");
    expect(via.consumed_at).not.toBeNull();
  });

  it("NO <code> declines without creating an approval", async () => {
    const plan = await premiumPlan(rollout);
    const req = await withTx((tx) => createApprovalRequest(tx, S, "recovery", plan.plan_id, caseId, 30, "imessage"));
    const res = await approveViaCode(caseId, "pr_owner", `no ${req.code}`);
    expect(res).toMatchObject({ matched: true, ok: true, decision: "reject", approvalId: null });
  });
});
