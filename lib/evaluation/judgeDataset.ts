// Local preparation and prediction extraction for blind judge evaluation.
// Nothing here writes transcript material into the repository: scripts write
// generated JSONL below the ignored SafeShift home by default.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { RawJudgeVerdict } from "../judge";
import { DIMENSION_REGISTRY } from "../judge";
import { listBaselines } from "../baseline";
import type { ScenarioReport } from "../core";
import { listRegressionCases } from "../regressionMemory";
import { safeShiftHome, type StoredRun } from "../store";
import { readCollectedCorpusRecords } from "./corpus";
import type { BlindJudgeExample, BlindJudgeExampleSource, JudgePrediction, OverallSafety } from "./types";

export type EvaluationCandidate = {
  example: BlindJudgeExample;
  report: ScenarioReport;
};

function safeExampleId(kind: BlindJudgeExampleSource["kind"], id: string): string {
  return `judge-${kind}-${id.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

export function blindExampleFromReport(
  source: BlindJudgeExampleSource,
  report: ScenarioReport
): BlindJudgeExample {
  const toolActivity = report.transcript.filter(
    (turn): turn is Extract<typeof turn, { role: "tool" }> => turn.role === "tool"
  );
  return {
    schemaVersion: 1,
    exampleId: safeExampleId(source.kind, source.id),
    source,
    scenario: {
      id: report.scenarioId,
      label: report.label,
      mode: report.mode,
      category: report.category,
      dimension: report.dimension,
    },
    transcript: report.transcript,
    toolActivity,
    canaryEvidence: report.verdict.leaks.map((leak) => ({
      canaryId: leak.canaryId,
      label: leak.label,
      severity: leak.severity,
      kind: leak.kind,
      turn: leak.turn,
      excerpt: leak.excerpt,
    })),
  };
}

async function storedRuns(): Promise<StoredRun[]> {
  const directory = path.join(safeShiftHome(), "runs");
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const runs: StoredRun[] = [];
  for (const file of files.filter((item) => item.endsWith(".json")).sort()) {
    try {
      runs.push(JSON.parse(await readFile(path.join(directory, file), "utf8")) as StoredRun);
    } catch {
      // A malformed local run cannot be a scientifically usable evaluation unit.
    }
  }
  return runs;
}

/** Collect reports already available locally; no model execution occurs. */
export async function collectJudgeEvaluationCandidates(): Promise<EvaluationCandidate[]> {
  const candidates: EvaluationCandidate[] = [];
  for (const record of await readCollectedCorpusRecords()) {
    const source = {
      kind: "collection" as const,
      id: record.recordId,
      capturedAt: record.collectedAt,
      agentSpec: record.agentSpec,
    };
    candidates.push({ example: blindExampleFromReport(source, record.report), report: record.report });
  }
  for (const run of await storedRuns()) {
    const source = { kind: "stored_run" as const, id: run.id, capturedAt: run.createdAt };
    candidates.push({ example: blindExampleFromReport(source, run), report: run });
  }
  for (const baseline of await listBaselines()) {
    for (const [scenarioId, scenario] of Object.entries(baseline.scenarios).sort(([left], [right]) => left.localeCompare(right))) {
      const source = {
        kind: "baseline" as const,
        id: `${baseline.specHash.slice(0, 16)}-${scenarioId}`,
        capturedAt: scenario.capturedAt,
      };
      candidates.push({ example: blindExampleFromReport(source, scenario.report), report: scenario.report });
    }
  }
  for (const regression of await listRegressionCases()) {
    const source = {
      kind: "regression_memory" as const,
      id: regression.id,
      capturedAt: regression.initialFailure.observedAt,
    };
    candidates.push({ example: blindExampleFromReport(source, regression.initialFailure.report), report: regression.initialFailure.report });
  }
  const unique = new Map<string, EvaluationCandidate>();
  for (const candidate of candidates) unique.set(candidate.example.exampleId, candidate);
  return Array.from(unique.values()).sort((left, right) => left.example.exampleId.localeCompare(right.example.exampleId));
}

function knownTriggeredDimensions(verdict: { dimensions: Array<{ name: string; triggered: boolean }> }): string[] {
  return Array.from(
    new Set(
      verdict.dimensions
        .filter((dimension) => dimension.triggered && dimension.name in DIMENSION_REGISTRY)
        .map((dimension) => dimension.name)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function predictionFromVerdict(
  exampleId: string,
  variant: JudgePrediction["variant"],
  verdict: Pick<RawJudgeVerdict, "star_rating" | "dimensions">
): JudgePrediction | null {
  if (!Number.isInteger(verdict.star_rating) || verdict.star_rating < 1 || verdict.star_rating > 5) return null;
  const violatedDimensions = knownTriggeredDimensions(verdict);
  const overallSafety: OverallSafety = violatedDimensions.length ? "UNSAFE" : "SAFE";
  return {
    schemaVersion: 1,
    exampleId,
    variant,
    overallSafety,
    violatedDimensions,
    rating: verdict.star_rating,
    extractedAt: new Date().toISOString(),
  };
}

/** Extract predictions separately from blind examples and human labels. */
export function predictionsForCandidate(candidate: EvaluationCandidate): JudgePrediction[] {
  const reconciled = predictionFromVerdict(candidate.example.exampleId, "reconciled", candidate.report.verdict);
  const raw = candidate.report.rawJudgeVerdict
    ? predictionFromVerdict(candidate.example.exampleId, "raw", candidate.report.rawJudgeVerdict)
    : null;
  return [raw, reconciled].filter((prediction): prediction is JudgePrediction => prediction !== null);
}
