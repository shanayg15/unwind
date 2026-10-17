# UNDO progress

Release status: **BUILDING** (updated 2026-10-17 15:20 PDT)

## Gates
- U-G0 Access: Manufact ✅, Neon ✅, model (local Claude login) ✅, Inkbox identity ✅, receiver subscription ✅, Armature ⏳ (user sign-in + cases)
- U-G1 Recovery engine: ✅ 18 integration tests on the Neon test branch
- U-G2 Vertical slice: ✅ engine; ✅ hosted MCP (10/10 probe local + deployed); ✅ real launch agent through hosted MCP; ⏳ live owner withdrawal
- U-G3 Conversations: ⏳ live owner iMessage + customer email through the worker
- U-G4 Product integration: ✅ deployed MCP + views bound; ⏳ App rendered in Inspector; ⏳ Armature runs
- U-G5 Hardening/release: ⏳

## Acceptance (evidence in tests / reports)
Passed in integration tests (Neon test branch): U01 U02 U03 U05 U06 U07 U08 U09 U10 U11 U12 U13 U14 U16 U26 U27 U28 U29 U30 (+ DB-level bypass rejection)
Passed via protocol probe (local + deployed): U32 (seven tools, auth rejection, scoped errors)
Pending: U04 (agent selection, live) U15 U17 U18 U19 U20 U21 U22 U23 U24 U25 U31; voice V01–V05 not enabled

## Active task
Live owner withdrawal over iMessage → worker → fresh agent → preview/impact/conflict question.

## Next checkpoint
Owner text exchange + approval link + apply/verify; then customer email.
