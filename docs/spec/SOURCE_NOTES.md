# UNDO source notes and verification boundaries

**Updated October 17, 2026.** The selected architecture, fixture, API names, acceptance tests, and budgets are design requirements, not existing product results. No sponsor account was logged into or tested by preparing this package. Read current official docs and installed versions during setup.

## Shared implementation references

- **S1 — Manufact:** https://manufact.com/ — hosting/inspection/client testing; account deployment needs real verification. Retained official reference.
- **S2 — mcp-use quickstart:** https://docs.mcp-use.com/typescript/getting-started/quickstart — reopened this revision; documents Node.js 22.22.2+, scaffold, development Inspector, and deploy workflow. Pin versions compatible with the actual environment.
- **S3 — MCP App quickstart:** https://docs.mcp-use.com/typescript/mcp-apps/quickstart — reopened; implement an actual tool-bound view and verify a compatible host, not a website called an App.
- **S4 — Armature goal evaluations:** https://docs.armature.tech/evaluation/eval-cases — reopened; use goal-driven agent tests with independently checked backend outcomes. No account quota or test result is implied.
- **S5 — Claude Code MCP setup:** https://code.claude.com/docs/en/mcp — retained reference; use installed-client instructions and verify connections. No assumption that a chat subscription provides an API key or that a goal continues after client shutdown.
- **S6 — MCP Apps extension:** https://modelcontextprotocol.io/extensions/apps/overview — retained reference; actual host support and auth need verification.

## Inkbox references — checked this revision unless noted

- **U1 — Introduction:** https://inkbox.ai/docs — persistent identity with mailbox and optional phone. We select one identity with owner phone/customer email; actual account provisioning remains undone.
- **U2 — Webhooks:** https://inkbox.ai/docs/webhooks — reopened; use signed events, real provider event IDs, actual delivery states, and capability-appropriate subscriptions. Transport authenticity is not merchant authority.
- **U3 — Texts:** https://inkbox.ai/docs/api/phone/texts — reopened; check sender readiness, US recipient opt-in, contact restrictions, and error/retry semantics. We require a tested owner-phone route; do not assume instant SMS readiness.
- **U4 — Signing/discovery:** https://inkbox.ai/docs/signing-keys and https://inkbox.ai/docs/llms.txt — documentation index reopened; signing page is a retained pointer. Follow actual method/key formats instead of inventing cryptography.
- **U9 — Hosted voice:** https://inkbox.ai/docs/capabilities/phone/hosted-call-agent — reopened; no custom tools inside hosted calls, and authority must be explicitly narrowed to contact_scoped. Voice is optional until enabled; our worker validates decisions after the call.
- **U10 — Call result handling:** https://inkbox.ai/docs/webhooks#subscribing-to-call-lifecycle-events — inspected within the webhooks page; final event may include an abridged transcript, with an authoritative transcript lookup. Voicemail/call completion does not establish approval. Follow actual SDK/runtime support.
- **U11 — Email:** https://inkbox.ai/docs/capabilities/email and https://inkbox.ai/docs/api/mail/messages — discovered in the current official documentation index; read these in full during implementation for sending/reply/thread/recipient semantics. Not a live email test.
- **U12 — Contact policies:** https://inkbox.ai/docs/capabilities/contact-rules and https://inkbox.ai/docs/api/phone/contact-rules — current official index references; inspect during setup and grant only the approved recipients/channels.

Do not copy broad-privilege examples from provider docs into the product. One shop identity does not require giving a voice/model session all of that identity's history or organization contacts. All outbound work remains within explicit consent, recipient, purpose, and budget limits.

## Recovery, target-platform, and competition references — retained, not newly benchmarked

- **U5 — PostgreSQL locking:** https://www.postgresql.org/docs/current/explicit-locking.html — required implementation reference for conditional writes; a local lock supplies no global lock over third-party APIs.
- **U6 — Amend:** https://www.useamend.com/ — close competitor previously checked for session undo/conflicts; do not claim novelty or superior reliability without direct testing.
- **U7 — Ecommerce agents / order schema:** https://help.shopify.com/en/manual/ai-powered-tools/sidekick and https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem — retained from previous research. Our controlled store records price-revision provenance itself; a Shopify object is not proof of campaign causation.
- **U8 — Existing recovery patterns/tools:** https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction ; https://github.com/LokeyDev0/UndoMCP-Tool ; https://wordpress.org/plugins/cowboy-mcp/ — retained prior research. Inspect exact current features and licensing before comparison/reuse.

## Source of the scenario and prizes

The latest scenario is the user's selected hypothetical ecommerce workflow, not an asserted historical incident: valid campaign followed by changed owner intent. Caps remain enforced. Order association is captured revision lineage, not estimated marketing impact.

Sponsor tracks and prizes come from the user's pasted event listing: Manufact $2,000/$700/$300 cash; Armature $1,000/$500/$300 cash; Inkbox $1,000/$500/$200 credits (no cash listed). Account limits, revised judging rules, award stacking, remaining time, and video/stage requirements must be checked at setup. The earlier listing put submissions/live demos on October 18 at 10 a.m. Pacific. Do not assume a fresh 24 hours remains.

## What was actually done in this handoff revision

Updated idea and execution documents; aligned the tool list, component recovery, order provenance, fresh-agent demonstration, channel roles, optional voice gates, and setup/goal files. Documentation links were checked as described above. No implementation, deployed endpoint, live message/call, hosted evaluation, or application acceptance test has been performed by this handoff-generation step.
