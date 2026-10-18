# UNDO — execution contract and definition of done

**Revision 2 — October 17, 2026. UNDO selected by the user.** Read `README_START_HERE.md` and `UNDO_Agent_Production_Recovery_Idea.md` first. This is the normative implementation/acceptance contract; `INKBOX_Channel_Plan.md` specifies owner-phone/customer-email routing. Features and scripts below are requirements, not existing software. Source details are in `SOURCE_NOTES.md`. Do not reopen MOTOR versus UNDO selection; inspect real setup and begin this project after the bounded scope/access gate.

**Finish goal:** One agent publishes an approved campaign through recorded writes. A fresh agent WITHOUT that rollout transcript receives new owner intent, discovers history, previews/inspects order impact, and reverses only eligible premium price/promotional-copy/placement edits. Later sizing information, clearance, navigation, conflicting price edits, and both related and unrelated orders survive. Real owner texts and customer emails use ONE Inkbox identity; an optional enabled owner call resumes through validated post-call handling. The deployed Manufact MCP/App, real Armature evaluations, mandatory tests, and three resettable rehearsals all work. Capture exact evidence rather than claim universal recovery.

**Critical scenario correction:** The launch initially passes its price caps and review. The owner later withdraws part of it. Do not force an agent arithmetic mistake, disable prevention, or rebuild the superseded discount-stacking/technician demo.

## A. Operating contract for the coding agent

This is a build specification, not a request for another proposal. The user has selected this idea. Read the idea brief, this execution document, and the channel plan fully, inspect the existing repository, complete the setup gate, and implement the scoped product through deployment and verified demonstration. Do not stop at scaffolding, a plan, local unit tests, or a polished frontend. Do not build the other shortlisted idea.

**Engineering quality means enforceable boundaries and evidence.** It does not mean a one-day prototype is audited, enterprise-certified, bug-free, or safe for arbitrary production customers. Use the release statuses below, not vague completion language.

### A1. Authority and scope

1. Use the chosen local repository and explicitly authorized sandbox/cloud projects only. Inspect `git status` before edits; preserve unrelated work. Do not overwrite another repository's `CLAUDE.md` or global MCP settings.
2. Do not request secrets in chat or write them into tracked docs. Create a redacted `.env.example`; use ignored local configuration, a system keychain, or provider secret storage. Redact request headers, tokens, phone numbers, customer content, and signed artifact URLs from public reports.
3. Ask once for genuinely missing setup, budget, deadline, and permissions. Provide exact console location or CLI step after reading current official docs. Inspect what already works instead of making the user repeat configuration.
4. After setup approval, make ordinary engineering decisions autonomously within these constraints. Keep a short decision log. Ask again only for missing external access, money beyond the approved cap, an essential scope change, or an action outside the approved sandbox/recipient policy.
5. Do not use unrestricted permission-skipping flags as a substitute for setup. Do not buy, send to unapproved recipients, modify real customer records, or broaden OAuth scopes without authorization.
6. Do not fabricate credentials, model IDs, provider methods, deployment URLs, run IDs, metrics, recordings, approvals, or a sponsor integration. Source SDK methods from the installed version and official docs. All APIs defined below are our proposed application interfaces unless explicitly identified as provider commands.
7. Keep this goal running only through mechanisms actually available in the user's client. A prompt cannot guarantee unattended execution after the client stops. Record recovery state to disk; never say a stopped process is still working. Do not assume a specific `/goal` implementation.

### A2. First response and setup gate

Before expensive work, inspect tools and present one concise missing-setup table. Populate `SETUP_STATUS.md` with `NOT_CHECKED`, `READY`, `BLOCKED`, or `APPROVED_FALLBACK`, plus non-secret evidence and date. File existence or an API key string is not proof of connectivity.

Resolve:

| Item | User action only when necessary | Agent verification |
|---|---|---|
| Selected idea and scope | UNDO is already selected; confirm only material target/scope changes. | `SELECTED_IDEA.md` records it; do not implement MOTOR. |
| Repository and machine | Open/grant the exact project directory; approve required local services. | Working directory, clean/understood git status, available disk/RAM, free ports, OS/architecture. |
| Time remaining and rules | Supply actual submission deadline, stage length, allowed starting code, repository visibility, and video requirement. | Write concrete Pacific timestamps; work backward from the real remaining time, not a fresh assumed 24 hours. |
| Budget and credentials | Approve total/per-provider caps and account projects. Keep keys in private storage. | Harmless authenticated call, quota check where available, explicit ceilings in config. No approval means no paid provisioning. |
| Runtime model | Confirm a working model/provider or authorized headless client and its budget. | One small model response and usage record; do not assume the builder's chat subscription is a runtime API key. |
| Manufact | Sign in/link the chosen project and permit deployment. | SDK hello-world `initialize`, `tools/list`, and harmless call locally; actual remote smoke follows deployment. |
| Armature | Sign in, connect the protected test endpoint with a test-scoped credential, confirm quota. | One genuine goal-based case runs against a real test fixture. If UI setup is required, give precise steps and ask for the resulting run ID. |
| App-rendering client | Open a supported App host/Inspector; authorize the endpoint. | A real tool-bound view renders and a UI action calls the same authenticated server. A standalone web page alone does not pass. |
| Project-specific providers | Complete the additional table below. | Actual documented provider probes, not mocked responses. |

Inspect `node --version`, package manager availability, `git status`, the installed coding-client version, and `docker info` only if Docker is actually required. Use Node compatible with the selected mcp-use scaffold (the reviewed quickstart specified 22.22.2+). Pin package versions and retain one lockfile. Do not silently switch framework major versions after implementation begins.

**Bootstrap permission:** minimal schema/hello-world/echo code is allowed to verify access within a designated test namespace. `ACCESS_READY` means required accounts, permissions, and a viable deployment route are established. `INTEGRATIONS_VERIFIED` is a later release gate after the real features work. Do not create a circular requirement that the complete product must exist before setup can pass.

If something is blocked, finish independent scaffolding or tests that do not pretend to replace it. Ask for the specific unblock. A local or mocked substitute must be explicitly approved and remains a different completion status.

### A3. Distinguish three kinds of agent access

- **Builder tools:** CLI/MCP connections used by Claude to create schemas, deploy, inspect logs, and run tests. They may be powerful but are restricted to the hackathon project.
- **Product MCP server/App:** what we are building and what judges inspect. It must have its own scoped auth, stable contract, real backend, and text fallback.
- **Demo/test agent:** a fresh runtime agent that calls the product. Give it only task-appropriate capabilities. Never give it unrestricted infrastructure admin keys, database mutation access that bypasses the product, or writable evaluation criteria.

