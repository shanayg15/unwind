# UNDO setup status

Updated 2026-10-17 14:25 PDT by the builder agent. No credentials or full contact data here. READY means a real probe passed.

Selected idea: UNDO (already selected; spec copied to `spec/`)
Repository and existing work: READY. `~/yc_hack_1017` (private github.com/shanayg15/yc_hack_1017), main, one commit (README only). No prior code.
Actual current time / submission deadline / stage length: time 2026-10-17 14:19 PDT. Deadline **Sun 2026-10-18 10:00 PT** (Manufact slides; live demos 10:00, judging done 11:00). Stage length: NOT_CHECKED. Submission needs a demo video URL.
Total and provider budgets: NOT_APPROVED (proposal below)
Permitted sandbox/store namespace: NOT_APPROVED (proposal: tagged `undo_demo_*` / `undo_eval_*` store namespaces in one new Neon project)
Approved owner/customer contacts and consent: NOT_APPROVED (proposal: owner = his phone +1925***1746 over iMessage; customer = one of his own email addresses)
Target adapter: controlled Postgres storefront
Owner channel: iMessage via Inkbox shared router (SMS would need a newly provisioned number; substitution needs approval)
Customer channel: email
Voice: NOT_ENABLED

| Dependency | Status | Redacted probe evidence | Specific user action if blocked | Verified at |
|---|---|---|---|---|
| Local repo/runtime/ports/resources | READY | macOS 26.5 arm64, 16 GB RAM (~2.7 GB free), 9.7 GB disk free; node 25.9.0, pnpm 10.12.3, git 2.39; Docker not running (not needed); ports 3000/3010/5173/5432/8080 free; 8767 used by the Inkbox bridge | none | 14:19 |
| Runtime model/headless client + usage/budget | READY (subscription, local) | Bundled Claude Code 2.1.301 (Agent SDK) headless call returned `OK` on claude-opus-5-5 with the Keychain login shanaygaitonde@gmail.com (Max); weekly 11% used, resets Oct 22. Must run with `CLAUDE_CODE_OAUTH_TOKEN` unset (the ~/.zshenv token is capped until Oct 18 18:00). No API key, so the agent worker runs on this Mac. | Approve local worker on subscription (or supply an API key for a cloud worker) | 14:13 |
| Manufact SDK/local MCP + deployment route | READY (access) | mcp-use CLI 2.10.1 logged in (org `org-808238af-w8cml`, owner); GitHub App installation 172513277 on shanayg15 with access to yc_hack_1017; mcp-apps scaffold typechecked, built, served `initialize`/`tools/list`/call locally | Approve pushing to the private repo + GitHub-backed deploy | 14:01 |
| Authenticated remote MCP client | NOT_CHECKED | Claude Code 2.1.238 and Codex 0.148 installed; needs deployed URL | none yet | |
| Actual MCP App-rendering host | NOT_CHECKED | Planned: inspector.manufact.com (supports headers) + Claude/ChatGPT if OAuth added | none yet | |
| Armature endpoint/test-scoped credential + quota | BLOCKED | Docs read: free plan 100 finished runs/month, 1 target/case, cases created only in the web UI, Evaluation may need enabling per workspace | Sign in at app.armature.tech, confirm the Evaluation sidebar exists (else email contact@armature.tech), later register the deployed MCP URL + test bearer token | 14:24 |
| Inkbox single shop identity/mailbox | READY | Identity `yc-hack-shanay` (id 8bdb127e…), mailbox yc-hack-shanay@inkboxmail.com (id 93c0d377…), signing key configured; intro email delivered to Gmail inbox | none | 14:06 |
| Owner phone channel provisioning/permissions | APPROVED_FALLBACK pending | No dedicated number (`imessage_number=None`, no SMS number). Shared iMessage router assignment to owner phone ACTIVE (created 21:08 UTC). SMS needs `POST /phone/numbers` (max 3/org) then sms_status `pending→ready` and recipient START opt-in | Approve iMessage as the owner phone channel, or approve provisioning an SMS number | 14:08 |
| Owner opt-in + real text round trip | READY (iMessage, via bridge) | "hi are u there" in, "Yep, I'm here!" out, delivered, 7 s (bridge path, not UNDO receiver yet) | none | 14:16 |
| Customer email permissions + real email round trip | NOT_CHECKED | Outbound proven (intro email). Inbound + threaded reply not yet tested | Approve the customer test address | |
| Signed event receiver, email and text subscriptions | NOT_CHECKED | Docs: per-identity signing key (bridge holds it), up to 60 subscriptions/identity, `verifyWebhook` in @inkbox/sdk, at-least-once delivery with stable event `id` | Approve pausing the Inkbox bridge during UNDO (else both reply) | |
| Role/case/plan-bound owner authentication | NOT_CHECKED | Planned: single-use plan-hash-bound approval link texted to the owner + owner session token | none yet | |
| Customer order-bound authentication | NOT_CHECKED | Planned: order access grant bound to customer principal + verified sender address | none yet | |
| Transactional Postgres + typed writers | READY (access), project not created | Neon CLI 8.8.0 (`neon`, via pnpm global) signed in: profile DEFAULT, OAuth, account scope. Project-level Neon MCP (`.mcp.json`, OAuth, URL only) and skills `neon` + `neon-postgres` installed in `.claude/skills/`. Supabase new project = $10/month, not used. | Approve creating one free Neon project for UNDO | 14:27 |
| Durable inbox/outbox worker + restart | NOT_CHECKED | | | |
| Hosting HTTPS + artifact access | READY (access) | Manufact deploy route verified (see above) | | 14:01 |
| Optional owner call provisioning / contact-scoped mode | NOT_ENABLED | Docs: hosted Voice AI can place calls over the shared iMessage line; identity's Voice AI authority is currently `yolo` and must be set to `contact_scoped` | Later approval | |
| Optional owner call result / authorization / resumption | NOT_ENABLED | | | |

ACCESS_READY: NO (blocked on Armature workspace and approvals; Neon access now ready)
INTEGRATIONS_VERIFIED: NO
Approved scope reductions: NONE
External actions/spend authorized: NONE UNTIL USER APPROVAL
