import assert from "node:assert/strict";
import test from "node:test";
import {
  pendingVarianceStudyRuns,
  plannedVarianceRunId,
  planVarianceStudy,
  validateVarianceStudyManifest,
} from "../lib/evaluation/varianceStudy";
import type { VarianceRunRecord } from "../lib/evaluation/variance";

const manifest = validateVarianceStudyManifest({
  schemaVersion: 1,
  studyId: "study-2026-a",
  createdAt: "2026-08-23T00:00:00.000Z",
  measurementMode: "end-to-end",
  model: "fixture-model",
  specs: [
    { path: "specs/a.json", hash: "a".repeat(64) },
    { path: "specs/b.json", hash: "b".repeat(64) },
  ],
  scenarioIds: ["credleak", "jailbreak"],
  repeatCount: 3,
  plannedRunCount: 12,
});

test("variance studies plan deterministic ids and validate planned arithmetic", () => {
  const plan = planVarianceStudy(manifest);
  assert.equal(plan.length, 12);
  assert.equal(plan[0].planRunId, plannedVarianceRunId("study-2026-a", "a".repeat(64), "credleak", 1));
  assert.equal(plan[0].planRunId, planVarianceStudy(manifest)[0].planRunId);
  assert.throws(() => validateVarianceStudyManifest({ ...manifest, plannedRunCount: 11 }), /plannedRunCount/);
});

test("successful study cells are skipped while failed cells remain eligible for an intentional retry", () => {
  const plan = planVarianceStudy(manifest);
  const success: VarianceRunRecord = {
    schemaVersion: 1, experimentId: manifest.studyId, planRunId: plan[0].planRunId,
    runIndex: plan[0].runIndex, specHash: plan[0].spec.hash, scenarioId: plan[0].scenarioId,
    timestamp: "2026-08-23", mode: "end-to-end", success: true, overallStatus: "SAFE", rating: 5,
  };
  const failed: VarianceRunRecord = {
    schemaVersion: 1, experimentId: manifest.studyId, planRunId: plan[1].planRunId,
    runIndex: plan[1].runIndex, specHash: plan[1].spec.hash, scenarioId: plan[1].scenarioId,
    timestamp: "2026-08-23", mode: "end-to-end", success: false,
    error: { kind: "network", message: "timeout" },
  };
  const pending = pendingVarianceStudyRuns(manifest, [success, failed]);
  assert.equal(pending.length, 11);
  assert.equal(pending.some((item) => item.planRunId === plan[0].planRunId), false);
  assert.equal(pending.some((item) => item.planRunId === plan[1].planRunId), true);
  assert.throws(() => pendingVarianceStudyRuns(manifest, [success, { ...success }]), /Duplicate successful/);
});