The reviewed Claude Code docs support adding a remote MCP endpoint and checking its connection. Have the builder generate the exact installed-client configuration, verify real calls, and document it. Do not mark a saved config as a successful connection. See source S5.

### A4. Progress and handoff files the builder must maintain

Create these in the implementation repo:

- `CLAUDE.md`: compact reading order, run/test commands, protected paths, current phase; link to this specification rather than copying pages of it.
- `SETUP_STATUS.md`: redacted access evidence and unresolved prerequisites.
- `DECISIONS.md`: meaningful architecture/scope changes, reasons, date, and user approval where required.
- `PROGRESS.md`: acceptance IDs completed, active task, blocker, next checkpoint.
- `HANDOFF.md`: last good commit, commands, active processes, current deployment, exact next action, and known failing tests; update at milestones and before compaction/stopping.
- `reports/acceptance.json`: machine-readable requirements and observed results, not self-assessed prose.
- `reports/FINAL_VERIFICATION.md`: commit/build IDs, environment, commands, results, source artifact paths, unresolved issues, and release status.

Only mark an acceptance item passed after recording its test and evidence. Have an independent reviewer/test pass inspect the core path if tools allow; do not pretend multiple agents were used. Parallelize independent UI/test work if available, with explicit file ownership; protect shared schemas and evaluator files.

### A5. Delivery and honest release statuses

Use these statuses:

- `SETUP_BLOCKED`: required user/account information missing.
- `BUILDING`: implementation or required tests incomplete.
- `LOCAL_ONLY`: working locally but a required hosted integration is absent.
- `DEMO_READY_WITH_LIMITS`: real vertical slice works but a named sponsor/channel/acceptance requirement is missing or explicitly reduced.
- `DONE_SCOPED_RELEASE`: every mandatory acceptance item for the approved scope passed on the actual deployed build, with artifacts and rehearsals.

Never call `LOCAL_ONLY` or `DEMO_READY_WITH_LIMITS` fully complete. Use mock providers only in clearly labeled tests; they cannot satisfy live sponsor gates. “No obvious issues” is not an acceptance result.

## B. Shared implementation and security standards

### B1. Stack and repository discipline

Default: TypeScript, a pinned Node runtime, pnpm workspace, mcp-use server/App scaffold, a small React/Vite web UI, Postgres, Vitest for unit/integration tests, and Playwright for end-to-end browser checks. Preserve an existing compatible stack instead of rewriting it for style. Do not introduce Kafka, Kubernetes, a vector database, a new orchestration framework, or multiple cloud stores for this release.

Use a bounded durable database-backed job worker where asynchronous execution is necessary. HTTP/MCP request acceptance must be distinct from completed work. Use typed schemas at every trust boundary. Monetary values are integer minor units plus currency; timestamps are UTC ISO strings and shown in event-local time when needed. IDs are opaque, not paths or provider secrets.

Generate and validate migrations, indexes, foreign keys, appropriate row-level policies or equivalent server enforcement, and realistic test fixtures. No destructive migrations against unknown schemas. For new test projects, reset only a tagged namespace with a guard and explicit development mode.

### B2. MCP and App minimum

- Authenticated HTTPS `/mcp` using a currently supported transport and current SDK contract.
- Correct `initialize`, `tools/list`, tool calls, typed inputs, stable error codes, and short text plus `structuredContent` outcomes.
- Tool annotations describe behavior; authorization and validation enforce it. An annotation is not a permission system.
- Compact result by default, evidence behind scoped IDs or expiring URLs, bounded pagination and response size.
- A real tool-bound React MCP App view with loading, error, partial, stale, and completed states; it calls the same business logic as the text tools. Verify it in a compatible host/Inspector. Provide text-only fallback for CLI clients.
- A public read-only overview/demo page without sponsor sign-in; mutation/control endpoints remain protected and rate limited. Never expose an admin Inspector unauthenticated on the public internet.
- Document one working installation/configuration path for the user's actual client. Use a scoped demo credential, not an infrastructure credential. No marketplace approval is required for a hackathon prototype unless the organizer explicitly requires it.

### B3. Security and failure handling

Authenticate each principal; derive tenant/project/role from verified credentials, not agent-provided IDs alone. Authorize every requested object, artifact, and operation. Deny cross-tenant access. Reject arbitrary callback URLs, private-network destinations, file traversal, and unvalidated HTML. Keep the App CSP narrow and render untrusted text safely. Use same-site sessions/CSRF protection for direct browser mutations and verify OAuth/session flows rather than inventing them.

Apply explicit request size limits, timeouts, bounded retries with jitter, and idempotency keys where the local contract supports them. A retry with the same key and different payload must fail. An unknown external outcome remains unknown until reconciled. Do not promise cross-provider exactly-once execution.

Separate control-plane credentials from untrusted code and external messages. Preserve audit events in append-only application paths; demo agents cannot rewrite receipts or evaluation results. Keep dependencies/license inventory and run a focused dependency/secret review. Record real high-severity findings and remediate or scope them out; don't suppress the checker to pass.

### B4. Required command contract

Implement and document these package scripts; these are requested project scripts, not pre-existing sponsor commands:

| Command | Required behavior |
|---|---|
| `pnpm setup:check` | Redacted provider/config checks; nonzero on a missing mandatory dependency. |
| `pnpm dev` | Start the documented local product; fail clearly on occupied ports. |
| `pnpm typecheck` / `pnpm lint` | Full source/type validation, excluding no critical paths. |
| `pnpm test` | Deterministic unit tests. |
| `pnpm test:integration` | Actual test-database business logic, concurrency, and lifecycle tests. |
| `pnpm test:e2e` | Browser-level happy path and error/partial states. |
| `pnpm test:security` | Focused auth, isolation, replay, input-validation tests. |
| `pnpm test:mcp` | Real local and deployed MCP protocol/tool probes. |
| `pnpm test:providers` | Explicitly consented real sponsor smoke tests, never random external contacts. |
| `pnpm eval:agent` | Fresh-agent goal run(s) with actual transcript/usage and deterministic outcome checks. |
| `pnpm build` | Production bundles with no unresolved import/type errors. |
| `pnpm deploy` | Documented approved deployment path; record URLs and build identity. |
| `pnpm smoke:deployed` | Auth, health, actual write/control, readback, and App view smoke on deployed services. |
| `pnpm demo:reset` | Reset only tagged fixtures; preserve unrelated data and release active work. |
| `pnpm demo:verify` | Assert the expected fixture state and visible outcome. |
| `pnpm verify:all` | Run mandatory gates, aggregate evidence, fail for missing required results. |

