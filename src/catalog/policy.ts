import { z } from "zod";

export const StorePolicy = z.object({
  currency: z.literal("USD"),
  /** Maximum discount from the price at proposal time, per collection (percent). */
  max_discount_pct: z.record(z.string(), z.number().min(0).max(90)),
  /** Discounts above this need owner review (all launches are owner-approved; this is recorded). */
  review_threshold_pct: z.number().min(0).max(90),
  /** Absolute price floor in minor units. */
  min_price_minor: z.number().int().positive(),
  /** Price increases in a rollout are capped (percent). */
  max_increase_pct: z.number().min(0).max(100),
  max_targets: z.number().int().positive().max(50),
  /** Content component keys a rollout (agent) may change. Sizing is operator-only. */
  rollout_content_keys: z.array(z.enum(["promotional_copy", "sizing_info"])),
  operator_content_keys: z.array(z.enum(["promotional_copy", "sizing_info"])),
  /** Narrow standing recovery policy (eval stores only): agent may apply plans that only restore eligible recorded changes. */
  recovery_grant: z
    .object({ scope: z.literal("eligible_restorations_only"), granted_by: z.string(), granted_at: z.string() })
    .nullable(),
  plan_ttl_minutes: z.number().int().min(1).max(120),
});
export type StorePolicy = z.infer<typeof StorePolicy>;

export function defaultPolicy(overrides: Partial<StorePolicy> = {}): StorePolicy {
  return StorePolicy.parse({
    currency: "USD",
    max_discount_pct: { premium: 15, clearance: 25 },
    review_threshold_pct: 15,
    min_price_minor: 1000,
    max_increase_pct: 10,
    max_targets: 50,
    rollout_content_keys: ["promotional_copy"],
    operator_content_keys: ["promotional_copy", "sizing_info"],
    recovery_grant: null,
    plan_ttl_minutes: 30,
    ...overrides,
  });
}
