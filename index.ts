import { getCookie, setCookie } from "hono/cookie";
import { MCPServer } from "mcp-use";
import { z } from "zod";
import { approveViaToken, lookupApprovalToken } from "./src/approvals/approvals.js";
import { bearerFrom, type Principal, verifyToken } from "./src/auth/principals.js";
import { operatorEdit } from "./src/catalog/operator.js";
import { receiveInkbox } from "./src/comms/receiver.js";
import { query, withTx } from "./src/db/pool.js";
import { undoImpact } from "./src/impact/impact.js";
import { httpStatusFor, isUndoError, UndoError } from "./src/lib/errors.js";
import { newId, newSecret, safeEqual } from "./src/lib/util.js";
import { checkout } from "./src/orders/checkout.js";
import { Proposal, undoExecute } from "./src/recovery/execute.js";
import { undoCapabilities, undoHistory } from "./src/recovery/history.js";
import { undoApply, undoPreview } from "./src/recovery/plan.js";
import { buildReceipt, Receipt } from "./src/recovery/receipt.js";
import { undoVerify } from "./src/recovery/verify.js";
import { approvalPage, layout, overviewPage, storefrontPage } from "./src/web/pages.js";

const PUBLIC_STORE = process.env.PUBLIC_DEMO_STORE_ID ?? "store_demo";
const BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const server = new MCPServer({
  name: "undo",
  title: "UNDO",
  version: "0.1.0",
  description: "Commerce-aware recovery for a shop agent's live changes: recorded history, selective recovery, order impact, verified readback.",
  instructions: [
    "UNDO records every supported store edit (price, promotional copy, homepage/navigation slots) with exact before/after values and revisions.",
    "Workflow: undo_capabilities -> undo_history (discover rollouts and change_ids; you never need the original conversation) ->",
    "undo_preview (select exact recorded change_ids; conflicts are reported, nothing is written) -> undo_impact (orders linked by captured price revision) ->",
    "undo_apply (needs the owner's confirmation of the exact plan_hash unless a standing grant covers it) -> undo_verify (readback + preservation checks).",
    "Select changes by their recorded labels (e.g. 'premium', 'clearance', 'navigation'). Never invent before-values or inverses.",
    "A later edit to a recorded component is a conflict: ask the owner whether to keep the current value, then re-preview with keep_current_change_ids.",
  ].join(" "),
  websiteUrl: BASE_URL,
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["512x512"] }],
});

// ---------------------------------------------------------------- helpers

const callCounts = new Map<string, { n: number; at: number }>();
function rateLimit(keyId: string, perMinute: number): void {
  const now = Date.now();
  const c = callCounts.get(keyId);
  if (!c || now - c.at > 60_000) {
    callCounts.set(keyId, { n: 1, at: now });
    return;
  }
  c.n++;
  if (c.n > perMinute) throw new UndoError("limit_exceeded", "Rate limit exceeded; slow down");
}

type ToolCtx = { request?: { header(name: string): string | undefined } };

async function principalOf(ctx: ToolCtx): Promise<Principal> {
  const p = await verifyToken(bearerFrom(ctx.request?.header("authorization")));
  rateLimit(p.tokenId, 120);
  return p;
}

function ok<T extends Record<string, unknown>>(summary: string, data: T) {
  const json = JSON.stringify(data);
  const text = `${summary}\n${json.length > 7000 ? `${json.slice(0, 7000)}… (truncated; full result in structuredContent)` : json}`;
  return { content: [{ type: "text" as const, text }], structuredContent: data };
}

function fail(e: unknown) {
  if (isUndoError(e)) {
    return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: e.toJSON() }) }] };
  }
  if (e instanceof z.ZodError) {
    return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "invalid_input", message: "Input failed validation", details: { issues: e.issues.slice(0, 5) } } }) }] };
  }
  console.error("[undo] internal error", (e as Error)?.message);
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "internal", message: "Internal error; the operation may not have completed. Use undo_verify or undo_history to check state." } }) }] };
}

