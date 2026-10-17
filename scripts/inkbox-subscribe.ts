/**
 * Create (or reuse) ONE identity-level webhook subscription pointing at the deployed UNDO receiver.
 * Uses the existing per-identity signing key (no rotation). Lists other subscriptions for the record.
 */
import { Inkbox } from "@inkbox/sdk";

const url = `${(process.env.APP_BASE_URL ?? "").replace(/\/$/, "")}/webhooks/inkbox`;
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_IDENTITY ?? "yc-hack-shanay");
const eventTypes = [
  "imessage.received",
  "imessage.sent",
  "imessage.delivered",
  "imessage.delivery_failed",
  "message.received",
  "message.sent",
  "message.delivered",
  "message.failed",
  "message.bounced",
];
const subs = (inkbox.webhooks.subscriptions as unknown as { list(o: Record<string, unknown>): Promise<unknown> });
const listed = (await subs.list({ agentIdentityId: identity.id })) as Array<{ id: string; url: string; eventTypes?: string[]; event_types?: string[] }> | { items?: unknown[] };
const rows = (Array.isArray(listed) ? listed : ((listed as { items?: unknown[] }).items ?? [])) as Array<{ id: string; url: string }>;
for (const s of rows) console.log(`existing subscription ${s.id} -> ${s.url.replace(/^(https:\/\/[^/]+).*/, "$1/…")}`);
const mine = rows.find((s) => s.url === url);
if (mine) {
  console.log(`reusing ${mine.id}`);
} else {
  const created = (await inkbox.webhooks.subscriptions.create({
    agentIdentityId: identity.id,
    url,
    eventTypes,
    authToken: process.env.INKBOX_WEBHOOK_AUTH_TOKEN!,
  } as never)) as { id: string; signingKey?: string | null };
  console.log(`created subscription ${created.id} -> ${url} (${eventTypes.length} event types); new signing key returned: ${created.signingKey ? "YES (unexpected)" : "no (existing identity key reused)"}`);
}
