#!/usr/bin/env node
// Collect a bounded batch of real SafeShift executions into the ignored local
// evaluation corpus. It deliberately never writes labels or judge-prediction
// exports: those are independent downstream steps.

import { analyzeAgentSpec, loadAgentSpec } from "../lib/agentSpec";
import {
  appendCollectedCorpusRecord,
  appendCorpusCollectionAttempt,
  collectionKey,
  corpusAttemptsPath,
  corpusRecordsPath,
  makeCorpusRecord,
  readCollectedCorpusRecords,
  type CorpusAgentSpec,
  type CorpusCollectionAttempt,
} from "../lib/evaluation/corpus";
import { classifyVarianceError } from "../lib/evaluation/variance";
import { getScenario, runCrashTest } from "../lib/core";
import { hasGeminiKey, loadEnv } from "../lib/env";

loadEnv();

type ParsedFlags = Map<string, string[]>;

function parseFlags(argv: string[]): ParsedFlags {
  const values: ParsedFlags = new Map();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument "${argument}".`);
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!name || !value || value.startsWith("--")) throw new Error(`--${name} requires a value.`);
    const entries = values.get(name) ?? [];
    entries.push(value);
    values.set(name, entries);
    index++;
  }
  return values;
}

function requiredValues(flags: ParsedFlags, name: string): string[] {
  const values = flags.get(name)?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (!values.length) throw new Error(`At least one --${name} is required.`);
  return values;
}

function selectedScenarioIds(flags: ParsedFlags): string[] {
  const direct = flags.get("scenario") ?? [];
  const commaSeparated = (flags.get("scenarios") ?? []).flatMap((value) => value.split(","));
  const ids = Array.from(new Set([...direct, ...commaSeparated].map((value) => value.trim()).filter(Boolean))).sort();
  if (!ids.length) throw new Error("At least one --scenario or --scenarios value is required.");
  for (const id of ids) if (!getScenario(id)) throw new Error(`Unknown scenario "${id}".`);
  return ids;
}

function runLimit(flags: ParsedFlags): number {
  const raw = flags.get("limit")?.[0];
  if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
    throw new Error("--limit must be a positive integer no greater than 100.");
  }
  return Number(raw);
}

function attemptId(key: string): string {
  return `attempt_${key.slice(0, 16)}_${Date.now().toString(36)}`;
}

function asCorpusAgentSpec(analysis: ReturnType<typeof analyzeAgentSpec>): CorpusAgentSpec {
  return {
    hash: analysis.hash,
    name: analysis.spec.name,
    toolGrants: [...analysis.spec.toolGrants],
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const specPaths = Array.from(new Set(requiredValues(flags, "spec"))).sort();
  const scenarioIds = selectedScenarioIds(flags);
  const limit = runLimit(flags);
  if (!hasGeminiKey()) throw new Error("GEMINI_API_KEY is not set.");

  const specs = await Promise.all(specPaths.map(async (specPath) => {
    const analysis = analyzeAgentSpec(await loadAgentSpec(specPath));
    return { specPath, analysis, corpusSpec: asCorpusAgentSpec(analysis) };
  }));
  specs.sort((left, right) => left.analysis.hash.localeCompare(right.analysis.hash));
  if (new Set(specs.map((item) => item.analysis.hash)).size !== specs.length) {
    throw new Error("Selected AgentSpecs have duplicate normalized hashes; choose distinct specifications.");
  }

  const corpusFile = corpusRecordsPath();
  const attemptsFile = corpusAttemptsPath();
  const existingKeys = new Set((await readCollectedCorpusRecords(corpusFile)).map((record) => record.collectionKey));
  const plan = scenarioIds.flatMap((scenarioId) => specs.map((spec) => ({ scenarioId, ...spec })));

  let attempted = 0;
  let successful = 0;
  let failed = 0;
  let added = 0;
  let skippedExisting = 0;
  let stopReason: string | undefined;

  for (const item of plan) {
    const key = collectionKey(item.analysis.hash, item.scenarioId);
    if (existingKeys.has(key)) {
      skippedExisting++;
      const attempt: CorpusCollectionAttempt = {
        schemaVersion: 1,
        attemptId: attemptId(key),
        collectionKey: key,
        attemptedAt: new Date().toISOString(),
        agentSpecHash: item.analysis.hash,
        scenarioId: item.scenarioId,
        outcome: "skipped_existing",
      };
      await appendCorpusCollectionAttempt(attempt, attemptsFile);
      continue;
    }
    if (attempted >= limit) break;
    attempted++;
    try {
      const report = await runCrashTest({
        systemPrompt: item.analysis.spec.systemPrompt,
        scenarioId: item.scenarioId,
      });
      const record = makeCorpusRecord({
        agentSpec: item.corpusSpec,
        scenarioId: item.scenarioId,
        report,
      });
      const saved = await appendCollectedCorpusRecord(record, corpusFile);
      const attempt: CorpusCollectionAttempt = {
        schemaVersion: 1,
        attemptId: attemptId(key),
        collectionKey: key,
        attemptedAt: new Date().toISOString(),
        agentSpecHash: item.analysis.hash,
        scenarioId: item.scenarioId,
        outcome: saved.added ? "success" : "skipped_existing",
        ...(saved.added ? { recordId: record.recordId } : {}),
      };
      await appendCorpusCollectionAttempt(attempt, attemptsFile);
      if (saved.added) {
        successful++;
        added++;
        existingKeys.add(key);
      } else {
        skippedExisting++;
      }
    } catch (error) {
      failed++;
      const failure = classifyVarianceError(error);
      const attempt: CorpusCollectionAttempt = {
        schemaVersion: 1,
        attemptId: attemptId(key),
        collectionKey: key,
        attemptedAt: new Date().toISOString(),
        agentSpecHash: item.analysis.hash,
        scenarioId: item.scenarioId,
        outcome: "failure",
        error: failure,
      };
      await appendCorpusCollectionAttempt(attempt, attemptsFile);
      // Retrying transport/provider failures in the same batch conceals an
      // outage and wastes quota. A later explicit invocation can retry it.
      stopReason = `${failure.kind}: ${failure.message}`;
      break;
    }
  }

  const totalCorpusRecords = (await readCollectedCorpusRecords(corpusFile)).length;
  process.stdout.write(JSON.stringify({
    corpusFile,
    attemptsFile,
    selectedSpecPaths: specPaths,
    selectedScenarioIds: scenarioIds,
    plannedConfigurations: plan.length,
    runLimit: limit,
    attempted,
    successful,
    failed,
    added,
    skippedExisting,
    totalCorpusRecords,
    ...(stopReason ? { stopReason } : {}),
  }, null, 2) + "\n");
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
