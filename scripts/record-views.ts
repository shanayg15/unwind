/**
 * Backup recording, browser side: headless Playwright video of the live deployed pages during a real
 * rehearsal (no focus stealing). Every clip carries a visible "Recorded rehearsal" label and timestamp.
 *   pnpm exec tsx --env-file=.env scripts/record-views.ts <label> <before|after>
 * Output: reports/recording/<label>-<phase>.webm (+ a PNG of the last frame).
 */
import { mkdirSync, renameSync } from "node:fs";
import { chromium, type Page } from "playwright";

const [label, phase] = [process.argv[2] ?? "rehearsal-1", process.argv[3] ?? "before"];
const BASE = (process.env.APP_BASE_URL ?? "https://bold-cloud-77gfl.run.mcp-use.com").replace(/\/$/, "");
const dir = "reports/recording";
mkdirSync(dir, { recursive: true });

async function stamp(page: Page, text: string) {
  await page.evaluate((t) => {
    const el = document.createElement("div");
    el.textContent = t;
    el.setAttribute("style", "position:fixed;top:8px;right:8px;z-index:99999;background:#111;color:#fff;font:12px/1.4 ui-monospace,Menlo,monospace;padding:4px 8px;border-radius:6px;opacity:.85");
    document.body.appendChild(el);
  }, text);
}

async function visit(page: Page, path: string, caption: string, scroll = true) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await stamp(page, `Recorded rehearsal · ${label} · ${phase} · ${new Date().toISOString().slice(0, 19)}Z · ${caption}`);
  await page.waitForTimeout(1800);
  if (scroll) {
    for (let y = 0; y < 4; y++) {
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(800);
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
try {
  await visit(page, "/store", phase === "before" ? "storefront after launch + activity" : "storefront after recovery");
  await visit(page, "/store/picklist", "pick list from immutable orders", false);
  await visit(page, "/", "UNDO overview: latest rollout and recoveries", false);
  await page.screenshot({ path: `${dir}/${label}-${phase}.png`, fullPage: true });
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) renameSync(await video.path(), `${dir}/${label}-${phase}.webm`);
}
console.log(`saved ${dir}/${label}-${phase}.webm`);
