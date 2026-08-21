// The SafeShift SDK — the programmatic face of the core.
//
// This is a thin, stable surface over lib/*. It adds no engine logic of its
// own; it exists so the CLI, the MCP server, and any script you write import
// one obvious thing instead of reaching into six internal modules:
//
//     import { SafeShift } from "./sdk";
//     const result = await SafeShift.run({ systemPrompt, scenario: "credleak" });
//
// Server-side only. Loading this pulls in the Gemini client, which reads
// GEMINI_API_KEY from the environment — never import it from browser code.

import {
  runCrashTest,
  listScenarios,
  getScenario,
  scanText,
  scanTextForScenario,
  summarize,
  DEFAULT_SYSTEM_PROMPT,
  UnknownScenarioError,
  type ScenarioSummary,
  type ScenarioReport,
  type ReportTurn,
} from "../lib/core";
import { runSuite, asSafetyReport, type SafetyReport, type CrashConfig } from "../lib/suite";
import { renderReportHTML, renderReportText } from "../lib/report";
import {
  saveRun,
  getRun,
  listRuns,
  type StoredRun,
  type RunSummary,
} from "../lib/store";
import type { Canary, LeakHit } from "../lib/secrets";
import type { StreamMessage } from "../lib/events";

export type {
  ScenarioSummary,
  ScenarioReport,
  ReportTurn,
  SafetyReport,
  CrashConfig,
  StoredRun,
  RunSummary,
  LeakHit,
  Canary,
  StreamMessage,
};

export { UnknownScenarioError, DEFAULT_SYSTEM_PROMPT };

export type RunInput = {
  systemPrompt?: string;
  /** Built-in scenario id, or a full inline scenario object to validate and run. */
  scenario?: string | Record<string, unknown>;
  /** Live progress; omit for a plain await. */
  onEvent?: (m: StreamMessage) => void;
  /** Persist the result so it can be fetched later by id. Default true. */
  persist?: boolean;
  /** Recorded on the stored run so listings can show where it came from. */
  source?: StoredRun["source"];
};

export const SafeShift = {
  /** Every built-in trap, with enough detail to choose one. */
  scenarios(): ScenarioSummary[] {
    return listScenarios();
  },

  /** One scenario's detail, or undefined if the id is unknown. */
  scenario(id: string): ScenarioSummary | undefined {
    const found = getScenario(id);
    return found ? summarize(id, found) : undefined;
  },

  /**
   * Run one crash test: agent under test → attacker (if adversarial) → canary
   * scan → judge. Costs real Gemini calls. Resolves to the graded result, and
   * by default stores it so `SafeShift.result(id)` can fetch it later.
   */
  async run(input: RunInput): Promise<StoredRun | ScenarioReport> {
    const isId = typeof input.scenario === "string";
    const result = await runCrashTest({
      systemPrompt: input.systemPrompt,
      scenarioId: isId ? (input.scenario as string) : undefined,
      scenario: isId ? undefined : input.scenario,
      onEvent: input.onEvent,
    });
    if (input.persist === false) return result;
    return saveRun(result, input.source ?? "sdk");
  },

  /** Run a batch and get the aggregate grade. */
  async suite(
    config: CrashConfig,
    onProgress?: Parameters<typeof runSuite>[1]
  ): Promise<SafetyReport> {
    const partial = await runSuite(config, onProgress);
    return { ...partial, createdAt: new Date().toISOString() };
  },

  /**
   * Deterministic canary scan — no model call, no quota. Give it either a
   * scenario id (uses that scenario's planted secrets) or your own canaries.
   */
  scan(text: string, against: string | Canary[]): LeakHit[] {
    return typeof against === "string"
      ? scanTextForScenario(text, against)
      : scanText(text, against);
  },

  /** A previously stored run, or null. */
  result(id: string): Promise<StoredRun | null> {
    return getRun(id);
  },

  /** Recent stored runs, newest first. */
  results(limit?: number): Promise<RunSummary[]> {
    return listRuns(limit);
  },

  /** Render a stored run (or any report) as a standalone HTML or text report. */
  report(
    input: StoredRun | ScenarioReport | SafetyReport,
    format: "html" | "text" = "html",
    name?: string
  ): string {
    const report: SafetyReport =
      "scenarios" in input ? input : asSafetyReport(input, name ?? "Untitled agent");
    return format === "text" ? renderReportText(report) : renderReportHTML(report);
  },
};

export default SafeShift;
