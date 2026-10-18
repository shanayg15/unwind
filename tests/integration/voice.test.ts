import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The provider is mocked here: these tests prove our call logic, never a live call (V01 is a separate live run).
const ik = vi.hoisted(() => ({
  placeCall: vi.fn(),
  hangupCall: vi.fn(async () => ({})),
  listTranscripts: vi.fn(async () => [] as Array<{ seq: number; party: string; text: string }>),
}));
vi.mock("@inkbox/sdk", () => ({
  Inkbox: class {
    async getIdentity() {
      return ik;
    }
  },
  verifyWebhook: () => true,
}));

import { bumpIntent, type CaseRow, getCase, openCase } from "../../src/cases/cases.js";
import { enqueueCaseMessage } from "../../src/comms/outbox.js";
import { callBrief, enforceCallLimits, placeOwnerCall, settleCallEnded } from "../../src/comms/voice.js";
import { closePool, query } from "../../src/db/pool.js";
import { productId } from "../../src/fixtures/demo.js";
import { newId } from "../../src/lib/util.js";
import { undoPreview } from "../../src/recovery/plan.js";
import { processEvent } from "../../worker/agent-worker.js";
import { type Actors, component, freshStores, launch } from "../helpers.js";

const S = "store_demo";
const Q = "Your launch set the Trail Runner Shoe to $135 but another operator changed it to $139. Keep $139, or restore $135?";
let a: Actors;
let rollout: Awaited<ReturnType<typeof launch>>;
let ownerCase: CaseRow;
let ownerPhone: string;
let calls = 0;
const RUN = Date.now().toString(36); // provider call ids must be unique across runs on the shared test branch
const pc = (n = calls) => `pc_${RUN}_${n}`;

afterAll(() => closePool());

async function premiumPlan() {
  const ids = rollout.changes.filter((c) => c.labels.includes("premium")).map((c) => c.change_id);
  return (await undoPreview(a.agent, { rollout_id: rollout.rollout_id, change_ids: ids })) as { plan_id: string; plan_hash: string };
}

function ended(providerCallId: string, over: { outcome?: string; hangup?: string | null; remote?: string; transcript?: unknown; items?: unknown[] } = {}) {
  return {
    id: newId("evt_ib"),
    event_type: "call.ended",
    timestamp: new Date().toISOString(),
    data: {
      call: { id: providerCallId, remote_phone_number: over.remote ?? ownerPhone, direction: "outbound", hangup_reason: over.hangup ?? null, hosted_agent_authority_mode: "contact_scoped" },
      transcript: over.transcript ?? null,
      transcript_url: "https://example.invalid/t",
      outcome: over.outcome ?? "completed",
      post_call_action_items: over.items ?? [],
    },
  };
}

async function deliver(payload: ReturnType<typeof ended>) {
  const id = newId("evt");
  await query(
    `insert into inbox_events(id, provider, provider_event_id, event_type, payload_hash, payload, status) values ($1,'inkbox',$2,'call.ended','test',$3,'processing')`,
    [id, payload.id, JSON.stringify(payload)],
  );
  await processEvent({ id, provider: "inkbox", provider_event_id: payload.id, event_type: "call.ended", payload, attempts: 1, case_id: null });
  return (await query(`select status, error from inbox_events where id=$1`, [id])).rows[0] as { status: string; error: string | null };
}

const outboxFor = async (caseId: string) => (await query(`select purpose, body, status from outbox_messages where case_id=$1 order by created_at`, [caseId])).rows;
const approvalsFor = async (planId: string) => (await query(`select count(*)::int n from approvals where subject_id=$1`, [planId])).rows[0].n as number;

beforeAll(async () => {
  process.env.LIVE_SEND_ENABLED = "true";
  process.env.OWNER_VOICE_ENABLED = "true";
  process.env.MAX_LIVE_MESSAGES = "100000";
  process.env.MAX_CALL_DURATION_SECONDS = "180";
  a = await freshStores();
  rollout = await launch(a);
  ownerPhone = (await query(`select phone_e164 from principals where id='pr_owner'`)).rows[0].phone_e164;
  if (!ownerPhone) await query(`update principals set phone_e164='+15550100001' where id='pr_owner'`);
  ownerPhone ||= "+15550100001";
});

beforeEach(async () => {
  process.env.MAX_LIVE_CALLS = "50";
  await query(`delete from usage_counters where name='live_calls'`);
  await query(`update cases set state='resolved' where store_id=$1 and role='owner'`, [S]);
  ownerCase = await openCase(S, "owner", "pr_owner", "imessage", `conv_${newId("t")}`);
  ik.placeCall.mockReset();
  ik.placeCall.mockImplementation(async () => ({ id: pc(++calls), hostedAgentAuthorityMode: "contact_scoped" }));
  ik.hangupCall.mockClear();
  ik.listTranscripts.mockClear();
});

