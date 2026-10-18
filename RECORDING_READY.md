# UNWIND: recording packet

**Status: RECORDING_READY.** The full race sequence (10 set aside → 4 orders → preview 4/6 → fifth order → stale plan refused → refreshed 5/5 → applied) passed three consecutive end-to-end rehearsals on deployed build `47e1d9b`, through the real owner text thread, the real customer mailbox, and real agent MCP calls. The store is reset to a clean pre-launch fixture and the worker is running.

**Two things you must know before submitting:**
1. **The repository is PRIVATE**: `https://github.com/shanayg15/yc_hack_1017`. Judges can't open it until you make it public or add them as collaborators. I have not changed visibility.
2. **Owner approval of the launch** (the 10-pouch allocation) uses the owner test credential in the launch script, labeled as such in the records. If you want the owner's phone to approve the launch on camera, use the `--owner-link` variant below (it texts you a link you tap).

## 1. What works vs. the storyboard

| Storyboard beat | State | Evidence |
|---|---|---|
| Agent reserves 10 pouches (owner-approved) | Works. A real agent builds `start_gift_promotion` from the brief; held 10, available 0, on hand 10 | `reports/runs/unwind-{1,2,3}.json` beat 2 |
| Four accepted gift orders | Works. Real checkout API, accepted offer terms, $0 gift line, allocation lineage; 6 held / 4 committed. Orders come from 2 test identities (test customer A = your OpenSwarm address; B = automated test actor, never contacted) | beat 3 |
| Owner texts "stop"; agent previews 4 kept / 6 releasable | Works. Signed Inkbox event → worker → fresh agent → undo_history/preview/impact → text with plan + code | beat 4–5 |
| Fifth order arrives at the review gate | Works. A controlled test checkout (`--scenario pouch-one`); 5 held / 5 committed | beat 6 |
| Stale plan caught | Works. You reply YES to the old code → the agent applies → `stale_dependency_state`: nothing written, old plan superseded, still 5 held | beat 8 |
| Agent refreshes; renewed approval | Works. New plan 5/5 with a NEW code; the old approval can't be reused (tested) | beat 8–9 |
| Apply + verify | Works. Offer retired, held 0, committed 5, available 5, on hand 10; banner + pack copy restored; verify `verified` | beat 10 |
| Customer email answered from verified facts | Works. Threaded reply from the shop mailbox listing only that customer's orders, each with its $0 pouch "set aside", no shipping claim | beat 12 |
| Voice | Not used in this video (works separately: V01–V05 verified) | `reports/runs/live-2-owner-voice.json` |

Known cosmetic limit: the `/unwind` board shows "Loading…" for about 3 s on first open. Open it before you start recording.

## 2. Build, repo, deployment

- Release build (server + worker code): `47e1d9b` on `main` (later commits change only scripts, docs and reports).
- Repo: `https://github.com/shanayg15/yc_hack_1017` (private; judge access NOT verified).
- Hosted MCP (Manufact): `https://bold-cloud-77gfl.run.mcp-use.com/mcp` (bearer token; secrets stay in `.env` / `.private/`).
- Manufact dashboard: `https://manufact.com/cloud/org-808238af-w8cml/servers/fa0d3fbb-466f-44fe-80b3-8b806ace54ff/overview`

## 3. URLs and tab order (left to right)

1. **UNWIND board**: `https://bold-cloud-77gfl.run.mcp-use.com/unwind` (main shot, 1920×1080; refreshes every 3 s from the database)
2. **Storefront**: `https://bold-cloud-77gfl.run.mcp-use.com/store` (offer card, pouch stock line, banner)
3. **Pick list**: `https://bold-cloud-77gfl.run.mcp-use.com/store/picklist` (orders with their pouches)
4. **Owner phone**: the shop thread on your iPhone (mirror with QuickTime → New Movie Recording → iPhone), or the same thread in Messages on this Mac. **Mask the phone number in the header.**
5. **Gmail (OpenSwarm account)**: compose to `yc-hack-shanay@inkboxmail.com`
6. **Terminal** in `~/yc_hack_1017` for the three demo commands
7. Sponsor tabs: **Armature** → Eval runs (case "E stop gift experiment keep promises", run `cb5088fe…`, passed 5/5); **Manufact** dashboard (deployment running)

## 4. Commands

Pre-flight (about 1 min, no messages sent):
```bash
cd ~/yc_hack_1017 && pnpm -s setup:check
```
```bash
cd ~/yc_hack_1017 && env -u CLAUDE_CODE_OAUTH_TOKEN pnpm -s test:providers
```
The worker must be running in the "UNDO worker" terminal tab. If it stopped:
```bash
cd ~/yc_hack_1017 && env -u CLAUDE_CODE_OAUTH_TOKEN pnpm worker
```
Reset to the clean pre-launch fixture (closes open cases, expires codes, sends nothing):
```bash
cd ~/yc_hack_1017 && pnpm demo:reset
```
Beat A1, the agent launches the offer (about 45 s):
```bash
cd ~/yc_hack_1017 && env -u CLAUDE_CODE_OAUTH_TOKEN pnpm demo:launch -- --scenario pouch
```
(Optional, the owner approves the launch on the phone: add `--owner-link`, then tap the link you get by text and press Approve.)

