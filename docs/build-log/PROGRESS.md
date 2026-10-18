# UNDO / UNWIND progress

Release status: **DONE_SCOPED_RELEASE** (updated 2026-10-18 00:45 PDT). Acceptance 37/37 (U01–U32, V01–V05), PA01–PA12 pass.
Recording status: **RECORDING_READY** (see RECORDING_READY.md). Three consecutive UNWIND race rehearsals passed on deployed build 47e1d9b.

## Gates
- Release gate on the final build: typecheck, unit 9/9, integration 63/63, security 15/15, build, deployed MCP probe, deployed smoke, setup check: all pass.
- Provider smoke 7/7 (Manufact, Neon, Inkbox, Claude). Fresh-agent evals A–F pass. Armature hosted runs: B/D/E passed, C partial, A failed (recorded honestly).
- Live: owner iMessage, owner voice call, customer email on one Inkbox identity; 3 weekend rehearsals + 3 UNWIND rehearsals.

## State left for recording
store_demo reset to the pre-launch fixture (pouch 10 on hand, no offer); worker running; nothing queued; budgets 39/150 messages, 1/6 calls.

## Open items for the user
- Repository is private: make it public or add judges before submitting.
- Optional: approve the launch on the phone with `--owner-link`.