If the selected scaffold uses a different command, implement an equivalent wrapper or update this contract explicitly. `echo success`, empty test files, fixed success JSON, and screenshots without exercised backend behavior do not count.

### B5. Scheduling and stopping

Get the real deadline and budget during setup. Aim for the first complete vertical slice within the first half of remaining build time, stop adding features no later than two hours before submission, and reserve time for deployed rehearsals and packaging. Prioritize P0 gates; cut optional scope first. Never weaken a core invariant or relabel an unbuilt sponsor feature as complete to make a deadline.

After three materially different unsuccessful attempts at a provider-specific blocker, document evidence and pursue an approved fallback or request the exact help needed. Do not spend the whole event cycling through the same failing setup. Continue independent useful work while preserving an honest blocker status.

## C. UNDO-specific setup gate

| Requirement | What the user may need to do | Passing probe |
|---|---|---|
| Inkbox organization and identity | Sign in, select ONE shop identity with a mailbox and provisioned phone channel. | Same identity is verified for customer email and owner phone; retain non-secret resource IDs. |
| Required channel readiness | Complete owner SMS readiness/opt-in and customer email setup, sender/recipient rules, and budgets. A sponsor-approved tested iMessage path may substitute for owner SMS only if recorded. | Owner phone-text round trip AND customer email round trip succeed. Same-channel fallback is a scope reduction requiring approval. |
| Optional owner voice | After core text/email works, approve voice, exact owner number, bounded call budget, and participant consent. Explicitly set contact-scoped authority. | Test one call; receive the final transcript/outcome, validate a case-bound decision, and resume without making an unapproved change. If enabled, voice acceptance gates are mandatory. |
| Webhook signing | Configure documented identity signing keys/subscription to our HTTPS receiver. | Valid signed event accepted; altered raw body/bad signature rejected; duplicate event causes no second job. |
| Test participants | Approve exact owner/customer test contacts and a capped test-message budget. Bind owner to an authenticated admin session and customer to a test-order session. | Owner can authorize only the selected store; customer cannot approve recovery or view another order. |
| Database/backend | Select one isolated Postgres project with a transactional query or tested database-function path. Existing InsForge/Supabase may serve; choose one. | Mutation + journal commits together and rolls back together under deliberate test failure. |
| Deployed worker/receiver | Provide an approved HTTPS host and background worker path if the MCP host cannot run durable jobs. | Durable webhook event survives worker restart and leads to exactly one local effect under our idempotency contract. |
| Model runtime | Provide actual API/client access for the store agent, separate from the builder session. | Model can inspect fixture through scoped tools and makes a real `undo_*` call. |
| App and permissions | Open a supported MCP App host/Inspector; authorize demo owner account. | Recovery view renders; approval cannot be spoofed by the model or customer message. |

**Fixed routing:** owner instructions/decisions by phone text; optional enabled voice calls to/from the approved owner. Customer inquiries/replies by email. Same persistent shop-agent identity, separate role-scoped contexts. Phone-to-customer outreach is disabled in this release. Email-only is not equivalent to the selected demo and requires explicit fallback approval. Calls need not run alongside every text; use one path per decision and deduplicate cross-channel replies. Inbound contact linking and signature checks do not replace business authorization. Ask the sponsor for current SDK docs/scopes; do not guess APIs.

Minimize later interruptions by preparing the consented test contacts and canned demo decisions during setup. Integration tests may use a separately provisioned participant identity or actual participant replies; identify automated participants as test actors. They cannot fake provider delivery. A genuine later authorization/account blocker still requires user action; do not hide it to pretend fully unattended completion.

### C1. Configuration contract

Internal `.env.example` names: `APP_BASE_URL`, `MCP_PUBLIC_URL`, `DATABASE_URL` or a documented RPC configuration, `MCP_AUTH_MODE`, `SESSION_SECRET`, `INKBOX_API_KEY`, `INKBOX_IDENTITY_ID`, `INKBOX_WEBHOOK_KEY_REF`, `INKBOX_WEBHOOK_AUTH_TOKEN`, `MODEL_PROVIDER`, `MODEL_ID`, `MODEL_API_KEY`, `DEMO_STORE_ID`, `MAX_TOTAL_SPEND_USD`, `MAX_LIVE_MESSAGES`, `MAX_LIVE_CALLS`, `MAX_CALL_DURATION_SECONDS`, `OWNER_PHONE_CHANNEL`, `CUSTOMER_CHANNEL`, `OWNER_VOICE_ENABLED`, `INKBOX_VOICE_AUTHORITY_MODE`, `LIVE_SEND_ENABLED`, and `TEST_NAMESPACE`.

These are our proposed environment names, not claims about SDK constructor names. Store signing/verification material exactly as required by current Inkbox documentation. Do not place full private keys or recipient lists in public evidence. Default live send is disabled until approved contacts/budget and the real channel are verified.

## D. Architecture and product boundary

```text
Owner/customer -> Inkbox -> signed HTTPS receiver -> durable inbox/events
                                                      -> agent worker
Fresh agent -> Manufact-hosted authenticated UNDO MCP -> recovery service
                                                      -> one Postgres database
MCP App / web owner view -> scoped approval service -> same recovery service
Storefront + operator + test checkout -> typed application writers -> same DB
Armature -> isolated fixture/store namespace -> same MCP + deterministic checks
Outbound messages <- transactional outbox <- verified case/decision/order state
```

INKBOX handles communication transport and identity infrastructure. UNDO handles state capture, selected changes, reversal rules, conflicts, authorization binding, and verification. The agent interprets new intent; it does not manufacture before-state or inverses. All controlled store writers share versioning and transaction rules.

Suggested layout:

```text
apps/mcp/                recovery tools, transport/auth, RecoveryReceipt App
apps/storefront/         product pages, campaign slots, test checkout
apps/owner/              recorded launches, preview/approval/conflict interface
services/recovery/       typed mutations, journal, selection, conditional inverse
services/impact/         order-price provenance, scoped exposure queries, verification
services/agent-worker/   inbox jobs, scoped model tools, case state
services/comms/          Inkbox adapter, signed receiver, inbox/outbox delivery
packages/contracts/     versioned DTOs, money, actor/role schemas
packages/db/            migrations, stored functions, role grants, test factories
harness/                fresh-agent goals, transcript/usage recorder
evals/                  frozen scenario assertions and Armature cases
scripts/                setup, seed, reset, deploy, verify
reports/                redacted actual evidence
```

