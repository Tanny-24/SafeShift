#!/usr/bin/env node
import path from "node:path";
import { readJsonl, writeJsonAtomic } from "../lib/evaluation/jsonl";
import { evaluateJudge, validateHumanLabels, validateJudgePredictions } from "../lib/evaluation/judgeMetrics";
import { safeShiftHome } from "../lib/store";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const labelsFile = flag("labels") ?? path.join(safeShiftHome(), "evaluation", "judge", "labels.jsonl");
  const predictionsFile = flag("predictions") ?? path.join(safeShiftHome(), "evaluation", "judge", "judge-predictions.jsonl");
  const variant = flag("variant") ?? "reconciled";
  const output = flag("output") ?? path.join(safeShiftHome(), "evaluation", "judge", `results-${variant}.json`);
  if (variant !== "raw" && variant !== "reconciled") throw new Error("--variant must be raw or reconciled.");
  const labels = validateHumanLabels(await readJsonl(labelsFile));
  if (!labels.length) {
    const result = { evaluatedExamples: 0, variant, status: "pending_human_labels" };
    await writeJsonAtomic(output, result);
    process.stdout.write(JSON.stringify({ output, ...result }, null, 2) + "\n");
    return;
  }
  const predictions = validateJudgePredictions(await readJsonl(predictionsFile), variant);
  const result = { variant, ...evaluateJudge(labels, predictions) };
  await writeJsonAtomic(output, result);
  process.stdout.write(JSON.stringify({ output, ...result }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
