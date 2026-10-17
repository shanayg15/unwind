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
import { type ApprovalItem, approvalDonePage, approvalErrorPage, approvalPage, overviewPage, storefrontPage } from "./src/web/pages.js";

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
    if (!/^apr_[A-Za-z0-9_-]{20,60}$/.test(token)) return c.html(approvalErrorPage("This approval link is not valid."), 404);
    const view = await withTx((tx) => lookupApprovalToken(tx, token));
    const csrf = newSecret("csrf");
    setCookie(c, "undo_csrf", csrf, { httpOnly: true, sameSite: "Strict", secure: BASE_URL.startsWith("https"), path: "/approve" });
    const model = await approvalModel(view.storeId, view.kind, view.subjectId);
    return c.html(approvalPage({ ...model, planHash: view.subjectHash, expiresAt: view.expiresAt, usedAt: view.usedAt, csrf, token, replyHint: view.caseId !== null }));
  } catch (e) {
    return c.html(approvalErrorPage(isUndoError(e) ? e.message : "Something went wrong loading this plan."), isUndoError(e) ? (httpStatusFor[e.code] as 400) : 500);
  }
});

server.post("/approve/:token", async (c) => {
  try {
    rateLimit(`ip:${clientIp(c)}`, 20);
    const token = c.req.param("token");
    const form = await c.req.parseBody();
    const csrf = String(form.csrf ?? "");
    const cookie = getCookie(c, "undo_csrf") ?? "";
    if (!csrf || !cookie || !safeEqual(csrf, cookie)) return c.html(approvalErrorPage("This form expired. Open the link again and retry."), 403);
    const decision = form.decision === "reject" ? "reject" : "approve";
    const res = await approveViaToken(token, decision);
    if (res.approvalId && res.caseId) {
      await query(
        `insert into inbox_events(id, provider, provider_event_id, event_type, payload_hash, payload, status, case_id)
         values ($1,'undo',$2,'undo.approval_granted',$3,$4,'queued',$5) on conflict do nothing`,
        [newId("evt"), `approval:${res.approvalId}`, res.approvalId, JSON.stringify({ approval_id: res.approvalId, kind: res.kind, subject_id: res.subjectId, case_id: res.caseId }), res.caseId],
      );
    }
    const store = (await query(`select s.name from approval_requests r join stores s on s.id = r.store_id where r.token_hash = encode(sha256($1::bytea), 'hex')`, [token])).rows[0]?.name ?? "Your store";
    const detail =
      decision === "reject"
        ? "Declined. Your shop agent will not apply it."
        : res.kind === "recovery"
          ? "Your shop agent is applying it now and will text you once it has checked the store."
          : "Your shop agent can now run this exact launch.";
    return c.html(approvalDonePage(store, decision === "approve", res.kind, detail));
  } catch (e) {
    return c.html(approvalErrorPage(isUndoError(e) ? e.message : "Something went wrong; nothing was applied."), isUndoError(e) ? (httpStatusFor[e.code] as 400) : 500);
  }
});

const COMPONENT_LABEL: Record<string, string> = {
  "price:price": "Price",
  "content:promotional_copy": "Promo copy",
  "content:sizing_info": "Sizing",
  "slot:premium_home": "Tile",
  "slot:clearance_home": "Tile",
  "slot:navigation": "Menu",
};
const SLOT_TITLE: Record<string, string> = { premium_home: "Homepage premium tile", clearance_home: "Homepage clearance tile", navigation: "Navigation menu" };

function groupItems<T extends { label: string; component: string }>(rows: T[], line: (r: T) => ApprovalItem["lines"][number]): ApprovalItem[] {
  const map = new Map<string, ApprovalItem>();
  for (const r of rows) {
    const [title] = r.label.split(" · ");
    const name = title === "Slot" ? (SLOT_TITLE[r.component.split(":")[1]] ?? "Store slot") : title;
    if (!map.has(name)) map.set(name, { title: name, lines: [] });
    map.get(name)!.lines.push(line(r));
  }
  return [...map.values()];
}

