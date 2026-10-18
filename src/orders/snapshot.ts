import type { Tx } from "../db/pool.js";
import { hashOf } from "../lib/util.js";

/** Hash of every immutable order/line field up to a cutoff sequence (U11, U-I7). */
export async function orderSnapshot(tx: Tx, storeId: string, cutoffSeq?: number): Promise<{ hash: string; count: number; maxSeq: number }> {
  const maxSeq =
    cutoffSeq ??
    Number((await tx.query(`select coalesce(max(seq), 0) as m from orders where store_id = $1`, [storeId])).rows[0].m);
  const { rows } = await tx.query(
    `select o.id, o.seq, o.status, o.total_minor, o.currency, o.created_at, o.customer_principal_id,
            coalesce(json_agg(json_build_object('id', l.id, 'sku', l.sku, 'q', l.quantity, 'u', l.unit_amount_minor, 'c', l.currency,
                     'rev', l.source_price_revision, 'chg', l.source_change_id, 'ro', l.source_rollout_id) order by l.id)
                     filter (where l.id is not null), '[]') as lines,
            (select json_agg(json_build_object('id', e.id, 'sku', e.gift_sku, 'q', e.quantity, 'u', e.unit_amount_minor, 'p', e.promotion_id, 'v', e.promotion_version,
                     'a', e.allocation_id, 't', e.terms_hash) order by e.id) from order_entitlements e where e.order_id = o.id) as gifts
       from orders o left join order_lines l on l.order_id = o.id
      where o.store_id = $1 and o.seq <= $2 group by o.id order by o.seq`,
    [storeId, maxSeq],
  );
  const hash = hashOf(
    // Gift entitlements are part of the immutable snapshot; orders without gifts hash exactly as before.
    rows.map((r) => ({ id: r.id, seq: Number(r.seq), s: r.status, t: r.total_minor, c: r.currency, at: new Date(r.created_at).toISOString(), cu: r.customer_principal_id, lines: r.lines, gifts: r.gifts ?? undefined })),
  );
  return { hash, count: rows.length, maxSeq };
}
