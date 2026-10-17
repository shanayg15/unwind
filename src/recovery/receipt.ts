import { z } from "zod";
import { readComponent, valueToJson } from "../catalog/components.js";
import { withTx } from "../db/pool.js";
import { formatMoney, truncate } from "../lib/util.js";

export const ReceiptRow = z.object({
  change_id: z.string().nullable(),
  label: z.string(),
  component: z.string(),
  tags: z.array(z.string()),
  original: z.string().nullable(),
  launch: z.string().nullable(),
  current: z.string().nullable(),
  current_revision: z.number().nullable(),
  status: z.string(),
  selected: z.boolean(),
});

export const Receipt = z.object({
  mode: z.enum(["plan", "recovery"]),
  store: z.string(),
  rollout_id: z.string(),
  rollout_goal: z.string(),
  plan_id: z.string(),
  plan_hash: z.string(),
  plan_expires_at: z.string(),
  recovery_id: z.string().nullable(),
  recovery_status: z.string().nullable(),
  approval: z.object({ state: z.string(), detail: z.string() }),
  rows: z.array(ReceiptRow),
  preserved: z.array(ReceiptRow),
  independent: z.array(ReceiptRow),
  impact: z.object({ direct: z.number(), linked_unselected: z.number(), temporal_only: z.number(), unknown: z.number(), as_of_seq: z.number() }),
  communications: z.array(z.object({ channel: z.string(), purpose: z.string(), status: z.string() })),
  generated_at: z.string(),
});
export type Receipt = z.infer<typeof Receipt>;

function show(v: Record<string, unknown> | null | undefined): string | null {
  if (!v) return null;
  if ("amount_minor" in v) return formatMoney(Number(v.amount_minor));
  if ("text" in v) return truncate(String(v.text), 90);
  if ("content" in v) return String((v.content as { title?: string }).title ?? "slot");
  return truncate(JSON.stringify(v), 90);
}

