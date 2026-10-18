import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { approveAsOwner } from "../../src/approvals/approvals.js";
import { openCase } from "../../src/cases/cases.js";
import { operatorEdit } from "../../src/catalog/operator.js";
import { enqueueCaseMessage } from "../../src/comms/outbox.js";
import { closePool, query, withTx } from "../../src/db/pool.js";
import { pouchExperimentProposal, productId } from "../../src/fixtures/demo.js";
import { undoImpact } from "../../src/impact/impact.js";
import { checkout } from "../../src/orders/checkout.js";
import { orderSnapshot } from "../../src/orders/snapshot.js";
import { pickList, stockAccounting } from "../../src/promotions/gift.js";
import { undoExecute, type Proposal } from "../../src/recovery/execute.js";
import { undoApply, undoPreview } from "../../src/recovery/plan.js";
import { undoVerify } from "../../src/recovery/verify.js";
import { type Actors, component, freshStores, key, launch } from "../helpers.js";

// Purchase-aware rollback (addendum PA01-PA11). Every count below is read back from the database.
const S = "store_demo";
const POUCH = productId(S, "pouch");
let a: Actors;
let rollout: Awaited<ReturnType<typeof launch>>;

afterAll(() => closePool());

const stock = async (pid = POUCH) => (await query(`select on_hand, held, committed, on_hand - held - committed as available from inventory where store_id=$1 and product_id=$2`, [S, pid])).rows[0];
const offer = async () => (await query(`select id as promotion_id, terms_hash from promotions where store_id=$1 and state='active' and gift_product_id=$2`, [S, POUCH])).rows[0] as { promotion_id: string; terms_hash: string };
const allocation = async () => (await query(`select a.* from campaign_allocations a join promotions p on p.id=a.promotion_id where p.store_id=$1 and p.gift_product_id=$2 order by a.created_at desc limit 1`, [S, POUCH])).rows[0];
const releaseMoves = async (allocId: string) => (await query(`select count(*)::int n, coalesce(sum(quantity),0)::int q from inventory_moves where allocation_id=$1 and kind='release_remaining'`, [allocId])).rows[0];
const entitlements = async () => (await query(`select * from order_entitlements where store_id=$1 order by id`, [S])).rows;
const books = () => withTx((tx) => stockAccounting(tx, S));

async function giftOrder(customer = a.customerA, sku = "PRM-JKT", acc?: { promotion_id: string; terms_hash: string }) {
  return checkout(customer, { items: [{ sku, quantity: 1 }], accept_offer: acc ?? (await offer()), idempotency_key: key("ord") });
}

async function retirementPlan() {
  const ids = rollout.changes.map((c) => c.change_id);
  return (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: ids, intent_note: "Stop the free-pouch experiment" })) as {
    plan_id: string;
    plan_hash: string;
    purchase_dependencies: Array<{ initially_allocated: number; committed_to_accepted_orders: number; held_unallocated: number; releasable_on_apply: number; accepted_order_ids: string[] }>;
  };
}

async function approveAndApply(plan: { plan_id: string; plan_hash: string }, idem = key("apply")) {
  const appr = await approveAsOwner("pr_owner", S, "recovery", plan.plan_id, plan.plan_hash, "test_owner_session");
  return (await undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr, idempotency_key: idem })) as Record<string, any>;
}

beforeEach(async () => {
  a = await freshStores();
  rollout = await launch(a, pouchExperimentProposal(S) as unknown as Proposal);
});

