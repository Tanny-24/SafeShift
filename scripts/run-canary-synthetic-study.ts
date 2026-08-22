#!/usr/bin/env node
// Execute the deterministic 390-example Phase 2C synthetic study. No model or
// network calls occur. Candidate text stays under ignored runtime storage.

import path from "node:path";
import {
  SYNTHETIC_CANARY_STUDY_ID,
  buildSyntheticKnownCleanStudy,
  runPartialLengthSensitivity,
  runPositiveControlSanityCheck,
  sanitizeSyntheticStudySummary,
} from "../lib/evaluation/canarySyntheticStudy";
import { evaluateCanaryFp, validateCleanCorpus } from "../lib/evaluation/canaryFp";
import { loadCanaries } from "../lib/evaluation/canaryFpIo";
import { writeJsonAtomic, writeJsonlAtomic } from "../lib/evaluation/jsonl";
import { safeShiftHome } from "../lib/store";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const scenarioId = flag("scenario");
  const canariesFile = scenarioId ? flag("canaries") : (flag("canaries") ?? "evaluation/canary/synthetic-canaries.json");
  const { canaries, source } = await loadCanaries({ canariesFile, scenarioId });
  const directory = path.join(safeShiftHome(), "evaluation", "canary");
  const candidatesOutput = flag("candidates-output") ?? path.join(directory, "synthetic-390-candidates.jsonl");
  const acceptedOutput = flag("accepted-output") ?? path.join(directory, "synthetic-390-known-clean.jsonl");
  const preparationOutput = flag("preparation-output") ?? path.join(directory, "synthetic-390-preparation.json");
  const resultOutput = flag("result-output") ?? path.join(directory, "synthetic-390-result.json");
  const summaryOutput = flag("summary-output") ?? path.join(directory, "synthetic-390-summary.json");
  const candidates = buildSyntheticKnownCleanStudy(canaries);
  const validation = validateCleanCorpus(candidates, canaries);
  await writeJsonlAtomic(candidatesOutput, candidates);
  await writeJsonlAtomic(acceptedOutput, validation.accepted);
  await writeJsonAtomic(preparationOutput, {
    schemaVersion: 1,
    studyId: SYNTHETIC_CANARY_STUDY_ID,
    sourceType: "SYNTHETIC_KNOWN_CLEAN_STUDY",
    candidateExamples: candidates.length,
    validCleanExamples: validation.accepted.length,
    rejectedExamples: validation.rejected.length,
    rejected: validation.rejected,
    canarySource: source,
  });
  if (validation.accepted.length !== candidates.length) {
    throw new Error("Synthetic study candidate construction produced scanner-contaminated records; see preparation output.");
  }
  const result = evaluateCanaryFp({
    studyId: SYNTHETIC_CANARY_STUDY_ID,
    canarySource: source,
    records: candidates,
    canaries,
  });
  const positiveControl = runPositiveControlSanityCheck(canaries);
  const sensitivity = runPartialLengthSensitivity(candidates, canaries);
  const summary = sanitizeSyntheticStudySummary({ result, canaries, positiveControl, sensitivity });
  await writeJsonAtomic(resultOutput, result);
  await writeJsonAtomic(summaryOutput, summary);
  process.stdout.write(JSON.stringify({
    candidatesOutput,
    acceptedOutput,
    preparationOutput,
    resultOutput,
    summaryOutput,
    summary,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
