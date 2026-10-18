# UNDO setup status — copy to SETUP_STATUS.md

No credentials or full private contact data belong here. Mark READY only after the actual probe passes. Check existing configuration before asking for repeated setup.

Selected idea: UNDO (already selected)
Repository and existing work: NOT_CHECKED
Actual current time / submission deadline / stage length: NOT_CHECKED
Total and provider budgets: NOT_APPROVED
Permitted sandbox/store namespace: NOT_APPROVED
Approved owner/customer contacts and consent: NOT_APPROVED
Target adapter: controlled Postgres storefront unless an explicit approved change is recorded
Owner channel: phone text (SMS by default; tested alternative requires approval)
Customer channel: email
Voice: NOT_ENABLED until enabled after text/email core readiness

| Dependency | Status | Redacted probe evidence | Specific user action if blocked | Verified at |
|---|---|---|---|---|
| Local repo/runtime/ports/resources | NOT_CHECKED | | | |
| Runtime model/headless client + usage/budget | NOT_CHECKED | | | |
| Manufact SDK/local MCP + deployment route | NOT_CHECKED | | | |
| Authenticated remote MCP client | NOT_CHECKED | | | |
| Actual MCP App-rendering host | NOT_CHECKED | | | |
| Armature endpoint/test-scoped credential + quota | NOT_CHECKED | | | |
| Inkbox single shop identity/mailbox | NOT_CHECKED | | | |
| Owner phone channel provisioning/permissions | NOT_CHECKED | | | |
| Owner opt-in + real text round trip | NOT_CHECKED | | | |
| Customer email permissions + real email round trip | NOT_CHECKED | | | |
| Signed event receiver, email and text subscriptions | NOT_CHECKED | | | |
| Role/case/plan-bound owner authentication | NOT_CHECKED | | | |
| Customer order-bound authentication | NOT_CHECKED | | | |
| Transactional Postgres + typed writers | NOT_CHECKED | | | |
| Durable inbox/outbox worker + restart | NOT_CHECKED | | | |
| Hosting HTTPS + artifact access | NOT_CHECKED | | | |
| Optional owner call provisioning / contact-scoped mode | NOT_ENABLED | | | |
| Optional owner call result / authorization / resumption | NOT_ENABLED | | | |

ACCESS_READY: NO
INTEGRATIONS_VERIFIED: NO
Approved scope reductions: NONE
External actions/spend authorized: NONE UNTIL USER APPROVAL

An email-only substitute for owner text/customer email changes the requested demo and needs approval. Setup bootstrap checks establish access, not proof the complete application works. Promised voice must pass V01–V05; do not relabel an unavailable call as implemented.