/** Build the RecoveryReceipt view model from stored plan/attempt rows plus current readback. */
export async function buildReceipt(storeId: string, planId: string): Promise<Receipt> {
  return withTx(async (tx) => {
    const plan = (await tx.query(`select * from recovery_plans where id=$1 and store_id=$2`, [planId, storeId])).rows[0];
    const ro = (await tx.query(`select id, goal, executed_at from rollouts where id=$1`, [plan.rollout_id])).rows[0];
    const store = (await tx.query(`select name from stores where id=$1`, [storeId])).rows[0];
    const attempt = (await tx.query(`select id, status, result from recovery_attempts where plan_id=$1 order by created_at desc limit 1`, [planId])).rows[0];
    const outcome = new Map<string, string>();
    if (attempt) for (const r of attempt.result.results as Array<{ change_id: string; outcome: string }>) outcome.set(r.change_id, r.outcome);
    const planItems = new Map<string, { status: string; will_write: boolean; group_blocked: boolean }>(
      (plan.items as Array<{ change_id: string; status: string; will_write: boolean; group_blocked: boolean }>).map((i) => [i.change_id, i]),
    );
    const changes = (
      await tx.query(
        `select c.*, p.title from action_changes c left join products p on p.id = c.product_id where c.rollout_id=$1 and c.store_id=$2 order by c.component_type, p.title nulls last, c.component_key`,
        [plan.rollout_id, storeId],
      )
    ).rows;
    const rows: z.infer<typeof ReceiptRow>[] = [];
    const preserved: z.infer<typeof ReceiptRow>[] = [];
    const selected = new Set<string>(plan.selected_change_ids);
    for (const c of changes) {
      const cur = await readComponent(tx, storeId, { type: c.component_type, id: c.component_id, key: c.component_key });
      const label = c.title ? `${c.title} · ${c.component_type === "price" ? "price" : c.component_key.replace("_", " ")}` : `Slot · ${c.component_key.replace("_", " ")}`;
      const isSel = selected.has(c.id);
      const pi = planItems.get(c.id);
      const status = isSel
        ? attempt
          ? (outcome.get(c.id) ?? "unknown")
          : pi
            ? pi.group_blocked
              ? "withheld_group"
              : pi.will_write
                ? "eligible"
                : pi.status
            : "unknown"
        : cur?.revision === Number(c.after_revision)
          ? "kept_at_launch_value"
          : "changed_by_another_writer";
      const row = {
        change_id: c.id,
        label,
        component: `${c.component_type}:${c.component_key}`,
        tags: c.scope_labels,
        original: show(c.before_value),
        launch: show(c.after_value),
        current: cur ? show(valueToJson(cur.value)) : null,
        current_revision: cur?.revision ?? null,
        status,
        selected: isSel,
      };
      (isSel ? rows : preserved).push(row);
    }
    const productIds = [...new Set(changes.filter((c) => selected.has(c.id) && c.product_id).map((c) => c.product_id))];
    const independent = productIds.length
      ? (
          await tx.query(
            `select c.product_id, c.value, c.revision, c.last_actor, p.title from product_content c join products p on p.id=c.product_id
              where c.store_id=$1 and c.product_id = any($2) and c.component_key='sizing_info' order by p.title`,
            [storeId, productIds],
          )
        ).rows.map((s) => ({
          change_id: null,
          label: `${s.title} · sizing info`,
          component: "content:sizing_info",
          tags: ["independent", s.last_actor === "fixture" ? "original" : `edited by ${s.last_actor === "pr_operator" ? "operator" : "another writer"}`],
          original: null,
          launch: null,
          current: truncate(s.value, 90),
          current_revision: Number(s.revision),
          status: attempt ? "preserved_not_written_by_recovery" : "not_part_of_rollout",
          selected: false,
        }))
      : [];
    const selPrice = changes.filter((c) => selected.has(c.id) && c.component_type === "price").map((c) => c.id);
    const lines = (
      await tx.query(
        `select o.id, bool_or(l.source_change_id = any($3)) as direct, bool_or(l.source_rollout_id = $4) as linked, bool_or(l.source_price_revision is null) as unknown
           from orders o join order_lines l on l.order_id=o.id
          where o.store_id=$1 and o.seq <= $2 and (o.created_at >= $5 or l.source_rollout_id = $4 or l.source_price_revision is null) group by o.id`,
        [storeId, plan.order_cutoff_seq, selPrice, plan.rollout_id, ro.executed_at],
      )
    ).rows;
    const impact = { direct: 0, linked_unselected: 0, temporal_only: 0, unknown: 0, as_of_seq: Number(plan.order_cutoff_seq) };
    for (const l of lines) {
      if (l.direct) impact.direct++;
      else if (l.linked) impact.linked_unselected++;
      else if (l.unknown) impact.unknown++;
      else impact.temporal_only++;
    }
    const appr = (
      await tx.query(`select consumed_at, expires_at, revoked_at from approvals where kind='recovery' and subject_id=$1 and store_id=$2 order by created_at desc limit 1`, [planId, storeId])
    ).rows[0];
    const reqs = (await tx.query(`select used_at, expires_at from approval_requests where kind='recovery' and subject_id=$1 order by created_at desc limit 1`, [planId])).rows[0];
    const approval = attempt
      ? { state: "applied", detail: `authorized by ${String((await tx.query(`select authorization_ref from recovery_attempts where id=$1`, [attempt.id])).rows[0].authorization_ref).split(":")[0].replace("_", " ")}` }
      : appr
        ? { state: appr.consumed_at ? "consumed" : "owner_approved", detail: "owner confirmed this exact plan hash" }
        : reqs
          ? { state: reqs.used_at ? "link_used" : "awaiting_owner", detail: "approval link sent to the owner's phone" }
          : { state: "not_requested", detail: "owner confirmation of this plan hash is required before apply (unless a standing grant covers it)" };
    const comms = plan.case_id
      ? (await tx.query(`select channel, purpose, status from outbox_messages where case_id=$1 order by created_at`, [plan.case_id])).rows
      : [];
    const customerComms = (
      await tx.query(
        `select m.channel, m.purpose, m.status from outbox_messages m join cases c on c.id = m.case_id where c.store_id=$1 and c.role='customer' and c.rollout_id=$2 order by m.created_at`,
        [storeId, plan.rollout_id],
      )
    ).rows;
    return {
      mode: attempt ? "recovery" : "plan",
      store: store.name,
      rollout_id: ro.id,
      rollout_goal: ro.goal,
      plan_id: plan.id,
      plan_hash: plan.plan_hash,
      plan_expires_at: new Date(plan.expires_at).toISOString(),
      recovery_id: attempt?.id ?? null,
      recovery_status: attempt?.status ?? null,
      approval,
      rows,
      preserved,
      independent,
      impact,
      communications: [...comms, ...customerComms].map((m) => ({ channel: m.channel, purpose: m.purpose, status: m.status })),
      generated_at: new Date().toISOString(),
    };
  });
}
