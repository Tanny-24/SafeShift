// Offline evaluation for deterministic canary scanner false positives. Raw
// candidate text and synthetic canary values remain in separate local inputs;
// result objects contain only identifiers and safe match metadata.

import { createHash } from "node:crypto";
import { scanMessage, type Canary, type LeakHit, type Severity } from "../secrets";
import { wilsonInterval, type WilsonInterval } from "./variance";

export const CANARY_FP_SCHEMA_VERSION = 1 as const;
export const CLEAN_ASSERTION = "NO_CONFIGURED_CANARY" as const;

export type CleanCorpusRecord = {
  schemaVersion: typeof CANARY_FP_SCHEMA_VERSION;
  exampleId: string;
  text: string;
  source: string;
  category: string;
  cleanAssertion: typeof CLEAN_ASSERTION;
  hardNegative?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
};

export type CanaryMetadata = {
  canaryId: string;
  label: string;
  length: number;
  partialLength: number | null;
  severity: Severity;
  dimension: string;
};

export type SafeMatch = Pick<LeakHit, "canaryId" | "kind" | "severity" | "dimension">;

export type RejectedCleanRecord = {
  exampleId: string;
  category: string;
  reason: "configured_canary_match";
  matches: SafeMatch[];
};

export type CleanCorpusValidation = {
  accepted: CleanCorpusRecord[];
  rejected: RejectedCleanRecord[];
};

export type Rate = {
  denominator: number;
  count: number;
  rate: number | null;
  wilson95: WilsonInterval;
};

export type PairObservation = {
  exampleId: string;
  category: string;
  hardNegative: boolean;
  canaryId: string;
  partialLength: number | null;
  severity: Severity;
  hit: SafeMatch | null;
};

export type CanaryFpSummary = {
  exampleLevel: Rate;
  pairLevel: Rate;
  totalScannerMatches: number;
  matchKindDistribution: Record<"exact" | "partial", number>;
  severityDistribution: Record<Severity, number>;
  perCanary: Array<CanaryMetadata & Rate>;
  perCategory: Array<{ category: string; examples: number; flags: number; falsePositiveRate: number | null; wilson95: WilsonInterval }>;
  perPartialLength: Array<{ partialLength: number | null; pairs: number; flags: number; falsePositiveRate: number | null; wilson95: WilsonInterval }>;
  hardNegative: { examples: number; flags: number; falsePositiveRate: number | null; wilson95: WilsonInterval };
};

export type CanaryFpResult = {
  schemaVersion: typeof CANARY_FP_SCHEMA_VERSION;
  studyId: string;
  measuredAt: string;
  corpusFingerprint: string;
  scannerConfigFingerprint: string;
  canarySource: string;
  inputExamples: number;
  validCleanExamples: number;
  rejectedExamples: number;
  rejected: RejectedCleanRecord[];
  /** Safe audit trail for every benchmark flag; deliberately excludes text and excerpts. */
  matches: Array<{ exampleId: string; category: string; canaryId: string; kind: "exact" | "partial"; severity: Severity; dimension: string }>;
  summary: CanaryFpSummary;
};

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

function normalizedLength(value: string): number {
  return value.replace(/[^A-Za-z0-9]/g, "").length;
}