Default to a controlled Postgres store. It is a Shopify-style demonstration, not a Shopify integration. Do not build arbitrary SQL tools, payment actions, deletes, production-store installs, or an external commerce adapter without an explicit scope change. A local transaction does not encompass remote APIs; a local lock cannot prevent edits through a third-party native admin.

## E. Data model and invariants

### E1. Model components explicitly

Use separate versioned components for price, promotional copy, sizing information, and homepage slots so independent changes can be recovered independently. Component identity is not an arbitrary JSON path chosen by the caller; declare it in the adapter. Proposed tables:

| Table | Essential fields and constraints |
|---|---|
| `stores` / `principals` / `store_memberships` | Tenant/store ownership, verified roles, server-derived authorization. |
| `products` | Stable ID, store ID, collection ID, SKU; not all fields are mutable through UNDO. |
| `product_prices` | Product ID, integer amount, currency, monotonic revision, last actor/action. |
| `product_content` | Product ID + fixed component key (`promotional_copy` or `sizing_info`), bounded value, independent monotonic revision, last actor/action. Unique `(store_id, product_id, component_key)`. |
| `store_slots` | Slot ID, typed safe JSON content, monotonic revision; premium, clearance, navigation are distinct slots. |
| `inventory` | Separate from price/content so ordinary stock movements do not fabricate a price conflict. |
| `orders` / `order_lines` | Immutable checkout snapshots: store/customer IDs, SKU, quantity, actual unit amount/currency, total, order-time status, `source_price_revision` and nullable `source_change_id`/`source_rollout_id`. Explicit test-order flag. Null provenance stays unknown. |
| `rollouts` | Goal, owner-approved proposal hash, permitted store/targets/fields, plan version, state. |
| `actions` / `action_changes` | Exact typed targets, before/after values and revisions, original actor, scope labels, group/dependency identity, request hash, committed time. |
| `recovery_plans` / `recovery_items` | Selected immutable change IDs, current observations, proposed inverses, conflicts, keep-current exceptions, plan hash/expiry, authorization reference. |
| `recovery_attempts` | Result, verification receipts, request hash, committed compensation IDs, partial/complete state. |
| `approvals` / `policy_grants` | Authenticated principal, store/run/selection hash, allowed action, expiry, nonce, consumed status. |
| `cases` / `case_events` | Current intent version, selected rollout, communications, role-separated state and ownership. |
| `impact_reports` | Read-only snapshot/report ID, store, rollout/selection hash, cutoff, max order sequence, coverage/truncation, provenance classes, referenced order IDs; immutable report does not freeze future commerce. |
| `order_access_grants` | Bound customer principal/order, expiring scope, revocation; knowing an email/order ID is not authentication. |
| `voice_sessions` (if enabled) | Provider call ID, verified owner binding, case/version, plan hash, consent/budget, call outcome, transcript reference, proposed decision state, processing idempotency key. |
| `inbox_events` / `outbox_messages` | Provider event IDs, payload hashes, processing leases, dedupe keys, delivery states, case links. |
| `idempotency_keys` / `audit_events` | Unique local request keys and immutable audit events with correlation IDs. |

All IDs and queries are store-scoped. Add foreign keys, uniqueness, safe null handling, indexes for pending jobs/current cases/action lookups, and currency constraints. Use actual database constraints for invariants rather than only frontend validation.

### E2. Supported mutation contract

Initial adapters:

- `catalog.set_price(product_id, amount_minor, currency, expected_revision)`.
- `catalog.set_content(product_id, component_key, value, expected_revision)`; whitelist `promotional_copy` and `sizing_info` per role. Launch edits only promotional copy; alternate operator edits sizing.
- `store.set_slot(slot_id, typed_content, expected_revision)`.

Agent cannot submit SQL, arbitrary URLs, deletion, an executable inverse, or its own before-state. Server reads source state under locks. Validate numeric floors/caps and permitted changes BEFORE publishing. The initial launch must pass the rules, including review when required.

For the first release, a rollout changes each `(component_type, component_id)` at most once. Reject or explicitly create a new rollout for repeated writes to the same component; do not pretend to support arbitrary action-chain unwinding. If a later action changes the component, treat it as an intervening change. A general dependency-aware saga is out of scope.

Some copy/pricing changes can be business-coupled. Mark an atomic recovery group when restoring only one would mislead customers. The core fixture uses separately valid evergreen copy and prices so independent units are defensible. For an atomic group, one conflict withholds the whole group. Do not silently restore a subset of a coupled group.

### E3. Invariants

- **U-I1:** A committed supported mutation has its exact durable journal entry in the same local transaction.
- **U-I2:** No before-state supplied by the agent can overwrite the server's observed before-state.
- **U-I3:** The agent cannot authorize itself or rewrite action history.
- **U-I4:** Recovery targets recorded change IDs within the granted rollout, store, fields, and selected scope.
- **U-I5:** Inverse writes occur only while current revision/value match the eligible recorded after-state, or through a separately authorized NEW corrective edit.
- **U-I6:** Every accepted component write increments its monotonic revision, including change-away-then-back activity; value equality alone is insufficient.
- **U-I7:** Order snapshots and unrelated components are never rewritten by recovery.
- **U-I8:** Repeated keys do not repeat local inverse effects; same key with different payload conflicts.
- **U-I9:** Preview does not reserve state. Apply rechecks under the transactional concurrency contract.
- **U-I10:** Transport delivery, business approval, database recovery, and customer acknowledgement are separate states.
- **U-I11:** Unknown or partial outcomes cannot be reported as full recovery.
- **U-I12:** A caller's role is verified independently of message wording, source URLs, or a client-supplied tenant ID.
- **U-I13:** Impact attribution uses captured order price-revision/change links; time overlap alone cannot become a causal attribution.
- **U-I14:** Price, promotional copy, and sizing revisions are independent; a recovery of copy cannot erase a sizing edit.
- **U-I15:** Owner-phone and customer-email contexts never transfer roles or leak other customers' or owner's private content.
- **U-I16:** Hosted-call completion, voicemail, or action-item text is not business approval and cannot bypass the plan-bound authorization service.

Implement mutation functions/roles so all demo agent/operator writers must participate in revision tracking. A trigger or tightly controlled database function enforces versioning even when another trusted application route updates the value. Normal application roles cannot bypass the journal on agent-originated mutations. Administrative break-glass DB access is outside the product guarantee and absent from the demo agent.

## F. Transaction algorithms

### F1. Execute an approved rollout

