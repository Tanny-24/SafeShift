import assert from "node:assert/strict";
import test from "node:test";
import { sampleStandardDeviation, summarizeVariance, wilsonInterval, type VarianceRunRecord } from "../lib/evaluation/variance";

const success = (
  runIndex: number,
  overallStatus: "SAFE" | "UNSAFE",
  rating: number,
  violatedDimensions: string[] = [],
  canaryHit = false
): VarianceRunRecord => ({
  schemaVersion: 1, experimentId: "experiment", runIndex, specHash: "a".repeat(64), scenarioId: "credleak",
  timestamp: "2026-01-01", mode: "end-to-end", success: true, overallStatus, rating,
  violatedDimensions, canaryHit, canaryIds: canaryHit ? ["canary"] : [],
});

test("variance summary excludes failures and calculates hand-checkable rates and sample SD", () => {
  const records: VarianceRunRecord[] = [
    success(1, "UNSAFE", 1, ["CREDENTIAL_LEAK"], true),
    success(2, "SAFE", 5),
    success(3, "UNSAFE", 3, ["JAILBREAK"]),
    {
      schemaVersion: 1, experimentId: "experiment", runIndex: 4, specHash: "a".repeat(64), scenarioId: "credleak",
      timestamp: "2026-01-01", mode: "end-to-end", success: false,
      error: { kind: "network", message: "connect timeout" },
    },
  ];
  records[0].evaluatedDimensions = ["CREDENTIAL_LEAK", "JAILBREAK", "POLICY_VIOLATION"];
  records[1].evaluatedDimensions = ["CREDENTIAL_LEAK", "JAILBREAK", "POLICY_VIOLATION"];
  records[2].evaluatedDimensions = ["CREDENTIAL_LEAK", "JAILBREAK", "POLICY_VIOLATION"];
  const summary = summarizeVariance(records);
  assert.equal(summary.attemptedRuns, 4);
  assert.equal(summary.successfulRuns, 3);
  assert.equal(summary.failedRuns, 1);
  assert.equal(summary.failureKinds.network, 1);
  assert.equal(summary.unsafeRate, 2 / 3);
  assert.equal(summary.safeRate, 1 / 3);
  assert.equal(summary.canaryHitRate, 1 / 3);
  assert.equal(summary.rating.mean, 3);
  assert.equal(summary.rating.sampleStandardDeviation, 2);
  assert.equal(summary.rating.min, 1);
  assert.equal(summary.rating.max, 5);
  assert.deepEqual(summary.dimensions.map((dimension) => dimension.name), ["CREDENTIAL_LEAK", "JAILBREAK", "POLICY_VIOLATION"]);
  assert.equal(summary.dimensions[0].detectionRate, 1 / 3);
  assert.equal(summary.dimensions[2].detectionRate, 0);
});

test("Wilson intervals and small samples are handled without fabricated variance", () => {
  assert.equal(wilsonInterval(0, 0), null);
  const interval = wilsonInterval(1, 1)!;
  assert.ok(interval.lower > 0 && interval.lower < 1);
  assert.equal(interval.upper, 1);
  assert.equal(sampleStandardDeviation([]), null);
  assert.equal(sampleStandardDeviation([3]), null);
  const empty = summarizeVariance([]);
  assert.equal(empty.successfulRuns, 0);
  assert.equal(empty.unsafeRate, null);
  assert.equal(empty.rating.mean, null);
});

test("variance records reject invalid runs and keep deterministic dimension order", () => {
  assert.throws(
    () => summarizeVariance([{ ...success(0, "SAFE", 5) }]),
    /runIndex must be a positive integer/
  );
  assert.throws(
    () => summarizeVariance([{ ...success(1, "UNSAFE", 2, ["UNKNOWN"]) }]),
    /Unknown variance dimension/
  );
});
