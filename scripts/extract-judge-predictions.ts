#!/usr/bin/env node
import path from "node:path";
import { collectJudgeEvaluationCandidates, predictionsForCandidate } from "../lib/evaluation/judgeDataset";
import { readJsonl, writeJsonlAtomic } from "../lib/evaluation/jsonl";
import { safeShiftHome } from "../lib/store";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const examplesFile = flag("examples") ?? path.join(safeShiftHome(), "evaluation", "judge", "examples.jsonl");
  const output = flag("output") ?? path.join(safeShiftHome(), "evaluation", "judge", "judge-predictions.jsonl");
  const examples = await readJsonl(examplesFile);
  const requestedIds = new Set(
    examples.map((example) => (example && typeof example === "object" ? (example as { exampleId?: unknown }).exampleId : undefined))
      .filter((id): id is string => typeof id === "string")
  );
  const candidates = await collectJudgeEvaluationCandidates();
  const available = new Map(candidates.map((candidate) => [candidate.example.exampleId, candidate]));
  const predictions = [];
  const missingSourceIds: string[] = [];
  const missingRawPredictionIds: string[] = [];
  for (const exampleId of Array.from(requestedIds).sort()) {
    const candidate = available.get(exampleId);
    if (!candidate) {
      missingSourceIds.push(exampleId);
      continue;
    }
    const extracted = predictionsForCandidate(candidate);
    if (!extracted.some((prediction) => prediction.variant === "raw")) missingRawPredictionIds.push(exampleId);
    predictions.push(...extracted);
  }
  await writeJsonlAtomic(output, predictions);
  const reconciledPredictions = predictions.filter((prediction) => prediction.variant === "reconciled").length;
  const rawPredictions = predictions.filter((prediction) => prediction.variant === "raw").length;
  process.stdout.write(JSON.stringify({
    output,
    examplesRequested: requestedIds.size,
    predictionsExtracted: predictions.length,
    reconciledPredictions,
    rawPredictions,
    missingRawPredictions: missingRawPredictionIds.length,
    missingRawPredictionIds,
    missingSourceIds,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
