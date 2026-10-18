# UNWIND (internal name: undo)

Reading order: `docs/build-log/HANDOFF.md` (current state) → `docs/build-log/PROGRESS.md` → `docs/spec/README_START_HERE.md` →
`docs/spec/UNDO_Execution.md` (normative) → `docs/spec/INKBOX_Channel_Plan.md` → `docs/spec/DEMO_RUNBOOK.md`.
Decisions: `docs/build-log/DECISIONS.md`. Setup evidence: `docs/build-log/SETUP_STATUS.md`. Recording packet: `docs/RECORDING_READY.md`.
Product name is UNWIND; internal identifiers keep `undo` (server, tools, packages).

Layout: `index.ts` (mcp-use server: 7 tools + routes) · `src/` (db, recovery engine, impact, approvals, comms, web) · `views/` (MCP App
views) · `src/ui/` (shared receipt UI) · `worker/` (local agent worker) · `harness/` · `scripts/` · `tests/`.

Rules: never commit `.env` or `.private/`; never print tokens/keys/contacts; tests use `DATABASE_URL_TEST` only; run anything that uses
Claude with `CLAUDE_CODE_OAUTH_TOKEN` unset; keep exactly seven public MCP tools; never weaken DB triggers or approval checks.
Protected: `src/db/migrations/*` (add new migrations, do not edit applied ones), `tests/`, `evals/`.
