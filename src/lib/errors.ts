/** Stable, model-readable error codes returned by every UNDO surface. */
export type UndoErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "policy_violation"
  | "approval_required"
  | "approval_invalid"
  | "stale_plan"
  | "plan_expired"
  | "revision_conflict"
  | "idempotency_conflict"
  | "replan_required"
  | "unsupported"
  | "limit_exceeded"
  | "offer_changed_reconfirm"
  | "stale_dependency_state"
  | "internal";

export class UndoError extends Error {
  constructor(
    public readonly code: UndoErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly nextAction?: string,
  ) {
    super(message);
    this.name = "UndoError";
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details, next_action: this.nextAction };
  }
}

export function isUndoError(e: unknown): e is UndoError {
  return e instanceof UndoError;
}

export const httpStatusFor: Record<UndoErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  policy_violation: 422,
  approval_required: 409,
  approval_invalid: 403,
  stale_plan: 409,
  plan_expired: 410,
  revision_conflict: 409,
  idempotency_conflict: 409,
  replan_required: 409,
  unsupported: 422,
  limit_exceeded: 429,
  offer_changed_reconfirm: 409,
  stale_dependency_state: 409,
  internal: 500,
};