async function approvalModel(storeId: string, kind: "launch" | "recovery", subjectId: string) {
  const store = (await query(`select name from stores where id=$1`, [storeId])).rows[0].name as string;
  if (kind === "launch") {
    const ro = (await query(`select goal, proposal from rollouts where id=$1 and store_id=$2`, [subjectId, storeId])).rows[0];
    const titles = Object.fromEntries((await query(`select id, title from products where store_id=$1`, [storeId])).rows.map((r) => [r.id, r.title]));
    const fmt = (v: Record<string, unknown>) => ("amount_minor" in v ? `$${(Number(v.amount_minor) / 100).toFixed(2)}` : "text" in v ? String(v.text) : String((v.content as { title?: string })?.title ?? ""));
    const changes = ro.proposal.changes as Array<{ component: { type: string; id: string; key: string }; value: Record<string, unknown>; observed_value: Record<string, unknown> }>;
    const rows = changes.map((ch) => ({
      label: ch.component.type === "slot" ? "Slot" : `${titles[ch.component.id] ?? ch.component.id}`,
      component: `${ch.component.type}:${ch.component.key}`,
      from: fmt(ch.observed_value),
      to: fmt(ch.value),
    }));
    return {
      kind,
      store,
      headline: `Launch ${changes.length} changes?`,
      lede: `${String(ro.goal).split(":")[0]}. Every change is recorded so it can be undone later.`,
      goesBack: groupItems(rows, (r) => ({ what: COMPONENT_LABEL[r.component] ?? r.component, from: r.from, to: r.to })),
      stays: [],
      heldBack: [],
      untouched: ["Sizing information", "Existing orders"],
    };
  }
  const receipt = await buildReceipt(storeId, subjectId);
  const back = receipt.rows.filter((r) => r.status === "eligible");
  const kept = receipt.rows.filter((r) => r.status === "kept_by_new_decision");
  const held = receipt.rows.filter((r) => r.status === "conflict" || r.status.startsWith("withheld"));
  const orders = (await query(`select count(*)::int n from orders where store_id=$1`, [storeId])).rows[0].n as number;
  const keptByProduct = new Map<string, string[]>();
  for (const r of receipt.preserved) {
    const [title] = r.label.split(" · ");
    const name = title === "Slot" ? (SLOT_TITLE[r.component.split(":")[1]] ?? "Store slot") : title;
    const what = title === "Slot" ? "" : (COMPONENT_LABEL[r.component] ?? r.component).toLowerCase();
    keptByProduct.set(name, [...(keptByProduct.get(name) ?? []), what].filter(Boolean));
  }
  const untouched = [
    ...[...keptByProduct].map(([name, parts]) => (parts.length ? `${name}: launch ${parts.join(" and ")} ${parts.length > 1 ? "stay" : "stays"}` : `${name} stays as launched`)),
    ...receipt.independent.filter((r) => r.tags.some((t) => t.startsWith("edited"))).map((r) => `${r.label.split(" · ")[0]} sizing: your team's edit stays`),
    `${orders} existing order${orders === 1 ? "" : "s"} keep their recorded prices`,
  ];
  const n = back.length;
  const goal = receipt.rollout_goal.split(":")[0];
  return {
    kind,
    store,
    headline: `Put ${n} change${n === 1 ? "" : "s"} back?`,
    lede: `From your ${goal.toLowerCase().startsWith("weekend") ? goal.toLowerCase() : `"${goal}"`}. ${kept.length ? `${kept.length} stay${kept.length === 1 ? "s" : ""} as you decided. ` : ""}${held.length ? `${held.length} changed after the launch and won't be overwritten. ` : ""}Nothing else changes.`,
    goesBack: groupItems(back, (r) => ({ what: COMPONENT_LABEL[r.component] ?? r.component, from: r.current, to: r.original })),
    stays: groupItems(kept, (r) => ({ what: COMPONENT_LABEL[r.component] ?? r.component, from: null, to: r.current, note: "Changed after the launch; kept as you asked" })),
    heldBack: groupItems(held, (r) => ({ what: COMPONENT_LABEL[r.component] ?? r.component, from: null, to: r.current, note: "Changed after the launch by someone else" })),
    untouched,
  };
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
