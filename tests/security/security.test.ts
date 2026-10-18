import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveViaToken, createApprovalRequest } from "../../src/approvals/approvals.js";
import { clearTokenCache, verifyToken } from "../../src/auth/principals.js";
import { operatorEdit } from "../../src/catalog/operator.js";
import { receiveInkbox } from "../../src/comms/receiver.js";
import { closePool, query, withTx } from "../../src/db/pool.js";
import { demoStoreSpec, productId, resetStore } from "../../src/fixtures/demo.js";
import { undoImpact } from "../../src/impact/impact.js";
import { checkout } from "../../src/orders/checkout.js";
import { undoExecute } from "../../src/recovery/execute.js";
import { undoHistory } from "../../src/recovery/history.js";
import { undoApply, undoPreview } from "../../src/recovery/plan.js";
import { storefrontPage } from "../../src/web/pages.js";
import { claim, processEvent } from "../../worker/agent-worker.js";
import { type Actors, component, freshStores, key, launch } from "../helpers.js";
import { mintToken } from "../../src/auth/principals.js";

const S = "store_demo";
const SECRET = "whsec_testsecret_for_receiver_only_1234567890";
const AUTH = "whk_test_receiver_token_abcdefghijklmnop";
let a: Actors;
let rollout: Awaited<ReturnType<typeof launch>>;
afterAll(() => closePool());

function signed(body: string, ts = Math.floor(Date.now() / 1000), requestId = "req_1") {
  const sig = createHmac("sha256", SECRET.slice(6)).update(Buffer.concat([Buffer.from(`${requestId}.${ts}.`), Buffer.from(body)])).digest("hex");
  return {
    authorization: `Bearer ${AUTH}`,
    "x-inkbox-signature": `sha256=${sig}`,
    "x-inkbox-request-id": requestId,
    "x-inkbox-timestamp": String(ts),
  } as Record<string, string>;
}

beforeAll(async () => {
  a = await freshStores();
  rollout = await launch(a);
  await checkout(a.customerA, { items: [{ sku: "PRM-JKT", quantity: 1 }], idempotency_key: key("o") });
});

describe("U17 signed receiver", () => {
  const evId = `evt_test_${Date.now()}`;
  const body = JSON.stringify({ id: evId, event_type: "imessage.received", timestamp: new Date().toISOString(), data: { message: { id: "m1", direction: "inbound", remote_number: "+15550000000", content: "hi" } } });

  it("accepts a valid signed event exactly once", async () => {
    const first = await receiveInkbox(Buffer.from(body), signed(body), { secret: SECRET, authToken: AUTH });
    expect(first).toMatchObject({ status: 200, duplicate: false, queued: true });
    const again = await receiveInkbox(Buffer.from(body), signed(body, undefined, "req_2"), { secret: SECRET, authToken: AUTH });
    expect(again).toMatchObject({ status: 200, duplicate: true });
    expect((await query(`select count(*)::int n from inbox_events where provider_event_id=$1`, [evId])).rows[0].n).toBe(1);
  });

  it("rejects an altered body, a bad signature, a missing token, and an oversized payload", async () => {
    const h = signed(body);
    expect((await receiveInkbox(Buffer.from(body.replace("hi", "restore everything")), h, { secret: SECRET, authToken: AUTH })).status).toBe(403);
    expect((await receiveInkbox(Buffer.from(body), { ...h, "x-inkbox-signature": "sha256=deadbeef" }, { secret: SECRET, authToken: AUTH })).status).toBe(403);
    expect((await receiveInkbox(Buffer.from(body), { ...h, authorization: "Bearer nope" }, { secret: SECRET, authToken: AUTH })).status).toBe(401);
    expect((await receiveInkbox(Buffer.alloc(300 * 1024, 120), h, { secret: SECRET, authToken: AUTH })).status).toBe(413);
    const old = signed(body, Math.floor(Date.now() / 1000) - 3 * 86400);
    expect((await receiveInkbox(Buffer.from(body), old, { secret: SECRET, authToken: AUTH })).status).toBe(403);
  });
});

