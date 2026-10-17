/**
 * Ensure the tagged demo + eval stores exist, reset them to the fixture, and mint any missing
 * long-lived demo credentials. Plaintext tokens are written ONLY to .private/tokens.json (git-ignored).
 *   pnpm demo:reset            reset store_demo only
 *   pnpm demo:reset -- --all   reset store_demo and store_eval
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { closePool } from "../src/db/pool.js";
import { demoStoreSpec, ensureTokens, evalStoreSpec, resetStore } from "../src/fixtures/demo.js";

const all = process.argv.includes("--all");
const evalOnly = process.argv.includes("--eval");
try {
  if (!process.env.OWNER_PHONE_E164 || !process.env.CUSTOMER_TEST_EMAIL) throw new Error("OWNER_PHONE_E164 and CUSTOMER_TEST_EMAIL must be set in .env");
  const specs = evalOnly ? [evalStoreSpec()] : all ? [demoStoreSpec(), evalStoreSpec()] : [demoStoreSpec()];
  const out: Record<string, string> = existsSync(".private/tokens.json") ? JSON.parse(readFileSync(".private/tokens.json", "utf8")) : {};
  for (const spec of specs) {
    const { runLabel } = await resetStore(spec);
    const minted = await ensureTokens(spec);
    Object.assign(out, minted);
    console.log(`reset ${spec.storeId} (${spec.namespace}) run=${runLabel}; new tokens: ${Object.keys(minted).length}`);
  }
  mkdirSync(".private", { recursive: true, mode: 0o700 });
  writeFileSync(".private/tokens.json", JSON.stringify(out, null, 2), { mode: 0o600 });
  chmodSync(".private/tokens.json", 0o600);
  console.log(`credentials file: .private/tokens.json (${Object.keys(out).length} entries, private)`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
