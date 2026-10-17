import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Opaque, non-guessable id with a type prefix (never a path or secret). */
export function newId(prefix: string, bytes = 10): string {
  const buf = randomBytes(bytes);
  let out = "";
  for (const b of buf) out += ALPHABET[b % 32];
  return `${prefix}_${out}`;
}

export function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortDeep(v);
    }
    return out;
  }
  return value;
}

export function hashOf(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function formatMoney(amountMinor: number, currency = "USD"): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const dollars = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return currency === "USD" ? `${sign}$${dollars}.${cents}` : `${sign}${dollars}.${cents} ${currency}`;
}

/** Redact a phone number or email for public evidence. */
export function redactContact(value: string | null | undefined): string {
  if (!value) return "";
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return value.length > 6 ? `${value.slice(0, 5)}***${value.slice(-4)}` : "***";
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
