# UNDO progress

Release status: **BUILDING** (updated 2026-10-17 16:27 PDT)

## Gates
- U-G0 Access: ✅ Manufact, Neon, model (local Claude login), Inkbox identity + receiver subscription. ⏳ Armature (user sign-in + cases)
- U-G1 Recovery engine: ✅ (integration suite on Neon test branch)
- U-G2 Vertical slice: ✅ deployed; real launch agent; live owner withdrawal over iMessage → preview/impact → conflict question → owner decision → approval → apply → verify → completion text (reports/runs/live-1-owner-imessage.json)
- U-G3 Conversations: ✅ owner iMessage round trips (3 delivered); ⏳ customer email round trip; ✅ durable inbox/outbox with leases
- U-G4 Product integration: ✅ deployed MCP (seven tools), ✅ RecoveryReceipt + plan views render from the deployed server (reports/app-view/), ✅ fresh-agent evals 4/4 on deployed MCP (reports/eval-agent.json); ⏳ Armature runs
- U-G5 Hardening/release: ✅ unit 9, integration 24, security 15, e2e 11, smoke 11, MCP probe 10; ⏳ three rehearsals, recording, final report

## Acceptance
Evidence-backed so far: U01–U20, U22, U23, U26–U32 (tests + live run + deployed probes). Remaining: U21 (customer email), U24 (Armature), U25 (3 rehearsals). Voice V01–V05: NOT_ENABLED.

## Active task
Waiting on: customer email from the approved test address; Armature workspace setup.

## Next checkpoint
Customer email → offer owner voice (needs approval) → Armature runs → three rehearsals → recording → reports/FINAL_VERIFICATION.md.