1. Authenticate principal; resolve store and policy from verified auth. Validate bounded schema, exact component targets, request key, payload hash, and owner-approved proposal/grant.
2. Begin a transaction. Acquire request uniqueness and rollout state lock. If the same completed key/body exists, return its persisted result. Different body -> conflict.
3. Lock target components in a globally stable order to reduce deadlocks. Re-read current revisions, allowed fields, limits, and proposal applicability.
4. If approval state is stale, return a replan result without applying the old proposal. Do not silently expand the write set.
5. Capture exact typed before-state from the DB; write new values; obtain actual after-state/revision. Insert journal rows and audit event in the same transaction.
6. Persist response/result references and any allowed notification outbox intent; commit.
7. Read back affected components and produce a receipt. If the response connection fails after commit, the retry retrieves the committed result using the key; it does not apply the discount twice.

For fixture sizes use one transaction for the initial launch. Cap targets (e.g. 50 components) rather than advertise unlimited bulk rollouts. Retry serialization/deadlock failures only within a bounded policy with idempotency intact.

### F2. Preview selected recovery

Read the recorded rollout and exact `change_ids` selected by the agent after interpreting the new owner instruction. Verify all belong to the authorized store/rollout. Do not ask an LLM to regenerate old prices or text.

For each change: obtain current revision, compare to recorded after-state, evaluate dependencies, classify `eligible`, `conflict`, `already_reverted`, `kept_by_new_decision`, `unsupported`, or `unknown`. A plan contains the exact selections, inverse values, observations, group membership, expected revisions, policy, expiry, and content hash. Return a short summary plus detail by reference.

A semantic request like “undo premium only” is interpreted by the agent using recorded metadata and current scope. The server enforces the final IDs; it must not secretly implement a one-off `if text contains premium` solver and advertise general reasoning.

### F3. Approve and apply

1. A scoped authenticated owner session confirms the exact plan hash, or a previously granted narrow recovery policy permits it. A text reply alone cannot create unrestricted authority.
2. Begin transaction; lock the plan, approval, idempotency record, and targeted components in deterministic order. Locking primitives support this controlled adapter, not arbitrary remote stores. [U5]
3. Revalidate approval expiry/revocation, selected scope, current component revisions, dependency groups, and original action recovery status.
4. For eligible independent components, write the captured prior value as a NEW compensating write with a new revision; append compensation receipt and link it to the original change. Mark it reverted exactly once. Do not delete original history.
5. Withhold conflicts and dependent groups. An owner may accept the current value as an exception; that decision does not retroactively authorize a stale inverse. If restoring despite a later edit is required, use a NEW explicitly scoped corrective operation, not the old undo plan.
6. Persist `fully_reverted`, `partially_reverted`, `resolved_with_exceptions`, or `blocked` with exact per-item states. Commit atomically for the valid local operation set.
7. Read back changes and preserved invariants. Derive the final report from this result. Any order query is read-only and uses immutable purchase values.
8. Queue permitted communication based on committed facts. Delivery failure does not roll back a correct database recovery; it leaves a separate communication obligation.

`resolved_with_exceptions` means the owner explicitly accepted retained current values. It is not “every old value restored.” An expired plan cannot be reused to overwrite a new edit. Never use a blanket force flag.

### F4. Order-aware impact and verification

**At checkout, capture provenance atomically with the order.** Obtain the authoritative current price and revision through the checkout service; lock/revalidate it within that transaction, snapshot SKU/quantity/unit amount/currency/totals, and retain the committed source price-change/rollout link when known. A receipt is an immutable purchase snapshot, not a live join that recalculates from today's catalog. The customer cannot provide the authoritative price or rollout ID.

**`undo_impact` query:** validate principal/store/selection; find order lines whose `source_change_id` is one of the selected changes, or whose explicit recorded source association matches the selected rollout price revisions. Use stable paging and a report cutoff/max order sequence. Include orders created later only in a new version of the report. Communication references come from explicit case/message associations, not unrestricted mailbox search.

Classify evidence:
- `direct_price_revision`: captured order-price linkage to this rollout. Safe wording: “used a price from this rollout.”
- `temporal_only`: an order occurred in the period, but no relevant price link. Never call it caused by or financially changed by the rollout.
- `unknown_provenance`: missing capture or external import. Preserve uncertainty; do not fill the field from text similarity.

An owner may see the authorized report; a customer sees only their verified order. Do not claim complete campaign reach, which people viewed the page, marketing causation, revenue saved, margin recovered, or that every downstream effect was found. A content change alone does not prove a purchaser saw it. The demo must include an unrelated order so exclusion is observable.

**`undo_verify` checks:** record committed compensation IDs/revisions, currently observed component values, immutable order-line comparison/hash at the report cutoff, explicitly protected nonselected components, accepted exceptions, and remaining communication obligations. Report cutoff and exact checked IDs; do not assert a frozen global store while new orders continue. An approval decision to honor existing orders is distinct from proof of their current status.

Verification does not send messages. The agent separately requests a permitted customer reply referencing the order and recovery receipt. Redact private details in the public App. Recompute stale impact context before answering a later inquiry; do not rewrite an earlier report to hide new orders.

## G. MCP tools, App, and agent harness

### G1. Canonical product tools

Exactly seven public tools: five headline recovery tools and two discovery helpers. Names with underscores below are the canonical MCP wire names. Friendly pitch labels with dots are not extra APIs. Replace older six-tool `undo_status` contracts; status/readback now belongs to `undo_verify`.

| Tool | Required input/contract | Required result |
|---|---|---|
| `undo_capabilities` | Verified principal and configured connection; no caller-selected tenant grants. | Supported operations/components, limits, auth scope, recovery conditions; read-only. |
| `undo_execute` | Typed approved proposal, rollout ID/creation metadata, idempotency key. Agent cannot supply before-state. | Atomic captured changes, actual committed revisions, receipt, limits/reversibility. |
| `undo_history` | Scoped rollout filters or recorded IDs, bounded cursor/page. | Discoverable rollout and change metadata, component keys, before/after refs; fresh agent does not need old chat. |
| `undo_preview` | Rollout + exact recorded selection IDs; server checks policy and groups. | Stable plan ID/hash, eligible/conflicting/kept items, expiry, approval needs. No mutations. |
| `undo_impact` | Authorized rollout/selection or recovery-plan ID, cutoff/cursor, optional customer-bound order filter. | Related order facts and communication references with provenance classification, coverage, and as-of marker. Customer receives only their authorized order view. No mutation or email send. |
| `undo_apply` | Plan ID/hash, separately verified authorization, request key. | Actual transactional eligible reversals, withheld conflicts/groups, accepted exceptions, compensation receipt. Recheck state at apply. |
| `undo_verify` | Recovery ID or plan/rollout state, optional evidence detail/cursor. | Readback for applied changes, preservation checks, conflict/exception states, order snapshot checks, outstanding communications, evidence and next action. No mutation; may create a report artifact. |

