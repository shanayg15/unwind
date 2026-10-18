import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool } from "../../src/db/pool.js";
import { undoImpact } from "../../src/impact/impact.js";
import { checkout } from "../../src/orders/checkout.js";
import { undoApply, undoPreview } from "../../src/recovery/plan.js";
import { undoVerify } from "../../src/recovery/verify.js";
import { type Actors, freshStores, key, launch } from "../helpers.js";

let a: Actors;
let rollout: Awaited<ReturnType<typeof launch>>;
afterAll(() => closePool());
beforeAll(async () => {
  a = await freshStores();
  rollout = await launch(a);
  await checkout(a.customerA, { items: [{ sku: "PRM-JKT", quantity: 1 }], idempotency_key: key("o") });
  await checkout(a.customerB, { items: [{ sku: "COR-TOT", quantity: 1 }], idempotency_key: key("o") });
  await checkout(a.customerB, { items: [{ sku: "CLR-SHT", quantity: 1 }], idempotency_key: key("o") });
});

type Imp = { orders: Array<{ order_id: string; order_seq: number }>; next_cursor: string | null; as_of: { cutoff_order_seq: number }; counts: Record<string, number> };

describe("U30 consistent impact and readback", () => {
  it("paging at a fixed cutoff returns every order exactly once", async () => {
    const full = (await undoImpact(a.agent, { rollout_id: rollout.rollout_id, limit: 25 })) as Imp;
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = (await undoImpact(a.agent, { rollout_id: rollout.rollout_id, limit: 1, cutoff_seq: full.as_of.cutoff_order_seq, cursor })) as Imp;
      expect(page.orders.length).toBeLessThanOrEqual(1);
      seen.push(...page.orders.map((o) => o.order_id));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(full.orders.map((o) => o.order_id).sort());
  });

  it("a later order does not change an as-of report; the latest report includes it", async () => {
    const before = (await undoImpact(a.agent, { rollout_id: rollout.rollout_id, limit: 25 })) as Imp;
    const later = await checkout(a.customerA, { items: [{ sku: "PRM-SHO", quantity: 1 }], idempotency_key: key("o") });
    const asOf = (await undoImpact(a.agent, { rollout_id: rollout.rollout_id, limit: 25, cutoff_seq: before.as_of.cutoff_order_seq })) as Imp;
    expect(asOf.orders.map((o) => o.order_id)).toEqual(before.orders.map((o) => o.order_id));
    expect(asOf.counts).toEqual(before.counts);
    const latest = (await undoImpact(a.agent, { rollout_id: rollout.rollout_id, limit: 25 })) as Imp;
    expect(latest.orders.map((o) => o.order_id)).toContain(later.order_id);
  });

  it("verify reports orders placed after the plan cutoff separately and keeps the snapshot check exact", async () => {
    const plan = (await undoPreview(a.owner, { rollout_id: rollout.rollout_id, labels: ["navigation"] })) as { plan_id: string; plan_hash: string };
    const rec = (await undoApply(a.owner, { plan_id: plan.plan_id, plan_hash: plan.plan_hash })) as { recovery_id: string };
    await checkout(a.customerB, { items: [{ sku: "COR-TOT", quantity: 1 }], idempotency_key: key("o") });
    const v = (await undoVerify(a.agent, { recovery_id: rec.recovery_id })) as { verdict: string; checks: Array<{ check: string; passed?: boolean; orders_after_cutoff?: number }> };
    const snap = v.checks.find((c) => c.check === "order_snapshots_unchanged")!;
    expect(snap.passed).toBe(true);
    expect(snap.orders_after_cutoff).toBe(1);
    expect(v.verdict).toBe("verified");
  });
});
