/**
 * Browser-level e2e on the DEPLOYED build (headless Chromium, no focus stealing):
 *  - public storefront renders the controlled-store label and live prices
 *  - owner approval page for a real staged plan (eval store): sections, Approve -> done page,
 *    reuse shows "already used", invalid token and missing CSRF are refused
 * Writes reports/e2e.json and screenshots to reports/e2e/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createApprovalRequest } from "../src/approvals/approvals.js";
import { mintToken, verifyToken } from "../src/auth/principals.js";
import { closePool, query, withTx } from "../src/db/pool.js";
import { undoPreview } from "../src/recovery/plan.js";
import { evalFixture } from "./eval-fixture.js";

const BASE = (process.env.APP_BASE_URL ?? "https://bold-cloud-77gfl.run.mcp-use.com").replace(/\/$/, "");
const results: Array<{ check: string; pass: boolean; detail: string }> = [];
const check = (c: string, pass: boolean, detail = "") => {
  results.push({ check: c, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${c}${detail ? `  (${detail})` : ""}`);
};
mkdirSync("reports/e2e", { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/store`);
  check("storefront label", await page.getByText("Test checkout only").isVisible());
  check("storefront products", (await page.locator("[data-sku]").count()) === 8, `${await page.locator("[data-sku]").count()} products`);
  await page.screenshot({ path: "reports/e2e/storefront.png", fullPage: true });

  // Stage a real plan with a conflict on the eval store and an approval link for it.
  const { rolloutId } = await evalFixture();
  const agent = await verifyToken((await withTx((tx) => mintToken(tx, { principalId: "pr_evaluator", storeId: "store_eval", role: "evaluator", label: "e2e", ttlMinutes: 10 }))).token);
  const ids = (await query(`select id from action_changes where rollout_id=$1 and 'premium' = any(scope_labels)`, [rolloutId])).rows.map((r) => r.id);
  const plan = (await undoPreview(agent, { rollout_id: rolloutId, change_ids: ids })) as { plan_id: string };
  const req = await withTx((tx) => createApprovalRequest(tx, "store_eval", "recovery", plan.plan_id, null, 15));

  await page.goto(`${BASE}/approve/${req.token}`);
  check("approval headline", /Put \d+ changes? back\?/.test((await page.locator("h1").textContent()) ?? ""), (await page.locator("h1").textContent()) ?? "");
  check("goes-back section", await page.getByText("Goes back to how it was").isVisible());
  check("held-back section shows the shoe conflict", (await page.locator("section.hold").textContent())?.includes("Trail Runner Shoe") ?? false);
  check("not-touched lists orders", (await page.getByText(/existing orders? keep their recorded prices/).count()) > 0);
  await page.screenshot({ path: "reports/e2e/approval.png", fullPage: true });

  // CSRF: a forged cross-site POST without the cookie-bound token is refused.
  const forged = await fetch(`${BASE}/approve/${req.token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "decision=approve&csrf=forged" });
  check("forged POST without CSRF cookie refused", forged.status === 403, `HTTP ${forged.status}`);

  await page.getByRole("button", { name: "Apply this plan" }).click();
  await page.waitForLoadState("domcontentloaded");
  check("approve -> done page", ((await page.locator("h1").textContent()) ?? "").includes("Recovery approved"));
  await page.screenshot({ path: "reports/e2e/approved.png", fullPage: true });
  const appr = (await query(`select decided_via, subject_hash from approvals where subject_id=$1`, [plan.plan_id])).rows[0];
  check("approval recorded for the exact plan", appr?.decided_via === "owner_link", appr?.decided_via ?? "none");

  await page.goto(`${BASE}/approve/${req.token}`);
  check("reused link shows already used", (await page.getByText("already been used").count()) > 0 && (await page.getByRole("button", { name: "Apply this plan" }).count()) === 0);
  await page.goto(`${BASE}/approve/apr_this-token-does-not-exist-at-all-000`);
  check("unknown token shows a clear error", ((await page.locator("h1").textContent()) ?? "").includes("can't be used"));
  await query(`update api_tokens set revoked_at = now() where label='e2e' and revoked_at is null`);
} finally {
  await browser.close();
  await closePool();
}
writeFileSync("reports/e2e.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