describe("PA01 reserve -> accepted orders -> retire (computed counts)", () => {
  it("10 held -> 4 committed + 6 held -> 4 committed + 6 available", async () => {
    expect(rollout.status).toBe("executed");
    expect(await stock()).toMatchObject({ on_hand: 10, held: 10, committed: 0, available: 0 });
    const orders = [];
    for (const c of [a.customerA, a.customerA, a.customerB, a.customerB]) orders.push(await giftOrder(c));
    expect(orders.every((o) => (o.gift as { state: string }).state === "included and allocated in this accepted order")).toBe(true);
    const mid = await stock();
    expect(mid).toMatchObject({ on_hand: 10, held: 6, committed: 4, available: 0 });
    const plan = await retirementPlan();
    expect(plan.purchase_dependencies[0]).toMatchObject({ initially_allocated: 10, committed_to_accepted_orders: 4, held_unallocated: 6, releasable_on_apply: 6 });
    expect(plan.purchase_dependencies[0].accepted_order_ids.sort()).toEqual(orders.map((o) => o.order_id as string).sort());
    const res = await approveAndApply(plan);
    expect(res.status).toBe("fully_reverted");
    const eff = res.purchase_aware[0].effects as Array<{ label: string; quantity?: number }>;
    expect(eff.map((e) => e.label)).toEqual(["retire_future_use", "release_remaining", "preserve_order_commitment"]);
    expect(eff.find((e) => e.label === "release_remaining")!.quantity).toBe(mid.held);
    expect(eff.find((e) => e.label === "preserve_order_commitment")!.quantity).toBe(mid.committed);
    const after = await stock();
    expect(after).toMatchObject({ on_hand: 10, held: 0, committed: mid.committed, available: 10 - mid.committed });
    // Presentation recovered through the existing journal.
    expect((await component(S, "promo", productId(S, "pack"))).value).toBe("A day pack with a weatherproof shell.");
    const v = (await undoVerify(a.agent, { recovery_id: res.recovery_id })) as { verdict: string; checks: Array<{ check: string; passed?: boolean }> };
    expect(v.verdict).toBe("verified");
    for (const c of ["future_eligibility_closed", "remaining_allocation_released_once", "order_commitments_preserved", "stock_accounting_reconciles", "fulfillment_lists_promised_gifts"]) {
      expect(v.checks.find((x) => x.check === c)?.passed, c).toBe(true);
    }
    expect((await books()).every((b) => b.balanced)).toBe(true);
  });
});

describe("PA02 / PA03 immutable orders and fulfillment readback", () => {
  it("order contents, gift terms and amounts are byte-identical; the pick list still has every pouch", async () => {
    for (const c of [a.customerA, a.customerA, a.customerB, a.customerB]) await giftOrder(c);
    const before = await withTx((tx) => orderSnapshot(tx, S));
    const entsBefore = await entitlements();
    expect(entsBefore).toHaveLength(4);
    expect(entsBefore.every((e) => e.unit_amount_minor === 0 && e.quantity === 1 && e.gift_sku === "COR-PCH")).toBe(true);
    await approveAndApply(await retirementPlan());
    const after = await withTx((tx) => orderSnapshot(tx, S, before.maxSeq));
    expect(after.hash).toBe(before.hash);
    expect(await entitlements()).toEqual(entsBefore);
    const picks = (await withTx((tx) => pickList(tx, S))).flatMap((o) => o.pick.filter((x) => x.sku === "COR-PCH" && x.kind.startsWith("gift")));
    expect(picks).toHaveLength(4);
    expect(picks.every((p) => "terms" in p && String(p.terms).includes("One free Packable Travel Pouch"))).toBe(true);
  });
});

describe("PA04 checkout after retirement", () => {
  it("a stale accepted offer gets OFFER_CHANGED_RECONFIRM; ordinary orders still work from released stock", async () => {
    await giftOrder();
    const seen = await offer(); // customer saw the offer before it ended
    await approveAndApply(await retirementPlan());
    const orders = (await query(`select count(*)::int n from orders where store_id=$1`, [S])).rows[0].n;
    await expect(giftOrder(a.customerB, "PRM-SHO", seen)).rejects.toMatchObject({ code: "offer_changed_reconfirm" });
    expect((await query(`select count(*)::int n from orders where store_id=$1`, [S])).rows[0].n).toBe(orders);
    const plain = await checkout(a.customerB, { items: [{ sku: "PRM-SHO", quantity: 1 }], idempotency_key: key("ord") });
    expect(plain.gift).toBeNull();
    const before = await stock();
    await checkout(a.customerB, { items: [{ sku: "COR-PCH", quantity: 1 }], idempotency_key: key("ord") });
    expect(await stock()).toMatchObject({ committed: before.committed + 1, available: before.available - 1, held: 0 });
  });

  it("changed terms or an exhausted cap also ask to reconfirm instead of silently dropping the gift", async () => {
    const o = await offer();
    await expect(giftOrder(a.customerA, "PRM-JKT", { ...o, terms_hash: "0".repeat(64) })).rejects.toMatchObject({ code: "offer_changed_reconfirm" });
    for (let i = 0; i < 10; i++) await giftOrder(i % 2 ? a.customerA : a.customerB);
    await expect(giftOrder()).rejects.toMatchObject({ code: "offer_changed_reconfirm" });
    expect(await stock()).toMatchObject({ held: 0, committed: 10, available: 0 });
  });
});

