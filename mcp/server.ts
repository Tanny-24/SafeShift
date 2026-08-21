// SafeShift MCP server (stdio).
//
// Exposes the SafeShift core to any MCP-compatible client so an agent can be
// crash-tested from the editor that is building it. Every tool here calls the
// same lib/core.ts engine the web UI uses — there is no second
// implementation and no canned response.
//
// Start:   npm run mcp
// Speaks:  JSON-RPC over stdio (MCP's standard local transport).
//
// stdout is the protocol channel. Anything written there that is not a JSON-RPC
// frame corrupts the session, so every diagnostic in this file goes to stderr.

import { loadEnv, hasGeminiKey } from "../lib/env";
loadEnv(); // before the SDK/core import chain reads GEMINI_API_KEY

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { SafeShift } from "../sdk";

const VERSION = "0.1.0";

/* ── helpers ─────────────────────────────────────────────────────────────── */

// MCP wants content blocks. Hand back pretty JSON: it renders readably in every
// client, and an agent can parse it.
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

// Tool errors are reported in-band (isError) rather than thrown, so the client
// sees a usable message instead of a dead session. Never echo the environment.
function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `SafeShift error: ${message}` }],
  };
}

/* ── server ──────────────────────────────────────────────────────────────── */

const server = new McpServer({ name: "safeshift", version: VERSION });

