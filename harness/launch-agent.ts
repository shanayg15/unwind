/**
 * Launch the approved weekend campaign through a real agent session and the hosted UNDO MCP.
 *   pnpm demo:launch                         owner approval via the owner credential (labeled test actor)
 *   pnpm demo:launch -- --owner-link         text the owner a single-use approval link and wait for it
 * The agent computes the proposal itself from the brief + undo_capabilities.
 */
import { readFileSync } from "node:fs";
import { approveAsOwner, createApprovalRequest } from "../src/approvals/approvals.js";
import { closePool, query, withTx } from "../src/db/pool.js";
import { newId } from "../src/lib/util.js";
import { runAgent } from "../worker/agent-runner.js";

const MCP_URL = process.env.MCP_PUBLIC_URL ?? "https://bold-cloud-77gfl.run.mcp-use.com/mcp";
const STORE = process.env.LAUNCH_STORE_ID ?? "store_demo";
const tokens: Record<string, string> = JSON.parse(readFileSync(".private/tokens.json", "utf8"));
const agentToken = tokens[`${STORE}:${STORE === "store_eval" ? "pr_evaluator" : "pr_agent"}`];
const ownerId = STORE === "store_eval" ? "pr_eval_owner" : "pr_owner";
const ownerLink = process.argv.includes("--owner-link");
const scenario = process.argv.includes("--scenario") ? process.argv[process.argv.indexOf("--scenario") + 1] : "weekend";

export const BRIEF = `Weekend launch brief (owner-approved plan to propose):
- Premium collection: 10% off every premium product price (round to the cent).
- Clearance collection: 20% off every clearance product price.
- Promotional copy: on each of the four premium products, replace the promotional copy with a line starting "Weekend Premium Event: 10% off". On the Linen Camp Shirt, use a line starting "Clearance: an extra 20% off".
- Homepage: premium tile title "Weekend Premium Event" (subtitle "10% off technical layers, this weekend only", link /collections/premium); clearance tile title "Clearance: extra 20% off" (subtitle "Summer gear, final markdowns", link /collections/clearance).
- Navigation: items New arrivals (/collections/premium), Premium (/collections/premium), Clearance (/collections/clearance), Size guide (/size-guide); title "Main navigation", link "/".
- Do not change the Canvas Market Tote or any sizing information.
- Do not set atomic_group on any change: each price, copy, tile and the navigation are independent components here.`;

export const POUCH_BRIEF = `Free-pouch experiment brief (owner-approved plan to propose):
- Gift offer: one free Packable Travel Pouch with any order that includes a premium item, capped at 10 accepted gifts (set aside 10 pouches). Title "Free travel pouch". Terms: "One free Packable Travel Pouch with any order that includes a premium item, while the 10 set aside last. One per order. Test store: no payment is taken."
- Homepage: premium tile title "Free travel pouch with premium gear" (subtitle "One per order while the 10 set aside last", link /collections/premium).
- Promotional copy on the Summit 28L Pack: "Free Packable Travel Pouch with the Summit 28L while the offer lasts."
- The offer, the premium tile and the pack copy announce the same offer: put all three in one atomic recovery group "pouch_offer" so they are never half-withdrawn.
- Do not change any price, the clearance tile, navigation, or sizing information.`;

const SYSTEM = `You are a shop agent. You change the store only through the UNDO MCP tools. Build exact typed changes from undo_capabilities (product_id, slot_id, current prices) and the brief. Never change anything the brief does not ask for.`;

async function main() {
  const t0 = Date.now();
  const propose = await runAgent({
    label: `launch-propose-${STORE}`,
    systemPrompt: SYSTEM,
    prompt: `${scenario === "pouch" ? POUCH_BRIEF : BRIEF}\n\nCall undo_capabilities, then submit the full proposal with ONE undo_execute call ({proposal: {goal, changes}, idempotency_key}). It will wait for the owner's approval; report the rollout_id and proposal_hash.`,
    mcpUrl: MCP_URL,
    mcpToken: agentToken,
    maxTurns: 10,
  });
  const ro = (await query(`select id, proposal_hash, proposal from rollouts where store_id=$1 and state='awaiting_approval' order by created_at desc limit 1`, [STORE])).rows[0];
  if (!ro) throw new Error(`agent did not create a proposal (stop=${propose.stop})`);
  console.log(`[launch] proposal ${ro.id} with ${(ro.proposal.changes as unknown[]).length} changes (${propose.tool_calls.map((t) => t.name).join(", ")})`);
  if (ownerLink) {
    const req = await withTx((tx) => createApprovalRequest(tx, STORE, "launch", ro.id, null, 30));
    const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
    const owner = (await query(`select id from principals where id=$1`, [ownerId])).rows[0];
    await query(
      `insert into outbox_messages(id, store_id, dedupe_key, channel, recipient_principal_id, purpose, body) values ($1,$2,$3,'imessage',$4,'request_approval',$5)`,
      [newId("msg"), STORE, `launch:${ro.id}`, owner.id, (scenario === "pouch" ? `Free-pouch experiment ready for your approval: one free travel pouch with premium orders, 10 set aside, plus the homepage tile and pack copy. Approve: ${base}/approve/${req.token}` : `Launch ready for your approval: ${(ro.proposal.changes as unknown[]).length} recorded changes (premium 10% off, clearance 20% off, weekend copy, homepage tiles, navigation). All within price caps.\n\nApprove this exact launch: ${base}/approve/${req.token}`)],
    );
    console.log("[launch] approval link queued for the owner; the worker delivers it. Waiting up to 20 min for approval...");
    for (let i = 0; i < 240; i++) {
      const s = (await query(`select state from rollouts where id=$1`, [ro.id])).rows[0].state;
      if (s === "approved") break;
      if (s === "rejected") throw new Error("owner rejected the launch");
      await new Promise((r) => setTimeout(r, 5000));
    }
  } else {
    await approveAsOwner(ownerId, STORE, "launch", ro.id, ro.proposal_hash, "owner_credential_test_actor");
    console.log("[launch] approved via the owner credential (scripted rehearsal; labeled test actor)");
  }
  const exec = await runAgent({
    label: `launch-execute-${STORE}`,
    systemPrompt: SYSTEM,
    prompt: `The owner approved rollout ${ro.id} with proposal_hash ${ro.proposal_hash}. Execute it now with undo_execute ({rollout_id, proposal_hash, idempotency_key}) and report the receipt (change count and status).`,
    mcpUrl: MCP_URL,
    mcpToken: agentToken,
    maxTurns: 6,
  });
  const done = (await query(`select state, executed_at from rollouts where id=$1`, [ro.id])).rows[0];
  const n = (await query(`select count(*)::int n from action_changes where rollout_id=$1`, [ro.id])).rows[0].n;
  console.log(`[launch] rollout ${ro.id}: ${done.state}, ${n} recorded changes (${exec.tool_calls.map((t) => t.name).join(", ")}); ${Math.round((Date.now() - t0) / 1000)}s`);
  if (done.state !== "executed") process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
