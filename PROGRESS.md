# UNDO progress

Release status: **DEMO_READY_WITH_LIMITS — only U24 (Armature) outstanding** (updated 2026-10-17 21:30 PDT)

Acceptance 36/37 (`reports/acceptance.json`, `reports/FINAL_VERIFICATION.md`). Voice V01–V05 VERIFIED. Purchase-aware PA01–PA12 pass.

## Gates
- U-G0 Access: ✅ Manufact, Neon, Claude (local login), Inkbox (identity, receiver, call.ended) — provider smoke 7/7. ⏳ Armature (user setup)
- U-G1 Recovery engine: ✅ 62 integration + 15 security + 9 unit tests
- U-G2 Vertical slice: ✅ live owner iMessage, voice call, customer email through one Inkbox identity
- U-G3 Conversations: ✅ durable inbox/outbox, signed receiver, YES-code approval checked in code
- U-G4 Product integration: ✅ deployed MCP (7 tools), RecoveryReceipt views, 3 MCP clients (Agent SDK worker, Claude Code CLI, mcp-use App host), fresh-agent evals A–F pass; ⏳ Armature runs
- U-G5 Release: ✅ three rehearsals (17/17 each), backup recording (`reports/recording/`), README + docs, final report

## Remaining
U24: user registers the MCP + evaluator token and an API key in Armature (evals/ARMATURE_SETUP.md); then the builder runs cases A–E via the CI API with fixture resets and records reports/armature.json.