Beat A2, four accepted test orders (about 3 s):
```bash
cd ~/yc_hack_1017 && pnpm demo:activity -- --scenario pouch
```
Beat C, the fifth test order at the review gate (about 2 s):
```bash
cd ~/yc_hack_1017 && pnpm demo:activity -- --scenario pouch-one
```
After recording, save evidence for the take:
```bash
cd ~/yc_hack_1017 && pnpm exec tsx --env-file=.env scripts/evidence.ts recording-1
```
If the hosted server is down, redeploy: `pnpm run deploy` (NOT `pnpm deploy`).

## 5. Click-by-click recording script (expected state read from the board)

| # | Action | Who | Expected on screen (from rehearsals) |
|---|---|---|---|
| 0 | `pnpm demo:reset`, open the board | you | Board: "Pre-launch: no offer yet" · 0 / 0 / 0 / **10 available** / **10 on hand** |
| 1 | Run the launch command | terminal | About 45 s. Board: **10 set aside · 10 held · 0 committed · 0 available · 10 on hand**, "Offer active". Storefront: offer card "10 of 10 gifts left", pouch "0 available · 10 set aside", premium tile "Free travel pouch with premium gear" |
| 2 | Run the 4-orders command | terminal | Board: **6 held · 4 committed · 0 available**; chain shows 4 accepted orders, 2 tagged "test customer". Pick list: 4 orders each with "1 × Packable Travel Pouch · gift" |
| 3 | Owner texts the shop (exact): **"Stop the free-pouch experiment. Restore the campaign pages, honor every accepted order, and release only unused promotional stock."** | owner phone | About 30 s later the shop texts the plan: "4 accepted orders keep their pouch, 6 held pouches go back to stock … Reply YES plus the code" (code + optional link appended). Board: plan "4 stay committed · 6 releasable · awaiting owner approval"; agent tool calls undo_capabilities, undo_history, undo_preview, undo_impact, case.case_send |
| 4 | **Review gate**: run the fifth-order command | terminal | Board: **5 held · 5 committed**, 5 accepted orders |
| 5 | Owner replies **"YES ####"** with the code from step 3 | owner phone | About 25 s: the shop texts "Update: a new order accepted the pouch offer after your approval, so nothing was changed and your earlier approval no longer applies … Now 5 accepted orders keep their pouch, 5 held pouches go back to stock … Reply YES plus the new code". Board: first plan **"stale: an order arrived · not applied"**, new plan **5 · 5**; stock still 5 held |
| 6 | Owner replies **"YES ####"** with the NEW code | owner phone | About 25–30 s: completion text "Done and verified … All 5 accepted orders keep their pouch … 5 available, 5 committed, 10 on hand". Board: **0 held · 5 committed · 5 available · 10 on hand**, "Offer retired", plan "applied · fully_reverted", effects retire_future_use · release_remaining 5 · preserve_order_commitment 5, "stock books reconcile" |
| 7 | Show the storefront and pick list | browser | Storefront: no offer card, pouch "5 available", tile "New season essentials", pack copy restored. Pick list: all 5 pouches still listed |
| 8 | Customer emails from Gmail (OpenSwarm), subject e.g. "My pouch", body (exact): **"The free-pouch offer disappeared. Is mine still included in my order?"** | you (customer) | About 30–40 s: a threaded reply in Gmail from the shop mailbox listing that customer's orders, each "Gift: 1 × Packable Travel Pouch at $0.00", "set aside for you", "not shipped yet". Board customer pane shows it with the provider status |

Approvals on camera: two owner YES replies (old plan, then the refreshed plan). Both are real approvals checked by code against the exact plan hash. Don't hide them.

Raw run length: about 3 minutes (rehearsals took 162–187 s including the launch). Trim or visibly speed up the waits; don't splice rehearsals into one "uninterrupted" run.

## 6. Participants and budget (labels only)

