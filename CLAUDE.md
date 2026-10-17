# UNDO (YC hackathon, Manufact/Inkbox/Armature)

Reading order: `HANDOFF.md` (current state) → `PROGRESS.md` → `spec/README_START_HERE.md` → `spec/UNDO_Execution.md` (normative) →
`spec/INKBOX_Channel_Plan.md` → `spec/DEMO_RUNBOOK.md`. Decisions: `DECISIONS.md`. Setup evidence: `SETUP_STATUS.md`.

Layout: `index.ts` (mcp-use server: 7 tools + routes) · `src/` (db, recovery engine, impact, approvals, comms, web) · `views/` (MCP App
views) · `src/ui/` (shared receipt UI) · `worker/` (local agent worker) · `harness/` · `scripts/` · `tests/`.

Rules: never commit `.env` or `.private/`; never print tokens/keys/contacts; tests use `DATABASE_URL_TEST` only; run anything that uses
Claude with `CLAUDE_CODE_OAUTH_TOKEN` unset; keep exactly seven public MCP tools; never weaken DB triggers or approval checks.
Protected: `src/db/migrations/*` (add new migrations, do not edit applied ones), `tests/`, `evals/`.
