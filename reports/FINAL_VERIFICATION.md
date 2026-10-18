# UNDO final verification

Generated 2026-10-18T07:03:55.756Z from evidence files at commit `de23cf1`. Deployed build: `47e1d9b` (Manufact deployment 948ae230-3cc4-499c-9d94-896cbdf0fe35).

**Release status: DONE_SCOPED_RELEASE**

Acceptance: 37/37 items with passing evidence. Voice: VERIFIED. Purchase-aware: PA01=passed PA02=passed PA03=passed PA04=passed PA05=passed PA06=passed PA07=passed PA08=passed PA09=passed PA10=passed PA11=passed PA12=passed.

## Gates

| Gate | Result |
|---|---|
| unit tests | 9/9 passed |
| integration tests | 63/63 passed |
| security tests | 15/15 passed |
| typecheck | pass |
| build | pass |
| mcp-deployed | pass |
| smoke-deployed | pass |
| setup-check | pass |
| deployed MCP probe | 10/10 |
| deployed smoke | 11/11 |
| browser e2e (approval page) | 11/11 |
| provider smoke (Manufact, Neon, Inkbox, Claude) | 7/7 |
| fresh-agent goal evals on the deployed MCP | A pass, B pass, C pass, D pass, E pass, F pass |

## Live and rehearsal runs (real providers)

| Run | Recovery | Verify | Owner messages | Customer messages | Voice |
|---|---|---|---|---|---|
| live-1-owner-imessage-and-customer-email | resolved_with_exceptions | verified | conflict_question=delivered, request_approval=delivered, completion_summary=delivered | order_answer=delivered | - |
| live-1-owner-imessage | resolved_with_exceptions | verified | conflict_question=delivered, request_approval=delivered, completion_summary=delivered | - | - |
| live-2-owner-voice | partially_reverted | verified | clarification=delivered, clarification=delivered, request_approval=delivered, completion_summary=delivered | - | call completed/contact_scoped |
| pouch-1 | fully_reverted | verified | request_approval=delivered, completion_summary=delivered | order_answer=delivered | - |
| rehearsal-1 | resolved_with_exceptions | verified | conflict_question=delivered, request_approval=delivered, completion_summary=delivered | order_answer=delivered | - |
| rehearsal-2 | resolved_with_exceptions | verified | conflict_question=delivered, request_approval=delivered, completion_summary=delivered | order_answer=delivered | - |
| rehearsal-3 | resolved_with_exceptions | verified | conflict_question=delivered, request_approval=delivered, completion_summary=delivered | order_answer=delivered | - |
| unwind-1 | fully_reverted | verified | request_approval=delivered, request_approval=delivered, completion_summary=delivered | order_answer=delivered | - |
| unwind-2 | fully_reverted | verified | request_approval=delivered, request_approval=delivered, completion_summary=delivered | order_answer=delivered | - |
| unwind-3 | fully_reverted | verified | request_approval=delivered, request_approval=delivered, completion_summary=delivered | order_answer=delivered | - |

## Acceptance items

