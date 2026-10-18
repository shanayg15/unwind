# UNDO progress

Release status: **BUILDING** (updated 2026-10-17 18:20 PDT)

## Gates
- U-G0 Access: ✅ Manufact, Neon, model (local Claude login), Inkbox identity + receiver + call.ended subscriptions. ⏳ Armature (user sign-in + cases)
- U-G1 Recovery engine: ✅ (integration suite on Neon test branch)
- U-G2 Vertical slice: ✅ deployed; live owner withdrawal over iMessage end to end (reports/runs/live-1-owner-imessage.json)
- U-G3 Conversations: ✅ owner iMessage + customer email through ONE identity; ✅ durable inbox/outbox with leases
- U-G4 Product integration: ✅ deployed MCP (seven tools), ✅ RecoveryReceipt + plan views (reports/app-view/), ✅ fresh-agent evals A–F on deployed MCP (reports/eval-agent.json); ⏳ Armature runs
- U-G5 Hardening/release: ✅ unit, integration, security, e2e 11, smoke 11, MCP probe 10; ⏳ three rehearsals, recording, final report

## Voice (V01–V05): ENABLED_UNTESTED
Contact-scoped hosted calls (≤6, ≤180 s, owner only), call.ended settlement, one text fallback, kill switch. V02–V05 pass (mocked provider). V01 needs one real call with the user.

## Purchase-aware rollback (addendum, adopted 17:10)
Gift-promotion adapter + order-dependency contract built and deployed. PA01–PA09, PA11 pass (incl. barrier races, retries, crash rollback, bypass attempts); eval E/F pass on the deployed MCP. PA10/PA12 need the live pouch run (in progress: owner text sent, awaiting YES). Report: reports/PURCHASE_AWARE_ACCEPTANCE.md (scripts/pa-report.ts).

## Agent experience (18:15)
undo_preview selects by labels / all_changes / change_ids, infers the rollout when unambiguous; idempotency keys default safely; history label_summary + next_action; capabilities quickstart; summary lines carry the key numbers.

## Next checkpoint
Live pouch run (YES + customer email) → evidence + PA report → V01 call → Armature → three rehearsals → recording → reports/FINAL_VERIFICATION.md.