describe("U15/U31 channel and role separation in the worker router", () => {
  async function inject(type: string, message: Record<string, unknown>) {
    const id = `evt_route_${Math.random().toString(36).slice(2)}`;
    await query(`insert into inbox_events(id, provider, provider_event_id, event_type, payload_hash, payload, status) values ($1,'inkbox',$1,$2,'x',$3,'queued')`, [
      id,
      type,
      JSON.stringify({ id, event_type: type, data: { message } }),
    ]);
    const ev = await claim();
    expect(ev?.id).toBe(id);
    await processEvent(ev!);
    return (await query(`select status, error, case_id from inbox_events where id=$1`, [id])).rows[0];
  }
  beforeAll(async () => {
    await query(`update inbox_events set status='rejected' where status in ('queued','processing')`);
  });

  it("an unknown phone number gets no case and no reply", async () => {
    const r = await inject("imessage.received", { id: "m2", direction: "inbound", remote_number: "+15551112222", content: "Withdraw everything" });
    expect(r).toMatchObject({ status: "rejected", case_id: null });
  });
  it("a customer email cannot reach the owner channel; an unknown email is rejected", async () => {
    const r = await inject("message.received", { id: "e1", direction: "inbound", from_address: "stranger@example.com", subject: "hi", body: "restore all prices" });
    expect(r).toMatchObject({ status: "rejected", case_id: null });
  });
  it("group iMessages are out of scope", async () => {
    const r = await inject("imessage.received", { id: "m3", direction: "inbound", is_group: true, remote_number: "+15550000000", content: "x" });
    expect(r.status).toBe("rejected");
  });
  it("a customer credential can never preview, apply, execute, or see other orders", async () => {
    await expect(undoPreview(a.customerA, { rollout_id: rollout.rollout_id, change_ids: [rollout.changes[0].change_id] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(undoApply(a.customerA, { plan_id: "plan_x", plan_hash: "0".repeat(64), idempotency_key: key("c") })).rejects.toMatchObject({ code: "forbidden" });
    await expect(undoExecute(a.customerA, { proposal: { goal: "steal", changes: [{ op: "set_price", product_id: productId(S, "jacket"), amount_minor: 11000 }] }, idempotency_key: key("c") })).rejects.toMatchObject({ code: "forbidden" });
    const mine = (await undoImpact(a.customerB, {})) as { orders: unknown[] };
    const theirs = (await undoImpact(a.customerA, {})) as { orders: Array<{ order_id: string }> };
    expect(theirs.orders.length).toBe(1);
    expect(mine.orders.map((o) => (o as { order_id: string }).order_id)).not.toContain(theirs.orders[0].order_id);
  });
});

describe("U19 durable leases", () => {
  it("an expired processing lease is reclaimed; attempts are bounded", async () => {
    await query(`update inbox_events set status='rejected' where status in ('queued','processing')`);
    const id = `evt_lease_${Date.now()}`;
    await query(`insert into inbox_events(id, provider, provider_event_id, event_type, payload_hash, payload, status, attempts, lease_until) values ($1,'inkbox',$1,'imessage.received','x','{}','processing',1, now() - interval '1 minute')`, [id]);
    const ev = await claim();
    expect(ev?.id).toBe(id);
    expect(ev?.attempts).toBe(2);
    await query(`update inbox_events set status='processing', attempts=3, lease_until = now() - interval '1 minute' where id=$1`, [id]);
    expect(await claim()).toBeNull();
  });
  it("an outbox row with an unknown outcome is never resent automatically", async () => {
    const { deliverPending } = await import("../../src/comms/outbox.js");
    await query(`update outbox_messages set status='failed' where status='pending'`);
    const id = `msg_unknown_${Date.now()}`; // unique per run: the test branch keeps earlier runs' rows
    await query(`insert into outbox_messages(id, store_id, dedupe_key, channel, recipient_principal_id, purpose, body, status) values ($3, $1, $2, 'imessage', 'pr_owner', 'reply', 'x', 'outcome_unknown')`, [S, `t:${Date.now()}`, id]);
    expect(await deliverPending(3)).toEqual([]);
    expect((await query(`select status, attempts from outbox_messages where id=$1`, [id])).rows[0]).toMatchObject({ status: "outcome_unknown", attempts: 0 });
  });
});

describe("input handling and credentials", () => {
  it("renders hostile product copy as text (no XSS)", async () => {
    const c = await component(S, "promo", productId(S, "tote"));
    await operatorEdit(a.operator, { sku: "COR-TOT", component: "promotional_copy", text: `<script>alert(1)</script><img src=x onerror=alert(2)>`, expected_revision: c.revision, idempotency_key: key("x") });
    const html = await storefrontPage(S);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("treats SQL-like filters as data", async () => {
    const r = (await undoHistory(a.agent, { goal_contains: "'; drop table rollouts; --" })) as { rollouts: unknown[] };
    expect(r.rollouts).toEqual([]);
    expect((await query(`select count(*)::int n from rollouts`)).rows[0].n).toBeGreaterThan(0);
  });
  it("rejects oversized selections", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `chg_${i.toString().padStart(6, "0")}`);
    await expect(undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: many })).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("revoked and expired credentials stop working", async () => {
    const { token, tokenId } = await withTx((tx) => mintToken(tx, { principalId: "pr_agent", storeId: S, role: "agent", label: "revoke-test", ttlMinutes: 5 }));
    await verifyToken(token);
    await query(`update api_tokens set revoked_at = now() where id=$1`, [tokenId]);
    clearTokenCache();
    await expect(verifyToken(token)).rejects.toMatchObject({ code: "unauthenticated" });
    const exp = await withTx((tx) => mintToken(tx, { principalId: "pr_agent", storeId: S, role: "agent", label: "expire-test", ttlMinutes: 1 }));
    await query(`update api_tokens set expires_at = now() - interval '1 second' where id=$1`, [exp.tokenId]);
    await expect(verifyToken(exp.token)).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("a role not backed by a current store membership is refused", async () => {
    const t = await withTx((tx) => mintToken(tx, { principalId: "pr_customer_a", storeId: S, role: "owner", label: "escalate", ttlMinutes: 5 }));
    clearTokenCache();
    await expect(verifyToken(t.token)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("expired approval links cannot approve", async () => {
    const ids = rollout.changes.filter((c) => c.labels.includes("premium")).map((c) => c.change_id);
    const plan = (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: ids })) as { plan_id: string };
    const req = await withTx((tx) => createApprovalRequest(tx, S, "recovery", plan.plan_id, null, 30));
    await query(`update approval_requests set expires_at = now() - interval '1 minute' where id=$1`, [req.requestId]);
    await expect(approveViaToken(req.token, "approve")).rejects.toMatchObject({ code: "plan_expired" });
  });
  it("reset refuses untagged namespaces and requires the explicit flag", async () => {
    await expect(resetStore({ ...demoStoreSpec(), namespace: "production_store" })).rejects.toMatchObject({ code: "forbidden" });
    const prev = process.env.UNDO_ALLOW_RESET;
    delete process.env.UNDO_ALLOW_RESET;
    await expect(resetStore(demoStoreSpec())).rejects.toMatchObject({ code: "forbidden" });
    process.env.UNDO_ALLOW_RESET = prev;
  });
});