| ID | Status | Evidence |
|---|---|---|
| U01 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U01 an approved, capped launch commits exact mutations with journal rows |
| U02 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U02 rejects a cap-breaking price and a forbidden field before any write |
| U03 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U03 a failure mid-write leaves no partial, unjournaled mutation |
| U04 | passed | reports/runs/live-1-owner-imessage-and-customer-email.json<br>reports/runs/live-1-owner-imessage.json<br>reports/runs/live-2-owner-voice.json |
| U05 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U05/U26/U11 exact restoration with new revisions; sizing edit and orders untouched |
| U06 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U04/U06/U07 preview: premium eligible; later shoe price and change-away-and-back are conflicts |
| U07 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U04/U06/U07 preview: premium eligible; later shoe price and change-away-and-back are conflicts |
| U08 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U08 a write between preview and apply is not overwritten |
| U09 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U09/U10 duplicate execute key replays; same key with a different body conflicts |
| U10 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U09/U10 duplicate execute key replays; same key with a different body conflicts |
| U11 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U05/U26/U11 exact restoration with new revisions; sizing edit and orders untouched |
| U12 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U12 an atomic group with one conflicting member is withheld as a whole |
| U13 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U13 owner-accepted exception yields resolved_with_exceptions, distinct from full restoration |
| U14 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U14 cross-store: the eval store's evaluator cannot see or select demo changes |
| U15 | passed | tests/security/security.test.ts: U15/U31 channel and role separation in the worker router > an unknown phone number gets no case and no reply<br>tests/security/security.test.ts: U15/U31 channel and role separation in the worker router > a customer email cannot reach the owner channel; an unknown email is rejected<br>tests/security/security.test.ts: U15/U31 channel and role separation in the worker router > group iMessages are out of scope |
| U16 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U16 apply needs the owner's confirmation of this exact plan hash<br>tests/integration/text-approval.test.ts: reply-to-approve (U16, U18, U31) > ignores ordinary text and rejects a wrong code<br>tests/integration/text-approval.test.ts: reply-to-approve (U16, U18, U31) > only the owner principal can approve; a customer reply with the right code is refused |
| U17 | passed | tests/security/security.test.ts: U17 signed receiver > accepts a valid signed event exactly once<br>tests/security/security.test.ts: U17 signed receiver > rejects an altered body, a bad signature, a missing token, and an oversized payload |
| U18 | passed | tests/integration/text-approval.test.ts: reply-to-approve (U16, U18, U31) > ignores ordinary text and rejects a wrong code<br>tests/integration/text-approval.test.ts: reply-to-approve (U16, U18, U31) > only the owner principal can approve; a customer reply with the right code is refused<br>tests/integration/text-approval.test.ts: reply-to-approve (U16, U18, U31) > an old code cannot approve a newer plan (out-of-order reply) |
| U19 | passed | tests/security/security.test.ts: U19 durable leases > an expired processing lease is reclaimed; attempts are bounded<br>tests/security/security.test.ts: U19 durable leases > an outbox row with an unknown outcome is never resent automatically |
| U20 | passed | reports/runs/live-1-owner-imessage-and-customer-email.json (owner iMessage, approved scope reduction: iMessage for SMS)<br>reports/runs/live-1-owner-imessage.json (owner iMessage, approved scope reduction: iMessage for SMS)<br>reports/runs/live-2-owner-voice.json (owner iMessage, approved scope reduction: iMessage for SMS) |
| U21 | passed | reports/runs/live-1-owner-imessage-and-customer-email.json (customer email thread)<br>reports/runs/rehearsal-1.json (customer email thread)<br>reports/runs/rehearsal-2.json (customer email thread) |
| U22 | passed | reports/eval-agent.json (fresh agent, deployed MCP, no launch transcript)<br>reports/runs/live-1-owner-imessage-and-customer-email.json<br>reports/runs/live-1-owner-imessage.json |
| U23 | passed | reports/app-view/pouch-retirement-plan.png<br>reports/app-view/recovery-plan-deployed.png<br>reports/app-view/recovery-receipt-deployed-light.png |
| U24 | passed | armature run 08a2b655-6adc-5261-81cc-3931e7f1e922 case C (openai:gpt-4o-mini): judge failed, db fail<br>armature run ac009490-acf1-5bde-9e44-c427fdc6f92b case A (Claude Haiku 4.5): judge failed, db fail<br>armature run 0c9579be-be10-5a2a-a207-270098ae3821 case B (Claude Haiku 4.5): judge passed, db pass |
| U25 | passed | reports/runs/rehearsal-1.json<br>reports/runs/rehearsal-2.json<br>reports/runs/rehearsal-3.json |
| U26 | passed | tests/integration/ax.test.ts: U26 agent-friendly selection > labels select exactly the recorded changes carrying them; all_changes selects the whole rollout<br>tests/integration/ax.test.ts: U26 agent-friendly selection > the rollout is inferred only when exactly one is recoverable<br>tests/integration/ax.test.ts: U26 agent-friendly selection > bad selections fail with a usable hint |
| U27 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U27/U28 impact: direct link from checkout provenance; unrelated and unknown are not attributed |
| U28 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U27/U28 impact: direct link from checkout provenance; unrelated and unknown are not attributed |
| U29 | passed | tests/integration/recovery.test.ts: UNDO engine on real Postgres (Neon test branch) > U29 customers see only their own order |
| U30 | passed | tests/integration/impact-consistency.test.ts: U30 consistent impact and readback > paging at a fixed cutoff returns every order exactly once<br>tests/integration/impact-consistency.test.ts: U30 consistent impact and readback > a later order does not change an as-of report; the latest report includes it<br>tests/integration/impact-consistency.test.ts: U30 consistent impact and readback > verify reports orders placed after the plan cutoff separately and keeps the snapshot check exact |
| U31 | passed | tests/integration/text-approval.test.ts: reply-to-approve (U16, U18, U31) > ignores ordinary text and rejects a wrong code<br>tests/integration/text-approval.test.ts: reply-to-approve (U16, U18, U31) > only the owner principal can approve; a customer reply with the right code is refused<br>tests/integration/text-approval.test.ts: reply-to-approve (U16, U18, U31) > an old code cannot approve a newer plan (out-of-order reply) |
| U32 | passed | reports/mcp-probe.json (deployed) |
| V01 | passed | reports/runs/live-2-owner-voice.json (real owner call, case-bound outcome) |
| V02 | passed | tests/integration/voice.test.ts: V02 voicemail / no answer / unclear > no answer: no approval, no store change, one text fallback, case pending<br>tests/integration/voice.test.ts: V02 voicemail / no answer / unclear > declined: no approval, no store change, one text fallback, case pending<br>tests/integration/voice.test.ts: V02 voicemail / no answer / unclear > voicemail: no approval, no store change, one text fallback, case pending |
| V03 | passed | tests/integration/voice.test.ts: V03 duplicate and stale call results > a replayed call.ended has one local effect<br>tests/integration/voice.test.ts: V03 duplicate and stale call results > an answer for an older intent or expired plan is marked stale and never approves<br>tests/integration/voice.test.ts: V03 duplicate and stale call results > an abridged inline transcript is replaced by the authoritative lookup |
| V04 | passed | tests/integration/voice.test.ts: V04 authority and context > places a hosted call to the case owner only, explicitly contact_scoped, with a narrow brief<br>tests/integration/voice.test.ts: V04 authority and context > customer cases, foreign plans, and disabled voice cannot place calls<br>tests/integration/voice.test.ts: V04 authority and context > the brief is bounded even for a long question |
| V05 | passed | tests/integration/voice.test.ts: V05 failure, budget, and stop > one call per plan and no second call while one is active<br>tests/integration/voice.test.ts: V05 failure, budget, and stop > the call budget is a hard cap and the text path still works after it<br>tests/integration/voice.test.ts: V05 failure, budget, and stop > an ambiguous placement failure is recorded once and never retried |

## Approved scope changes and honest limits

- Owner channel is iMessage through the Inkbox shared line instead of SMS (user-approved). Owner voice enabled with ≤6 calls of ≤180 s to the owner only; each call is contact_scoped (the identity default could not be narrowed with our key).
- Agent worker runs on the operator's Mac with the local Claude login (approved); it is lease-durable but needs that machine online.
- Rehearsals 1–2 ran on c0754e6 and rehearsal 3 on 8fcc5c5. The only difference is that approval events now carry plan_hash and apply accepts approval_id alone (fix found during rehearsal 3). Rehearsal owner texts 2–3 were sent from the owner's Mac Messages with approval.
- Purchase-aware rollback is one gift-promotion adapter on the controlled store's own inventory; no shipping, payments or refunds.
- An atomic group stays withheld when the owner keeps one member's later value (linked copy then stays as is; the receipt says so).
- See docs/SECURITY_AND_LIMITS.md. No claim of universal undo, novelty, or production certification.
