# UNDO — selected build handoff

**Latest package: revision 2 execution / revision 5 idea, October 17, 2026.** UNDO is selected. This replaces older UNDO ZIPs and earlier six-tool/one-channel specifications. MOTOR is not in this build. These are specifications, not a built application.

## Start

1. Extract this folder. Copy its contents into the intended repository root, preserving existing code, `CLAUDE.md`, environment values, and Git rules. Do not dump it into an unrelated active repository.
2. Open the actual repository in your coding-agent client. Paste `UNDO_Goal.txt` (1332 characters excluding its trailing newline).
3. The builder must inspect existing tools, read all required docs, give a consolidated missing-setup checklist, guide account/MCP/channel setup, and verify the probes.
4. Approve the sandbox, scope, remaining deadline, budget, and test contacts. Then the agent should implement and test through the definition of done without repeatedly asking about routine engineering decisions.
5. Keep the execution client alive as its real operation requires. External account/authorization blockers still need a human answer; a goal prompt is not a guarantee of background execution.

## The fixed product and communication contract

**Undo the campaign. Keep the business running.** A fresh shop agent selectively recovers recorded prices/promotional copy/homepage changes while preserving sizing corrections, later price edits, clearance, navigation, and existing orders. It uses exact captured history and order-price provenance, not remembered values or a hidden hardcoded demo.

**One Inkbox shop identity:** owner phone texts and optional enabled calls; customer email. Text/email are the baseline; owner voice is added only after they work and is explicitly tested if enabled. Same-channel fallback requires approval. Shared identity does not mix authority or private contexts.

**Three sponsors:** Manufact product MCP/App; Inkbox communication; Armature agent-use evaluation. One supporting Postgres/backend. No refund or real Shopify guarantee.

## Read in this order

| File | Purpose |
|---|---|
| `SELECTED_IDEA.md` | Frozen selection and scope. |
| `UNDO_Agent_Production_Recovery_Idea.md` | Pitch, agent value, five headline tools, concrete story, limits, and competition. |
| `UNDO_Execution.md` | Normative setup, architecture, data/API contracts, algorithms, tests, and definition of done. |
| `INKBOX_Channel_Plan.md` | Owner text/call versus customer email; setup, conversations, authority, optional voice processing. |
| `DEMO_RUNBOOK.md` | Exact fixture, roles, live sequence, variations, reset, and fallback presentation. |
| `SOURCE_NOTES.md` | Official docs and verification boundaries. |
| `SETUP_STATUS.template.md` | Copy to setup ledger and fill using real probes. |
| `.env.example` / `.gitignore` | Merge private configuration and safe source-control rules; no credentials included. |
| `UNDO_Goal.txt` | Short start instruction; points to complete requirements. |

`MANIFEST.json` and `PACKAGE_VALIDATION.md` concern document integrity only, not application completion.

## What the builder must not miss

Seven canonical MCP tools: `undo_capabilities`, `undo_execute`, `undo_history`, `undo_preview`, `undo_impact`, `undo_apply`, `undo_verify`. Five headline functions are execute/preview/impact/apply/verify; two helpers support fresh-agent discovery.

Before claiming `DONE_SCOPED_RELEASE`: U01–U32 pass with evidence, real owner-phone/customer-email exchanges work, the deployed MCP/App and Armature integration work, and three demo rehearsals pass. If voice is enabled, V01–V05 also pass. An approval change must not silently weaken recovery or privacy guarantees. No claim of enterprise certification, universal undo, fake sponsor usage, or invented savings.