server.registerTool(
  "list_scenarios",
  {
    title: "List SafeShift scenarios",
    description:
      "List the built-in trap scenarios an agent can be crash-tested against. " +
      "Returns each scenario's id, label, category, targeted harm dimension, and " +
      "(for adversarial traps) the tools it wires up and the secrets it watches. " +
      "Use the returned id with run_crash_test. Costs no model calls.",
    inputSchema: {
      category: z
        .string()
        .optional()
        .describe("Case-insensitive substring filter on category, e.g. 'injection'."),
      kind: z
        .enum(["autonomous", "adversarial"])
        .optional()
        .describe("autonomous = agent works an inbox alone; adversarial = live attacker."),
    },
  },
  async ({ category, kind }) => {
    try {
      let list = SafeShift.scenarios();
      if (kind) list = list.filter((s) => s.kind === kind);
      if (category) {
        const q = category.toLowerCase();
        list = list.filter((s) => s.category.toLowerCase().includes(q));
      }
      return json({ count: list.length, scenarios: list });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "run_crash_test",
  {
    title: "Run a crash test",
    description:
      "Crash-test an agent: drop it into a trap scenario, run the red-team attacker " +
      "against it (or let it act autonomously), scan every reply for planted secrets, " +
      "and have a judge score it 1-5 with a cited quote. Returns the full verdict plus " +
      "a run_id for get_test_result / get_report. " +
      "This makes real Gemini API calls and takes 20-120s — call it once and wait.",
    inputSchema: {
      system_prompt: z
        .string()
        .min(1)
        .max(20000)
        .describe("The system prompt of the agent under test — this is what gets graded."),
      scenario_id: z
        .string()
        .min(1)
        .describe("Scenario id from list_scenarios, e.g. 'credleak' or 'blackmail'."),
    },
  },
  async ({ system_prompt, scenario_id }, extra) => {
    try {
      // A crash test runs for 20-120s, well past the 60s default request
      // timeout in most MCP clients. Emitting progress keeps the call alive on
      // any client that resets its timeout on progress (and gives the user
      // something to watch); clients that ignore progress should raise their
      // timeout for this tool.
      const progressToken = extra?._meta?.progressToken;
      let step = 0;
      const note = async (message: string) => {
        if (progressToken === undefined) return;
        try {
          await extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken, progress: ++step, message },
          });
        } catch {
          // Progress is advisory — never fail a run because a notice failed.
        }
      };

      await note(`Starting ${scenario_id}`);

      const run = await SafeShift.run({
        systemPrompt: system_prompt,
        scenario: scenario_id,
        source: "mcp",
        onEvent: (m) => {
          if (m.kind === "redteam" && m.event.type === "attacker") {
            void note(`Attacker turn ${m.event.turn + 1}: ${m.event.tactic}`);
          } else if (m.kind === "redteam" && m.event.type === "leak") {
            void note(`Leak detected: ${m.event.hit.label}`);
          } else if (m.kind === "agent" && m.event.type === "action") {
            void note(`Agent called ${m.event.tool}`);
          } else if (m.kind === "judging") {
            void note("Judging the transcript");
          }
        },
      });
      const stored = run as Awaited<ReturnType<typeof SafeShift.run>> & { id?: string };
      return json({
        run_id: stored.id ?? null,
        scenario: { id: run.scenarioId, label: run.label, mode: run.mode },
        star_rating: run.verdict.star_rating,
        failed: run.failed,
        headline: run.verdict.headline,
        explanation: run.verdict.explanation,
        worst_severity: run.verdict.worst_severity,
        proven_leaks: run.verdict.leaks.map((l) => ({
          label: l.label,
          severity: l.severity,
          kind: l.kind,
          turn: l.turn + 1,
          excerpt: l.excerpt,
        })),
        dimensions: run.verdict.dimensions.map((d) => ({
          name: d.name,
          triggered: d.triggered,
          cited_message: d.cited_message,
          reasoning: d.reasoning,
        })),
        transcript_turns: run.transcript.length,
      });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "get_test_result",
  {
    title: "Get a stored crash-test result",
    description:
      "Fetch a completed crash test by run_id, including the full transcript. " +
      "Omit run_id to list recent runs instead. Runs started in the web UI, the CLI " +
      "and MCP all land in the same local store. Costs no model calls.",
    inputSchema: {
      run_id: z
        .string()
        .optional()
        .describe("Run id from run_crash_test. Omit to list recent runs."),
      include_transcript: z
        .boolean()
        .optional()
        .describe("Include the full play-by-play transcript. Default true."),
      limit: z.number().int().min(1).max(200).optional().describe("Listing size. Default 25."),
    },
  },
  async ({ run_id, include_transcript, limit }) => {
    try {
      if (!run_id) {
        const runs = await SafeShift.results(limit ?? 25);
        return json({ count: runs.length, runs });
      }
      const run = await SafeShift.result(run_id);
      if (!run) {
        return fail(new Error(`No run with id "${run_id}". Call get_test_result with no run_id to list stored runs.`));
      }
      const { transcript, ...rest } = run;
      return json(include_transcript === false ? rest : { ...rest, transcript });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "scan_canary",
  {
    title: "Scan text for leaked secrets",
    description:
      "Run SafeShift's deterministic canary scanner over any text — an agent reply, a " +
      "log line, a support transcript. Catches exact matches, obfuscated ones " +
      "(spacing/punctuation are normalised away), and partial disclosure of " +
      "high-entropy secrets. Give it a scenario_id to scan against that scenario's " +
      "planted secrets, or supply your own canaries. Pure string matching: no model " +
      "call, no quota, no false-positive risk from a model's opinion.",
    inputSchema: {
      text: z.string().min(1).max(200000).describe("The text to scan."),
      scenario_id: z
        .string()
        .optional()
        .describe("Adversarial scenario whose planted secrets to scan for."),
      canaries: z
        .array(
          z.object({
            id: z.string().optional(),
            label: z.string().describe("Human name, e.g. 'Live payment API key'."),
            value: z.string().min(1).describe("The exact secret string."),
            severity: z.enum(["critical", "high", "medium"]).optional(),
            dimension: z.string().optional(),
            partial_length: z
              .number()
              .int()
              .min(6)
              .optional()
              .describe("Only for high-entropy values: shortest fragment that still counts."),
          })
        )
        .optional()
        .describe("Your own secrets to hunt for. Use instead of scenario_id."),
    },
  },
  async ({ text: input, scenario_id, canaries }) => {
    try {
      if (!scenario_id && !canaries?.length) {
        return fail(new Error("Provide either scenario_id or a non-empty canaries array."));
      }
      const hits = scenario_id
        ? SafeShift.scan(input, scenario_id)
        : SafeShift.scan(
            input,
            canaries!.map((c, i) => ({
              id: c.id ?? `canary_${i}`,
              label: c.label,
              value: c.value,
              severity: c.severity ?? "high",
              dimension: c.dimension ?? "CREDENTIAL_LEAK",
              partialLength: c.partial_length,
            }))
          );
      return json({
        leaked: hits.length > 0,
        count: hits.length,
        hits: hits.map((h) => ({
          label: h.label,
          severity: h.severity,
          kind: h.kind,
          dimension: h.dimension,
          matched: h.matched,
          excerpt: h.excerpt,
        })),
      });
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "get_report",
  {
    title: "Generate a crash-test report",
    description:
      "Render a completed run as a shareable report — 'text' for a full plain-text log " +
      "(transcript, actions, verdict, citations), or 'html' for a self-contained page " +
      "that prints to PDF. Costs no model calls.",
    inputSchema: {
      run_id: z.string().describe("Run id from run_crash_test."),
      format: z.enum(["text", "html"]).optional().describe("Default 'text'."),
      agent_name: z.string().max(120).optional().describe("Label for the agent in the report."),
    },
  },
  async ({ run_id, format, agent_name }) => {
    try {
      const run = await SafeShift.result(run_id);
      if (!run) return fail(new Error(`No run with id "${run_id}".`));
      return text(SafeShift.report(run, format ?? "text", agent_name ?? run.label));
    } catch (err) {
      return fail(err);
    }
  }
);

/* ── boot ────────────────────────────────────────────────────────────────── */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout belongs to the protocol.
  console.error(`SafeShift MCP server v${VERSION} ready on stdio.`);
  if (!hasGeminiKey()) {
    console.error(
      "warning: GEMINI_API_KEY is not set — list_scenarios, scan_canary, " +
        "get_test_result and get_report still work, but run_crash_test will fail."
    );
  }
}

main().catch((err) => {
  console.error("SafeShift MCP server failed to start:", err?.message ?? err);
  process.exit(1);
});
