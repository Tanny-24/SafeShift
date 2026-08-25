import assert from "node:assert/strict";
import test from "node:test";
import {
  classificationMetrics,
  cohenKappa,
  evaluateJudge,
  meanAbsoluteError,
  validateHumanLabels,
  validateJudgePredictions,
} from "../lib/evaluation/judgeMetrics";
import type { HumanJudgeLabel, JudgePrediction } from "../lib/evaluation/types";

test("binary judge metrics calculate a hand-checkable unsafe confusion matrix", () => {
  const metrics = classificationMetrics([true, true, false, false], [true, false, true, false]);
  assert.deepEqual(
    { tp: metrics.truePositive, fp: metrics.falsePositive, tn: metrics.trueNegative, fn: metrics.falseNegative },
    { tp: 1, fp: 1, tn: 1, fn: 1 }
  );
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 0.5);
  assert.equal(metrics.f1, 0.5);
  assert.equal(metrics.support, 2);
});

test("kappa, MAE, and zero-denominator behavior are explicit", () => {
  assert.equal(cohenKappa([true, true, false, false], [true, false, true, false]), 0);
  assert.equal(cohenKappa([true, true], [true, true]), null);
  assert.equal(meanAbsoluteError([1, 3, 5], [2, 3, 4]), 2 / 3);
  const noPredictedUnsafe = classificationMetrics([true, false], [false, false]);
  assert.equal(noPredictedUnsafe.precision, null);
  assert.equal(noPredictedUnsafe.recall, 0);
  assert.equal(noPredictedUnsafe.f1, 0);
});

test("judge evaluation calculates overall, per-dimension, micro and macro metrics", () => {
  const labels: HumanJudgeLabel[] = [
    { schemaVersion: 1, exampleId: "a", overallSafety: "UNSAFE", violatedDimensions: ["CREDENTIAL_LEAK"], rating: 1, labeledAt: "2026-01-01" },
    { schemaVersion: 1, exampleId: "b", overallSafety: "SAFE", violatedDimensions: [], rating: 5, labeledAt: "2026-01-01" },
  ];
  const predictions: JudgePrediction[] = [
    { schemaVersion: 1, exampleId: "a", variant: "reconciled", overallSafety: "UNSAFE", violatedDimensions: ["CREDENTIAL_LEAK"], rating: 2, extractedAt: "2026-01-01" },
    { schemaVersion: 1, exampleId: "b", variant: "reconciled", overallSafety: "UNSAFE", violatedDimensions: ["JAILBREAK"], rating: 4, extractedAt: "2026-01-01" },
  ];
  const metrics = evaluateJudge(labels, predictions, ["CREDENTIAL_LEAK", "JAILBREAK"]);
  assert.deepEqual(
    { tp: metrics.overall.truePositive, fp: metrics.overall.falsePositive, tn: metrics.overall.trueNegative, fn: metrics.overall.falseNegative },
    { tp: 1, fp: 1, tn: 0, fn: 0 }
  );
  assert.equal(metrics.overall.precision, 0.5);
  assert.equal(metrics.overall.recall, 1);
  assert.equal(metrics.perDimension.CREDENTIAL_LEAK.f1, 1);
  assert.equal(metrics.perDimension.JAILBREAK.support, 0);
  assert.deepEqual(metrics.macro.dimensionsIncluded, ["CREDENTIAL_LEAK"]);
  assert.deepEqual(metrics.macro.zeroSupportExcluded, ["JAILBREAK"]);
  assert.equal(metrics.micro.truePositive, 1);
  assert.equal(metrics.micro.falsePositive, 1);
  assert.equal(metrics.ratingMae, 1);

  const noPositivePrediction = evaluateJudge(
    [labels[0]],
    [{ ...predictions[0], overallSafety: "SAFE", violatedDimensions: [], rating: 5 }],
    ["CREDENTIAL_LEAK"]
  );
  assert.equal(noPositivePrediction.macro.precision, null);
});

test("labels reject duplicates, invalid dimensions, contradictory safety, and invalid ratings", () => {
  const valid: HumanJudgeLabel = { schemaVersion: 1, exampleId: "a", overallSafety: "SAFE", violatedDimensions: [], rating: 5, labeledAt: "2026-01-01" };
  assert.throws(() => validateHumanLabels([valid, valid]), /Duplicate human label/);
  assert.throws(() => validateHumanLabels([{ ...valid, violatedDimensions: ["NOT_A_DIMENSION"] }]), /unknown dimension/);
  assert.throws(() => validateHumanLabels([{ ...valid, overallSafety: "UNSAFE" }]), /must be SAFE/);
  assert.throws(() => validateHumanLabels([{ ...valid, rating: 6 }]), /integer from 1 to 5/);
  assert.throws(
    () => validateJudgePredictions([{ ...valid, variant: "reconciled", extractedAt: "2026-01-01", violatedDimensions: ["UNKNOWN"] }]),
    /unknown dimension/
  );
  assert.throws(
    () => evaluateJudge([{ ...valid }], []),
    /Missing judge prediction/
  );
});

test("evaluation validators reject unsupported schema versions and malformed prediction rows", () => {
  const label: HumanJudgeLabel = {
    schemaVersion: 1, exampleId: "schema-fixture", overallSafety: "SAFE", violatedDimensions: [], rating: 5, labeledAt: "2026-01-01",
  };
  const prediction: JudgePrediction = {
    schemaVersion: 1, exampleId: "schema-fixture", variant: "reconciled", overallSafety: "SAFE", violatedDimensions: [], rating: 5, extractedAt: "2026-01-01",
  };
  assert.throws(() => validateHumanLabels([{ ...label, schemaVersion: 0 }]), /schemaVersion must be 1/);
  assert.throws(() => validateJudgePredictions([{ ...prediction, schemaVersion: 0 }]), /schemaVersion must be 1/);
  assert.throws(() => validateJudgePredictions([null]), /must be an object/);
});
