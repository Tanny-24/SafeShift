#!/usr/bin/env node
// Manifest-driven, resumable end-to-end variance runner. This is intentionally
// separate from the small one-off pilot command.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeAgentSpec, loadAgentSpec } from "../lib/agentSpec";
import { getScenario, runCrashTest } from "../lib/core";
import { hasGeminiKey, loadEnv } from "../lib/env";
import { readJsonl, writeJsonlAtomic } from "../lib/evaluation/jsonl";
import { pendingVarianceStudyRuns, validateVarianceStudyManifest } from "../lib/evaluation/varianceStudy";
import { classifyVarianceError, summarizeVariance, type VarianceRunRecord } from "../lib/evaluation/variance";
import { MODEL } from "../lib/gemini";
import { safeShiftHome } from "../lib/store";

loadEnv();

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function positiveLimit(): number | null {
  const value = flag("limit");
  if (value === undefined) return null;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error("--limit must be a positive integer.");
  return Number(value);
}

async function loadManifest(file: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not read variance manifest "${file}": ${(error as Error).message}`);
  }
  return validateVarianceStudyManifest(parsed);
}

async function main(): Promise<void> {
  const manifestFile = flag("manifest");
  if (!manifestFile) throw new Error("--manifest <file> is required.");
  const manifest = await loadManifest(manifestFile);
  if (!hasGeminiKey()) throw new Error("GEMINI_API_KEY is not set.");
  const output = flag("output") ?? path.join(safeShiftHome(), "evaluation", "variance", `${manifest.studyId}.jsonl`);
  const records = (await readJsonl(output)) as VarianceRunRecord[];
  // Validate prior data before any call. The summary invokes the same strict
  // record validation used for reporting rates and intervals.
  summarizeVariance(records);
  const pending = pendingVarianceStudyRuns(manifest, records);
  const limit = positiveLimit();
  const batch = limit === null ? pending : pending.slice(0, limit);

  const specs = new Map<string, { systemPrompt: string }>();
  for (const spec of manifest.specs) {
    const analysis = analyzeAgentSpec(await loadAgentSpec(spec.path));
    if (analysis.hash !== spec.hash) {
      throw new Error(`AgentSpec "${spec.path}" no longer matches hash in the study manifest.`);
    }
    specs.set(spec.hash, { systemPrompt: analysis.spec.systemPrompt });
  }
  for (const scenarioId of manifest.scenarioIds) if (!getScenario(scenarioId)) throw new Error(`Unknown scenario "${scenarioId}" in manifest.`);

  let executed = 0;
  let stopReason: string | undefined;
  for (const item of batch) {
    executed++;
    try {
      const report = await runCrashTest({ systemPrompt: specs.get(item.spec.hash)!.systemPrompt, scenarioId: item.scenarioId });
      const violatedDimensions = report.verdict.dimensions
        .filter((dimension) => dimension.triggered)
        .map((dimension) => dimension.name)
        .sort((left, right) => left.localeCompare(right));
      const scenario = getScenario(item.scenarioId)!;
      const evaluatedDimensions = scenario.kind === "adversarial"
        ? (scenario.judgeDimensions ?? report.verdict.dimensions.map((dimension) => dimension.name))
        : report.verdict.dimensions.map((dimension) => dimension.name);
      records.push({
        schemaVersion: 1,
        experimentId: manifest.studyId,
        planRunId: item.planRunId,
        runIndex: item.runIndex,
        specHash: item.spec.hash,
        scenarioId: item.scenarioId,
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
        experimentId: manifest.studyId,
        planRunId: item.planRunId,
        runIndex: item.runIndex,
        specHash: item.spec.hash,
        scenarioId: item.scenarioId,
        timestamp: new Date().toISOString(),
        mode: "end-to-end",
        model: MODEL,
        success: false,
        error: failure,
      });
      stopReason = `${failure.kind}: ${failure.message}`;
      await writeJsonlAtomic(output, records);
      break;
    }
    await writeJsonlAtomic(output, records);
  }

  const summary = summarizeVariance(records);
  const remaining = pendingVarianceStudyRuns(manifest, records).length;
  process.stdout.write(JSON.stringify({
    manifestFile,
    output,
    plannedRuns: manifest.plannedRunCount,
    pendingBefore: pending.length,
    executed,
    remaining,
    ...(stopReason ? { stopReason } : {}),
    ...summary,
  }, null, 2) + "\n");
  if (summary.failedRuns) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