describe("PA05 an order wins the race (dependency changed after preview)", () => {
  it("sequential: the stale plan writes nothing; a fresh plan reflects 5 committed / 5 released", async () => {
    for (let i = 0; i < 4; i++) await giftOrder(i % 2 ? a.customerA : a.customerB);
    const plan = await retirementPlan();
    await giftOrder(a.customerB, "PRM-KNT"); // fifth order arrives between preview and apply
    const appr = await approveAsOwner("pr_owner", S, "recovery", plan.plan_id, plan.plan_hash, "test_owner_session");
    const stale = (await undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr, idempotency_key: key("apply") })) as Record<string, any>;
    expect(stale).toMatchObject({ status: "stale_dependency_state", code: "STALE_DEPENDENCY_STATE", mutations: "none" });
    expect(stale.fresh_plan.purchase_dependencies[0]).toMatchObject({ committed_to_accepted_orders: 5, held_unallocated: 5, releasable_on_apply: 5 });
    expect(await stock()).toMatchObject({ held: 5, committed: 5 });
    expect((await query(`select status from recovery_plans where id=$1`, [plan.plan_id])).rows[0].status).toBe("superseded");
    expect((await query(`select consumed_at from approvals where id=$1`, [appr])).rows[0].consumed_at).toBeNull();
    await expect(undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr, idempotency_key: key("apply") })).rejects.toMatchObject({ code: "stale_plan" });
    const res = await approveAndApply(stale.fresh_plan);
    expect(res.status).toBe("fully_reverted");
    expect(await stock()).toMatchObject({ held: 0, committed: 5, available: 5 });
  });

  it("barrier: a checkout holding the offer lock commits first; apply then sees it and refuses the stale plan", async () => {
    await giftOrder();
    const plan = await retirementPlan();
    const appr = await approveAsOwner("pr_owner", S, "recovery", plan.plan_id, plan.plan_hash, "test_owner_session");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const locked = new Promise<void>((r) => (held = r));
    const co = checkout(a.customerB, { items: [{ sku: "PRM-SHO", quantity: 1 }], accept_offer: await offer(), idempotency_key: key("ord") }, { afterLock: async () => (held(), gate) });
    await locked;
    const ap = undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr, idempotency_key: key("apply") });
    await new Promise((r) => setTimeout(r, 400));
    release();
    const [order, applied] = await Promise.all([co, ap]);
    expect((order.gift as { state: string }).state).toMatch(/included/);
    expect(applied.status).toBe("stale_dependency_state");
    expect(await stock()).toMatchObject({ held: 8, committed: 2 });
  });
});

describe("PA06 retirement wins the race", () => {
  it("barrier: a checkout waiting on the offer lock cannot draw from the released allocation", async () => {
    await giftOrder();
    const plan = await retirementPlan();
    const appr = await approveAsOwner("pr_owner", S, "recovery", plan.plan_id, plan.plan_hash, "test_owner_session");
    const acc = await offer();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const locked = new Promise<void>((r) => (held = r));
    const ap = undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr, idempotency_key: key("apply") }, { afterLock: async () => (held(), gate) });
    await locked;
    const co = checkout(a.customerB, { items: [{ sku: "PRM-SHO", quantity: 1 }], accept_offer: acc, idempotency_key: key("ord") }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 400));
    release();
    const [applied, order] = await Promise.all([ap, co]);
    expect(applied.status).toBe("fully_reverted");
    expect(order).toMatchObject({ code: "offer_changed_reconfirm" });
    expect(await entitlements()).toHaveLength(1);
    expect(await stock()).toMatchObject({ held: 0, committed: 1, available: 9 });
  });
});

