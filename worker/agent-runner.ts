import { mkdirSync, writeFileSync } from "node:fs";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface CaseToolHandlers {
  read: () => Promise<Record<string, unknown>>;
  send: (args: { purpose: string; message: string; plan_id?: string }) => Promise<Record<string, unknown>>;
  update: (args: { rollout_id?: string; plan_id?: string; state?: string; summary?: string }) => Promise<Record<string, unknown>>;
}

export interface RunOptions {
  label: string;
  systemPrompt: string;
  prompt: string;
  mcpUrl: string;
  mcpToken: string;
  caseTools?: CaseToolHandlers;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface RunRecord {
  label: string;
  model: string;
  started_at: string;
  duration_ms: number;
  num_turns: number | null;
  stop: string;
  usage: unknown;
  tool_calls: Array<{ name: string; input: unknown; is_error?: boolean }>;
  final_text: string;
}

const MODEL = process.env.MODEL_ID ?? "claude-opus-5-5";
const UNDO_TOOLS = ["undo_capabilities", "undo_history", "undo_execute", "undo_preview", "undo_impact", "undo_apply", "undo_verify"];

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/**
 * Run one bounded agent turn with a fresh context. The model reaches the store ONLY through the
 * hosted UNDO MCP (scoped bearer token) and the case tools; no built-in file/shell/web tools,
 * no user/project settings, no persisted session. Usage and every tool call are recorded.
 */
export async function runAgent(opts: RunOptions): Promise<RunRecord> {
  const started = Date.now();
  const servers: Record<string, unknown> = {
    undo: { type: "http", url: opts.mcpUrl, headers: { Authorization: `Bearer ${opts.mcpToken}` } },
  };
  const allowed = UNDO_TOOLS.map((t) => `mcp__undo__${t}`);
  if (opts.caseTools) {
    const h = opts.caseTools;
    servers.case = createSdkMcpServer({
      name: "case",
      version: "1.0.0",
      tools: [
        tool("case_read", "Read this case only: role, state, ids, and its own conversation so far.", {}, async () => textResult(await h.read())),
        tool(
          "case_send",
          "Send a message to THIS case's verified participant (owner: text message; customer: email reply). purpose request_approval attaches a secure single-use approval link for plan_id; you never see the link.",
          {
            purpose: z.enum(["reply", "conflict_question", "request_approval", "completion_summary", "order_answer", "clarification"]),
            message: z.string().min(1).max(1200),
            plan_id: z.string().max(40).optional(),
          },
          async (args) => {
            try {
              return textResult(await h.send(args));
            } catch (e) {
              return { ...textResult({ error: (e as Error).message }), isError: true };
            }
          },
        ),
        tool(
          "case_update",
          "Record case progress: rollout_id, plan_id, state (open|awaiting_owner|awaiting_approval|resolved|needs_clarification), and a one-paragraph summary.",
          {
            rollout_id: z.string().max(40).optional(),
            plan_id: z.string().max(40).optional(),
            state: z.enum(["open", "awaiting_owner", "awaiting_approval", "resolved", "needs_clarification"]).optional(),
            summary: z.string().max(900).optional(),
          },
          async (args) => textResult(await h.update(args)),
        ),
      ],
    });
    allowed.push("mcp__case__case_read", "mcp__case__case_send", "mcp__case__case_update");
  }
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CLAUDE_CODE_OAUTH_TOKEN; // use the local Claude login, never the capped shell token
  delete env.DATABASE_URL;
  delete env.INKBOX_API_KEY;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 240_000);
  const rec: RunRecord = { label: opts.label, model: MODEL, started_at: new Date(started).toISOString(), duration_ms: 0, num_turns: null, stop: "unknown", usage: null, tool_calls: [], final_text: "" };
  const pendingTools = new Map<string, number>();
  try {
    const q = query({
      prompt: opts.prompt,
      options: {
        model: MODEL,
        systemPrompt: opts.systemPrompt,
        tools: [],
        mcpServers: servers as never,
        strictMcpConfig: true,
        allowedTools: allowed,
        permissionMode: "dontAsk",
        settingSources: [],
        persistSession: false,
        maxTurns: opts.maxTurns ?? 24,
        cwd: process.env.AGENT_SCRATCH_DIR ?? "/tmp",
        env,
        abortController: abort,
      },
    });
    for await (const msg of q as AsyncIterable<Record<string, unknown>>) {
      if (msg.type === "assistant") {
        const content = ((msg.message as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>;
        for (const b of content) {
          if (b.type === "tool_use") {
            pendingTools.set(String(b.id), rec.tool_calls.length);
            rec.tool_calls.push({ name: String(b.name).replace(/^mcp__/, ""), input: b.input });
          } else if (b.type === "text" && typeof b.text === "string") {
            rec.final_text = b.text;
          }
        }
      } else if (msg.type === "user") {
        const content = ((msg.message as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>;
        for (const b of content) {
          if (b.type === "tool_result") {
            const idx = pendingTools.get(String(b.tool_use_id));
            if (idx !== undefined && b.is_error) rec.tool_calls[idx].is_error = true;
          }
        }
      } else if (msg.type === "result") {
        rec.num_turns = (msg.num_turns as number) ?? null;
        rec.usage = { usage: msg.usage, model_usage: msg.modelUsage, total_cost_usd_equivalent: msg.total_cost_usd };
        rec.stop = String(msg.subtype ?? "result");
        if (typeof msg.result === "string") rec.final_text = msg.result;
      }
    }
  } catch (e) {
    rec.stop = abort.signal.aborted ? "timeout" : `error: ${(e as Error).message?.slice(0, 200)}`;
  } finally {
    clearTimeout(timer);
    rec.duration_ms = Date.now() - started;
  }
  try {
    mkdirSync("reports/private/transcripts", { recursive: true });
    writeFileSync(`reports/private/transcripts/${rec.started_at.replace(/[:.]/g, "-")}-${opts.label}.json`, JSON.stringify({ ...rec, prompt: opts.prompt }, null, 2));
  } catch {
    /* best effort */
  }
  return rec;
}
