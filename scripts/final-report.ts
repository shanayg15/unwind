/**
 * reports/FINAL_VERIFICATION.md from evidence files only (no hand-entered results).
 *   pnpm exec tsx --env-file=.env scripts/final-report.ts
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const commit = execSync("git rev-parse --short HEAD").toString().trim();
const acc = read("reports/acceptance.json");
const deploy = read("reports/deploy.json");
const evals = read("reports/eval-agent.json");
const prov = read("reports/provider-smoke.json");
const probe = read("reports/mcp-probe.json");
const smoke = read("reports/smoke-deployed.json");
const e2e = read("reports/e2e.json");
const vitest = ["unit", "integration", "security"].map((k) => ({ k, j: read(`reports/vitest-${k}.json`) }));
const runs = readdirSync("reports/runs").filter((f) => f.endsWith(".json")).map((f) => ({ f, j: read(`reports/runs/${f}`) }));
const pa = existsSync("reports/PURCHASE_AWARE_ACCEPTANCE.md") ? readFileSync("reports/PURCHASE_AWARE_ACCEPTANCE.md", "utf8") : "";
const paRows = [...pa.matchAll(/^\| (PA\d\d) \| [^|]+\| \*\*(\w+)\*\*/gm)].map((m) => `${m[1]}=${m[2]}`);
const items = (acc?.items ?? []) as Array<{ id: string; status: string; evidence: string[] }>;
const missing = items.filter((i) => i.status !== "passed");
const armature = missing.some((i) => i.id === "U24");
const status = missing.length === 0 ? "DONE_SCOPED_RELEASE" : armature && missing.length === 1 ? "DEMO_READY_WITH_LIMITS (only U24 Armature outstanding)" : "DEMO_READY_WITH_LIMITS";

const runRow = (r: { f: string; j: any }) => {
  const owner = (r.j.cases ?? []).filter((c: any) => c.role === "owner").flatMap((c: any) => c.messages.map((m: any) => `${m.purpose}=${m.status}`));
  const cust = (r.j.cases ?? []).filter((c: any) => c.role === "customer").flatMap((c: any) => c.messages.map((m: any) => `${m.purpose}=${m.status}`));
  const voice = (r.j.voice ?? []).map((v: any) => `call ${v.outcome}/${v.authority_mode}`).join(", ");
  return `| ${r.f.replace(".json", "")} | ${r.j.recovery?.status ?? "-"} | ${r.j.verify?.verdict ?? "-"} | ${owner.join(", ") || "-"} | ${cust.join(", ") || "-"} | ${voice || "-"} |`;
};

const md = [
  "# UNDO final verification",
  "",
  `Generated ${new Date().toISOString()} from evidence files at commit \`${commit}\`. Deployed build: \`${String(deploy?.commit ?? "").slice(0, 7)}\` (Manufact deployment ${deploy?.deployment_id ?? "?"}).`,
  "",
  `**Release status: ${status}**`,
  "",
  `Acceptance: ${items.length - missing.length}/${items.length} items with passing evidence${missing.length ? `; outstanding: ${missing.map((m) => `${m.id} (${m.status})`).join(", ")}` : ""}. Voice: ${acc?.voice ?? "?"}. Purchase-aware: ${paRows.join(" ")}.`,
  "",
  "## Gates",
  "",
  "| Gate | Result |",
  "|---|---|",
  ...vitest.map(({ k, j }) => `| ${k} tests | ${j ? `${j.numPassedTests}/${j.numTotalTests} passed` : "missing"} |`),
  ...(acc?.gates ?? []).filter((g: any) => !["unit", "integration", "security"].includes(g.name)).map((g: any) => `| ${g.name} | ${g.ok === null ? "not run" : g.ok ? "pass" : "FAIL"} |`),
  `| deployed MCP probe | ${probe?.deployed?.results ? `${probe.deployed.results.filter((r: any) => r.pass).length}/${probe.deployed.results.length}` : "missing"} |`,
  `| deployed smoke | ${smoke?.results ? `${smoke.results.filter((r: any) => r.pass).length}/${smoke.results.length}` : "missing"} |`,
  `| browser e2e (approval page) | ${e2e?.results ? `${e2e.results.filter((r: any) => r.pass).length}/${e2e.results.length}` : "missing"} |`,
  `| provider smoke (Manufact, Neon, Inkbox, Claude) | ${prov?.results ? `${prov.results.filter((r: any) => r.pass).length}/${prov.results.length}` : "missing"} |`,
  `| fresh-agent goal evals on the deployed MCP | ${evals?.results ? evals.results.map((r: any) => `${r.case} ${r.passed ? "pass" : "FAIL"}`).join(", ") : "missing"} |`,
  "",
  "## Live and rehearsal runs (real providers)",
  "",
  "| Run | Recovery | Verify | Owner messages | Customer messages | Voice |",
  "|---|---|---|---|---|---|",
  ...runs.filter((r) => /^(live-|rehearsal-|pouch-|unwind-)/.test(r.f)).sort((a, b) => a.f.localeCompare(b.f)).map(runRow),
  "",
  "## Acceptance items",
  "",
  "| ID | Status | Evidence |",
  "|---|---|---|",
  ...items.map((i) => `| ${i.id} | ${i.status} | ${(i.evidence ?? []).slice(0, 3).join("<br>").replace(/\|/g, "/") || "-"} |`),
  "",
  "## Approved scope changes and honest limits",
  "",
  "- Owner channel is iMessage through the Inkbox shared line instead of SMS (user-approved). Owner voice enabled with ≤6 calls of ≤180 s to the owner only; each call is contact_scoped (the identity default could not be narrowed with our key).",
  "- Agent worker runs on the operator's Mac with the local Claude login (approved); it is lease-durable but needs that machine online.",
  "- Rehearsals 1–2 ran on c0754e6 and rehearsal 3 on 8fcc5c5. The only difference is that approval events now carry plan_hash and apply accepts approval_id alone (fix found during rehearsal 3). Rehearsal owner texts 2–3 were sent from the owner's Mac Messages with approval.",
  "- Purchase-aware rollback is one gift-promotion adapter on the controlled store's own inventory; no shipping, payments or refunds.",
  "- An atomic group stays withheld when the owner keeps one member's later value (linked copy then stays as is; the receipt says so).",
  "- See docs/SECURITY_AND_LIMITS.md. No claim of universal undo, novelty, or production certification.",
  "",
].join("\n");
writeFileSync("reports/FINAL_VERIFICATION.md", md);
console.log(`reports/FINAL_VERIFICATION.md: ${status}; ${items.length - missing.length}/${items.length}`);
