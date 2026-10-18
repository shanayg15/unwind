import { verifyWebhook } from "@inkbox/sdk";
import { query } from "../db/pool.js";
import { newId, safeEqual, sha256 } from "../lib/util.js";

export const MAX_WEBHOOK_BYTES = 256 * 1024;
// Inkbox does not document a freshness window and replays keep old timestamps; stale-replay
// protection comes from the unique provider event id. Reject only clearly stale deliveries.
const MAX_SKEW_SECONDS = 24 * 60 * 60;

function parseTimestamp(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
  const d = Date.parse(v);
  return Number.isFinite(d) ? d / 1000 : null;
}

export interface ReceiverConfig {
  secret: string;
  authToken: string;
}

export type ReceiveOutcome =
  | { status: 401 | 403 | 413 | 400; error: string }
  | { status: 200; duplicate: boolean; eventId: string; queued: boolean };

const QUEUED_TYPES = new Set(["imessage.received", "message.received", "call.ended"]);
const DELIVERY: Record<string, string> = {
  "imessage.sent": "accepted",
  "imessage.delivered": "delivered",
  "imessage.delivery_failed": "failed",
  "message.sent": "accepted",
  "message.delivered": "delivered",
  "message.failed": "failed",
  "message.bounced": "failed",
};

/** Verify an Inkbox delivery exactly as the SDK specifies (HMAC over request id, timestamp, raw body). */
export function verifySignature(raw: Buffer, headers: Record<string, string>, secret: string): boolean {
  const ts = parseTimestamp(headers["x-inkbox-timestamp"]);
  if (ts !== null && Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS) return false;
  try {
    return verifyWebhook({ payload: raw, headers, secret });
  } catch {
    return false; // malformed / wrong-length signature
  }
}

/**
 * Signed receiver: authenticate the subscription token, verify the signature on the exact raw
 * body, persist the provider event id under a unique constraint BEFORE any work is scheduled.
 * Duplicates return success without a second job (U17). Transport authenticity is not business
 * authority; the worker still resolves principals and authorizes.
 */
export async function receiveInkbox(raw: Buffer, headers: Record<string, string>, cfg: ReceiverConfig): Promise<ReceiveOutcome> {
  if (raw.length > MAX_WEBHOOK_BYTES) return { status: 413, error: "payload too large" };
  const auth = headers["authorization"] ?? "";
  if (!cfg.authToken || !auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), cfg.authToken)) return { status: 401, error: "unauthenticated" };
  if (!cfg.secret || !verifySignature(raw, headers, cfg.secret)) return { status: 403, error: "bad signature" };
  let body: { id?: string; event_type?: string; data?: { message?: { id?: string } } };
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return { status: 400, error: "invalid json" };
  }
  if (!body.id || !body.event_type || typeof body.id !== "string" || body.id.length > 200) return { status: 400, error: "missing event id/type" };
  const queued = QUEUED_TYPES.has(body.event_type);
  const id = newId("evt");
  const ins = await query(
    `insert into inbox_events(id, provider, provider_event_id, event_type, payload_hash, payload, status)
     values ($1,'inkbox',$2,$3,$4,$5,$6) on conflict (provider, provider_event_id) do nothing returning id`,
    [id, body.id, body.event_type, sha256(raw), raw.toString("utf8"), queued ? "queued" : "handled"],
  );
  if (!ins.rowCount) return { status: 200, duplicate: true, eventId: body.id, queued: false };
  const delivery = DELIVERY[body.event_type];
  const providerMessageId = body.data?.message?.id;
  if (delivery && providerMessageId) {
    // Transport states only move forward; delivered is not "read" and not "agreed".
    await query(
      `update outbox_messages set status = $2
        where provider_message_id = $1 and (status in ('sending','accepted','outcome_unknown') or ($2 = 'failed' and status <> 'delivered'))`,
      [providerMessageId, delivery],
    );
  }
  return { status: 200, duplicate: false, eventId: body.id, queued };
}
