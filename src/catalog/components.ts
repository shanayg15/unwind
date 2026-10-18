import { z } from "zod";
import type { Tx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";

export type ComponentType = "price" | "content" | "slot" | "promotion";

/** Declared component identity. Never an arbitrary JSON path chosen by the caller. */
export interface ComponentRef {
  type: ComponentType;
  id: string; // product id for price/content, slot id for slot
  key: string; // "price" | "promotional_copy" | "sizing_info" | slot kind
}

export const SlotContent = z
  .object({
    title: z.string().min(1).max(120),
    subtitle: z.string().max(240).optional(),
    link: z.string().regex(/^\/[a-z0-9\-/]*$/, "store-relative path only").max(120),
    product_skus: z.array(z.string().max(40)).max(12).optional(),
    items: z.array(z.object({ label: z.string().min(1).max(40), link: z.string().regex(/^\/[a-z0-9\-/]*$/).max(120) })).max(12).optional(),
  })
  .strict();
export type SlotContent = z.infer<typeof SlotContent>;

export type ComponentValue =
  | { kind: "price"; amount_minor: number; currency: string }
  | { kind: "text"; text: string }
  | { kind: "slot"; content: SlotContent };

export interface ComponentState {
  ref: ComponentRef;
  storeId: string;
  revision: number;
  value: ComponentValue;
  productId: string | null;
  collection: string | null;
}

export function refKey(r: ComponentRef): string {
  return `${r.type}:${r.id}:${r.key}`;
}

/** Stable global lock order to reduce deadlocks. */
export function sortRefs<T extends { ref: ComponentRef } | ComponentRef>(items: T[]): T[] {
  const k = (x: T) => refKey("ref" in x ? (x as { ref: ComponentRef }).ref : (x as ComponentRef));
  return [...items].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
}

/** Journal/before-after JSON shape used in action_changes. */
export function valueToJson(v: ComponentValue): Record<string, unknown> {
  if (v.kind === "price") return { amount_minor: v.amount_minor, currency: v.currency };
  if (v.kind === "text") return { text: v.text };
  return { content: v.content };
}

export function valueFromJson(type: ComponentType, j: Record<string, unknown>): ComponentValue {
  if (type === "price") return { kind: "price", amount_minor: Number(j.amount_minor), currency: String(j.currency) };
  if (type === "content") return { kind: "text", text: String(j.text) };
  return { kind: "slot", content: SlotContent.parse(j.content) };
}

export function sameValue(a: ComponentValue, b: ComponentValue): boolean {
  return JSON.stringify(valueToJson(a)) === JSON.stringify(valueToJson(b));
}

/** Read (and lock FOR UPDATE when requested) one component within the caller's store. */
export async function readComponent(tx: Tx, storeId: string, ref: ComponentRef, lock = false): Promise<ComponentState | null> {
  if (ref.type === "promotion") return null; // promotions are read through the gift-promotion adapter
  const forUpdate = lock ? " for update of c" : "";
  if (ref.type === "price") {
    const { rows } = await tx.query(
      `select c.amount_minor, c.currency, c.revision, p.id as product_id, p.collection
         from product_prices c join products p on p.id = c.product_id
        where c.store_id = $1 and c.product_id = $2${forUpdate}`,
      [storeId, ref.id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      ref,
      storeId,
      revision: Number(r.revision),
      value: { kind: "price", amount_minor: r.amount_minor, currency: r.currency.trim() },
      productId: r.product_id,
      collection: r.collection,
    };
  }
  if (ref.type === "content") {
    const { rows } = await tx.query(
      `select c.value, c.revision, p.id as product_id, p.collection
         from product_content c join products p on p.id = c.product_id
        where c.store_id = $1 and c.product_id = $2 and c.component_key = $3${forUpdate}`,
      [storeId, ref.id, ref.key],
    );
    const r = rows[0];
    if (!r) return null;
    return { ref, storeId, revision: Number(r.revision), value: { kind: "text", text: r.value }, productId: r.product_id, collection: r.collection };
  }
  const { rows } = await tx.query(
    `select c.content, c.revision, c.slot_kind from store_slots c where c.store_id = $1 and c.slot_id = $2${forUpdate}`,
    [storeId, ref.id],
  );
  const r = rows[0];
  if (!r || r.slot_kind !== ref.key) return null;
  return { ref, storeId, revision: Number(r.revision), value: { kind: "slot", content: SlotContent.parse(r.content) }, productId: null, collection: null };
}

/**
 * Conditional write: succeeds only if the component is still at expectedRevision.
 * The guard trigger bumps the revision and the journal trigger appends component_writes
 * in this same transaction (U-I1, U-I6). Caller must have set undo.writer.
 */
export async function writeComponent(
  tx: Tx,
  storeId: string,
  ref: ComponentRef,
  value: ComponentValue,
  expectedRevision: number,
): Promise<{ revision: number }> {
  let res;
  if (ref.type === "price" && value.kind === "price") {
    res = await tx.query(
      `update product_prices set amount_minor = $3, currency = $4
        where store_id = $1 and product_id = $2 and revision = $5 returning revision`,
      [storeId, ref.id, value.amount_minor, value.currency, expectedRevision],
    );
  } else if (ref.type === "content" && value.kind === "text") {
    res = await tx.query(
      `update product_content set value = $4
        where store_id = $1 and product_id = $2 and component_key = $3 and revision = $5 returning revision`,
      [storeId, ref.id, ref.key, value.text, expectedRevision],
    );
  } else if (ref.type === "slot" && value.kind === "slot") {
    res = await tx.query(
      `update store_slots set content = $3
        where store_id = $1 and slot_id = $2 and revision = $4 returning revision`,
      [storeId, ref.id, JSON.stringify(value.content), expectedRevision],
    );
  } else {
    throw new UndoError("invalid_input", "Value kind does not match component type", { ref });
  }
  if (res.rowCount !== 1) {
    throw new UndoError("revision_conflict", "Component changed since it was read", { ref, expected_revision: expectedRevision });
  }
  return { revision: Number(res.rows[0].revision) };
}

export function describeValue(v: ComponentValue): string {
  if (v.kind === "price") return `$${(v.amount_minor / 100).toFixed(2)}`;
  if (v.kind === "text") return v.text.length > 80 ? `${v.text.slice(0, 79)}…` : v.text;
  return v.content.title;
}