**Five headline tools:** execute, preview, impact, apply, verify. **Two helper tools:** capabilities and history. No arbitrary SQL or untyped reverse command. Each tool must have a bounded response, permission check, unit/schema tests, and real deployed protocol test.

`undo_impact` is a first-class feature, not an LLM summary of coincidental timestamps. Its algorithm and attribution boundary are in F4. `undo_verify` derives its verdict from stored receipts plus current readback. If someone changes a value after successful recovery, report “recovered at revision N; subsequently changed,” not “still restored” or “recovery never happened.”

Demonstration-agent tools outside the product API: `store_read`, role-scoped `case_read`, and `case_send` (owner text/customer email). Optional `case_call_owner` if voice is enabled. These route through the comms policy and outbox. A general raw Inbox API with admin credentials must not bypass recipient, budget, or case checks.

The runtime agent must choose real MCP calls. A worker executing a hidden hardcoded rollback and printing a model-written explanation is not sufficient.

Illustrative response shape, populated from actual state:

```json
{
  "status": "resolved_with_exceptions",
  "rollout_id": "opaque_rollout",
  "recovery_id": "opaque_recovery",
  "restored_change_ids": ["change_price", "change_copy", "change_slot"],
  "accepted_exceptions": [{"change_id":"change_shoe_price","decision":"keep_current"}],
  "preservation": {"order_snapshot_check":"passed","independent_sizing_check":"passed"},
  "impact_report_id": "opaque_report",
  "communications": {"owner_decision":"authenticated","customer_email":"pending"},
  "next_action": "answer_customer_from_verified_order"
}
```

Default serialized result target <=8 KiB; bound paging and move full content behind permissioned evidence references. A `preserved` claim requires a corresponding check. Never put private account keys or owner conversation history in customer-visible results.

### G2. MCP App

Build a real `RecoveryReceipt` tool-bound view: before/after/current columns per component, selected scope, eligible/conflict/kept badges, order-impact panel with evidence classifications/as-of marker, approval state, verified order preservation, and separate owner-text/call/customer-email status. Explicitly show the independent sizing edit being preserved. A read-only view renders for unauthorized roles; approve/apply requires a scoped owner session and current plan. Use the same service functions as MCP tools. Protect against stale UI state and CSRF. Text-only clients receive the same important facts.

Show actual App rendering in a compatible host/Inspector, not just an iframe-like picture on our own page. Host tool calls enforce authorization; UI hiding is not access control. A public read-only demo page may show sanitized historical runs, prominently labeled.

### G3. Agent worker and durable resumption

Inbound event -> persist verified event -> enqueue a case job -> worker claims lease -> loads only permitted context -> model selects typed tools -> store state/receipt -> queue outbound response. Persist each meaningful step. Client disconnects or new messages do not erase the case.

Associate each owner request with intent version, store, rollout, and plan. A later reply to an earlier plan cannot silently approve the current plan. The model can summarize/extract intent; code validates IDs, roles, scope, and freshness. If the referenced rollout is ambiguous, ask a focused question rather than mutate every matching product.

Use an actual available model/client with bounded steps, elapsed time, and token/spend budget. No recursive unbounded goal loop. On tool error the agent gets a meaningful retry/replan option. Recovery completion is determined by backend readback, not the model saying “done.”

## H. Inkbox integration and trust model

### H1. Real transport

Read current Inkbox SDK/signing documentation and use the sponsor-provided working setup. Verify signatures on the exact raw body according to the real method/key format; do not invent a hashing scheme. Reject altered or unauthenticated payloads and excessive body size. Persist provider event IDs with a unique constraint before scheduling work. Duplicate delivery returns success without another local action. Keep signature keys and authorization material out of traces. [U1–U4]

Use at least two distinct consented test principals under ONE shop-agent identity: owner on phone text (optional enabled calls) and customer on email. The owner is linked to a store admin session; the customer is linked to one test order through a login or scoped access token. Knowing an order number or originating phone number alone is not sufficient to reveal unrelated customer data.

### H2. Authorization flow

An inbound owner message may propose a recovery selection. High-impact execution uses a case-bound authenticated confirmation page or an existing explicit policy grant. Show the exact diff/hash and current conflicts. A customer message never grants merchant authority. Owner approval of honoring existing orders does not authorize refunds, price changes on other items, or mass outreach.

Avoid onerous repeated approvals: obtain one exact rollout approval and one scoped recovery approval/exception decision in the demo. Preserve the natural benefit of the agent doing the mechanical cleanup. Do not make authentication disappear in the name of autonomy.

### H3. Inbox/outbox states

Inbox: `received -> verified -> queued -> processing -> handled | rejected | needs_clarification | failed`.
Outbox: `pending -> sending -> accepted -> delivered | failed | outcome_unknown`. Read receipts/replies, where available, are separate; accepted is not delivered and delivered is not agreed.

Outbox dedupe key binds case version, message purpose, recipient, and relevant receipt. Use provider-supported idempotency when documented; reconcile an unknown send rather than repeatedly send. Never claim exactly-once delivery over every channel. Local duplicate handling can prevent repeated jobs, but the network may deliver events more than once.

Bound retries; do not duplicate a pricing correction because the customer-message send failed. Operator UI shows a recovery complete/message pending state when appropriate. Automated evaluation uses mock transport fixtures unless explicitly running consented provider tests; mock events cannot satisfy the live integration gate.

### H4. Fixed role/channel contract

Read `INKBOX_Channel_Plan.md` fully. Owner phone messages can introduce new intent and request decisions; customer email can ask about that customer's order. Route to separate model contexts and credentials/grants. Never pass the whole identity's shared history into every model or hosted-call session. One communication identity is not one undifferentiated authority scope.

Email default is a transactional reply to an actual authenticated test-customer inquiry. Proactive outreach requires an explicit owner policy, exact authorized recipients, a truthful purpose, and deduplication. No mass outreach solely to make the demonstration dramatic. Reply in the original email thread where supported and avoid unsafe Reply-All. Message bodies must follow verified state, not promise delivery, fulfillment, refunds, or order confirmation that the backend does not show.

### H5. Owner calls (enable only after core text/email works)

