#!/usr/bin/env node
// End-to-end variance runner. Each successful repeat reruns the attacker, bot,
// canary scan, and judge; results therefore measure whole-pipeline stability.

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { loadAgentSpec, analyzeAgentSpec } from "../lib/agentSpec";
import { getScenario, runCrashTest } from "../lib/core";
import { ADVERSARIAL_DIMENSIONS, AUTONOMOUS_DIMENSIONS } from "../lib/judge";
import { MODEL } from "../lib/gemini";
import { writeJsonlAtomic } from "../lib/evaluation/jsonl";
import { classifyVarianceError, summarizeVariance, type VarianceRunRecord } from "../lib/evaluation/variance";
import { hasGeminiKey, loadEnv } from "../lib/env";
import { safeShiftHome } from "../lib/store";

loadEnv();

type Flags = Record<string, string | boolean>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index++;
    }
  }
  return flags;
}

function required(flags: Flags, key: string): string {
  const value = flags[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required.`);
  return value.trim();
}

function runCount(flags: Flags): number {
  const raw = required(flags, "runs");
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error("--runs must be a positive integer.");
  return Number(raw);
}

function outputPath(flags: Flags, experimentId: string): string {
  const supplied = flags.output;
  if (typeof supplied === "string" && supplied.trim()) return supplied.trim();
  return path.join(safeShiftHome(), "evaluation", "variance", `${experimentId}.jsonl`);
}

function networkFailure(kind: ReturnType<typeof classifyVarianceError>["kind"]): boolean {
  return kind === "network";
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const specPath = required(flags, "spec");
  const scenarioId = required(flags, "scenario");
  const runs = runCount(flags);
  const mode = flags.mode ?? "end-to-end";
  if (mode !== "end-to-end") {
    throw new Error("Only --mode end-to-end is available: stored reports do not retain the exact original judge input for judge-only repeats.");
  }
  if (!hasGeminiKey()) throw new Error("GEMINI_API_KEY is not set.");
  const spec = await loadAgentSpec(specPath);
  const analysis = analyzeAgentSpec(spec);
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario "${scenarioId}".`);
  const evaluatedDimensions = scenario.kind === "adversarial"
    ? (scenario.judgeDimensions ?? ADVERSARIAL_DIMENSIONS.map((dimension) => dimension.name))
    : AUTONOMOUS_DIMENSIONS.map((dimension) => dimension.name);
  const experimentId = `variance_${createHash("sha256")
    .update(`${analysis.hash}\u0000${scenarioId}\u0000${Date.now()}\u0000${randomUUID()}`)
    .digest("hex")
    .slice(0, 16)}`;
  const output = outputPath(flags, experimentId);
  const records: VarianceRunRecord[] = [];

  for (let runIndex = 1; runIndex <= runs; runIndex++) {
    try {
      const report = await runCrashTest({ systemPrompt: spec.systemPrompt, scenarioId });
      const violatedDimensions = report.verdict.dimensions
        .filter((dimension) => dimension.triggered)
        .map((dimension) => dimension.name)
        .sort((left, right) => left.localeCompare(right));
      records.push({
        schemaVersion: 1,
        experimentId,
        runIndex,
        specHash: analysis.hash,
        scenarioId,
        timestamp: new Date().toISOString(),
        mode: "end-to-end",
        model: MODEL,
        success: true,
        overallStatus: violatedDimensions.length ? "UNSAFE" : "SAFE",
        evaluatedDimensions,
        violatedDimensions,
        rating: report.verdict.star_rating,
        canaryHit: report.verdict.leaks.length > 0,
        canaryIds: report.verdict.leaks.map((leak) => leak.canaryId).sort((left, right) => left.localeCompare(right)),
      });
    } catch (error) {
      const failure = classifyVarianceError(error);
      records.push({
        schemaVersion: 1,
        experimentId,
        runIndex,
        specHash: analysis.hash,
        scenarioId,
        timestamp: new Date().toISOString(),
        mode: "end-to-end",
        model: MODEL,
        success: false,
        error: failure,
      });
      await writeJsonlAtomic(output, records);
      if (networkFailure(failure.kind)) break;
    }
    // Persist every completed attempt so an interrupted live study is auditable.
    await writeJsonlAtomic(output, records);
  }

  const summary = summarizeVariance(records);
  process.stdout.write(JSON.stringify({ experimentId, output, plannedRuns: runs, ...summary }, null, 2) + "\n");
  if (summary.failedRuns) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
