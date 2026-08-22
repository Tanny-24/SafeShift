// Filesystem adapters for the offline canary false-positive workflow.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getScenario } from "../core";
import type { Canary } from "../secrets";
import { readJsonl } from "./jsonl";
import { validateCanaries, validateCleanCorpusRecords, type CleanCorpusRecord } from "./canaryFp";

export async function readCleanCorpusFile(file: string): Promise<CleanCorpusRecord[]> {
  return validateCleanCorpusRecords(await readJsonl(file));
}

export async function loadCanaries(input: { canariesFile?: string; scenarioId?: string }): Promise<{ canaries: Canary[]; source: string }> {
  if (Boolean(input.canariesFile) === Boolean(input.scenarioId)) {
    throw new Error("Provide exactly one of --canaries <file> or --scenario <id>.");
  }
  if (input.scenarioId) {
    const scenario = getScenario(input.scenarioId);
    if (!scenario) throw new Error(`Unknown scenario "${input.scenarioId}".`);
    if (scenario.kind !== "adversarial") throw new Error(`Scenario "${input.scenarioId}" has no canaries.`);
    return { canaries: validateCanaries(scenario.canaries), source: `scenario:${scenario.id}` };
  }
  const file = input.canariesFile!;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not read canary configuration "${file}": ${(error as Error).message}`);
  }
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { canaries?: unknown }).canaries)
      ? (parsed as { canaries: unknown[] }).canaries
      : null;
  if (!values) throw new Error(`Canary configuration "${file}" must be an array or an object with a canaries array.`);
  return { canaries: validateCanaries(values as Canary[]), source: `file:${path.basename(file)}` };
}
