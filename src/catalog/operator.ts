import { z } from "zod";
import type { Principal } from "../auth/principals.js";
import { requireRole } from "../auth/principals.js";
import { setActionId, withTx } from "../db/pool.js";
import { UndoError } from "../lib/errors.js";
import { audit, reserveKey, storeResponse } from "../lib/idempotency.js";
import { hashOf, newId } from "../lib/util.js";
import { loadPolicy } from "../recovery/execute.js";
import { type ComponentRef, readComponent, valueToJson, writeComponent } from "./components.js";

export const OperatorEdit = z.object({
  sku: z.string().max(40),
  component: z.enum(["price", "promotional_copy", "sizing_info"]),
  amount_minor: z.number().int().positive().max(10_000_000).optional(),
  text: z.string().min(1).max(2000).optional(),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(8).max(120),
});

/**
 * A human operator's versioned edit outside any rollout (e.g. a sizing correction or a later
 * price change). Uses the same journaled writer, so it bumps the component's own revision.
 */
export async function operatorEdit(p: Principal, raw: unknown): Promise<Record<string, unknown>> {
  requireRole(p, ["operator", "owner"], "edit catalog components");
  const input = OperatorEdit.parse(raw);
  const actionId = newId("act");
  return withTx(
    async (tx) => {
      const { replay } = await reserveKey(tx, p.storeId, `operator:${p.principalId}`, input.idempotency_key, hashOf(input));
      if (replay) return replay as Record<string, unknown>;
      const policy = await loadPolicy(tx, p.storeId);
      const prod = (await tx.query(`select id from products where store_id=$1 and sku=$2`, [p.storeId, input.sku])).rows[0];
      if (!prod) throw new UndoError("not_found", `Unknown SKU ${input.sku}`);
      const ref: ComponentRef =
        input.component === "price" ? { type: "price", id: prod.id, key: "price" } : { type: "content", id: prod.id, key: input.component };
      if (input.component !== "price" && !policy.operator_content_keys.includes(input.component)) {
        throw new UndoError("forbidden", `Operators may not edit ${input.component}`);
      }
      const cur = await readComponent(tx, p.storeId, ref, true);
      if (!cur) throw new UndoError("not_found", "Component not found");
      if (cur.revision !== input.expected_revision) {
        throw new UndoError("revision_conflict", "Component changed since you loaded it", { current_revision: cur.revision });
      }
      const value =
        input.component === "price"
          ? { kind: "price" as const, amount_minor: input.amount_minor ?? NaN, currency: "USD" }
          : { kind: "text" as const, text: input.text ?? "" };
      if (value.kind === "price" && !(value.amount_minor >= policy.min_price_minor)) {
        throw new UndoError("policy_violation", "Price missing or below the store floor");
      }
      if (value.kind === "text" && !value.text) throw new UndoError("invalid_input", "text is required");
      await tx.query(`insert into actions(id, store_id, kind, actor, idempotency_key) values ($1,$2,'operator_edit',$3,$4)`, [
        actionId,
        p.storeId,
        p.principalId,
        input.idempotency_key,
      ]);
      await setActionId(tx, actionId);
      const { revision } = await writeComponent(tx, p.storeId, ref, value, cur.revision);
      await audit(tx, p.storeId, p.principalId, "operator.edit", { sku: input.sku, component: input.component, revision });
      const result = {
        status: "saved",
        sku: input.sku,
        component: input.component,
        before: valueToJson(cur.value),
        after: valueToJson(value),
        before_revision: cur.revision,
        revision,
        action_id: actionId,
      };
      await storeResponse(tx, p.storeId, `operator:${p.principalId}`, input.idempotency_key, result);
      return result;
    },
    { writer: p.principalId },
  );
}
