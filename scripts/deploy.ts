/**
 * Approved deployment path: push main to GitHub (Manufact auto-deploys on push via its GitHub App),
 * wait for the deployment of exactly HEAD to be running, then record build identity in reports/deploy.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const SERVER = "fa0d3fbb-466f-44fe-80b3-8b806ace54ff";
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const head = sh("git", ["rev-parse", "HEAD"]);
if (sh("git", ["status", "--porcelain"])) throw new Error("working tree not clean; commit first");
sh("git", ["push", "origin", "main"]);
console.log(`pushed ${head.slice(0, 7)}; waiting for Manufact deployment of this commit...`);
const list = () => {
  const out = JSON.parse(sh("npx", ["-y", "mcp-use@latest", "deployments", "list", "--server", SERVER, "--json"]));
  const rows = Array.isArray(out) ? out : (Object.values(out).find((v) => Array.isArray(v)) as Array<Record<string, unknown>>);
  return rows as Array<{ id: string; status: string; gitCommitSha?: string; mcpUrl?: string; createdAt: string }>;
};
let dep: ReturnType<typeof list>[number] | undefined;
for (let i = 0; i < 60; i++) {
  dep = list().find((d) => d.gitCommitSha === head && d.status !== "stopped");
  if (dep && (dep.status === "running" || dep.status === "failed")) break;
  if (i === 6 && !dep) {
    console.log("no webhook deployment yet; triggering a manual deploy");
    sh("npx", ["-y", "mcp-use@latest", "deploy", "-y", "--json"]);
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
if (!dep || dep.status !== "running") throw new Error(`deployment not running: ${dep?.status ?? "not found"}`);
const health = await fetch("https://bold-cloud-77gfl.run.mcp-use.com/healthz").then((r) => r.json());
mkdirSync("reports", { recursive: true });
writeFileSync(
  "reports/deploy.json",
  JSON.stringify({ at: new Date().toISOString(), server_id: SERVER, deployment_id: dep.id, commit: head, mcp_url: dep.mcpUrl ?? "https://bold-cloud-77gfl.run.mcp-use.com/mcp", dashboard: `https://manufact.com/cloud/org-808238af-w8cml/servers/${SERVER}/overview`, health }, null, 2),
);
console.log(`deployment ${dep.id} running commit ${head.slice(0, 7)}; reports/deploy.json`);
