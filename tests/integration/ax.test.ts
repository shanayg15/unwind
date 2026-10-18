import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAsOwner } from "../../src/approvals/approvals.js";
import { closePool, query } from "../../src/db/pool.js";
import { pouchExperimentProposal } from "../../src/fixtures/demo.js";
import { undoExecute, type Proposal } from "../../src/recovery/execute.js";
import { undoHistory } from "../../src/recovery/history.js";
import { undoApply, undoPreview } from "../../src/recovery/plan.js";
import { type Actors, freshStores, key, launch } from "../helpers.js";

// Agent experience: fewer exact ids to copy, safe defaults, deterministic resolution (U26 discoverability).
const S = "store_demo";
let a: Actors;
let weekend: Awaited<ReturnType<typeof launch>>;
afterAll(() => closePool());
beforeAll(async () => {
  a = await freshStores();
  weekend = await launch(a);
});

type Plan = { plan_id: string; plan_hash: string; selection: { by: string; change_ids: string[]; rollout_inferred: boolean } };

describe("U26 agent-friendly selection", () => {
  it("labels select exactly the recorded changes carrying them; all_changes selects the whole rollout", async () => {
    const byLabel = (await undoPreview(a.agent, { rollout_id: weekend.rollout_id, labels: ["premium"] })) as unknown as Plan;
    const expected = weekend.changes.filter((c) => c.labels.includes("premium")).map((c) => c.change_id).sort();
    expect([...byLabel.selection.change_ids].sort()).toEqual(expected);
    expect(byLabel.selection.by).toBe("labels");
    const all = (await undoPreview(a.agent, { rollout_id: weekend.rollout_id, all_changes: true })) as unknown as Plan;
    expect(all.selection.change_ids).toHaveLength(weekend.changes.length);
  });

  it("the rollout is inferred only when exactly one is recoverable", async () => {
    const p = (await undoPreview(a.agent, { labels: ["clearance"] })) as unknown as Plan;
    expect(p.selection.rollout_inferred).toBe(true);
    await launch(a, pouchExperimentProposal(S) as unknown as Proposal);
    await expect(undoPreview(a.agent, { labels: ["premium"] })).rejects.toMatchObject({ code: "invalid_input", details: { candidates: expect.any(Array) } });
  });

  it("bad selections fail with a usable hint", async () => {
    await expect(undoPreview(a.agent, { rollout_id: weekend.rollout_id, labels: ["summer"] })).rejects.toMatchObject({ code: "invalid_input", details: { known_labels: expect.arrayContaining(["premium", "clearance"]) } });
    await expect(undoPreview(a.agent, { rollout_id: weekend.rollout_id, labels: ["premium"], all_changes: true })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(undoPreview(a.agent, { rollout_id: weekend.rollout_id })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("history summarizes labels and points to the next call", async () => {
    const h = (await undoHistory(a.agent, { rollout_id: weekend.rollout_id })) as { rollouts: Array<{ label_summary: Record<string, number>; recoverable_changes: number }>; next_action: string };
    expect(h.rollouts[0].label_summary.premium).toBe(weekend.changes.filter((c) => c.labels.includes("premium")).length);
    expect(h.next_action).toMatch(/labels/);
  });
});

describe("U26 safe default idempotency", () => {
  it("apply without a key applies once; the same call again replays the stored outcome", async () => {
    const plan = (await undoPreview(a.agent, { rollout_id: weekend.rollout_id, labels: ["navigation"] })) as unknown as Plan;
    const appr = await approveAsOwner("pr_owner", S, "recovery", plan.plan_id, plan.plan_hash, "test_owner_session");
    const first = await undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr });
    const again = await undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr });
    expect(again).toMatchObject({ replayed: true, recovery_id: first.recovery_id });
    expect((await query(`select count(*)::int n from recovery_attempts where plan_id=$1`, [plan.plan_id])).rows[0].n).toBe(1);
  });

  it("proposing the same rollout twice without a key records it once", async () => {
    const proposal = { goal: "Tote copy refresh", changes: [{ op: "set_content", product_id: "prd_demo_tote", component_key: "promotional_copy", value: "Canvas tote, now in natural." }] } as unknown as Proposal;
    const one = (await undoExecute(a.agent, { proposal })) as { rollout_id: string };
    const two = (await undoExecute(a.agent, { proposal })) as { rollout_id: string };
    expect(two.rollout_id).toBe(one.rollout_id);
    expect(key("x")).toBeTruthy();
  });
});
