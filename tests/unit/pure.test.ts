import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REPLY_PATTERN } from "../../src/approvals/approvals.js";
import { bearerFrom } from "../../src/auth/principals.js";
import { refKey, sortRefs } from "../../src/catalog/components.js";
import { defaultPolicy } from "../../src/catalog/policy.js";
import { verifySignature } from "../../src/comms/receiver.js";
import { Proposal } from "../../src/recovery/execute.js";
import { canonicalJson, formatMoney, hashOf, redactContact } from "../../src/lib/util.js";
import { esc } from "../../src/web/pages.js";

describe("pure helpers", () => {
  it("canonical JSON and hashes are key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
    expect(hashOf({ x: 1, y: 2 })).toBe(hashOf({ y: 2, x: 1 }));
    expect(hashOf({ x: 1 })).not.toBe(hashOf({ x: 2 }));
  });
  it("money is integer minor units", () => {
    expect(formatMoney(10800)).toBe("$108.00");
    expect(formatMoney(8550)).toBe("$85.50");
    expect(formatMoney(5)).toBe("$0.05");
  });
  it("redacts contacts for public evidence", () => {
    expect(redactContact("+19255550123")).toBe("+1925***0123");
    expect(redactContact("someone@example.com")).toBe("so***@example.com");
  });
  it("parses only well-formed bearer headers", () => {
    expect(bearerFrom("Bearer undo_agen_abcdefghijklmnopqrstu")).toBe("undo_agen_abcdefghijklmnopqrstu");
    expect(bearerFrom("Basic abc")).toBeNull();
    expect(bearerFrom("Bearer short")).toBeNull();
    expect(bearerFrom(undefined)).toBeNull();
  });
  it("orders component locks deterministically", () => {
    const refs = [
      { type: "slot" as const, id: "s", key: "navigation" },
      { type: "price" as const, id: "b", key: "price" },
      { type: "content" as const, id: "a", key: "promotional_copy" },
    ];
    expect(sortRefs(refs).map(refKey)).toEqual(["content:a:promotional_copy", "price:b:price", "slot:s:navigation"]);
  });
  it("reply-to-approve needs a decision word plus a 4-digit code", () => {
    expect(REPLY_PATTERN.exec("YES 4821")?.slice(1)).toEqual(["YES", "4821"]);
    expect(REPLY_PATTERN.exec("yes, 4821 thanks")?.[2]).toBe("4821");
    expect(REPLY_PATTERN.exec("no 1234")?.[1]).toBe("no");
    expect(REPLY_PATTERN.exec("yes")).toBeNull();
    expect(REPLY_PATTERN.exec("Keep $139. Restore the rest.")).toBeNull();
    expect(REPLY_PATTERN.exec("4821")).toBeNull();
  });
  it("verifies Inkbox signatures over request id, timestamp and raw body", () => {
    const secret = "whsec_abc123";
    const ts = String(Math.floor(Date.now() / 1000));
    const body = Buffer.from('{"id":"evt_1"}');
    const sig = createHmac("sha256", "abc123").update(Buffer.concat([Buffer.from(`r1.${ts}.`), body])).digest("hex");
    const h = { "x-inkbox-signature": `sha256=${sig}`, "x-inkbox-request-id": "r1", "x-inkbox-timestamp": ts };
    expect(verifySignature(body, h, secret)).toBe(true);
    expect(verifySignature(Buffer.from('{"id":"evt_2"}'), h, secret)).toBe(false);
    expect(verifySignature(body, { ...h, "x-inkbox-signature": "sha256=00" }, secret)).toBe(false);
  });
  it("escapes HTML", () => {
    expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });
  it("proposal schema rejects unknown ops and oversized batches", () => {
    expect(() => Proposal.parse({ goal: "x y z", changes: [{ op: "delete_product", product_id: "p" }] })).toThrow();
    expect(() => Proposal.parse({ goal: "x y z", changes: Array.from({ length: 51 }, () => ({ op: "set_price", product_id: "p", amount_minor: 100 })) })).toThrow();
    expect(defaultPolicy().max_discount_pct.premium).toBe(15);
  });
});