describe("PA07 repeated retirement and message retry", () => {
  it("releases once; replays return the persisted outcome; a message retry cannot release again", async () => {
    for (let i = 0; i < 4; i++) await giftOrder();
    const plan = await retirementPlan();
    const idem = key("apply");
    const first = await approveAndApply(plan, idem);
    const replay = (await undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: "unused", idempotency_key: idem }).catch((e) => e)) as Record<string, any>;
    // Same key + different body is rejected; same key + same body replays.
    expect(replay.code ?? replay.status).toBe("idempotency_conflict");
    const appr = (await query(`select id from approvals where subject_id=$1`, [plan.plan_id])).rows[0].id;
    const same = (await undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr, idempotency_key: idem })) as Record<string, any>;
    expect(same).toMatchObject({ replayed: true, recovery_id: first.recovery_id });
    await expect(undoApply(a.agent, { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr, idempotency_key: key("apply") })).rejects.toMatchObject({ code: "stale_plan" });
    const again = (await retirementPlan()) as unknown as { will_restore: number; purchase_dependencies: Array<{ will_retire: boolean; releasable_on_apply: number }> };
    expect(again.purchase_dependencies[0]).toMatchObject({ will_retire: false, releasable_on_apply: 0 });
    const c = await openCase(S, "owner", "pr_owner", "imessage", `conv_${key("t")}`);
    process.env.LIVE_SEND_ENABLED = "true";
    process.env.MAX_LIVE_MESSAGES = "100000";
    const m1 = await enqueueCaseMessage(c, { purpose: "completion_summary", body: "Experiment stopped.", triggerEventId: "evt_retry_test" });
    const m2 = await enqueueCaseMessage(c, { purpose: "completion_summary", body: "Experiment stopped.", triggerEventId: "evt_retry_test" });
    expect(m2).toMatchObject({ duplicate: true, outbox_id: m1.outbox_id });
    const alloc = await allocation();
    expect(await releaseMoves(alloc.id)).toEqual({ n: 1, q: 6 });
    expect(await stock()).toMatchObject({ held: 0, committed: 4, available: 6 });
  });
});

describe("PA08 unrelated stock activity", () => {
  it("another campaign's allocation and ordinary commitments stay; the books reconcile", async () => {
    const tote = productId(S, "tote");
    const other = await launch(a, {
      goal: "Tote gift with clearance orders",
      changes: [{ op: "start_gift_promotion", gift_product_id: tote, qualifying_collection: "clearance", cap: 3, title: "Free tote", terms: "One free Canvas Market Tote with any clearance order while 3 last." }],
    } as unknown as Proposal);
    expect(other.status).toBe("executed");
    const toteOffer = (await query(`select id as promotion_id, terms_hash from promotions where gift_product_id=$1 and state='active'`, [tote])).rows[0];
    await checkout(a.customerB, { items: [{ sku: "CLR-SHT", quantity: 1 }], accept_offer: toteOffer, idempotency_key: key("ord") });
    await checkout(a.customerB, { items: [{ sku: "COR-TOT", quantity: 2 }], idempotency_key: key("ord") });
    for (let i = 0; i < 2; i++) await giftOrder();
    const toteBefore = await stock(tote);
    await approveAndApply(await retirementPlan());
    expect(await stock(tote)).toEqual(toteBefore);
    expect((await query(`select a.remaining_quantity, a.state from campaign_allocations a join promotions p on p.id=a.promotion_id where p.gift_product_id=$1`, [tote])).rows[0]).toEqual({ remaining_quantity: 2, state: "holding" });
    expect(await stock()).toMatchObject({ held: 0, committed: 2, available: 8 });
    const b = await books();
    expect(b.filter((x) => !x.balanced)).toEqual([]);
    expect(b.find((x) => x.sku === "COR-TOT")).toMatchObject({ held: 2, owners: { held_by_allocations: 2 } });
  });
});

describe("PA09 crash and response timeout", () => {
  it("a failure after the retirement writes rolls back everything; the retry applies exactly once", async () => {
    for (let i = 0; i < 3; i++) await giftOrder();
    const plan = await retirementPlan();
    const appr = await approveAsOwner("pr_owner", S, "recovery", plan.plan_id, plan.plan_hash, "test_owner_session");
    const idem = key("apply");
    const input = { plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: appr, idempotency_key: idem };
    await expect(undoApply(a.agent, input, { failAfterRetire: true })).rejects.toThrow(/injected failure/);
    const alloc = await allocation();
    expect(alloc).toMatchObject({ remaining_quantity: 7, state: "holding" });
    expect(await releaseMoves(alloc.id)).toEqual({ n: 0, q: 0 });
    expect((await query(`select state from promotions where id=$1`, [alloc.promotion_id])).rows[0].state).toBe("active");
    expect((await query(`select count(*)::int n from recovery_attempts where plan_id=$1`, [plan.plan_id])).rows[0].n).toBe(0);
    const ok = (await undoApply(a.agent, input)) as Record<string, any>;
    expect(ok.status).toBe("fully_reverted");
    const timeoutRetry = (await undoApply(a.agent, input)) as Record<string, any>;
    expect(timeoutRetry).toMatchObject({ replayed: true, recovery_id: ok.recovery_id });
    expect(await releaseMoves(alloc.id)).toEqual({ n: 1, q: 7 });
  });
});

