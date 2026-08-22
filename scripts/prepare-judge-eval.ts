#!/usr/bin/env node
import path from "node:path";
import { collectJudgeEvaluationCandidates } from "../lib/evaluation/judgeDataset";
import { writeJsonlAtomic } from "../lib/evaluation/jsonl";
import { safeShiftHome } from "../lib/store";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const output = flag("output") ?? path.join(safeShiftHome(), "evaluation", "judge", "examples.jsonl");
  const candidates = await collectJudgeEvaluationCandidates();
  await writeJsonlAtomic(output, candidates.map((candidate) => candidate.example));
  const sourceCounts = candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.example.source.kind] = (counts[candidate.example.source.kind] ?? 0) + 1;
    return counts;
  }, {});
  process.stdout.write(JSON.stringify({ output, preparedExamples: candidates.length, targetExamples: "60-80", sourceCounts }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
