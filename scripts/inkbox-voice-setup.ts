/**
 * Voice setup for the approved owner-call scope: narrow the identity's default Voice AI authority to
 * contact_scoped (falls back to per-call override if the key lacks admin rights), verify it, and add
 * call.ended to the UNDO receiver subscription. Prints non-secret evidence only.
 */
import { Inkbox } from "@inkbox/sdk";

const ik = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const id = await ik.getIdentity(process.env.INKBOX_IDENTITY ?? "yc-hack-shanay");
const before = await id.getHostedAgentConfig();
console.log(`authority before: ${(before as { authorityMode?: string }).authorityMode}`);
try {
  const after = await id.setHostedAgentAuthorityMode({ authorityMode: "contact_scoped" as never });
  console.log(`authority after: ${(after as { authorityMode?: string }).authorityMode}`);
} catch (e) {
  console.log(`could not change identity default (${(e as { status?: number }).status ?? ""} ${(e as Error).message.slice(0, 120)}); every UNDO call sets hosted_agent_authority_mode=contact_scoped explicitly`);
}
const verify = await id.getHostedAgentConfig();
console.log(`authority verified: ${(verify as { authorityMode?: string }).authorityMode}`);
const subs = ik.webhooks.subscriptions as unknown as { list(o: object): Promise<Array<{ id: string; url: string; eventTypes: string[] }>>; update(id: string, o: object): Promise<{ eventTypes: string[] }> };
const url = `${(process.env.APP_BASE_URL ?? "").replace(/\/$/, "")}/webhooks/inkbox`;
const mine = (await subs.list({})).find((s) => s.url === url);
if (!mine) throw new Error("UNDO subscription not found; run scripts/inkbox-subscribe.ts");
if (!mine.eventTypes.includes("call.ended")) {
  const u = await subs.update(mine.id, { eventTypes: [...mine.eventTypes, "call.ended"] });
  console.log(`subscription ${mine.id.slice(0, 8)} now: ${u.eventTypes.join(",")}`);
} else console.log("subscription already has call.ended");
