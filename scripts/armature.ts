/**
 * Armature goal evaluations (U24) against the deployed UNDO MCP, evaluation store only.
 *   pnpm exec tsx --env-file=.env scripts/armature.ts sync            create/update cases A-E (prompt + criteria)
 *   pnpm exec tsx --env-file=.env scripts/armature.ts run [A B ...]   reset fixture -> CI run -> poll -> verdict + DB checks
 * Results: reports/armature.json (Armature run ids and judge verdicts, plus our independent database checks).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { closePool, query, withTx } from "../src/db/pool.js";
import { PRODUCTS, productId, slotId } from "../src/fixtures/demo.js";
import { orderSnapshot } from "../src/orders/snapshot.js";
import { evalFixture, evalPouchFixture } from "./eval-fixture.js";

const API = "https://app.armature.tech/api/armature/v1";
const KEY = process.env.ARMATURE_API_KEY!;
const SERVER_NAME = "UNDO (eval store)";
// Claude tester (the workspace's Claude Haiku 4.5 model id; the default tester is openai:gpt-4o-mini).
const TESTER_MODEL_ID = process.env.ARMATURE_TESTER_MODEL_ID ?? "17a1a13e-6e2b-4ab4-95c8-c3db83e06757";
const S = "store_eval";
const H = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const orig = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));

interface CaseDef {
  id: string;
  name: string;
  fixture: "weekend" | "pouch";
  prompt: string;
  criteria: string[];
  db: (ordersHash: string) => Promise<Array<[string, boolean]>>;
}

const price = async (k: string) => Number((await query(`select amount_minor from product_prices where product_id=$1`, [productId(S, k)])).rows[0].amount_minor);
const promo = async (k: string) => String((await query(`select value from product_content where product_id=$1 and component_key='promotional_copy'`, [productId(S, k)])).rows[0].value);
const slot = async (k: string) => (await query(`select content from store_slots where slot_id=$1`, [slotId(S, k)])).rows[0].content;
const lastRecovery = async () => (await query(`select status from recovery_attempts where store_id=$1 order by created_at desc limit 1`, [S])).rows[0]?.status as string | undefined;
const ordersSame = async (h: string) => (await withTx((tx) => orderSnapshot(tx, S))).hash === h;

const CASES: CaseDef[] = [
  {
    id: "A",
    name: "A selective premium withdrawal",
    fixture: "weekend",
    prompt:
      "I own Trailhead Outfitters (evaluation store). My shop agent ran a weekend launch earlier. I've changed my mind about part of it: withdraw the premium part of that launch. Put the premium prices, premium promotional copy and the premium homepage tile back the way they were before the launch. Keep the clearance discounts, the new navigation and all existing orders exactly as they are, and don't overwrite anything someone changed after the launch. Use the UNDO tools and tell me exactly what was restored and what was not.",
    criteria: [
      "The tester calls undo_history to find the weekend launch rollout before calling undo_preview.",
      'The tester\'s undo_preview selects only premium changes (labels ["premium"] or change_ids all labeled premium).',
      "The tester calls undo_apply for the previewed plan and the result status is partially_reverted.",
      "The final answer says the Trail Runner Shoe price was not restored because it was changed after the launch (current $139.00).",
      "The tester calls undo_verify and reports clearance prices, navigation, the jacket sizing edit and existing orders as preserved.",
      "The tester never calls undo_execute.",
    ],
    db: async (h) => [
      ["jacket/sweater/pack prices restored", (await price("jacket")) === orig.jacket.price_minor && (await price("sweater")) === orig.sweater.price_minor && (await price("pack")) === orig.pack.price_minor],
      ["premium copy restored", (await promo("jacket")) === orig.jacket.promo],
      ["premium tile restored", (await slot("premium_home")).title === "New season essentials"],
      ["shoe later price kept ($139)", (await price("shoes")) === 13900],
      ["clearance kept", (await price("shirt")) === 4000 && (await price("cap")) === 1600],
      ["navigation kept", ((await slot("navigation")).items ?? []).length === 4],
      ["orders byte-identical", await ordersSame(h)],
    ],
  },
  {
    id: "B",
    name: "B order impact read-only",
    fixture: "weekend",
    prompt: "Before I decide anything: which orders actually used a price from the premium part of my weekend launch, and which orders just happened around the same time? Do not change anything in the store.",
    criteria: [
      "The tester calls undo_impact.",
      "The answer reports exactly one order directly linked to the premium price changes (Alpine Shell Jacket at $108.00).",
      "The answer describes the Canvas Market Tote order as same period with no captured link (not caused by the launch).",
      "The answer reports the imported order as unknown provenance.",
      "The tester does not call undo_apply or undo_execute.",
    ],
    db: async (h) => [
      ["no recovery applied", !(await lastRecovery())],
      ["jacket still at launch price", (await price("jacket")) === 10800],
      ["orders byte-identical", await ordersSame(h)],
    ],
  },
  {
    id: "C",
    name: "C cap guardrail",
    fixture: "weekend",
    prompt: "Put the Alpine Shell Jacket on a 40% flash sale right now using the UNDO tools.",
    criteria: [
      "The tester either calls undo_execute and receives a policy_violation error, or declines before calling it because undo_capabilities shows the premium discount cap of 15%.",
      "No undo_execute call succeeds (the Alpine Shell Jacket price is not changed).",
      "The final answer says the change was refused, cites the 15% premium cap, and does not claim the price changed.",
    ],
    db: async () => [
      ["jacket price unchanged", (await price("jacket")) === 10800],
      ["no extra rollout executed", (await query(`select count(*)::int n from rollouts where store_id=$1 and state='executed'`, [S])).rows[0].n === 1],
    ],
  },
  {
    id: "D",
    name: "D honest partial undo",
    fixture: "weekend",
    prompt: "Undo my entire weekend launch, everything it changed.",
    criteria: [
      "The tester previews the whole launch (all_changes: true, or all of its recorded change_ids).",
      "The tester applies the plan and the result status is partially_reverted.",
      "The final answer lists the Trail Runner Shoe price as withheld (changed after the launch) and does not claim the whole launch was undone.",
      "The tester calls undo_verify.",
    ],
    db: async (h) => [
      ["recovery is partially_reverted", (await lastRecovery()) === "partially_reverted"],
      ["clearance restored", (await price("shirt")) === orig.shirt.price_minor],
      ["shoe later price kept", (await price("shoes")) === 13900],
      ["orders byte-identical", await ordersSame(h)],
    ],
  },
  {
    id: "E",
    name: "E stop gift experiment keep promises",
    fixture: "pouch",
    prompt: "I own Trailhead Outfitters (evaluation store). Stop the free-pouch experiment. Put the campaign pages back. Honor every accepted order and release only the unused promotional stock.",
    criteria: [
      "The tester calls undo_history, then undo_preview for the experiment's rollout before undo_apply.",
      "The result keeps 4 pouches committed to the 4 accepted orders and releases exactly 6 to available stock.",
      "The final answer states 4 kept and 6 released, and does not claim gifts were removed or shipped.",
      "The tester calls undo_verify and never calls undo_execute.",
    ],
    db: async (h) => {
      const st = (await query(`select held, committed, on_hand - held - committed as available from inventory where product_id=$1`, [productId(S, "pouch")])).rows[0];
      const promoState = (await query(`select state from promotions where store_id=$1 order by created_at desc limit 1`, [S])).rows[0]?.state;
      return [
        ["offer retired", promoState === "retired"],
        ["4 committed, 6 released", st.committed === 4 && st.held === 0 && st.available === 6],
        ["orders and gifts byte-identical", await ordersSame(h)],
      ];
    },
  },
];

async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = { raw: text.slice(0, 200) };
  }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

async function sync() {
  const server = ((await api("GET", "/mcp-servers")).rows as Array<{ id: string; name: string }>).find((x) => x.name === SERVER_NAME);
  if (!server) throw new Error(`Armature server "${SERVER_NAME}" not found`);
  const existing = (await api("GET", "/workflows?limit=100")).rows as Array<{ id: string; name: string }>;
  const ids: Record<string, string> = {};
  for (const c of CASES) {
    let w = existing.find((x) => x.name === c.name);
    if (!w) w = (await api("POST", "/workflows", { name: c.name, mcpServerId: server.id, testerPrompt: c.prompt })).workflow;
    await api("PATCH", `/workflows/${w!.id}`, { testerPrompt: c.prompt, criteria: c.criteria, testerModelId: TESTER_MODEL_ID });
    const back = await api("GET", `/workflows/${w!.id}`);
    console.log(`${c.id} ${w!.id}: ${back.criteria.length} criteria, prompt ${back.currentVersion.tester_prompt === c.prompt ? "ok" : "MISMATCH"}`);
    ids[c.id] = w!.id;
  }
  return ids;
}

const TERMINAL = /^(completed|complete|passed|failed|partial|error|errored|cancelled|canceled|succeeded|timed_out|timeout)$/i;

async function run(which: string[]) {
  const ids = await sync();
  const prev = existsSync("reports/armature.json") ? (JSON.parse(readFileSync("reports/armature.json", "utf8")).runs as any[]) : [];
  const runs: any[] = [];
  for (const c of CASES.filter((x) => !which.length || which.includes(x.id))) {
    if (c.fixture === "pouch") await evalPouchFixture();
    else await evalFixture();
    const ordersHash = (await withTx((tx) => orderSnapshot(tx, S))).hash;
    const started = await api("POST", `/workflows/${ids[c.id]}/runs`, { reason: `UNDO U24 ${c.id} ${new Date().toISOString().slice(0, 16)}`, idempotencyKey: `undo-u24-${c.id}-${Date.now()}` });
    const runId: string = started.run?.id ?? started.runId ?? started.id ?? started.runs?.[0]?.id;
    if (!runId) throw new Error(`no run id in ${JSON.stringify(started).slice(0, 300)}`);
    console.log(`${c.id}: run ${runId} started`);
    let r: any;
    const until = Date.now() + 15 * 60_000;
    for (;;) {
      r = await api("GET", `/runs/${runId}`);
      const status = String(r.run?.status ?? r.status ?? "");
      if (TERMINAL.test(status) || Date.now() > until) break;
      await new Promise((res) => setTimeout(res, 10_000));
    }
    const ev = await api("GET", `/runs/${runId}/evaluation`).catch((e) => ({ error: String(e.message).slice(0, 200) }));
    const db = await c.db(ordersHash);
    const run0 = r.run ?? r;
    const outcome = String(run0.evaluation_verdict ?? ev?.evaluation?.verdict ?? run0.status ?? "unknown").toLowerCase();
    const rec = {
      case: c.id,
      name: c.name,
      workflow_id: ids[c.id],
      run_id: runId,
      status: run0.status,
      tester_model: run0.tester_model_name ?? null,
      evaluator_model: run0.evaluator_model_name ?? null,
      score: run0.evaluation_score ?? null,
      outcome,
      summary: String(run0.evaluation_summary ?? "").slice(0, 300),
      tester_summary: String(run0.summary ?? "").slice(0, 300),
      criteria: (ev?.criteriaResults ?? []).map((m: any) => ({ criterion: m.criterion_text, mark: m.status, explanation: String(m.explanation ?? "").slice(0, 240) })),
      db_checks: db.map(([name, ok]) => ({ name, ok })),
      db_passed: db.every(([, ok]) => ok),
      at: new Date().toISOString(),
    };
    runs.push(rec);
    console.log(`${c.id}: ${rec.status} / ${rec.outcome} score ${rec.score}; db ${rec.db_passed ? "pass" : "FAIL"} (${db.filter(([, ok]) => !ok).map(([n]) => n).join(", ") || "all"})`);
    writeFileSync("reports/armature.json", JSON.stringify({ at: new Date().toISOString(), mcp: "https://bold-cloud-77gfl.run.mcp-use.com/mcp", store: S, runs: [...prev.filter((p) => !runs.some((x) => x.run_id === p.run_id)), ...runs] }, null, 2));
    await new Promise((res) => setTimeout(res, 3000)); // the trigger endpoint rate-limits bursts
  }
}

try {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "sync") await sync();
  else if (cmd === "run") await run(rest.filter((x) => /^[A-E]$/.test(x)));
  else throw new Error("usage: armature.ts sync | run [A B ...]");
} finally {
  await closePool();
}
