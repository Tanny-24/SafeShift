#!/usr/bin/env node
// Validate a raw candidate corpus before it enters the known-clean benchmark.
// The original corpus is never overwritten; only accepted records and a safe
// rejection report are written to ignored local evaluation storage by default.

import path from "node:path";
import { canaryMetadata, corpusFingerprint, scannerConfigFingerprint, validateCleanCorpus } from "../lib/evaluation/canaryFp";
import { loadCanaries, readCleanCorpusFile } from "../lib/evaluation/canaryFpIo";
import { writeJsonAtomic, writeJsonlAtomic } from "../lib/evaluation/jsonl";
import { safeShiftHome } from "../lib/store";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const input = flag("input");
  if (!input) throw new Error("--input <clean-corpus.jsonl> is required.");
  const { canaries, source } = await loadCanaries({ canariesFile: flag("canaries"), scenarioId: flag("scenario") });
  const output = flag("output") ?? path.join(safeShiftHome(), "evaluation", "canary", "prepared-clean-corpus.jsonl");
  const report = flag("report") ?? path.join(safeShiftHome(), "evaluation", "canary", "preparation-report.json");
  const records = await readCleanCorpusFile(input);
  const validation = validateCleanCorpus(records, canaries);
  await writeJsonlAtomic(output, validation.accepted);
  await writeJsonAtomic(report, {
    schemaVersion: 1,
    sourceCorpusFingerprint: corpusFingerprint(records),
    scannerConfigFingerprint: scannerConfigFingerprint(canaries),
    canarySource: source,
    canaries: canaries.map(canaryMetadata),
    inputExamples: records.length,
    validCleanExamples: validation.accepted.length,
    rejectedExamples: validation.rejected.length,
    rejected: validation.rejected,
  });
  process.stdout.write(JSON.stringify({ output, report, inputExamples: records.length, validCleanExamples: validation.accepted.length, rejectedExamples: validation.rejected.length, canarySource: source }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