describe("PA11 scope and authorization bypass", () => {
  it("committed stock and gift entitlements cannot be released or altered outside the protocol", async () => {
    await giftOrder();
    const alloc = await allocation();
    const sql = async (q: string, writer = true) =>
      withTx(async (tx) => {
        if (writer) await tx.query(`select set_config('undo.writer','attacker',true)`);
        await tx.query(q);
      });
    await expect(sql(`update order_entitlements set quantity = 0 where store_id='${S}'`)).rejects.toThrow(/immutable/);
    await expect(sql(`delete from order_entitlements where store_id='${S}'`)).rejects.toThrow(/immutable/);
    await expect(sql(`update inventory set committed = 0 where product_id='${POUCH}'`, false)).rejects.toThrow(/UNDO writer/);
    await expect(sql(`update campaign_allocations set remaining_quantity = remaining_quantity + 1 where id='${alloc.id}'`)).rejects.toThrow(/only decrease/);
    await expect(sql(`update inventory_moves set quantity = 99 where allocation_id='${alloc.id}'`)).rejects.toThrow(/append-only/);
    await expect(sql(`update promotions set cap = 50 where id='${alloc.promotion_id}'`)).rejects.toThrow(/immutable/);
    await approveAndApply(await retirementPlan());
    await expect(sql(`update promotions set state='active' where id='${alloc.promotion_id}'`)).rejects.toThrow(/cannot be changed/);
    expect(await stock()).toMatchObject({ committed: 1, held: 0 });
  });

  it("customers cannot preview, apply, or see other orders; setup cannot over-allocate; non-qualifying carts get no gift", async () => {
    await giftOrder(a.customerB);
    await expect(undoPreview(a.customerA, { rollout_id: rollout.rollout_id, change_ids: [rollout.changes[0].change_id] })).rejects.toMatchObject({ code: "forbidden" });
    const mine = (await undoImpact(a.customerA, {})) as { orders: unknown[] };
    expect(mine.orders).toHaveLength(0);
    await expect(checkout(a.customerA, { items: [{ sku: "COR-TOT", quantity: 1 }], accept_offer: await offer(), idempotency_key: key("ord") })).rejects.toMatchObject({ code: "policy_violation" });
    await expect(
      undoExecute(a.agent, {
        proposal: { goal: "Too many gifts", changes: [{ op: "start_gift_promotion", gift_product_id: productId(S, "cap"), qualifying_collection: "premium", cap: 25, title: "Free cap", terms: "One free cap with premium orders." }] } as unknown as Proposal,
        idempotency_key: key("prop"),
      }),
    ).resolves.toMatchObject({ status: "needs_owner_approval" });
    await expect(
      undoExecute(a.agent, {
        proposal: { goal: "Over-allocate", changes: [{ op: "start_gift_promotion", gift_product_id: POUCH, qualifying_collection: "premium", cap: 5, title: "Second pouch offer", terms: "Another pouch offer for premium orders." }] } as unknown as Proposal,
        idempotency_key: key("prop"),
      }),
    ).rejects.toMatchObject({ code: "policy_violation" });
  });

  it("a coupled presentation conflict withholds the whole offer group instead of half-retiring it", async () => {
    await giftOrder();
    const pack = await component(S, "promo", productId(S, "pack"));
    await operatorEdit(a.operator, { sku: "PRM-PCK", component: "promotional_copy", text: "Operator rewrite of the pack copy.", expected_revision: pack.revision, idempotency_key: key("op") });
    const plan = (await retirementPlan()) as unknown as { counts: Record<string, number>; purchase_dependencies: Array<{ will_retire: boolean }> };
    expect(plan.counts.conflict).toBe(1);
    expect(plan.purchase_dependencies[0].will_retire).toBe(false);
    const res = await approveAndApply(plan as unknown as { plan_id: string; plan_hash: string });
    expect(res.status).toBe("blocked");
    expect(await stock()).toMatchObject({ held: 9, committed: 1 });
  });
});