- **Owner**: your approved phone (iMessage via the shop's Inkbox identity). In the recording you send the 3 owner texts yourself.
- **Test customer A**: your OpenSwarm address. You send the on-camera email yourself from Gmail.
- **Test customer B**: automated test identity, no contact details, never messaged.
- Message budget: 39 of 150 used; a recording take uses about 5 outbound messages (3 owner texts + 1 customer reply + delivery of the plan text). Calls: 1 of 6 used, none needed.

## 7. Evidence

- **Three UNWIND rehearsals** on `47e1d9b`: `reports/runs/unwind-1.json`, `unwind-2.json`, `unwind-3.json` (beat-by-beat counts, plan ids, provider delivery states, verify `verified`).
- **Tests**: the release gate on this build passed: see `reports/FINAL_VERIFICATION.md` (unit 9/9, integration 63/63, security 15/15; typecheck, build, deployed MCP probe, deployed smoke, setup check all pass). The race sequence itself is `tests/integration/unwind-race.test.ts` (old code approves → apply refuses the stale plan → old approval can't be reused → new code → 5/5 → retry never releases again). PA01–PA12 are in `reports/PURCHASE_AWARE_ACCEPTANCE.md`, including barrier-coordinated checkout-first and retirement-first races, crash rollback, duplicate applies, unrelated allocations, bypass attempts, and post-retirement checkout returning `OFFER_CHANGED_RECONFIRM`.
- **Acceptance**: 37/37 (U01–U32, V01–V05) in `reports/acceptance.json`.
- **Armature** (real hosted runs on the deployed MCP, Claude Haiku 4.5 tester): E pouch retirement **passed 5/5** (`cb5088fe-9354-52f6-93ff-786117484d58`), B order impact passed, D honest partial passed, C cap guardrail partial, A selective withdrawal failed (the tester marked the conflict as an owner exception, which needs owner approval). The first C run on Armature's default gpt-4o-mini tester also failed (it misused a recovery). All are in `reports/armature.json`, each next to our own database check.
- **Manufact**: hosted authenticated MCP (`reports/provider-smoke.json`: 401 without a token, 7 tools with one); RecoveryReceipt App rendered from the deployed server (`reports/app-view/pouch-retirement-plan.png`); Claude Code CLI as a second client (`reports/clients/claude-code.json`).
- **Inkbox**: owner text in/out and customer email in/out on one identity with provider delivery states in every run file; signed webhook receiver.
- **Implementation references**: lock order and stock moves in `src/promotions/gift.ts` (`commitOrderStock`, `retirePromotion`, `promotionState`); dependency watermark and stale handling in `src/recovery/plan.ts` (`classify`, `applyLocked`, `StaleDependency` → superseded + fresh plan); triggers in `src/db/migrations/004_purchase_aware.sql`.

**One-sentence technical explanation (supported by code and tests):** Each gift links an accepted order to the campaign's allocation, and recovery re-reads those links under the same row locks checkout uses, so if an order changed after the preview the exact plan is refused and a fresh plan must be approved, and only units the campaign still holds are released.

## 8. Claim checklist for the video script

| Script sentence | Verdict | Note |
|---|---|---|
| "As agents take on more of running online stores … What happens when the plan changes after customers have already ordered?" | verified | framing, not an implementation claim |
| "We're building Unwind: rollback for ecommerce agents that preserves customer commitments while the store keeps running." | verified | for the supported slice on the controlled test store |
| "Our vision is recovery across promotions, inventory, and fulfillment …" | verified as vision | keep the on-screen "Long-term vision" label; fulfillment recovery is not built |
| "Manufact hosts the MCP our agent calls to inspect and reverse its work." | verified | deployed on Manufact; agent calls via MCP |
| "Inkbox connects owner texts and customer emails to the same agent." | verified | one Inkbox identity → one shop worker (owner and customer cases run in separate contexts) |
| "Armature tests whether unfamiliar agents can recover correctly." | verified | real runs; show run E (passed). Don't imply every case passed |
| "In this test store, the agent reserves ten pouches for a free-gift experiment." | verified | owner-approved (test credential, or `--owner-link`) |
| "Four customers order." | **rewrite** | → "Four test orders come in." (2 test identities, 4 orders) |
| "Four gifts are now commitments, not stock the campaign can take back." | verified | |
| "The owner texts: 'Stop the experiment. Honor existing orders.'" | **rewrite** | show/quote the actual tested text (step 3), or shorten the caption and keep the full text visible |
| "The agent previews recovery: four gifts stay committed, and six can be released." | verified | |
| "But before it applies, a fifth order completes." | verified | say "a fifth test order" (controlled event) |
| "Unwind catches the stale plan." | verified | `stale_dependency_state`; nothing written |
| "The agent refreshes it: now five gifts must stay committed, so only five can be released." | verified | add "… and asks the owner to approve the new plan" (renewed approval is on screen) |
| "We link allocations to accepted orders and recheck those dependencies inside the recovery transaction, rather than restoring an old inventory snapshot." | verified | the recheck happens under lock in the apply transaction; on change it refuses and replans (doesn't silently recompute) |
| "The offer is closed, unused stock is released, and this customer's gift remains on their order." | verified | |
| "The agent verifies that and emails them." | **rewrite** | → "The agent verifies it, and when the customer asks, it answers from their order." (the reply answers the customer's email; it isn't proactive outreach) |
| "The agent changes course without handing the cleanup back to you. Unwind the plan. Keep the promises." | verified | the owner only approves; the agent does the cleanup |
| Submission sentence 2: "It unwinds supported campaign changes while preserving accepted orders and committed inventory …" | verified | "supported" matters: one controlled store, one gift adapter |

## 9. Waits and fallbacks

- Launch about 45 s; each agent reply 25–35 s; customer reply 30–40 s. Trim or speed up the waits on screen and label it.
- If a reply is slow, the board shows the pending state; don't fake it. If the worker tab stopped, restart it (section 4); events are durable and resume.
- If a take goes wrong: `pnpm demo:reset` and start again from beat 1. Late replies from an earlier take can't approve a new run (codes expire with the reset, and a new case id is used).
- Backup footage: `reports/recording/` (labeled rehearsal clips + receipt screenshots) and the rehearsal evidence files. Label them as recorded rehearsals if used.