export function validateCleanCorpusRecords(values: unknown[]): CleanCorpusRecord[] {
  const records: CleanCorpusRecord[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Clean corpus record ${index + 1} must be an object.`);
    const record = value as Partial<CleanCorpusRecord>;
    if (record.schemaVersion !== CANARY_FP_SCHEMA_VERSION) throw new Error(`Clean corpus record ${index + 1} has an unsupported schemaVersion.`);
    const exampleId = requireText(record.exampleId, `Clean corpus record ${index + 1}.exampleId`);
    if (!/^[A-Za-z0-9_-]{3,160}$/.test(exampleId)) throw new Error(`Clean corpus record ${index + 1}.exampleId has unsupported characters.`);
    if (ids.has(exampleId)) throw new Error(`Duplicate clean corpus exampleId "${exampleId}".`);
    ids.add(exampleId);
    const text = requireText(record.text, `Clean corpus record ${index + 1}.text`);
    const source = requireText(record.source, `Clean corpus record ${index + 1}.source`);
    const category = requireText(record.category, `Clean corpus record ${index + 1}.category`);
    if (record.cleanAssertion !== CLEAN_ASSERTION) {
      throw new Error(`Clean corpus record ${index + 1} must assert ${CLEAN_ASSERTION}.`);
    }
    if (record.hardNegative !== undefined && typeof record.hardNegative !== "boolean") {
      throw new Error(`Clean corpus record ${index + 1}.hardNegative must be boolean when present.`);
    }
    if (record.metadata !== undefined) {
      if (!record.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata) ||
        !Object.values(record.metadata).every(isScalar)) {
        throw new Error(`Clean corpus record ${index + 1}.metadata must contain scalar values only.`);
      }
    }
    records.push({
      schemaVersion: CANARY_FP_SCHEMA_VERSION,
      exampleId,
      text,
      source,
      category,
      cleanAssertion: CLEAN_ASSERTION,
      ...(record.hardNegative ? { hardNegative: true } : {}),
      ...(record.metadata ? { metadata: record.metadata } : {}),
    });
  }
  return records.sort((left, right) => left.exampleId.localeCompare(right.exampleId));
}

export function validateCanaries(values: Canary[]): Canary[] {
  const ids = new Set<string>();
  for (let index = 0; index < values.length; index++) {
    const canary = values[index];
    if (!canary || typeof canary !== "object") throw new Error(`Canary ${index + 1} must be an object.`);
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(canary.id)) throw new Error(`Canary ${index + 1} has an invalid id.`);
    if (ids.has(canary.id)) throw new Error(`Duplicate canary id "${canary.id}".`);
    ids.add(canary.id);
    if (!requireText(canary.value, `Canary ${canary.id}.value`) || normalizedLength(canary.value) === 0) {
      throw new Error(`Canary ${canary.id} has no matchable characters.`);
    }
    if (!requireText(canary.label, `Canary ${canary.id}.label`) || !requireText(canary.dimension, `Canary ${canary.id}.dimension`)) {
      throw new Error(`Canary ${canary.id} is incomplete.`);
    }
    if (canary.severity !== "critical" && canary.severity !== "high" && canary.severity !== "medium") {
      throw new Error(`Canary ${canary.id} has an invalid severity.`);
    }
    if (canary.partialLength !== undefined && (!Number.isInteger(canary.partialLength) || canary.partialLength < 1 || canary.partialLength >= normalizedLength(canary.value))) {
      throw new Error(`Canary ${canary.id}.partialLength must be an integer shorter than the normalized canary.`);
    }
  }
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

export function canaryMetadata(canary: Canary): CanaryMetadata {
  return {
    canaryId: canary.id,
    label: canary.label,
    length: normalizedLength(canary.value),
    partialLength: canary.partialLength ?? null,
    severity: canary.severity,
    dimension: canary.dimension,
  };
}

/** Invoke the production scanner independently for every clean-example/canary pair. */
export function scanCanaryPairs(records: CleanCorpusRecord[], canaries: Canary[]): PairObservation[] {
  const pairs: PairObservation[] = [];
  for (const record of records) {
    for (const canary of canaries) {
      const hit = scanMessage([canary], record.text, 0, new Set())[0];
      pairs.push({
        exampleId: record.exampleId,
        category: record.category,
        hardNegative: record.hardNegative === true,
        canaryId: canary.id,
        partialLength: canary.partialLength ?? null,
        severity: canary.severity,
        hit: hit ? { canaryId: hit.canaryId, kind: hit.kind, severity: hit.severity, dimension: hit.dimension } : null,
      });
    }
  }
  return pairs;
}

/** Reject candidate text that already satisfies existing scanner semantics. */
export function validateCleanCorpus(records: CleanCorpusRecord[], canaries: Canary[]): CleanCorpusValidation {
  const accepted: CleanCorpusRecord[] = [];
  const rejected: RejectedCleanRecord[] = [];
  for (const record of records) {
    const matches = scanCanaryPairs([record], canaries).flatMap((pair) => pair.hit ? [pair.hit] : []);
    if (matches.length) rejected.push({
      exampleId: record.exampleId,
      category: record.category,
      reason: "configured_canary_match",
      matches,
    });
    else accepted.push(record);
  }
  return {
    accepted: [...accepted].sort((left, right) => left.exampleId.localeCompare(right.exampleId)),
    rejected: [...rejected].sort((left, right) => left.exampleId.localeCompare(right.exampleId)),
  };
}

function rate(count: number, denominator: number): Rate {
  return { count, denominator, rate: denominator ? count / denominator : null, wilson95: wilsonInterval(count, denominator) };
}

function expectedPairs(records: CleanCorpusRecord[], canaries: Canary[]): Set<string> {
  return new Set(records.flatMap((record) => canaries.map((canary) => `${record.exampleId}\u0000${canary.id}`)));
}

/** Pure statistics over one observation per valid clean-example/canary pair. */
export function summarizeCanaryFp(
  records: CleanCorpusRecord[],
  canaries: Canary[],
  observations: PairObservation[]
): CanaryFpSummary {
  const expected = expectedPairs(records, canaries);
  const observed = new Set<string>();
  const byExample = new Map(records.map((record) => [record.exampleId, record]));
  const byCanary = new Map(canaries.map((canary) => [canary.id, canary]));
  for (const observation of observations) {
    const key = `${observation.exampleId}\u0000${observation.canaryId}`;
    if (!expected.has(key) || observed.has(key)) throw new Error("Pair observations must contain exactly one valid, unique record/canary pair.");
    const record = byExample.get(observation.exampleId)!;
    const canary = byCanary.get(observation.canaryId)!;
    if (observation.category !== record.category || observation.hardNegative !== (record.hardNegative === true) ||
      observation.partialLength !== (canary.partialLength ?? null) || observation.severity !== canary.severity) {
      throw new Error("Pair observation metadata does not match its record and canary configuration.");
    }
    observed.add(key);
  }
  if (observed.size !== expected.size) throw new Error("Pair observations are incomplete.");

  const pairFlags = observations.filter((observation) => observation.hit !== null);
  const flaggedExamples = new Set(pairFlags.map((observation) => observation.exampleId));
  const severities: Record<Severity, number> = { critical: 0, high: 0, medium: 0 };
  const matchKinds: Record<"exact" | "partial", number> = { exact: 0, partial: 0 };
  for (const pair of pairFlags) {
    severities[pair.severity]++;
    matchKinds[pair.hit!.kind]++;
  }

  const metadata = new Map(canaries.map((canary) => [canary.id, canaryMetadata(canary)]));
  const perCanary = canaries.map((canary) => {
    const pairs = observations.filter((observation) => observation.canaryId === canary.id);
    return { ...metadata.get(canary.id)!, ...rate(pairs.filter((pair) => pair.hit !== null).length, pairs.length) };
  });
  const categories = Array.from(new Set(records.map((record) => record.category))).sort();
  const perCategory = categories.map((category) => {
    const examples = records.filter((record) => record.category === category);
    const flags = examples.filter((record) => flaggedExamples.has(record.exampleId)).length;
    const result = rate(flags, examples.length);
    return { category, examples: examples.length, flags, falsePositiveRate: result.rate, wilson95: result.wilson95 };
  });
  const partialLengths = Array.from(new Set(canaries.map((canary) => canary.partialLength ?? null)))
    .sort((left, right) => (left ?? -1) - (right ?? -1));
  const perPartialLength = partialLengths.map((partialLength) => {
    const pairs = observations.filter((observation) => observation.partialLength === partialLength);
    const result = rate(pairs.filter((pair) => pair.hit !== null).length, pairs.length);
    return { partialLength, pairs: pairs.length, flags: result.count, falsePositiveRate: result.rate, wilson95: result.wilson95 };
  });
  const hardNegatives = records.filter((record) => record.hardNegative === true);
  const hardNegativeFlags = hardNegatives.filter((record) => flaggedExamples.has(record.exampleId)).length;
  const hardNegativeRate = rate(hardNegativeFlags, hardNegatives.length);

  return {
    exampleLevel: rate(flaggedExamples.size, records.length),
    pairLevel: rate(pairFlags.length, observations.length),
    totalScannerMatches: pairFlags.length,
    matchKindDistribution: matchKinds,
    severityDistribution: severities,
    perCanary: perCanary.sort((left, right) => left.canaryId.localeCompare(right.canaryId)),
    perCategory,
    perPartialLength,
    hardNegative: {
      examples: hardNegatives.length,
      flags: hardNegativeFlags,
      falsePositiveRate: hardNegativeRate.rate,
      wilson95: hardNegativeRate.wilson95,
    },
  };
}

export function corpusFingerprint(records: CleanCorpusRecord[]): string {
  return fingerprint(records.map((record) => ({ ...record, metadata: record.metadata ?? {} })).sort((left, right) => left.exampleId.localeCompare(right.exampleId)));
}

export function scannerConfigFingerprint(canaries: Canary[]): string {
  return fingerprint(validateCanaries(canaries).map((canary) => ({
    id: canary.id, value: canary.value, severity: canary.severity, dimension: canary.dimension, partialLength: canary.partialLength ?? null,
  })));
}

export function evaluateCanaryFp(input: {
  studyId: string;
  canarySource: string;
  records: CleanCorpusRecord[];
  canaries: Canary[];
  measuredAt?: string;
}): CanaryFpResult {
  const records = validateCleanCorpusRecords(input.records);
  const canaries = validateCanaries(input.canaries);
  const validation = validateCleanCorpus(records, canaries);
  const observations = scanCanaryPairs(validation.accepted, canaries);
  const matches = observations
    .filter((observation): observation is PairObservation & { hit: SafeMatch } => observation.hit !== null)
    .map((observation) => ({
      exampleId: observation.exampleId,
      category: observation.category,
      canaryId: observation.canaryId,
      kind: observation.hit.kind,
      severity: observation.hit.severity,
      dimension: observation.hit.dimension,
    }))
    .sort((left, right) => `${left.exampleId}\u0000${left.canaryId}`.localeCompare(`${right.exampleId}\u0000${right.canaryId}`));
  return {
    schemaVersion: CANARY_FP_SCHEMA_VERSION,
    studyId: requireText(input.studyId, "studyId"),
    measuredAt: input.measuredAt ?? new Date().toISOString(),
    corpusFingerprint: corpusFingerprint(records),
    scannerConfigFingerprint: scannerConfigFingerprint(canaries),
    canarySource: requireText(input.canarySource, "canarySource"),
    inputExamples: records.length,
    validCleanExamples: validation.accepted.length,
    rejectedExamples: validation.rejected.length,
    rejected: validation.rejected,
    matches,
    summary: summarizeCanaryFp(validation.accepted, canaries, observations),
  };
}

/** Detect stale results before an explicit resume, without exposing corpus text. */
export function assertResultMatchesInput(
  result: CanaryFpResult,
  records: CleanCorpusRecord[],
  canaries: Canary[],
  expected?: { studyId?: string; canarySource?: string }
): void {
  if (result.schemaVersion !== CANARY_FP_SCHEMA_VERSION) throw new Error("Existing canary FP result has an unsupported schemaVersion.");
  if (result.corpusFingerprint !== corpusFingerprint(validateCleanCorpusRecords(records))) {
    throw new Error("Existing canary FP result is stale: corpus fingerprint differs.");
  }
  if (result.scannerConfigFingerprint !== scannerConfigFingerprint(canaries)) {
    throw new Error("Existing canary FP result is stale: scanner configuration fingerprint differs.");
  }
  if (expected?.studyId !== undefined && result.studyId !== expected.studyId) {
    throw new Error("Existing canary FP result is stale: studyId differs.");
  }
  if (expected?.canarySource !== undefined && result.canarySource !== expected.canarySource) {
    throw new Error("Existing canary FP result is stale: canary source differs.");
  }
}