const Loose = z.looseObject({});
const idem = z.string().min(8).max(120).regex(/^[A-Za-z0-9_\-:.]+$/).describe("Unique key for this request; retrying with the same key never repeats the effect");
const changeId = z.string().min(4).max(40);

// ---------------------------------------------------------------- tools (exactly seven)

export const undoCapabilitiesTool = server.tool(
  {
    name: "undo_capabilities",
    title: "UNDO capabilities",
    description: "Return your verified role and store, supported components, limits, recovery conditions, and the current targetable products/slots with revisions. Read-only. Call first.",
    inputSchema: z.object({}),
    outputSchema: Loose,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (_input, ctx) => {
    try {
      const p = await principalOf(ctx);
      const r = await undoCapabilities(p);
      return ok(`Role ${p.role} on store ${p.storeId}.`, r);
    } catch (e) {
      return fail(e);
    }
  },
);

export const undoHistoryTool = server.tool(
  {
    name: "undo_history",
    title: "UNDO history",
    description:
      "List recorded rollouts with their exact change_ids, components, labels (e.g. premium, clearance, navigation, price, promotional_copy, placement), before/after values, revisions and recovery status. Use it to discover what to recover without the original conversation. Read-only, paginated.",
    inputSchema: z.object({
      rollout_id: z.string().max(40).optional().describe("Fetch one rollout"),
      goal_contains: z.string().max(80).optional().describe("Case-insensitive filter on the rollout goal text"),
      state: z.enum(["awaiting_approval", "approved", "executed", "rejected"]).optional(),
      cursor: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(10).optional().describe("Rollouts per page (default 5)"),
    }),
    outputSchema: Loose,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input, ctx) => {
    try {
      const p = await principalOf(ctx);
      const r = await undoHistory(p, input);
      const n = (r.rollouts as unknown[]).length;
      return ok(`${n} rollout(s).`, r);
    } catch (e) {
      return fail(e);
    }
  },
);

export const undoExecuteTool = server.tool(
  {
    name: "undo_execute",
    title: "UNDO execute",
    description:
      "Two steps. (1) Pass {proposal, idempotency_key} to validate a typed rollout against price caps and allowed fields; it is recorded as awaiting the owner's approval of its proposal_hash. (2) After the owner approves, pass {rollout_id, proposal_hash, idempotency_key} to apply it atomically; every change is journaled with before/after values and revisions. You cannot supply before-values.",
    inputSchema: z.object({
      proposal: Proposal.optional().describe("Typed changes: set_price {product_id, amount_minor}, set_content {product_id, component_key:'promotional_copy', value}, set_slot {slot_id, content}"),
      rollout_id: z.string().max(40).optional(),
      proposal_hash: z.string().length(64).optional(),
      idempotency_key: idem,
    }),
    outputSchema: Loose,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input, ctx) => {
    try {
      const p = await principalOf(ctx);
      const r = await undoExecute(p, input);
      return ok(`Execute: ${String(r.status)}.`, r);
    } catch (e) {
      return fail(e);
    }
  },
);

const receiptMeta = (name: "recovery-plan" | "recovery-receipt") => ({
  name,
  description: "RecoveryReceipt: per-component original/launch/current values, eligible/conflict/kept badges, order impact, approval and communication state",
  prefersBorder: true,
});

export const undoPreviewTool = server.tool(
  {
    name: "undo_preview",
    title: "UNDO preview",
    description:
      "Preview recovery of exact recorded change_ids from one rollout (pick them from undo_history by label). Classifies each as eligible, conflict (changed by a later writer), already_reverted, or kept_by_new_decision; atomic groups are withheld as a whole. Returns plan_id, plan_hash and expiry. Writes nothing and reserves nothing.",
    inputSchema: z.object({
      rollout_id: z.string().max(40),
      change_ids: z.array(changeId).min(1).max(50).describe("Recorded change_ids to withdraw"),
      keep_current_change_ids: z.array(changeId).max(50).optional().describe("Subset of change_ids where the OWNER decided to keep the current value (accepted exception)"),
      intent_note: z.string().max(300).optional().describe("Short note of the owner's instruction this plan implements"),
    }),
    outputSchema: z.looseObject({ receipt: Receipt.nullable() }),
    view: receiptMeta("recovery-plan"),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input, ctx) => {
    try {
      const p = await principalOf(ctx);
      const r = await undoPreview(p, input);
      const receipt = await buildReceipt(p.storeId, String(r.plan_id));
      const c = r.counts as Record<string, number>;
      return ok(`Plan ${String(r.plan_id)}: ${String(r.will_restore)} will restore, ${c.conflict ?? 0} conflict(s), ${c.kept_by_new_decision ?? 0} kept.`, { ...r, receipt });
    } catch (e) {
      return fail(e);
    }
  },
);

export const undoImpactTool = server.tool(
  {
    name: "undo_impact",
    title: "UNDO impact",
    description:
      "Order facts for a rollout selection or plan, classified from checkout provenance: direct_price_revision (order captured a price written by a selected change), linked_unselected_change, temporal_only (same period, no link; not attributed), unknown_provenance. Includes as-of cutoff and paging. Customers see only their own orders. Read-only; sends nothing.",
    inputSchema: z.object({
      plan_id: z.string().max(40).optional(),
      rollout_id: z.string().max(40).optional(),
      change_ids: z.array(changeId).max(50).optional(),
      cutoff_seq: z.number().int().min(0).optional().describe("Report as of this order sequence (default: latest)"),
      cursor: z.string().max(40).optional(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    outputSchema: Loose,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input, ctx) => {
    try {
      const p = await principalOf(ctx);
      const r = await undoImpact(p, input);
      const counts = r.counts as Record<string, number> | undefined;
      return ok(counts ? `Impact: ${counts.direct_price_revision} direct, ${counts.temporal_only} temporal-only, ${counts.unknown_provenance} unknown.` : "Your orders.", r);
    } catch (e) {
      return fail(e);
    }
  },
);

export const undoApplyTool = server.tool(
  {
    name: "undo_apply",
    title: "UNDO apply",
    description:
      "Apply a previewed plan. Requires plan_id + plan_hash and either the owner's approval_id for that exact hash, owner credentials, or a standing grant. Re-checks every component under lock: only components still at their recorded launch revision are restored (as new revisions); later edits are withheld, never overwritten. Returns restored, withheld and accepted-exception items.",
    inputSchema: z.object({
      plan_id: z.string().max(40),
      plan_hash: z.string().length(64),
      approval_id: z.string().max(40).optional().describe("Owner approval for this exact plan_hash"),
      idempotency_key: idem,
    }),
    outputSchema: Loose,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input, ctx) => {
    try {
      const p = await principalOf(ctx);
      const r = await undoApply(p, input);
      return ok(`Recovery ${String(r.recovery_id)}: ${String(r.status)}.`, r);
    } catch (e) {
      return fail(e);
    }
  },
);

export const undoVerifyTool = server.tool(
  {
    name: "undo_verify",
    title: "UNDO verify",
    description:
      "Verify a recovery by readback: restored components (or 'subsequently changed'), no writes outside the restored set, unselected rollout changes and independent edits (e.g. sizing) preserved, order snapshots unchanged at the cutoff, accepted exceptions, and outstanding communications. Read-only.",
    inputSchema: z.object({
      recovery_id: z.string().max(40).optional(),
      plan_id: z.string().max(40).optional(),
      rollout_id: z.string().max(40).optional(),
    }),
    outputSchema: z.looseObject({ receipt: Receipt.nullable() }),
    view: receiptMeta("recovery-receipt"),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input, ctx) => {
    try {
      const p = await principalOf(ctx);
      const r = await undoVerify(p, input);
      let receipt = null;
      const planId = input.plan_id ?? (r.recovery_id ? (await query(`select plan_id from recovery_attempts where id=$1`, [r.recovery_id])).rows[0]?.plan_id : null);
      if (planId) receipt = await buildReceipt(p.storeId, planId);
      return ok(`Verify: ${String(r.verdict)}.`, { ...r, receipt });
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------- HTTP: auth gate for /mcp

server.use("/mcp", async (c, next) => {
  const accept = c.req.header("accept") ?? "";
  if (c.req.method === "GET" && accept.includes("text/html")) return next();
  if (c.req.method === "OPTIONS") return next();
  try {
    await verifyToken(bearerFrom(c.req.header("authorization")));
  } catch (e) {
    return c.json({ error: isUndoError(e) ? e.toJSON() : { code: "unauthenticated" } }, 401, { "WWW-Authenticate": 'Bearer realm="undo"' });
  }
  return next();
});

if (process.env.NODE_ENV === "production") {
  server.use("/mcp/inspector/*", async (c) => c.text("Not found", 404));
  server.use("/mcp/inspector", async (c) => c.text("Not found", 404));
}

// ---------------------------------------------------------------- HTTP: public read-only pages

server.get("/", async (c) => c.html(await overviewPage(PUBLIC_STORE, `${BASE_URL}/mcp`)));
server.get("/store", async (c) => c.html(await storefrontPage(PUBLIC_STORE)));
server.get("/healthz", async (c) => {
  const r = await query(`select 1 as ok`);
  return c.json({ ok: r.rows[0].ok === 1, service: "undo", version: "0.1.0", commit: process.env.GIT_COMMIT ?? process.env.MANUFACT_GIT_SHA ?? null });
});

// ---------------------------------------------------------------- HTTP: owner approval page (single-use link)

function clientIp(c: { req: { header(n: string): string | undefined } }): string {
  return (c.req.header("x-forwarded-for") ?? "local").split(",")[0].trim();
}

server.get("/approve/:token", async (c) => {
  try {
    rateLimit(`ip:${clientIp(c)}`, 60);
    const token = c.req.param("token");
    if (!/^apr_[A-Za-z0-9_-]{20,60}$/.test(token)) return c.html(layout("Approval", "<h1>Invalid approval link</h1>"), 404);
    const view = await withTx((tx) => lookupApprovalToken(tx, token));
    const rows = await approvalRows(view.storeId, view.kind, view.subjectId);
    const store = (await query(`select name from stores where id=$1`, [view.storeId])).rows[0].name;
    const csrf = newSecret("csrf");
    setCookie(c, "undo_csrf", csrf, { httpOnly: true, sameSite: "Strict", secure: BASE_URL.startsWith("https"), path: "/approve" });
    return c.html(approvalPage({ kind: view.kind, store, subjectHash: view.subjectHash, expiresAt: view.expiresAt, usedAt: view.usedAt, rows, csrf, token }));
  } catch (e) {
    return c.html(layout("Approval", `<h1>Approval link unavailable</h1><p>${isUndoError(e) ? e.message : "error"}</p>`), isUndoError(e) ? (httpStatusFor[e.code] as 400) : 500);
  }
});

server.post("/approve/:token", async (c) => {
  try {
    rateLimit(`ip:${clientIp(c)}`, 20);
    const token = c.req.param("token");
    const form = await c.req.parseBody();
    const csrf = String(form.csrf ?? "");
    const cookie = getCookie(c, "undo_csrf") ?? "";
    if (!csrf || !cookie || !safeEqual(csrf, cookie)) return c.html(layout("Approval", "<h1>Request rejected</h1><p>Missing or mismatched form token. Reload the link and try again.</p>"), 403);
    const decision = form.decision === "reject" ? "reject" : "approve";
    const res = await approveViaToken(token, decision);
    if (res.approvalId && res.caseId) {
      await query(
        `insert into inbox_events(id, provider, provider_event_id, event_type, payload_hash, payload, status, case_id)
         values ($1,'undo',$2,'undo.approval_granted',$3,$4,'queued',$5) on conflict do nothing`,
        [newId("evt"), `approval:${res.approvalId}`, res.approvalId, JSON.stringify({ approval_id: res.approvalId, kind: res.kind, subject_id: res.subjectId, case_id: res.caseId }), res.caseId],
      );
    }
    const msg =
      decision === "reject"
        ? "Rejected. Nothing will be applied."
        : res.kind === "recovery"
          ? "Approved. The agent will apply this exact plan, verify it, and text you the result."
          : "Approved. The agent can now execute this exact launch.";
    return c.html(layout("Approval", `<h1>${decision === "reject" ? "Rejected" : "Approved"}</h1><p>${msg}</p><p class="muted">Approval id ${res.approvalId ?? "-"}</p>`));
  } catch (e) {
    return c.html(layout("Approval", `<h1>Not applied</h1><p>${isUndoError(e) ? e.message : "error"}</p>`), isUndoError(e) ? (httpStatusFor[e.code] as 400) : 500);
  }
});

async function approvalRows(storeId: string, kind: string, subjectId: string) {
  if (kind === "launch") {
    const ro = (await query(`select proposal from rollouts where id=$1 and store_id=$2`, [subjectId, storeId])).rows[0];
    const fmt = (v: Record<string, unknown>) => ("amount_minor" in v ? `$${(Number(v.amount_minor) / 100).toFixed(2)}` : "text" in v ? String(v.text) : String((v.content as { title?: string })?.title ?? ""));
    return (ro.proposal.changes as Array<{ component: { type: string; id: string; key: string }; value: Record<string, unknown>; observed_value: Record<string, unknown>; check: string }>).map((c) => ({
      label: `${c.component.type} ${c.component.key} (${c.component.id.replace(/^prd_|^slot_/, "")})`,
      from: fmt(c.observed_value),
      to: fmt(c.value),
      status: "will_apply",
    }));
  }
  const receipt = await buildReceipt(storeId, subjectId);
  return receipt.rows.map((r) => ({ label: r.label, from: r.current, to: r.status === "eligible" ? r.original : r.current, status: r.status }));
}

// ---------------------------------------------------------------- HTTP: scoped storefront writers

async function apiPrincipal(c: { req: { header(n: string): string | undefined } }): Promise<Principal> {
  const p = await verifyToken(bearerFrom(c.req.header("authorization")));
  rateLimit(p.tokenId, 60);
  return p;
}

async function readJson(c: { req: { header(n: string): string | undefined; text(): Promise<string> } }, max = 16 * 1024): Promise<unknown> {
  const t = await c.req.text();
  if (t.length > max) throw new UndoError("invalid_input", "Body too large");
  try {
    return JSON.parse(t);
  } catch {
    throw new UndoError("invalid_input", "Invalid JSON");
  }
}

server.post("/api/checkout", async (c) => {
  try {
    const p = await apiPrincipal(c);
    return c.json(await checkout(p, await readJson(c)));
  } catch (e) {
    if (e instanceof z.ZodError) return c.json({ error: { code: "invalid_input", issues: e.issues.slice(0, 5) } }, 400);
    return c.json({ error: isUndoError(e) ? e.toJSON() : { code: "internal" } }, isUndoError(e) ? (httpStatusFor[e.code] as 400) : 500);
  }
});

server.post("/api/operator/edit", async (c) => {
  try {
    const p = await apiPrincipal(c);
    return c.json(await operatorEdit(p, await readJson(c)));
  } catch (e) {
    if (e instanceof z.ZodError) return c.json({ error: { code: "invalid_input", issues: e.issues.slice(0, 5) } }, 400);
    return c.json({ error: isUndoError(e) ? e.toJSON() : { code: "internal" } }, isUndoError(e) ? (httpStatusFor[e.code] as 400) : 500);
  }
});

// ---------------------------------------------------------------- HTTP: signed Inkbox receiver

server.post("/webhooks/inkbox", async (c) => {
  const len = Number(c.req.header("content-length") ?? "0");
  if (len > 256 * 1024) return c.json({ error: "payload too large" }, 413);
  const raw = Buffer.from(await c.req.arrayBuffer());
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const out = await receiveInkbox(raw, headers, {
    secret: process.env.INKBOX_WEBHOOK_SECRET ?? "",
    authToken: process.env.INKBOX_WEBHOOK_AUTH_TOKEN ?? "",
  });
  if (out.status !== 200) return c.json({ error: out.error }, out.status);
  return c.json({ ok: true, duplicate: out.duplicate, queued: out.queued });
});

export default server;
