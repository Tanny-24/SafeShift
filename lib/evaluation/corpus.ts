// Local-only storage and objective composition reporting for real evaluation
// transcripts. These records can contain synthetic canaries, so the default
// location is below the git-ignored SafeShift home, never this source tree.

import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentSpecAnalysis } from "../agentSpec";
import type { ScenarioReport } from "../core";
import { safeShiftHome } from "../store";
import { readJsonl, writeJsonlAtomic } from "./jsonl";
import type { BlindJudgeExample } from "./types";

export const CORPUS_SCHEMA_VERSION = 1 as const;

export type CorpusAgentSpec = Pick<AgentSpecAnalysis, "hash"> & {
  name: string;
  toolGrants: string[];
};

/** One successful real SafeShift execution admitted to the local corpus. */
export type CollectedCorpusRecord = {
  schemaVersion: typeof CORPUS_SCHEMA_VERSION;
  recordId: string;
  /** Stable AgentSpec/scenario fingerprint used for deduplication and resume. */
  collectionKey: string;
  collectedAt: string;
  agentSpec: CorpusAgentSpec;
  scenarioId: string;
  report: ScenarioReport;
};

export type CorpusCollectionFailure = {
  kind: "network" | "provider" | "unknown";
  message: string;
};

/** An auditable outcome for every collection attempt, including failures. */
export type CorpusCollectionAttempt = {
  schemaVersion: typeof CORPUS_SCHEMA_VERSION;
  attemptId: string;
  collectionKey: string;
  attemptedAt: string;
  agentSpecHash: string;
  scenarioId: string;
  outcome: "success" | "failure" | "skipped_existing";
  recordId?: string;
  error?: CorpusCollectionFailure;
};

export type CorpusComposition = {
  totalExamples: number;
  sourceCounts: Record<string, number>;
  scenarioCounts: Array<{
    scenarioId: string;
    label: string;
    dimension: string;
    mode: "autonomous" | "adversarial";
    count: number;
  }>;
  dimensionCounts: Array<{ dimension: string; count: number }>;
  agentSpecCounts: Array<{ hash: string; name: string; count: number }>;
  modeCounts: Record<"autonomous" | "adversarial", number>;
  toolActivity: { examplesWithTools: number; totalToolTurns: number };
  canaryEvidence: { examplesWithEvidence: number; totalEvidenceItems: number };
  turnCounts: { min: number | null; max: number | null; mean: number | null };
};

export function corpusDirectory(home = safeShiftHome()): string {
  return path.join(home, "evaluation", "judge");
}

export function corpusRecordsPath(home = safeShiftHome()): string {
  return path.join(corpusDirectory(home), "corpus.jsonl");
}

export function corpusAttemptsPath(home = safeShiftHome()): string {
  return path.join(corpusDirectory(home), "collection-attempts.jsonl");
}

export function collectionKey(agentSpecHash: string, scenarioId: string): string {
  if (!/^[a-f0-9]{64}$/i.test(agentSpecHash)) throw new Error("Collection requires a SHA-256 AgentSpec hash.");
  if (!/^[A-Za-z0-9_]+$/.test(scenarioId)) throw new Error(`Invalid scenario id "${scenarioId}".`);
  return createHash("sha256").update(`${agentSpecHash.toLowerCase()}\u0000${scenarioId}`, "utf8").digest("hex");
}

export function corpusRecordId(agentSpecHash: string, scenarioId: string): string {
  return `corpus_${collectionKey(agentSpecHash, scenarioId).slice(0, 24)}`;
}

export function makeCorpusRecord(input: {
  agentSpec: CorpusAgentSpec;
  scenarioId: string;
  report: ScenarioReport;
  collectedAt?: string;
}): CollectedCorpusRecord {
  if (input.report.scenarioId !== input.scenarioId) {
    throw new Error("Corpus report scenario does not match its collection scenario.");
  }
  const key = collectionKey(input.agentSpec.hash, input.scenarioId);
  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    recordId: corpusRecordId(input.agentSpec.hash, input.scenarioId),
    collectionKey: key,
    collectedAt: input.collectedAt ?? new Date().toISOString(),
    agentSpec: {
      hash: input.agentSpec.hash,
      name: input.agentSpec.name,
      toolGrants: [...input.agentSpec.toolGrants],
    },
    scenarioId: input.scenarioId,
    report: input.report,
  };
}

function isCorpusRecord(value: unknown): value is CollectedCorpusRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CollectedCorpusRecord>;
  return record.schemaVersion === CORPUS_SCHEMA_VERSION &&
    typeof record.recordId === "string" &&
    typeof record.collectionKey === "string" &&
    typeof record.collectedAt === "string" &&
    typeof record.scenarioId === "string" &&
    Boolean(record.agentSpec && typeof record.agentSpec.hash === "string") &&
    Boolean(record.report && record.report.scenarioId === record.scenarioId);
}

