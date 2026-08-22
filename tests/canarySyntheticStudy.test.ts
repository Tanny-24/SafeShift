import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTHETIC_STUDY_CATEGORIES,
  SYNTHETIC_STUDY_PER_CATEGORY,
  SYNTHETIC_STUDY_TOTAL,
  buildSyntheticKnownCleanStudy,
  runPartialLengthSensitivity,
  runPositiveControlSanityCheck,
  sanitizeSyntheticStudySummary,
  syntheticStudyFingerprint,
} from "../lib/evaluation/canarySyntheticStudy";
import { evaluateCanaryFp, validateCleanCorpus } from "../lib/evaluation/canaryFp";
import type { Canary } from "../lib/secrets";

const canaries: Canary[] = [
  { id: "alpha", label: "Synthetic alpha", value: "SSFP-ALPHA-6Q9W-2T4R", severity: "critical", dimension: "CREDENTIAL_LEAK", partialLength: 12 },
  { id: "beta", label: "Synthetic beta", value: "SSFP-BETA-8M3K-7V2X-9P5L", severity: "high", dimension: "SYSTEM_PROMPT_LEAK", partialLength: 14 },
  { id: "gamma", label: "Synthetic gamma", value: "SSFP-GAMMA-4H8D-1N6C", severity: "medium", dimension: "PII_SPILLAGE" },
];

test("synthetic study has deterministic ids, exact quotas, and valid hard negatives", () => {
  const records = buildSyntheticKnownCleanStudy(canaries);
  assert.equal(records.length, SYNTHETIC_STUDY_TOTAL);
  assert.equal(new Set(records.map((record) => record.exampleId)).size, SYNTHETIC_STUDY_TOTAL);
  for (const category of SYNTHETIC_STUDY_CATEGORIES) {
    assert.equal(records.filter((record) => record.category === category).length, SYNTHETIC_STUDY_PER_CATEGORY);
  }
  assert.equal(records.filter((record) => record.hardNegative).length, 30);
  assert.equal(validateCleanCorpus(records, canaries).rejected.length, 0);
  const sensitivityCanaries = canaries.map((canary) => ({ ...canary, partialLength: 6 }));
  assert.equal(validateCleanCorpus(records, sensitivityCanaries).rejected.length, 0);
  assert.equal(syntheticStudyFingerprint(canaries), syntheticStudyFingerprint(canaries));
});

test("positive controls remain separate from the FPR denominator and all detect", () => {
  const records = buildSyntheticKnownCleanStudy(canaries);
  const result = evaluateCanaryFp({ studyId: "synthetic", canarySource: "fixture", records, canaries, measuredAt: "2026-08-23" });
  const control = runPositiveControlSanityCheck(canaries);
  assert.equal(result.validCleanExamples, SYNTHETIC_STUDY_TOTAL);
  assert.equal(result.summary.exampleLevel.denominator, SYNTHETIC_STUDY_TOTAL);
  assert.equal(control.total, 9);
  assert.equal(control.detected, 9);
  assert.deepEqual(control.missed, []);
});

test("sensitivity is non-production, ordered, and sanitized summary omits raw text and values", () => {
  const records = buildSyntheticKnownCleanStudy(canaries);
  const result = evaluateCanaryFp({ studyId: "synthetic", canarySource: "fixture", records, canaries, measuredAt: "2026-08-23" });
  const sensitivity = runPartialLengthSensitivity(records, canaries);
  assert.deepEqual(sensitivity.map((entry) => entry.partialLength), [6, 8, 10, 12]);
  assert.ok(sensitivity.every((entry) => entry.validCleanExamples === SYNTHETIC_STUDY_TOTAL && entry.rejectedExamples === 0));
  const summary = sanitizeSyntheticStudySummary({ result, canaries, positiveControl: runPositiveControlSanityCheck(canaries), sensitivity });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(records[0].text), false);
  assert.equal(serialized.includes(canaries[0].value), false);
  assert.equal(summary.result.exampleLevel.count, 0);
  assert.ok(summary.result.exampleLevel.wilson95!.upper > 0);
});
