#!/usr/bin/env node
// Writes only objective corpus metadata. It does not read labels, predictions,
// raw verdicts, reconciled verdicts, ratings, or judge explanations.

import path from "node:path";
import { summarizeBlindJudgeCorpus } from "../lib/evaluation/corpus";
import { collectJudgeEvaluationCandidates } from "../lib/evaluation/judgeDataset";
import { writeJsonAtomic } from "../lib/evaluation/jsonl";
import { safeShiftHome } from "../lib/store";

async function main(): Promise<void> {
  const output = path.join(safeShiftHome(), "evaluation", "judge", "composition.json");
  const candidates = await collectJudgeEvaluationCandidates();
  const composition = summarizeBlindJudgeCorpus(candidates.map((candidate) => candidate.example));
  await writeJsonAtomic(output, composition);
  process.stdout.write(JSON.stringify({ output, ...composition }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
