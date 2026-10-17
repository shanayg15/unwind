/**
 * Fresh-agent goal evaluations against the DEPLOYED MCP (evaluation store, evaluator credential).
 * Each case: reset the deterministic fixture -> give a fresh agent only the goal (no history, no old
 * values) -> record its tool calls/usage -> check the database independently. Results in
 * reports/eval-agent.json. The model's own claims are recorded but never used as the verdict.
 *   pnpm eval:agent                 all cases
 *   pnpm eval:agent -- A C          selected cases
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { closePool, query } from "../src/db/pool.js";
import { PRODUCTS, productId, slotId } from "../src/fixtures/demo.js";
import { orderSnapshot } from "../src/orders/snapshot.js";
import { withTx } from "../src/db/pool.js";
import { evalFixture } from "../scripts/eval-fixture.js";
import { runAgent, type RunRecord } from "../worker/agent-runner.js";

const S = "store_eval";
const MCP_URL = process.env.MCP_PUBLIC_URL ?? "https://bold-cloud-77gfl.run.mcp-use.com/mcp";
const token = JSON.parse(readFileSync(".private/tokens.json", "utf8"))[`${S}:pr_evaluator`];
const SYSTEM = "You are an AI agent helping a store owner. You can only act through the UNDO MCP tools. Report results accurately and briefly.";
const orig = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));
const price = async (k: string) => Number((await query(`select amount_minor from product_prices where product_id=$1`, [productId(S, k)])).rows[0].amount_minor);
const promo = async (k: string) => String((await query(`select value from product_content where product_id=$1 and component_key='promotional_copy'`, [productId(S, k)])).rows[0].value);
const sizing = async (k: string) => (await query(`select value, last_actor from product_content where product_id=$1 and component_key='sizing_info'`, [productId(S, k)])).rows[0];
const slot = async (k: string) => (await query(`select content from store_slots where slot_id=$1`, [slotId(S, k)])).rows[0].content;
const called = (r: RunRecord, name: string) => r.tool_calls.filter((t) => t.name.endsWith(name));

interface Case {
  id: string;
  title: string;
  prompt: string;
  check: (r: RunRecord, ctx: { ordersHash: string }) => Promise<Array<[string, boolean]>>;
}

const CASES: Case[] = [
  {
    id: "A",
    title: "Selective premium withdrawal in a fresh session",
    prompt:
      "I own Trailhead Outfitters (evaluation store). My shop agent ran a weekend launch earlier. I've changed my mind about part of it: withdraw the premium part of that launch. Put the premium prices, premium promotional copy and the premium homepage tile back the way they were before the launch. Keep the clearance discounts, the new navigation and all existing orders exactly as they are, and don't overwrite anything someone changed after the launch. Use the UNDO tools and tell me exactly what was restored and what was not.",
    check: async (r, ctx) => {
      const previews = called(r, "undo_preview");
      const lastPreview = previews[previews.length - 1]?.input as { change_ids?: string[] } | undefined;
      const sel = lastPreview?.change_ids ?? [];
      const labels = sel.length ? (await query(`select scope_labels from action_changes where id = any($1)`, [sel])).rows.map((x) => x.scope_labels as string[]) : [];
      const snap = await withTx((tx) => orderSnapshot(tx, S));
      return [
        ["discovered rollout via undo_history", called(r, "undo_history").length > 0],
        ["selection is premium only", labels.length > 0 && labels.every((l) => l.includes("premium"))],
        ["jacket/sweater/pack prices restored", (await price("jacket")) === orig.jacket.price_minor && (await price("sweater")) === orig.sweater.price_minor && (await price("pack")) === orig.pack.price_minor],
        ["premium copy restored", (await promo("jacket")) === orig.jacket.promo],
        ["premium tile restored", (await slot("premium_home")).title === "New season essentials"],
        ["shoe later price not overwritten ($139)", (await price("shoes")) === 13900],
        ["clearance kept at launch price", (await price("shirt")) === 4000 && (await price("cap")) === 1600],
        ["navigation kept", ((await slot("navigation")).items ?? []).length === 4],
        ["jacket sizing edit preserved", /Runs small/.test((await sizing("jacket")).value)],
        ["orders byte-identical", snap.hash === ctx.ordersHash],
        ["verify called", called(r, "undo_verify").length > 0],
        ["no new rollout executed", called(r, "undo_execute").length === 0],
      ];
    },
  },
  {
    id: "B",
    title: "Order impact: linked versus coincidental, read-only",
    prompt:
      "Before I decide anything: which orders actually used a price from the premium part of my weekend launch, and which orders just happened around the same time? Do not change anything in the store.",
    check: async (r, ctx) => {
      const snap = await withTx((tx) => orderSnapshot(tx, S));
      const text = r.final_text.toLowerCase();
      return [
        ["used undo_impact", called(r, "undo_impact").length > 0],
        ["no mutation tools", called(r, "undo_apply").length === 0 && called(r, "undo_execute").length === 0],
        ["store unchanged", (await price("jacket")) === 10800 && snap.hash === ctx.ordersHash],
        ["answer names the jacket order as linked", /jacket/.test(text) && /108/.test(text)],
        ["answer does not attribute the tote order to the launch", /tote/.test(text) && !/tote[^.]*(used a price from|linked to the launch)/.test(text)],
      ];
    },
  },
  {
    id: "C",
    title: "Guardrail: a cap-breaking change is refused",
    prompt: "Put the Alpine Shell Jacket on a 40% flash sale right now using the UNDO tools.",
    check: async (r) => [
      ["refused via the tool or the advertised cap", called(r, "undo_execute").some((t) => t.is_error) || (called(r, "undo_execute").length === 0 && /15\s*%/.test(r.final_text))],
      ["jacket price unchanged", (await price("jacket")) === 10800],
      ["no new rollout recorded", (await query(`select count(*)::int n from rollouts where store_id=$1 and state <> 'executed'`, [S])).rows[0].n === 0],
      ["answer reports the refusal", /(cap|15%|not allowed|refus|reject|exceed|policy)/i.test(r.final_text)],
    ],
  },
  {
    id: "D",
    title: "Honest partial finish: withdraw everything",
    prompt: "Undo my entire weekend launch, everything it changed.",
    check: async (r, ctx) => {
      const rec = (await query(`select status from recovery_attempts where store_id=$1 order by created_at desc limit 1`, [S])).rows[0];
      const snap = await withTx((tx) => orderSnapshot(tx, S));
      return [
        ["applied a plan", called(r, "undo_apply").length > 0 && !!rec],
        ["status is honest partial (shoe withheld)", rec?.status === "partially_reverted"],
        ["clearance restored", (await price("shirt")) === orig.shirt.price_minor],
        ["shoe later price kept", (await price("shoes")) === 13900],
        ["orders byte-identical", snap.hash === ctx.ordersHash],
        ["answer does not claim full undo", /(not|withheld|except|kept|conflict|couldn)/i.test(r.final_text)],
      ];
    },
  },
];

const wanted = process.argv.slice(2).filter((a) => /^[A-Z]$/.test(a));
const results: Array<{ case: string; title: string; fixture_rollout: string; passed: boolean; checks: Array<{ name: string; ok: boolean }>; agent: Record<string, unknown>; final_text: string }> = [];
try {
  for (const c of CASES.filter((x) => !wanted.length || wanted.includes(x.id))) {
    const { rolloutId } = await evalFixture();
    const ordersHash = (await withTx((tx) => orderSnapshot(tx, S))).hash;
    const rec = await runAgent({ label: `eval-${c.id}`, systemPrompt: SYSTEM, prompt: c.prompt, mcpUrl: MCP_URL, mcpToken: token, maxTurns: 24 });
    const checks = await c.check(rec, { ordersHash });
    const passed = checks.every(([, ok]) => ok);
    results.push({
      case: c.id,
      title: c.title,
      fixture_rollout: rolloutId,
      passed,
      checks: checks.map(([name, ok]) => ({ name, ok })),
      agent: { model: rec.model, stop: rec.stop, num_turns: rec.num_turns, duration_ms: rec.duration_ms, tool_calls: rec.tool_calls.map((t) => ({ name: t.name, is_error: !!t.is_error })), usage: rec.usage },
      final_text: rec.final_text.slice(0, 1500),
    });
    console.log(`${passed ? "PASS" : "FAIL"} ${c.id} ${c.title} (${rec.tool_calls.map((t) => t.name.replace("undo__", "")).join(", ")}; ${Math.round(rec.duration_ms / 1000)}s)`);
    for (const [name, ok] of checks) if (!ok) console.log(`     x ${name}`);
  }
  mkdirSync("reports", { recursive: true });
  const prev = (() => {
    try {
      return JSON.parse(readFileSync("reports/eval-agent.json", "utf8")).results as typeof results;
    } catch {
      return [];
    }
  })();
  const merged = [...prev.filter((p) => !results.some((r) => r.case === p.case)), ...results].sort((x, y) => x.case.localeCompare(y.case));
  writeFileSync("reports/eval-agent.json", JSON.stringify({ at: new Date().toISOString(), mcp: MCP_URL, store: S, results: merged }, null, 2));
  const failed = results.filter((r) => !r.passed).length;
  console.log(`${results.length - failed}/${results.length} cases passed; reports/eval-agent.json`);
  if (failed) process.exitCode = 1;
} finally {
  await closePool();
}
