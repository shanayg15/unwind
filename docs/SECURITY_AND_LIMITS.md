# Security model, threats and limits

## Trust boundaries

| Boundary | Control |
|---|---|
| MCP caller → server | Bearer token (sha256-hashed at rest) bound to principal, role, store and membership; optional case scope and TTL; revocation; per-token rate limit; production Inspector disabled |
| Model → store | Only seven typed tools; no free-form SQL, inverses or before-values from the model; caps re-validated under lock at execution |
| Inkbox → receiver | Bearer auth token + HMAC signature over request id, timestamp and raw body; 256 KB cap; unique provider event id (duplicates do nothing); transport authenticity is not business authority |
| Inbound person → case | Sender resolved to a principal (owner phone / test-customer email with an active order grant); unknown senders get no reply; group chats rejected |
| Owner intent → authorization | Text or call content is intent only. Applying needs a 4-digit code bound to the exact plan hash, from the owner principal, unexpired, with a 5-attempt lockout (or the single-use link page with a CSRF check). The worker checks it in code |
| Agent → people | Recipient is derived from the case, never from model input; purposes are allow-listed per role; outbox dedupe; live-send gate and hard budgets |
| Voice | Explicit `contact_scoped` authority on every call, a narrow brief with no customer data, one call per plan, budget cap, 180 s hang-up kill switch, inbound calls rejected, transcript treated as proposed intent |

## Threats considered

- **Prompt injection via messages or product copy.** Message text is data in the prompt. Tools cannot widen scope, and storefront text is HTML-escaped.
- **Replay or forgery of provider events.** Signature check plus unique provider event id. Stale or ambiguous approvals fail closed.
- **Approval confusion.** A code from an old plan cannot approve a newer one. Plan hash, expiry and the owner principal are all checked. A stale dependency supersedes the plan rather than re-scoping the approval.
- **Lost updates and races.** Conditional writes on revisions. A global lock order (components → promotion → allocation → inventory) is shared by checkout and recovery. Barrier tests cover both race orders.
- **Partial failure.** Single transactions per rollout and recovery. Injected failure tests prove rollback. Retries return the persisted outcome (idempotency keys with request hashes).
- **Data exposure.** Customers see only their own orders. Contacts are redacted in evidence. Secrets live only in `.env`, `.private/` and provider secret storage.
- **Over-release of stock.** Allocations can only decrease. Entitlements are immutable. Inventory writes need the UNDO writer. Release happens once and is journaled.

## Known limits

- One controlled demo store, one location, one gift per order. No fulfillment, returns or restocks in the fixture.
- Local Postgres transactions only. There is no claim of a global cutoff across external platforms.
- The agent worker runs on the operator's Mac (local Claude login). It is durable through leases and resumes after a restart, but needs that machine online.
- The owner channel is iMessage through Inkbox's shared line instead of SMS (user-approved substitution).
- The identity's default voice authority stays `yolo` (our key cannot change it). Each UNDO call narrows to `contact_scoped`, and inbound calls auto-reject.
- An atomic group is withheld whole when any member is not restorable, including when the owner keeps a member's later value. Linked copy then stays as is, and the receipt says so.
- Evidence comes from test fixtures and a few live runs. It is not production certification.