/** Fail closed: malformed local content cannot silently become an evaluation example. */
export async function readCollectedCorpusRecords(file = corpusRecordsPath()): Promise<CollectedCorpusRecord[]> {
  const parsed = await readJsonl(file);
  const records: CollectedCorpusRecord[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const value of parsed) {
    if (!isCorpusRecord(value)) throw new Error(`Invalid corpus record in "${file}".`);
    if (keys.has(value.collectionKey) || ids.has(value.recordId)) {
      throw new Error(`Duplicate corpus record in "${file}".`);
    }
    keys.add(value.collectionKey);
    ids.add(value.recordId);
    records.push(value);
  }
  return records.sort((left, right) => left.recordId.localeCompare(right.recordId));
}

/** Atomically admit one success. Existing configuration keys are never duplicated. */
export async function appendCollectedCorpusRecord(
  record: CollectedCorpusRecord,
  file = corpusRecordsPath()
): Promise<{ added: boolean; records: CollectedCorpusRecord[] }> {
  const records = await readCollectedCorpusRecords(file);
  if (records.some((item) => item.collectionKey === record.collectionKey || item.recordId === record.recordId)) {
    return { added: false, records };
  }
  const next = [...records, record].sort((left, right) => left.recordId.localeCompare(right.recordId));
  await writeJsonlAtomic(file, next);
  return { added: true, records: next };
}

export async function appendCorpusCollectionAttempt(
  attempt: CorpusCollectionAttempt,
  file = corpusAttemptsPath()
): Promise<void> {
  const attempts = await readJsonl(file);
  await writeJsonlAtomic(file, [...attempts, attempt]);
}

/**
 * Pure, verdict-free corpus composition report. It works entirely from the
 * same blind examples an annotator will see and never uses judge predictions.
 */
export function summarizeBlindJudgeCorpus(examples: BlindJudgeExample[]): CorpusComposition {
  const sourceCounts: Record<string, number> = {};
  const scenarios = new Map<string, CorpusComposition["scenarioCounts"][number]>();
  const dimensions = new Map<string, number>();
  const specs = new Map<string, CorpusComposition["agentSpecCounts"][number]>();
  const modeCounts: CorpusComposition["modeCounts"] = { autonomous: 0, adversarial: 0 };
  let examplesWithTools = 0;
  let totalToolTurns = 0;
  let examplesWithEvidence = 0;
  let totalEvidenceItems = 0;
  const turnCounts: number[] = [];

  for (const example of examples) {
    sourceCounts[example.source.kind] = (sourceCounts[example.source.kind] ?? 0) + 1;
    modeCounts[example.scenario.mode]++;
    const existingScenario = scenarios.get(example.scenario.id);
    if (existingScenario) existingScenario.count++;
    else scenarios.set(example.scenario.id, {
      scenarioId: example.scenario.id,
      label: example.scenario.label,
      dimension: example.scenario.dimension,
      mode: example.scenario.mode,
      count: 1,
    });
    dimensions.set(example.scenario.dimension, (dimensions.get(example.scenario.dimension) ?? 0) + 1);
    if (example.source.agentSpec) {
      const existingSpec = specs.get(example.source.agentSpec.hash);
      if (existingSpec) existingSpec.count++;
      else specs.set(example.source.agentSpec.hash, {
        hash: example.source.agentSpec.hash,
        name: example.source.agentSpec.name,
        count: 1,
      });
    }
    if (example.toolActivity.length) examplesWithTools++;
    totalToolTurns += example.toolActivity.length;
    if (example.canaryEvidence.length) examplesWithEvidence++;
    totalEvidenceItems += example.canaryEvidence.length;
    turnCounts.push(example.transcript.length);
  }

  return {
    totalExamples: examples.length,
    sourceCounts: Object.fromEntries(Object.entries(sourceCounts).sort(([left], [right]) => left.localeCompare(right))),
    scenarioCounts: Array.from(scenarios.values()).sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
    dimensionCounts: Array.from(dimensions, ([dimension, count]) => ({ dimension, count })).sort((left, right) => left.dimension.localeCompare(right.dimension)),
    agentSpecCounts: Array.from(specs.values()).sort((left, right) => left.hash.localeCompare(right.hash)),
    modeCounts,
    toolActivity: { examplesWithTools, totalToolTurns },
    canaryEvidence: { examplesWithEvidence, totalEvidenceItems },
    turnCounts: {
      min: turnCounts.length ? Math.min(...turnCounts) : null,
      max: turnCounts.length ? Math.max(...turnCounts) : null,
      mean: turnCounts.length ? turnCounts.reduce((sum, count) => sum + count, 0) / turnCounts.length : null,
    },
  };
}