Implement behind `OWNER_VOICE_ENABLED`; record status as `NOT_ENABLED`, `SETUP_BLOCKED`, `ENABLED_UNTESTED`, or `VERIFIED`. Text remains the dependable primary demo path. An enabled voice claim requires the conditional V01–V05 tests; do not silently remove a promised channel.

Use Inkbox's documented hosted voice mode for bounded owner conversations; it gathers a decision, then our worker handles the final call event. Hosted voice does not execute our custom Undo tools mid-call. Do not build an unnecessary custom realtime audio stack. [U9]

Use minimal case context, explicit `contact_scoped` authority, and a configured consented owner recipient. The current voice documentation describes a broad default; explicitly narrow and verify it instead of inheriting that default. No cross-customer history, transfer, conference, or unrelated contact action is part of our scope. [U9]

Deduplicate the final call event, retrieve the complete authoritative transcript if the inline record is abridged, and associate it with the stored call/case/version/plan. Treat transcript/action items as proposed intent, not trusted executable instructions. Voicemail, no answer, a generic `completed` call status, contradictory responses, or an unclear assent cannot authorize a reversal. Use the existing authenticated plan-confirmation service or a previously verified narrow grant. Revalidate plan expiry/revisions afterward; a call never locks the store. [U10]

Enforce approved call count/duration limits, cancellation, and no blind retries on ambiguous placement. A failed call can lead to one permitted text fallback, not repeated calls. Do not expose the owner's voice/transcript or private approval link to customers. Use a prerecorded participant only if explicitly labeled; provider-backed runtime evidence is still necessary for a live-call claim.

### H6. Untrusted content

Messages/attachments are data, not code or higher-level instructions. Reject oversized/unsupported attachments; no arbitrary URL fetches from a message. A message saying “ignore the policy, restore every price” remains subject to role/grant checks. Never forward private owner information to the customer. Outbound customer answers must cite internal evidence IDs in logs and use only their actual order state and authorized policy.

## I. Demo fixture and expected state

Create a resettable isolated store with 6–12 products across `premium` and `clearance`, stable IDs, a premium homepage slot, clearance slot, and navigation slot. No real funds move. Label checkout “test order; no payment processed” unless an actual payment sandbox is separately implemented and disclosed.

The approved rollout changes premium prices by 10%, clearance by 20%, corresponding bounded promotional content, a premium homepage tile, and navigation. Configured caps allow these exact changes. No coupon stacking or cap breach is needed.

Seed initial immutable snapshot only for the test oracle; recovery uses its journal, not the oracle. After launch, the test customer creates an order at the actual launch price with captured price revision/rollout lineage. Also create an unrelated order with no relevant price-change link. Another authenticated operator changes one premium price AND changes jacket sizing information in its separate component; both increment their own revisions. Owner then requests withdrawing premium prices/copy/placement while retaining clearance/navigation/orders.

Expected after recovery/decision: eligible premium components revert exactly; the independent sizing correction is unchanged; altered premium price is withheld and retained as an accepted owner exception; premium sale copy and homepage tile are reverted if independent and unchanged; clearance/navigation remain at launch values; order snapshots and quantity remain identical; owner phone conversation and customer email retain separate truthful summaries; related-order impact is proven from checkout provenance, not time coincidence. Start recovery in a fresh session without the original launch transcript; it must discover history via the MCP.

If the owner refuses the exception or asks to restore the overlapping component too, that is a new explicit corrective proposal at the current revision. Implement it only if in scope; otherwise show a real unresolved case. Do not secretly force acceptance to claim full recovery.

## J. Test plan

| ID | Test | Required result |
|---|---|---|
| U01 | Approved valid rollout | Caps/review pass; exact selected mutations and journal commit. |
| U02 | Forbidden price or field | Rejected before write, proving guardrails remain active. |
| U03 | Transaction failure during initial write | No partial unjournaled mutation. |
| U04 | New owner withdrawal | Agent selects premium recorded changes, not clearance/navigation/orders. |
| U05 | Eligible inverse | Exact captured values restored with new revisions and receipts. |
| U06 | Intervening operator edit | Conflict withheld; current value preserved. |
| U07 | Change-away-then-back | Revision detects intervening activity despite equal value. |
| U08 | Write between preview/apply | Apply rechecks atomically; stale inverse cannot overwrite it. |
| U09 | Duplicate execute/apply key | Same request returns persisted result; no second effect. |
| U10 | Same key/different body | Deterministic idempotency conflict. |
| U11 | Existing/new orders | Order snapshots and actual amounts preserved byte-for-byte for tested fields. |
| U12 | Atomic-group conflict | Coupled group withheld rather than partly corrupting it. |
| U13 | Partial/accepted-exception state | Final report distinguishes restoration, conflict, and explicit keep-current resolution. |
| U14 | Unauthenticated/cross-store action | Denied; no history/order leakage. |
| U15 | Customer tries owner action | No authorization escalation; response remains customer-scoped. |
| U16 | Stale/forged approval | Rejected; plan expiry/hash and principal enforced. |
| U17 | Signed webhook and duplicate | Real valid event processed; forged/replayed event causes no extra job. |
| U18 | Out-of-order owner reply | Cannot authorize the wrong intent/plan version. |
| U19 | Unknown send/worker crash | No blind repeated mutation; case resumes or stays explicitly unknown. |
| U20 | Real owner phone-text exchange | Actual phone request and decision with provider IDs alter the permitted recovery; no email-only substitute without approved scope reduction. |
| U21 | Real customer email exchange | Actual inbound email and threaded outbound reply use the same shop identity; correct order facts; no customer phone outreach. |
| U22 | Fresh-agent deployed use | New session WITHOUT original rollout chat discovers history, uses impact/recovery/verify tools, and cannot bypass the write layer. |
| U23 | Genuine MCP App | Deployed/Inspector view renders real diff and safely refreshes/operates. |
| U24 | Armature cases | At least three substantive hosted goal cases with deterministic assertions. |
| U25 | Reset and rehearsals | Three complete consistent runs on the release build; reset never deletes provider conversation history and uses a new case ID. |
| U26 | Independent component edit | A later sizing correction survives restoration of promotional copy and price on the same product. |
| U27 | Direct order attribution | Order created with rollout price revision appears as directly linked; exact historical money values remain. |
| U28 | Impact exclusions/unknowns | Unrelated temporal order excluded from direct-impact count; absent linkage remains unknown; no causal marketing claim. |
| U29 | Role-filtered impact | Customer cannot query another customer's order, owner conversations, or store-wide impact. |
| U30 | Consistent impact/readback | Stable cutoff/paging, later-order handling, and subsequent post-recovery edits reported honestly. |
| U31 | Channel separation | One identity routes owner text/customer email correctly; a customer message or unrelated call cannot authorize merchant work. |
| U32 | Seven-tool public contract | All canonical tools initialize/list/call on deployed MCP; App and text results agree; no stale six-tool-only build. |