describe("V04 authority and context", () => {
  it("places a hosted call to the case owner only, explicitly contact_scoped, with a narrow brief", async () => {
    const plan = await premiumPlan();
    const r = await placeOwnerCall(ownerCase, plan.plan_id, Q);
    expect(r).toMatchObject({ status: "ringing", authority_mode: "contact_scoped", max_seconds: 180 });
    expect(ik.placeCall).toHaveBeenCalledTimes(1);
    const args = ik.placeCall.mock.calls[0][0];
    expect(args).toMatchObject({ toNumber: ownerPhone, mode: "hosted_agent", hostedAgentAuthorityMode: "contact_scoped", origination: "shared_imessage_number", onVoicemail: "hang_up" });
    expect(args.reason).toContain(Q);
    expect(args.reason).toMatch(/No transfers/);
    expect(args.reason).toMatch(/nothing is changed until they confirm the plan by text/i);
    expect(args.reason.length).toBeLessThanOrEqual(1400);
    // No customer contact, order data, or other phone numbers reach the call session.
    expect(args.reason).not.toMatch(/@/);
    expect(args.reason).not.toMatch(/\+\d{7,}/);
    const s = (await query(`select plan_hash, intent_version, authority_mode, status from voice_sessions where case_id=$1`, [ownerCase.id])).rows[0];
    expect(s).toMatchObject({ plan_hash: plan.plan_hash, intent_version: ownerCase.intent_version, authority_mode: "contact_scoped", status: "in_progress" });
  });

  it("customer cases, foreign plans, and disabled voice cannot place calls", async () => {
    const plan = await premiumPlan();
    const cust = await openCase(S, "customer", "pr_customer_a", "email", `t_${newId("t")}`);
    await expect(placeOwnerCall(cust, plan.plan_id, Q)).rejects.toMatchObject({ code: "forbidden" });
    await expect(placeOwnerCall(ownerCase, "plan_not_real", Q)).rejects.toMatchObject({ code: "invalid_input" });
    process.env.OWNER_VOICE_ENABLED = "false";
    await expect(placeOwnerCall(ownerCase, plan.plan_id, Q)).rejects.toMatchObject({ code: "forbidden" });
    process.env.OWNER_VOICE_ENABLED = "true";
    expect(ik.placeCall).not.toHaveBeenCalled();
  });

  it("the brief is bounded even for a long question", () => {
    expect(callBrief("Demo", "case_abcdef123456", "x".repeat(5000)).length).toBeLessThanOrEqual(1400);
  });
});

describe("V02 voicemail / no answer / unclear", () => {
  const variants: Array<[string, Parameters<typeof ended>[1]]> = [
    ["no answer", { outcome: "no_answer" }],
    ["declined", { outcome: "declined", hangup: "rejected" }],
    ["voicemail", { outcome: "completed", hangup: "voicemail", transcript: { abridged: false, entries: [{ party: "remote", text: "Leave a message after the tone" }] } }],
    ["connected but the owner never spoke", { outcome: "completed", hangup: "remote", transcript: { abridged: false, entries: [{ party: "local", text: "Hi, this is the shop assistant" }] } }],
  ];
  for (const [label, over] of variants) {
    it(`${label}: no approval, no store change, one text fallback, case pending`, async () => {
      const plan = await premiumPlan();
      const shoeBefore = await component(S, "price", productId(S, "shoes"));
      await placeOwnerCall(ownerCase, plan.plan_id, Q);
      const res = await deliver(ended(pc(), over));
      expect(res.status).toBe("handled");
      expect(res.error).toMatch(/one text fallback queued/);
      const out = await outboxFor(ownerCase.id);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ purpose: "conflict_question", status: "pending" });
      expect(out[0].body).toMatch(/couldn't reach you/);
      expect(out[0].body).toMatch(/Nothing has been changed yet/);
      expect(await approvalsFor(plan.plan_id)).toBe(0);
      expect(await component(S, "price", productId(S, "shoes"))).toEqual(shoeBefore);
      expect((await getCase(ownerCase.id))!.state).toBe("awaiting_owner");
    });
  }
});

