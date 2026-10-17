import { z } from "zod";
import type { Principal } from "../auth/principals.js";
import { requireRole } from "../auth/principals.js";
import { withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { audit, reserveKey, storeResponse } from "../lib/idempotency.js";
import { formatMoney, hashOf, newId } from "../lib/util.js";

export const CheckoutInput = z.object({
  items: z.array(z.object({ sku: z.string().max(40), quantity: z.number().int().min(1).max(5) })).min(1).max(5),
  idempotency_key: z.string().min(8).max(120),
});

/**
 * Test checkout (no payment processed). The authoritative price and its revision are read
 * under lock in the same transaction that writes the immutable snapshot, and the order keeps
 * the committed source change/rollout link when the price came from a recorded rollout change.
 * The customer cannot supply prices or rollout ids.
 */
export async function checkout(p: Principal, raw: unknown): Promise<Record<string, unknown>> {
  requireRole(p, ["customer"], "place orders");
  const input = CheckoutInput.parse(raw);
  return withTx(async (tx) => {
    const requestHash = hashOf({ items: input.items });
    const { replay } = await reserveKey(tx, p.storeId, `checkout:${p.principalId}`, input.idempotency_key, requestHash);
    if (replay) return replay as Record<string, unknown>;
    const orderId = newId("ord");
    const lines = [];
    let total = 0;
    for (const item of [...input.items].sort((a, b) => a.sku.localeCompare(b.sku))) {
      const { rows } = await tx.query(
        `select p.id, p.sku, p.title, pp.amount_minor, pp.currency, pp.revision
           from products p join product_prices pp on pp.product_id = p.id
          where p.store_id = $1 and p.sku = $2 for share of pp`,
        [p.storeId, item.sku],
      );
      const pr = rows[0];
      if (!pr) throw new UndoError("not_found", `Unknown SKU ${item.sku}`);
      const src = (
        await tx.query(
          `select id, rollout_id from action_changes
            where store_id=$1 and component_type='price' and component_id=$2 and after_revision=$3 and recovery_status='active'`,
          [p.storeId, pr.id, pr.revision],
        )
      ).rows[0];
      const line = {
        id: newId("ol"),
        product_id: pr.id,
        sku: pr.sku,
        title: pr.title,
        quantity: item.quantity,
        unit_amount_minor: pr.amount_minor,
        currency: pr.currency.trim(),
        source_price_revision: Number(pr.revision),
        source_change_id: src?.id ?? null,
        source_rollout_id: src?.rollout_id ?? null,
      };
      total += line.unit_amount_minor * line.quantity;
      lines.push(line);
    }
    await tx.query(
      `insert into orders(id, store_id, customer_principal_id, status, total_minor, currency, is_test) values ($1,$2,$3,'placed_test',$4,'USD',true)`,
      [orderId, p.storeId, p.principalId, total],
    );
    for (const l of lines) {
      await tx.query(
        `insert into order_lines(id, order_id, store_id, product_id, sku, quantity, unit_amount_minor, currency, source_price_revision, source_change_id, source_rollout_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [l.id, orderId, p.storeId, l.product_id, l.sku, l.quantity, l.unit_amount_minor, l.currency, l.source_price_revision, l.source_change_id, l.source_rollout_id],
      );
    }
    await tx.query(
      `insert into order_access_grants(id, store_id, customer_principal_id, order_id, expires_at) values ($1,$2,$3,$4, now() + interval '7 days')`,
      [newId("grant"), p.storeId, p.principalId, orderId],
    );
    await audit(tx, p.storeId, p.principalId, "order.placed_test", { order_id: orderId, total_minor: total });
    const result = {
      order_id: orderId,
      status: "placed_test",
      label: "Test order; no payment processed",
      total: formatMoney(total),
      total_minor: total,
      lines: lines.map((l) => ({
        sku: l.sku,
        title: l.title,
        quantity: l.quantity,
        unit: formatMoney(l.unit_amount_minor),
        unit_amount_minor: l.unit_amount_minor,
        source_price_revision: l.source_price_revision,
        price_source: l.source_change_id ? "recorded rollout change" : "price not set by a rollout",
      })),
    };
    await storeResponse(tx, p.storeId, `checkout:${p.principalId}`, input.idempotency_key, result);
    return result;
  });
}
