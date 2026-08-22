#!/usr/bin/env node
// Run the production deterministic scanner against a known-clean corpus.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertResultMatchesInput, evaluateCanaryFp, type CanaryFpResult } from "../lib/evaluation/canaryFp";
import { loadCanaries, readCleanCorpusFile } from "../lib/evaluation/canaryFpIo";
import { writeJsonAtomic } from "../lib/evaluation/jsonl";
import { safeShiftHome } from "../lib/store";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function render(result: CanaryFpResult, resumed: boolean): string {
  const example = result.summary.exampleLevel;
  const pair = result.summary.pairLevel;
  return [
    `${resumed ? "Resumed" : "Evaluated"} ${result.validCleanExamples} valid clean examples (${result.rejectedExamples} rejected).`,
    `Example-level FPR: ${example.count}/${example.denominator}${example.rate === null ? " (n/a)" : ` (${(example.rate * 100).toFixed(2)}%)`}.`,
    `Pair-level FPR: ${pair.count}/${pair.denominator}${pair.rate === null ? " (n/a)" : ` (${(pair.rate * 100).toFixed(2)}%)`}.`,
  ].join("\n") + "\n";
}

async function existingResult(file: string): Promise<CanaryFpResult | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as CanaryFpResult;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read existing canary FP result "${file}": ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const corpus = flag("corpus");
  if (!corpus) throw new Error("--corpus <clean-corpus.jsonl> is required.");
  const { canaries, source } = await loadCanaries({ canariesFile: flag("canaries"), scenarioId: flag("scenario") });
  const output = flag("output") ?? path.join(safeShiftHome(), "evaluation", "canary", "results.json");
  const records = await readCleanCorpusFile(corpus);
  const studyId = flag("study") ?? "canary-fp-adhoc";
  if (hasFlag("resume")) {
    const prior = await existingResult(output);
    if (prior) {
      assertResultMatchesInput(prior, records, canaries, { studyId, canarySource: source });
      process.stdout.write(hasFlag("json") ? JSON.stringify({ resumed: true, output, result: prior }, null, 2) + "\n" : render(prior, true));
      return;
    }
  }
  const result = evaluateCanaryFp({
    studyId,
    canarySource: source,
    records,
    canaries,
  });
  await writeJsonAtomic(output, result);
  process.stdout.write(hasFlag("json") ? JSON.stringify({ resumed: false, output, result }, null, 2) + "\n" : render(result, false));
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
