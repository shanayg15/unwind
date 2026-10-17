/**
 * Real MCP protocol probe (JSON-RPC over streamable HTTP) against a local or deployed endpoint.
 *   pnpm test:mcp                       -> MCP_PROBE_URL or http://localhost:3000/mcp
 *   MCP_PROBE_URL=https://.../mcp pnpm test:mcp
 * Uses credentials from .private/tokens.json. Fails nonzero on any unexpected result.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const url = process.env.MCP_PROBE_URL ?? "http://localhost:3000/mcp";
const tokens: Record<string, string> = JSON.parse(readFileSync(".private/tokens.json", "utf8"));
const EXPECTED = ["undo_apply", "undo_capabilities", "undo_execute", "undo_history", "undo_impact", "undo_preview", "undo_verify"];

let id = 0;
async function rpc(token: string | null, method: string, params: unknown = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  let body: any = null;
  try {
    body = JSON.parse(line ? line.slice(6) : text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function session(token: string) {
  const init = await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "undo-probe", version: "1" } });
  return init;
}

const results: Array<{ check: string; pass: boolean; detail: string }> = [];
const check = (name: string, pass: boolean, detail = "") => {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const agent = tokens["store_demo:pr_agent"];
const customer = tokens["store_demo:pr_customer_a"];

const unauth = await rpc(null, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
check("unauthenticated initialize rejected", unauth.status === 401, `HTTP ${unauth.status}`);
const forged = await rpc("undo_agen_forgedforgedforgedforged000000", "tools/list");
check("forged token rejected", forged.status === 401, `HTTP ${forged.status}`);

const init = await session(agent);
check("initialize", init.status === 200 && init.body?.result?.serverInfo?.name === "undo", `${init.body?.result?.serverInfo?.name} ${init.body?.result?.serverInfo?.version}`);
const list = await rpc(agent, "tools/list");
const names = (list.body?.result?.tools ?? []).map((t: { name: string }) => t.name).sort();
check("exactly seven canonical tools", JSON.stringify(names) === JSON.stringify(EXPECTED), names.join(","));
const viewTools = (list.body?.result?.tools ?? []).filter((t: any) => JSON.stringify(t._meta ?? {}).includes("ui"));
check("receipt view bound to preview/verify", viewTools.map((t: any) => t.name).sort().join(",") === "undo_preview,undo_verify", viewTools.map((t: any) => t.name).join(","));

const caps = await rpc(agent, "tools/call", { name: "undo_capabilities", arguments: {} });
const sc = caps.body?.result?.structuredContent;
check("undo_capabilities structuredContent", sc?.principal?.role === "agent" && Array.isArray(sc?.targets), `role=${sc?.principal?.role} targets=${sc?.targets?.length}`);
const bytes = JSON.stringify(caps.body?.result ?? {}).length;
check("capabilities result bounded", bytes < 16_000, `${bytes} bytes`);

const hist = await rpc(agent, "tools/call", { name: "undo_history", arguments: { limit: 3 } });
check("undo_history callable", hist.body?.result?.isError !== true && Array.isArray(hist.body?.result?.structuredContent?.rollouts), `${hist.body?.result?.structuredContent?.rollouts?.length} rollouts`);

const custHist = await rpc(customer, "tools/call", { name: "undo_history", arguments: {} });
check("customer cannot read history", custHist.body?.result?.isError === true && /forbidden/.test(custHist.body?.result?.content?.[0]?.text ?? ""), "isError forbidden");

const bad = await rpc(agent, "tools/call", { name: "undo_preview", arguments: { rollout_id: "ro_doesnotexist", change_ids: ["chg_x1234"] } });
check("stable error code on bad input", bad.body?.result?.isError === true && /not_found|forbidden|invalid_input/.test(bad.body?.result?.content?.[0]?.text ?? ""), (bad.body?.result?.content?.[0]?.text ?? "").slice(0, 80));

const failed = results.filter((r) => !r.pass);
mkdirSync("reports", { recursive: true });
const target = url.includes("localhost") ? "local" : "deployed";
const prev = existsSync("reports/mcp-probe.json") ? JSON.parse(readFileSync("reports/mcp-probe.json", "utf8")) : {};
prev[target] = { url: url.replace(/\/\/[^/]+@/, "//"), at: new Date().toISOString(), results };
writeFileSync("reports/mcp-probe.json", JSON.stringify(prev, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed (${target})`);
if (failed.length) process.exitCode = 1;
