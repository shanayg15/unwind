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
import { evalExtraGiftOrder, evalFixture, evalPouchFixture } from "../scripts/eval-fixture.js";
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
  fixture?: "weekend" | "pouch";
  /** Optional concurrent activity while the agent runs (e.g. an order racing its preview and apply). */
  during?: (fx: { rolloutId: string; promotionId?: string; termsHash?: string }) => { stop: () => Promise<Record<string, unknown>> };
  check: (r: RunRecord, ctx: { ordersHash: string; during?: Record<string, unknown> }) => Promise<Array<[string, boolean]>>;
}

const pouchStock = async () => (await query(`select on_hand, held, committed, on_hand - held - committed as available from inventory where product_id=$1`, [productId(S, "pouch")])).rows[0];
const pouchPromo = async () => (await query(`select state from promotions where store_id=$1 order by created_at desc limit 1`, [S])).rows[0]?.state;
const giftCount = async () => (await query(`select count(*)::int n from order_entitlements where store_id=$1`, [S])).rows[0].n as number;
const POUCH_GOAL = "Stop the free-pouch experiment. Put the campaign pages back. Honor every accepted order and release only the unused promotional stock.";

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

CASES.push(
  {
    id: "E",
    title: "Purchase-aware retirement: keep accepted gifts, release only unused stock",
    fixture: "pouch",
    prompt: `I own Trailhead Outfitters (evaluation store). ${POUCH_GOAL}`,
    check: async (r, ctx) => {
      const st = await pouchStock();
      const snap = await withTx((tx) => orderSnapshot(tx, S));
      return [
        ["discovered rollout via undo_history", called(r, "undo_history").length > 0],
        ["previewed before applying", called(r, "undo_preview").length > 0 && called(r, "undo_apply").length > 0],
        ["offer closed to new orders", (await pouchPromo()) === "retired"],
        ["4 accepted gifts still committed", st.committed === 4 && (await giftCount()) === 4],
        ["only the 6 unused pouches released", st.held === 0 && st.available === 6],
        ["campaign tile restored", (await slot("premium_home")).title === "New season essentials"],
        ["pack copy restored", (await promo("pack")) === orig.pack.promo],
        ["orders and gift snapshots byte-identical", snap.hash === ctx.ordersHash],
        ["verify called", called(r, "undo_verify").length > 0],
        ["no new rollout executed", called(r, "undo_execute").length === 0],
        ["answer reports 4 kept and 6 released", /\b4\b/.test(r.final_text) && /\b6\b/.test(r.final_text)],
      ];
    },
  },
  {
    id: "F",
    title: "Stale dependency: an order arrives between preview and apply",
    fixture: "pouch",
    prompt: `I own Trailhead Outfitters (evaluation store). ${POUCH_GOAL}`,
    // As soon as the agent's first retirement plan exists, a fifth customer accepts the gift.
    during: (fx) => {
      let done = false;
      let injected: string | null = null;
      const loop = (async () => {
        while (!done && !injected) {
          const plan = (await query(`select id from recovery_plans where store_id=$1 and rollout_id=$2 limit 1`, [S, fx.rolloutId])).rows[0];
          if (plan) injected = await evalExtraGiftOrder(fx.promotionId!, fx.termsHash!);
          else await new Promise((res) => setTimeout(res, 150));
        }
      })();
      return {
        stop: async () => {
          done = true;
          await loop;
          return { injected_order: injected };
        },
      };
    },
    check: async (r, ctx) => {
      const st = await pouchStock();
      const superseded = (await query(`select count(*)::int n from recovery_plans where store_id=$1 and status='superseded'`, [S])).rows[0].n as number;
      const applied = (await query(`select count(*)::int n from recovery_attempts where store_id=$1`, [S])).rows[0].n as number;
      return [
        ["a fifth gift order raced the plan", !!ctx.during?.injected_order],
        ["stale plan was refused (superseded, not applied)", superseded >= 1],
        ["exactly one retirement applied", applied === 1],
        ["offer closed to new orders", (await pouchPromo()) === "retired"],
        ["5 accepted gifts committed (new order kept its gift)", st.committed === 5 && (await giftCount()) === 5],
        ["only 5 unused pouches released (not 6)", st.held === 0 && st.available === 5],
        ["no new rollout executed", called(r, "undo_execute").length === 0],
        ["answer reports the updated counts", /\b5\b/.test(r.final_text)],
      ];
    },
  },
);

const wanted = process.argv.slice(2).filter((a) => /^[A-Z]$/.test(a));
const results: Array<{ case: string; title: string; fixture_rollout: string; passed: boolean; checks: Array<{ name: string; ok: boolean }>; agent: Record<string, unknown>; final_text: string }> = [];
try {
  for (const c of CASES.filter((x) => !wanted.length || wanted.includes(x.id))) {
    const fx = c.fixture === "pouch" ? await evalPouchFixture() : await evalFixture();
    const { rolloutId } = fx;
    const ordersHash = (await withTx((tx) => orderSnapshot(tx, S))).hash;
    const side = c.during?.(fx);
    const rec = await runAgent({ label: `eval-${c.id}`, systemPrompt: SYSTEM, prompt: c.prompt, mcpUrl: MCP_URL, mcpToken: token, maxTurns: 24 });
    const during = side ? await side.stop() : undefined;
    const checks = await c.check(rec, { ordersHash, during });
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