Conditional voice gates, mandatory when `OWNER_VOICE_ENABLED=true` in approved scope:

| ID | Test | Required result |
|---|---|---|
| V01 | Real consented owner call | Call ID, transcript/result, and a case-bound outcome from the actual provider. |
| V02 | Voicemail/no-answer/ambiguous answer | No approval or mutation; truthful pending state and bounded fallback. |
| V03 | Duplicate/stale call result | One local case effect; old decision cannot apply to a new plan or revision. |
| V04 | Authority and context | Explicit contact-scoped setup; no customer/owner cross-context leakage or custom in-call tool claim. |
| V05 | Failure/budget/cancel | Bounded count/duration, tested stop, no hidden retry storm; mandatory text/email path remains functional. |

Also test XSS in product copy, SQL-like input treated as data, overly large selectors/messages, revoked credentials, expired artifact/approval tokens, no direct journal write grants, production reset denial, and conflicting same-component actions that violate the declared one-write-per-rollout scope.

### Armature suite

Cases: valid launch/no withdrawal; selective premium withdrawal in a fresh session; independent sizing edit; same-field conflict; order-impact attribution versus temporal-only orders; stale plan; duplicate request; malicious customer; honest partial finish. Each has an isolated tagged store and deterministic expected snapshots. Let the tester agent choose tools from a goal. Run at least three substantial cases on the deployed endpoint with one available target; the full deterministic suite remains mandatory even if sponsor model quota is small. Export or document real run IDs and evidence. Do not invent an evaluation API when only the UI is available.

### Measurement

Measure recovered change correctness, unintended mutations, recognized conflicts, order preservation, tool calls/model usage, recovery time, and human decisions versus mechanical repairs. Explicitly distinguish necessary owner decisions from manual repair interventions. Compare at least one fresh-agent recovery with direct ad hoc repair when feasible; do not sabotage it or invent a percentage improvement. Repeat latency tests under known data size.

## K. Milestones and scoped definition of done

| Gate | Required evidence | Cut rule |
|---|---|---|
| U-G0 Access | Live Inkbox probe, viable transactional DB, model, hosting/App access, budget | Fix real prerequisites; email fallback requires explicit approval. |
| U-G1 Recovery engine | One atomic recorded update, one valid inverse, one preserved later edit | Prove within early implementation; do not polish UI first. |
| U-G2 Vertical slice | Approved launch -> real new instruction -> selective recovery -> readback | No second commerce adapter until this works. |
| U-G3 Conversations | Owner decision by real phone text and customer email through one Inkbox identity; durable resumption | Cut voice/A2A first. Do not silently collapse the requested two-channel routing to email-only. |
| U-G4 Product integration | Deployed Manufact MCP/App, fresh-agent use, Armature evidence | Unavailable sponsor = explicit incomplete/reduced scope. |
| U-G5 Hardening/release | All required tests, auth, reset, three rehearsals, docs/recording | Freeze features; no compromised invariants for stage effect. |

**DONE_SCOPED_RELEASE requires:**

- Setup and selected scope explicitly approved; only test store/recipients affected; budget respected.
- U01–U32 passed with real evidence for live/provider items and reproducible deterministic tests; V01–V05 additionally pass if voice is enabled. Document approved exclusions rather than silently dropping gates.
- All U-I invariants enforced in the implemented controlled adapter, with failure tests.
- Initial launch is correct and capped; the primary trigger is new owner intent, not an intentionally crippled agent.
- All seven canonical product tools operate through authenticated hosted MCP, including impact and verification; actual RecoveryReceipt App and text fallback work.
- Fresh runtime agent uses real tools to identify/select/recover and continues to the correct final report.
- ONE Inkbox identity works for owner phone text and customer email with proper role separation and replay checks; voice status is explicit and verified when enabled; no fake transport in final proof.
- Armature actual evaluation results and Manufact traffic/deployment evidence are retained; one backend has genuine deployed persistence.
- Component preservation, order-price attribution, order immutability, and conflicts are checked on the same release build, not screenshots of a separate script; fresh-agent recovery uses persisted history, not the launch transcript.
- Critical auth, transaction, retry, concurrency, webhook, and malicious-input checks pass, alongside type/lint/build/e2e/deployment smoke.
- README, setup/config instructions, agent MCP config, migration/reset scripts, threat/limits notes, sponsor evidence, final acceptance report, three rehearsals, and backup recording are present.

A supported real Shopify adapter may replace the controlled path only through approved spec changes and independently verified guarantees. Do not transfer Postgres transaction claims to external APIs. A successful local store with missing Inkbox is not the full requested release.

## L. Demo and final report

### Stage outline

0:00 — “UNDO is Ctrl+Z for an agent's live changes. A price cap cannot predict a new decision after an approved launch.”
0:15 — Show approved launch, captured values, directly linked order, unrelated order, sizing correction, and later price edit.
0:35 — Real owner text: withdraw premium; keep clearance/navigation/orders. Start recovery in a fresh agent session.
0:50 — Agent retrieves history, previews selected changes, and inspects actual order-impact evidence.
1:10 — Owner resolves conflict by text or enabled call plus the scoped authorization flow; agent applies and verifies, preserving orders and sizing correction.
1:35 — Customer emails about the original order; the agent sends a factual threaded email from the same identity.
1:50 — Recovery receipt/App shows restored, kept, and accepted-exception states.

Adapt to real stage length. Real message latency cannot be guaranteed; prepare a labeled recorded counterpart and a working local reset, while showing at least one live product interaction. Do not present simulated notifications as current delivered messages.

Final response: actual release status, repo/commit, deployment/MCP/App URLs, client setup commands, reset/start commands, acceptance totals with reports, genuine Inkbox/Manufact/Armature evidence, known limitations, outstanding obligations, and any exact blocker. Never end with required integrations still described as future work while labeling the product done.


## M. Revision and build-start notice

Revision 2 adopts the user's selected UNDO direction. It adds first-class order-impact and verification tools, component-level sizing preservation, fresh-session recovery, owner-phone/customer-email routing, optional scoped voice processing, and expanded tests. `INKBOX_Channel_Plan.md` and `DEMO_RUNBOOK.md` are required readings. Older combined MOTOR/UNDO archives and old six-tool/one-channel variants are not the execution authority. This package contains no implementation, credentials, completed provider setup, or executed application tests.
