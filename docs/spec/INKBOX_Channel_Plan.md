# Inkbox — one shop identity, two audiences

**Selected UNDO build; October 17, 2026.** This fixes the intended channel behavior. The execution contract controls authorization and release gates. These channels have NOT been provisioned or tested by this document.

## 1. The exact answer

**Yes: the shop agent TEXTS/CALLS the OWNER and EMAILS CUSTOMERS.**

One Inkbox identity owns the public-facing mailbox and its attached phone resources. There is no need for separate owner-agent and customer-agent identities. Separate recipient roles, conversations, model contexts, and data access are still required. [U1]

| Audience | Default channel | Job | Business authority |
|---|---|---|---|
| Store owner | Phone text in/out | Request withdrawal, inspect a conflict, give a scoped decision, receive completion summary. | Only the authenticated owner's store and currently granted case/plan. |
| Store owner | Optional enabled voice | Discuss the same bounded conflict when a call is preferable. | No extra authority; post-call result is validated before any write. |
| Customer | Email in/out | Ask about their existing order and receive an answer backed by actual order data. | Their order inquiry only; never approve store-wide recovery. |

**Release baseline:** real owner phone-text round trip AND real customer email round trip. Implement those before voice. A tested iMessage path can substitute for owner SMS if approved and documented; do not silently advertise SMS when iMessage is what works.

**Voice:** implement only after baseline works and owner enables the scope/budget. Enabling it promotes V01–V05 to mandatory. A phone-only or email-only fallback needs explicit approval and changes the advertised release. Do not call the full selected routing complete if only one channel works.

Do not automatically call/text customers, mass-email buyers, or contact people not approved for the test. A mailbox/phone number is not a permission grant.

## 2. Setup steps the builder must guide and verify

1. Read current sponsor docs/installed SDK; use the actual account and an explicitly selected identity. Reuse an existing suitable identity rather than creating paid resources by default.
2. Confirm the mailbox and attached phone resource belong to that identity. Record IDs and readiness in `SETUP_STATUS.md`, never credentials.
3. Provision phone texting permissions, approved owner contact, recipient consent, sender readiness, and explicit spend/message limits. For the current US SMS route, Inkbox documents both sender-readiness and recipient opt-in gates; do not assume immediate readiness. [U3]
4. Add the approved test-customer email and both send/receive permissions. Keep owner and customer as distinct application principals.
5. Deploy the signed-event receiver or approved public ingress, configure actual email and text events, and verify a genuine inbound request and reply on BOTH routes. Test signatures/duplicates separately with local fixtures. [U2][U11]
6. Link the owner to an authenticated admin session and the customer to their test-order access. Phone/email matching selects a candidate principal; application authorization verifies it.
7. Verify the durable worker survives a restart and resumes one case without repeating the catalog change or outbound message.
8. If voice is enabled, follow section 4 and run V01–V05. Otherwise set `OWNER_VOICE_ENABLED=false` and label calls as not enabled, not ready.

Use user-approved targets and budgets. Keep tokens, contact details, and transcripts out of public logs. Provider setup blocked by a dashboard, consent, or payment step requires a precise user action, not a guessed workaround.

## 3. The messages in the demo

Illustrative wording; generate live answers from actual store/order/decision facts.

**Owner text to shop identity:**
> Withdraw premium from the weekend campaign. Restore premium prices, promotional copy, and homepage placement. Keep clearance, navigation, current orders, and later independent edits.

**Agent text to owner after preview:**
> My recorded shoe price was $135 after launch, but another operator changed it to $139. Keep $139 as an exception and restore the eligible premium changes? Review case [case reference] in the authenticated recovery receipt.

**Owner reply:**
> Keep $139. Restore the rest.

The reply supplies proposed business intent. The same case uses a narrow existing policy grant or an authenticated plan-hash confirmation to authorize application. Avoid two redundant approval UIs for the same decision. A new plan hash requires freshness checking, not blind reuse of “yes.”

**Customer email to the shop mailbox:**
> I ordered the jacket for $108. The promotion is gone now. Is my order still confirmed at that amount?

**Agent email after order verification:**
> Your test order [reference] remains recorded at $108. The later catalog change did not change the order's amount or status.

Use real backend status. If the fixture is a test order without payment, do not say money was charged. Do not claim shipment, delivery, refund, or compensation that has not happened. No owner private conversation or other customer's data enters this reply. Add a test-environment label for demo participants.

**Owner completion text:**
> Eligible premium changes restored. Clearance, navigation, sizing correction, and orders preserved. The later $139 price remains as your accepted exception. Customer reply: [actual delivery state].

Transport accepted, delivered, read, and agreed are different states. Use exactly the status available; do not manufacture read receipts.

## 4. Optional owner-call path

Read [U9] and [U10] at setup. Hosted voice can collect the owner's decision and return a post-call transcript/action package; our worker performs the actual Undo tool actions afterward. Custom Undo calls are not executed inside that hosted call. A custom bidirectional audio stack is out of scope.

Set hosted voice authority explicitly to `contact_scoped`, verify the setting, and pass only the narrow owner-case context. The documented default can be broader; never inherit it blindly. Do not expose customer inbox history or allow transfers/conferences in this project's call flow. [U9]

Proposed call brief:
> You are the shop's AI assistant, calling the consenting owner about recovery case [ID]. Explain the specific [product] price conflict and ask whether to keep the later price or request review of a restoration. Gather the choice, say application occurs after verification, and end promptly. Do not claim you have already changed the store. No unrelated contacts or transactions.

Application processing:
1. Before dialing, bind call request to owner principal, phone permission, case/intent version, plan hash, consent, and budget. Use actual provider lifecycle and keep the call ID.
2. On final event, verify signature, deduplicate, and obtain the complete transcript when necessary. Do not trust an abridged snippet for a decision that might be contradicted later.
3. Treat voicemail/no answer/unclear response as unresolved. A successful call transport outcome is not agreement.
4. Extract proposed intent only. Check authentication, freshness, and authority through the same service used for texts. Use a plan-bound logged-in confirmation when the communication alone is insufficient.
5. Recheck current store state, apply permitted recovery, verify, then send accurate owner text/customer email as appropriate.
6. Failed/unknown call placement gets bounded reconciliation; never spam calls. A missed call can lead to one permitted text fallback.

Record voice status as NOT_ENABLED / SETUP_BLOCKED / ENABLED_UNTESTED / VERIFIED. If the user approves a call demo, actually test it. A transcript fixture can unit-test logic but cannot prove a live provider integration.

## 5. Integration boundaries

Inkbox supplies communication infrastructure. Our runtime supplies case state, actor roles, current recovery intent, authorization, safe context selection, and worker resumption. Manufact hosts the product MCP/App; Armature exercises agent use of it. Do not give the demo model unrestricted Inkbox organization/admin credentials or bypass the outbox through a general send tool.

No production customer outreach, invented delivery, global contact-history sharing, or removing authorization in the name of autonomy. Business-critical exceptions require a real decision; ordinary implementation work should continue without repeated user prompts.
