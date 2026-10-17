/**
 * Assert the demo store's visible state against the expected fixture outcome (test oracle).
 *   pnpm demo:verify            auto: "before" if no recovery applied yet, else "after"
 *   pnpm demo:verify -- --before | --after
 * Exit code is nonzero on any mismatch.
 */
import { closePool, query } from "../src/db/pool.js";
import { PRODUCTS, productId, slotId } from "../src/fixtures/demo.js";

const STORE = process.env.DEMO_VERIFY_STORE ?? "store_demo";
const fails: string[] = [];
const ok: string[] = [];
const expect = (name: string, cond: boolean, detail: string) => (cond ? ok : fails).push(`${name}: ${detail}`);

try {
  const rec = (await query(`select status from recovery_attempts where store_id=$1 order by created_at desc limit 1`, [STORE])).rows[0];
  const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : rec ? "after" : "before";
  const price = async (k: string) => Number((await query(`select amount_minor from product_prices where product_id=$1`, [productId(STORE, k)])).rows[0].amount_minor);
  const content = async (k: string, key: string) => (await query(`select value, last_actor from product_content where product_id=$1 and component_key=$2`, [productId(STORE, k), key])).rows[0];
  const slot = async (k: string) => (await query(`select content from store_slots where slot_id=$1`, [slotId(STORE, k)])).rows[0].content;
  const orig = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));
  if (mode === "before") {
    const executed = (await query(`select count(*)::int n from rollouts where store_id=$1 and state='executed'`, [STORE])).rows[0].n;
    if (executed === 0) {
      for (const p of PRODUCTS) expect(`${p.key} price`, (await price(p.key)) === p.price_minor, `${await price(p.key)} == ${p.price_minor}`);
      expect("orders", (await query(`select count(*)::int n from orders where store_id=$1`, [STORE])).rows[0].n === 1, "only the imported legacy order");
    } else {
      expect("jacket launch price", (await price("jacket")) === 10800, `${await price("jacket")}`);
      expect("shoe operator price", (await price("shoes")) === 13900, `${await price("shoes")}`);
      expect("clearance shirt launch price", (await price("shirt")) === 4000, `${await price("shirt")}`);
      expect("jacket sizing edited", /Runs small/.test((await content("jacket", "sizing_info")).value), "operator sizing edit present");
      expect("linked order", (await query(`select count(*)::int n from order_lines where store_id=$1 and source_change_id is not null`, [STORE])).rows[0].n >= 1, "jacket order linked to rollout");
    }
  } else {
    expect("recovery status", rec?.status === "resolved_with_exceptions" || rec?.status === "partially_reverted", `${rec?.status}`);
    for (const k of ["jacket", "sweater", "pack"]) expect(`${k} price restored`, (await price(k)) === orig[k].price_minor, `${await price(k)} == ${orig[k].price_minor}`);
    for (const k of ["jacket", "shoes", "sweater", "pack"]) expect(`${k} promo restored`, (await content(k, "promotional_copy")).value === orig[k].promo, "evergreen copy back");
    expect("shoe kept at $139", (await price("shoes")) === 13900, `${await price("shoes")}`);
    for (const [k, v] of [["shirt", 4000], ["shorts", 2800], ["cap", 1600]] as const) expect(`${k} clearance kept`, (await price(k)) === v, `${await price(k)} == ${v}`);
    expect("premium tile restored", (await slot("premium_home")).title === "New season essentials", (await slot("premium_home")).title);
    expect("clearance tile kept", /extra 20%/i.test((await slot("clearance_home")).title), (await slot("clearance_home")).title);
    expect("navigation kept", ((await slot("navigation")).items ?? []).length === 4, `${((await slot("navigation")).items ?? []).length} items`);
    const sz = await content("jacket", "sizing_info");
    expect("jacket sizing edit preserved", /Runs small/.test(sz.value) && sz.last_actor !== "pr_agent", `last writer ${sz.last_actor}`);
    const lines = (await query(`select l.sku, l.unit_amount_minor from order_lines l where l.store_id=$1 order by l.sku`, [STORE])).rows;
    expect("orders unchanged", lines.some((l) => l.sku === "PRM-JKT" && l.unit_amount_minor === 10800) && lines.some((l) => l.sku === "COR-TOT" && l.unit_amount_minor === 3000), `${lines.length} lines; jacket at $108.00 intact`);
  }
  for (const o of ok) console.log(`PASS ${o}`);
  for (const f of fails) console.log(`FAIL ${f}`);
  console.log(`${mode}: ${ok.length} passed, ${fails.length} failed (${STORE})`);
  if (fails.length) process.exitCode = 1;
} finally {
  await closePool();
}