describe("V03 duplicate and stale call results", () => {
  it("a replayed call.ended has one local effect", async () => {
    const plan = await premiumPlan();
    await placeOwnerCall(ownerCase, plan.plan_id, Q);
    const ev = ended(pc(), { outcome: "no_answer" });
    expect((await deliver(ev)).status).toBe("handled");
    const again = await deliver({ ...ev, id: newId("evt_ib") });
    expect(again).toMatchObject({ status: "handled", error: "duplicate call result (already settled)" });
    expect(await outboxFor(ownerCase.id)).toHaveLength(1);
  });

  it("an answer for an older intent or expired plan is marked stale and never approves", async () => {
    const plan = await premiumPlan();
    await placeOwnerCall(ownerCase, plan.plan_id, Q);
    await bumpIntent(ownerCase.id); // owner texted something newer after the call was placed
    const f = await settleCallEnded(ended(pc(), { transcript: { abridged: false, entries: [{ party: "local", text: Q }, { party: "remote", text: "Yes keep 139, restore the rest" }] } }));
    expect(f).toMatchObject({ duplicate: false, answered_by_person: true, stale: true, remote_matches_owner: true });
    expect(await approvalsFor(plan.plan_id)).toBe(0);

    const plan2 = await premiumPlan();
    const c2 = (await getCase(ownerCase.id))!;
    await placeOwnerCall(c2, plan2.plan_id, Q);
    await query(`update recovery_plans set expires_at = now() - interval '1 minute' where id=$1`, [plan2.plan_id]);
    const f2 = await settleCallEnded(ended(pc(), { transcript: { abridged: false, entries: [{ party: "remote", text: "Keep 139" }] } }));
    expect(f2.stale).toBe(true);
    expect(await approvalsFor(plan2.plan_id)).toBe(0);
  });

  it("an abridged inline transcript is replaced by the authoritative lookup", async () => {
    const plan = await premiumPlan();
    await placeOwnerCall(ownerCase, plan.plan_id, Q);
    ik.listTranscripts.mockResolvedValueOnce([
      { seq: 2, party: "remote", text: "Actually no, restore 135 as well" },
      { seq: 1, party: "local", text: Q },
    ]);
    const f = await settleCallEnded(ended(pc(), { transcript: { abridged: true, entries: [{ party: "remote", text: "keep 139" }, { marker: "abridged" }] } }));
    expect(ik.listTranscripts).toHaveBeenCalledWith(pc());
    expect(f.transcript).toBe(`Shop assistant: ${Q}\nOwner: Actually no, restore 135 as well`);
    expect(f.stale).toBe(false);
  });

  it("a result from another number or an unknown call does nothing", async () => {
    const plan = await premiumPlan();
    await placeOwnerCall(ownerCase, plan.plan_id, Q);
    expect((await deliver(ended(pc(), { outcome: "no_answer", remote: "+15550199999" }))).status).toBe("rejected");
    expect((await deliver(ended(`pc_${RUN}_unknown`, { outcome: "no_answer" }))).status).toBe("rejected");
    expect(await outboxFor(ownerCase.id)).toHaveLength(0);
  });
});

describe("V05 failure, budget, and stop", () => {
  it("one call per plan and no second call while one is active", async () => {
    const plan = await premiumPlan();
    await placeOwnerCall(ownerCase, plan.plan_id, Q);
    await expect(placeOwnerCall(ownerCase, plan.plan_id, Q)).rejects.toMatchObject({ code: "limit_exceeded" });
    const other = await premiumPlan();
    await expect(placeOwnerCall(ownerCase, other.plan_id, Q)).rejects.toMatchObject({ code: "limit_exceeded" });
    await settleCallEnded(ended(pc(), { outcome: "no_answer" }));
    await expect(placeOwnerCall(ownerCase, plan.plan_id, Q)).rejects.toMatchObject({ code: "limit_exceeded" });
    expect(ik.placeCall).toHaveBeenCalledTimes(1);
  });

  it("the call budget is a hard cap and the text path still works after it", async () => {
    process.env.MAX_LIVE_CALLS = "2";
    for (let i = 0; i < 2; i++) {
      const p = await premiumPlan();
      await placeOwnerCall((await getCase(ownerCase.id))!, p.plan_id, Q);
      await settleCallEnded(ended(pc(), { outcome: "no_answer" }));
    }
    const p3 = await premiumPlan();
    await expect(placeOwnerCall((await getCase(ownerCase.id))!, p3.plan_id, Q)).rejects.toThrow(/budget exhausted \(cap 2\)/);
    expect(ik.placeCall).toHaveBeenCalledTimes(2);
    const msg = await enqueueCaseMessage((await getCase(ownerCase.id))!, { purpose: "conflict_question", body: Q, triggerEventId: newId("evt") });
    expect(msg.status).toBe("pending");
  });

  it("an ambiguous placement failure is recorded once and never retried", async () => {
    const plan = await premiumPlan();
    ik.placeCall.mockRejectedValueOnce(Object.assign(new Error("upstream timeout"), { status: 503 }));
    await expect(placeOwnerCall(ownerCase, plan.plan_id, Q)).rejects.toMatchObject({ code: "internal" });
    const s = (await query(`select status, provider_call_id from voice_sessions where case_id=$1`, [ownerCase.id])).rows[0];
    expect(s).toMatchObject({ status: "unknown", provider_call_id: null });
    await expect(placeOwnerCall(ownerCase, plan.plan_id, Q)).rejects.toMatchObject({ code: "limit_exceeded" });
    expect(ik.placeCall).toHaveBeenCalledTimes(1);
  });

  it("the duration kill switch hangs up an over-limit call exactly once", async () => {
    await enforceCallLimits(); // sweep sessions left in progress by earlier runs on the shared test branch
    ik.hangupCall.mockClear();
    const plan = await premiumPlan();
    await placeOwnerCall(ownerCase, plan.plan_id, Q);
    const pid = pc();
    expect(await enforceCallLimits()).toHaveLength(0);
    await query(`update voice_sessions set created_at = now() - interval '5 minutes' where provider_call_id=$1`, [pid]);
    const cut = await enforceCallLimits();
    expect(cut).toHaveLength(1);
    expect(ik.hangupCall).toHaveBeenCalledWith(pid);
    expect(await enforceCallLimits()).toHaveLength(0);
    expect(ik.hangupCall).toHaveBeenCalledTimes(1);
  });
});
