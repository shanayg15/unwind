/**
 * Write reports/PURCHASE_AWARE_ACCEPTANCE.md from real evidence only: vitest JSON (PA tests), fresh-agent
 * eval cases E/F, and live pouch runs in reports/runs/pouch-*.json. Missing evidence is reported as missing.
 *   pnpm exec tsx --env-file=.env scripts/pa-report.ts
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const commit = execSync("git rev-parse --short HEAD").toString().trim();
const dirty = execSync("git status --porcelain -- src index.ts worker tests").toString().trim().length > 0;
const tests = new Map<string, Array<{ name: string; ok: boolean }>>();
for (const f of ["reports/vitest-integration.json", "reports/vitest-security.json"]) {
  for (const file of read(f)?.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      const full = `${(t.ancestorTitles ?? []).join(" > ")} > ${t.title}`;
      for (const id of full.match(/PA\d\d/g) ?? []) tests.set(id, [...(tests.get(id) ?? []), { name: full, ok: t.status === "passed" }]);
    }
  }
}
const evals = (read("reports/eval-agent.json")?.results ?? []) as Array<{ case: string; title: string; passed: boolean; checks: Array<{ name: string; ok: boolean }>; agent: { tool_calls: Array<{ name: string }> } }>;
const ev = (id: string) => evals.find((e) => e.case === id);
const runs = existsSync("reports/runs") ? readdirSync("reports/runs").filter((f) => /^pouch-.*\.json$/.test(f)).map((f) => ({ f, j: read(`reports/runs/${f}`) })) : [];
const liveOk = runs.filter((r) => {
  const cases = r.j?.cases ?? [];
  const owner = cases.some((c: any) => c.role === "owner" && c.messages?.some((m: any) => m.channel === "imessage" && ["accepted", "delivered"].includes(m.status)));
  const customer = cases.some((c: any) => c.role === "customer" && c.messages?.some((m: any) => m.channel === "email" && ["accepted", "delivered"].includes(m.status)));
  return owner && customer && r.j?.verify?.verdict === "verified";
});

type Row = { id: string; test: string; status: "passed" | "failed" | "missing"; evidence: string[] };
const rows: Row[] = [];
const fromTests = (id: string, title: string, extra: string[] = []) => {
  const t = tests.get(id);
  rows.push({ id, test: title, status: !t?.length ? "missing" : t.every((x) => x.ok) ? "passed" : "failed", evidence: [...(t ?? []).map((x) => `tests/integration/purchase-aware.test.ts: ${x.name}`), ...extra] });
};
fromTests("PA01", "Real reserve/checkout/retire (computed counts)");
fromTests("PA02", "Immutable order contents and gift terms");
fromTests("PA03", "Fulfillment readback without an active-rule lookup");
fromTests("PA04", "New checkout after retirement / stale offer reconfirmation");
fromTests("PA05", "Concurrent order wins first (sequential + barrier)", ev("F") ? [`eval case F (fresh agent, deployed MCP): ${ev("F")!.passed ? "passed" : "failed"}`] : []);
fromTests("PA06", "Retirement wins first (barrier)");
fromTests("PA07", "Repeated retirement / send retry");
fromTests("PA08", "Unrelated stock activity");
fromTests("PA09", "Crash / response timeout");
{
  const e = ev("E");
  const f = ev("F");
  const live = liveOk.map((r) => `reports/runs/${r.f} (real owner iMessage + customer email, verify ${r.j.verify.verdict})`);
  rows.push({
    id: "PA10",
    test: "Fresh agent and real conversation",
    status: e?.passed && live.length ? "passed" : e && !e.passed ? "failed" : "missing",
    evidence: [...(e ? [`eval case E: ${e.passed ? "passed" : "failed"} (${e.agent.tool_calls.map((t) => t.name.replace("mcp__undo__", "")).join(", ")})`] : ["eval case E not run"]), ...(f ? [`eval case F: ${f.passed ? "passed" : "failed"}`] : []), ...(live.length ? live : ["no verified live pouch run yet"])],
  });
}
fromTests("PA11", "Scope/auth bypass denied");
{
  const all = ["reports/vitest-unit.json", "reports/vitest-integration.json", "reports/vitest-security.json"].map(read).filter(Boolean);
  const ok = all.length === 3 && all.every((j) => j.numFailedTests === 0);
  const n = all.reduce((s, j) => s + j.numPassedTests, 0);
  rows.push({ id: "PA12", test: "Regression and rehearsal", status: ok ? (liveOk.length ? "passed" : "missing") : "failed", evidence: [`${n} unit/integration/security tests passing, including the original U-series recovery tests`, ...(liveOk.length ? [] : ["pouch rehearsal on the release build not yet recorded"])] });
}

const md = [
  "# Purchase-aware rollback: acceptance",
  "",
  `Commit \`${commit}\`${dirty ? " (working tree has uncommitted source changes)" : ""} · generated ${new Date().toISOString()}`,
  "",
  "Scope: one gift-promotion adapter (`start_gift_promotion`) on the controlled demo store's own inventory pool, and its relationship to accepted test orders. No shipping, payments, refunds, external platform inventory or general bundles. A handful of fixtures does not certify production safety.",
  "",
  "| ID | Test | Result | Evidence |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.id} | ${r.test} | **${r.status}** | ${r.evidence.join("<br>") || "-"} |`),
  "",
  "## Invariants checked by `undo_verify` after every retirement",
  "",
  "- `future_eligibility_closed`: promotion retired, zero gifts accepted after the retirement timestamp.",
  "- `remaining_allocation_released_once`: allocation remaining 0, released equals the held remainder at apply, exactly one `release_remaining` move.",
  "- `order_commitments_preserved`: every accepted order still holds its gift entitlement; committed quantity unchanged.",
  "- `stock_accounting_reconciles`: for every product, held equals units owned by holding allocations, committed equals purchased lines plus gift entitlements, available is never negative, and available + held + committed = on hand.",
  "- `fulfillment_lists_promised_gifts`: the pick list (built from immutable order snapshots and entitlements only) lists every promised gift.",
  "",
  "## Known limits",
  "",
  "- One gift per order, one location, no fulfillment/returns/restocks in the fixture (the invariant would need those categories if added).",
  "- Local Postgres transactions and row locks; no claim of a global cutoff across external systems.",
  "- A stale exact plan is never re-scoped: it is superseded and a fresh plan needs its own owner confirmation (no race-time standing policy).",
  "- Order counts in the demo are illustrative test orders, not an A/B result.",
  "",
].join("\n");
writeFileSync("reports/PURCHASE_AWARE_ACCEPTANCE.md", md);
console.log(rows.map((r) => `${r.id}=${r.status}`).join(" "));
