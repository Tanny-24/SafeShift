// Statistics for an end-to-end SafeShift stability study. Failed provider or
// network attempts are retained as records but deliberately excluded from all
// rates and rating aggregates.

import { DIMENSION_REGISTRY } from "../judge";
import type { OverallSafety } from "./types";

export type VarianceFailure = {
  kind: "network" | "provider" | "unknown";
  message: string;
};

export type VarianceRunRecord = {
  schemaVersion: 1;
  experimentId: string;
  /** Present for manifest-driven studies; lets failed cells be retried safely. */
  planRunId?: string;
  runIndex: number;
  specHash: string;
  scenarioId: string;
  timestamp: string;
  mode: "end-to-end";
  model?: string;
  success: boolean;
  overallStatus?: OverallSafety;
  /** Dimensions the scenario's judge was asked to evaluate, even if none fired. */
  evaluatedDimensions?: string[];
  violatedDimensions?: string[];
  rating?: number;
  canaryHit?: boolean;
  canaryIds?: string[];
  error?: VarianceFailure;
};

export type WilsonInterval = { lower: number; upper: number; confidence: 0.95 } | null;

export function wilsonInterval(successes: number, total: number, z = 1.96): WilsonInterval {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || total < 0 || successes > total) {
    throw new Error("Wilson interval requires integer successes from 0 through total.");
  }
  if (total === 0) return null;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const spread =
    (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { lower: Math.max(0, center - spread), upper: Math.min(1, center + spread), confidence: 0.95 };
}

export function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sumSquares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

function validateRecord(record: VarianceRunRecord): void {
  if (!Number.isInteger(record.runIndex) || record.runIndex < 1) throw new Error("runIndex must be a positive integer.");
  if (!record.experimentId || !record.specHash || !record.scenarioId) throw new Error("Variance records require experimentId, specHash, and scenarioId.");
  if (record.planRunId !== undefined && (!record.planRunId || typeof record.planRunId !== "string")) {
    throw new Error("planRunId must be a non-empty string when present.");
  }
  if (record.success) {
    if (record.overallStatus !== "SAFE" && record.overallStatus !== "UNSAFE") {
      throw new Error("Successful variance records require SAFE or UNSAFE status.");
    }
    if (!Number.isInteger(record.rating) || record.rating! < 1 || record.rating! > 5) {
      throw new Error("Successful variance records require an integer rating from 1 to 5.");
    }
    for (const dimension of record.violatedDimensions ?? []) {
      if (!(dimension in DIMENSION_REGISTRY)) throw new Error(`Unknown variance dimension "${dimension}".`);
    }
    for (const dimension of record.evaluatedDimensions ?? []) {
      if (!(dimension in DIMENSION_REGISTRY)) throw new Error(`Unknown evaluated variance dimension "${dimension}".`);
    }
  } else if (!record.error) {
    throw new Error("Failed variance records require error metadata.");
  }
}

export function classifyVarianceError(error: unknown): VarianceFailure {
  const message = (error as Error)?.message?.replace(/\s+/g, " ").trim().slice(0, 500) || "Unknown execution error";
  const network = /UND_ERR_CONNECT_TIMEOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|could not reach/i.test(message);
  const provider = /Gemini|API|quota|429|503|502|504/i.test(message);
  return { kind: network ? "network" : provider ? "provider" : "unknown", message };
}

export type VarianceSummary = {
  attemptedRuns: number;
  successfulRuns: number;
  failedRuns: number;
  failureKinds: Record<VarianceFailure["kind"], number>;
  statusDistribution: Record<OverallSafety, number>;
  unsafeRate: number | null;
  safeRate: number | null;
  unsafeWilson95: WilsonInterval;
  canaryHitRate: number | null;
  canaryHitWilson95: WilsonInterval;
  dimensions: Array<{ name: string; detections: number; detectionRate: number | null }>;
  rating: { mean: number | null; sampleStandardDeviation: number | null; min: number | null; max: number | null };
};

export function summarizeVariance(records: VarianceRunRecord[]): VarianceSummary {
  for (const record of records) validateRecord(record);
  const successful = records.filter((record) => record.success);
  const failures: Record<VarianceFailure["kind"], number> = { network: 0, provider: 0, unknown: 0 };
  for (const record of records.filter((item) => !item.success)) failures[record.error!.kind]++;
  const unsafe = successful.filter((record) => record.overallStatus === "UNSAFE").length;
  const canaryHits = successful.filter((record) => record.canaryHit).length;
  const ratings = successful.map((record) => record.rating!);
  const dimensions = Array.from(
    new Set(successful.flatMap((record) => [
      ...(record.evaluatedDimensions ?? []),
      ...(record.violatedDimensions ?? []),
    ]))
  )
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const detections = successful.filter((record) => record.violatedDimensions?.includes(name)).length;
      return { name, detections, detectionRate: successful.length ? detections / successful.length : null };
    });
  const mean = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null;
  return {
    attemptedRuns: records.length,
    successfulRuns: successful.length,
    failedRuns: records.length - successful.length,
    failureKinds: failures,
    statusDistribution: { SAFE: successful.length - unsafe, UNSAFE: unsafe },
    unsafeRate: successful.length ? unsafe / successful.length : null,
    safeRate: successful.length ? (successful.length - unsafe) / successful.length : null,
    unsafeWilson95: wilsonInterval(unsafe, successful.length),
    canaryHitRate: successful.length ? canaryHits / successful.length : null,
    canaryHitWilson95: wilsonInterval(canaryHits, successful.length),
    dimensions,
    rating: {
      mean,
      sampleStandardDeviation: sampleStandardDeviation(ratings),
      min: ratings.length ? Math.min(...ratings) : null,
      max: ratings.length ? Math.max(...ratings) : null,
    },
  };
}
