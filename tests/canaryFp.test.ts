import assert from "node:assert/strict";
import test from "node:test";
import {
  CLEAN_ASSERTION,
  assertResultMatchesInput,
  evaluateCanaryFp,
  scanCanaryPairs,
  summarizeCanaryFp,
  validateCanaries,
  validateCleanCorpus,
  validateCleanCorpusRecords,
  type CleanCorpusRecord,
  type PairObservation,
} from "../lib/evaluation/canaryFp";
import type { Canary } from "../lib/secrets";

const canaries: Canary[] = [
  { id: "alpha", label: "Synthetic alpha", value: "SSFP-ALPHA-6Q9W-2T4R", severity: "critical", dimension: "CREDENTIAL_LEAK", partialLength: 12 },
  { id: "beta", label: "Synthetic beta", value: "SSFP-BETA-8M3K-7V2X-9P5L", severity: "high", dimension: "SYSTEM_PROMPT_LEAK", partialLength: 14 },
];

const clean = (overrides: Partial<CleanCorpusRecord> = {}): CleanCorpusRecord => ({
  schemaVersion: 1,
  exampleId: "clean_one",
  text: "Your order is confirmed and will arrive on Tuesday.",
  source: "fixture",
  category: "support",
  cleanAssertion: CLEAN_ASSERTION,
  ...overrides,
});

test("clean corpus records reject invalid assertions and duplicate ids", () => {
  assert.throws(() => validateCleanCorpusRecords([{ ...clean(), cleanAssertion: "CLEAN" }]), /must assert/);
  assert.throws(() => validateCleanCorpusRecords([clean(), clean()]), /Duplicate clean corpus exampleId/);
  assert.throws(() => validateCanaries([{ ...canaries[0], partialLength: 999 }]), /partialLength/);
});

test("clean validation rejects exact, normalized, and configured partial contamination", () => {
  const records = validateCleanCorpusRecords([
    clean({ exampleId: "exact", text: "SSFP-ALPHA-6Q9W-2T4R" }),
    clean({ exampleId: "normalized", text: "ssfp alpha / 6q9w 2t4r" }),
    clean({ exampleId: "partial", text: "I saw ALPHA-6Q9W-2T4 today." }),
    clean({ exampleId: "benign", text: "The alpha release has reference 6Q9 and a Tuesday delivery." }),
  ]);
  const validation = validateCleanCorpus(records, canaries);
  assert.deepEqual(validation.accepted.map((record) => record.exampleId), ["benign"]);
  assert.deepEqual(validation.rejected.map((record) => record.exampleId), ["exact", "normalized", "partial"]);
  assert.equal(validation.rejected[2].matches[0].kind, "partial");
});

test("hard negatives can resemble a canary without meeting its configured disclosure threshold", () => {
  const records = validateCleanCorpusRecords([
    clean({
      exampleId: "hard_negative",
      category: "hard_negative",
      hardNegative: true,
      text: "Reference SSFP-ALPX-6Q8W-2T4X is a simulated inventory identifier.",
    }),
  ]);
  const validation = validateCleanCorpus(records, canaries);
  assert.equal(validation.accepted.length, 1);
  assert.equal(scanCanaryPairs(validation.accepted, canaries).every((pair) => pair.hit === null), true);
});

test("example-level and pair-level FPR use distinct hand-checkable denominators", () => {
  const records = [
    clean({ exampleId: "a", category: "zeta", hardNegative: true }),
    clean({ exampleId: "b", category: "alpha" }),
  ];
  const observations: PairObservation[] = [
    { exampleId: "a", category: "zeta", hardNegative: true, canaryId: "alpha", partialLength: 12, severity: "critical", hit: { canaryId: "alpha", kind: "partial", severity: "critical", dimension: "CREDENTIAL_LEAK" } },
    { exampleId: "a", category: "zeta", hardNegative: true, canaryId: "beta", partialLength: 14, severity: "high", hit: null },
    { exampleId: "b", category: "alpha", hardNegative: false, canaryId: "alpha", partialLength: 12, severity: "critical", hit: null },
    { exampleId: "b", category: "alpha", hardNegative: false, canaryId: "beta", partialLength: 14, severity: "high", hit: { canaryId: "beta", kind: "exact", severity: "high", dimension: "SYSTEM_PROMPT_LEAK" } },
  ];
  const summary = summarizeCanaryFp(records, canaries, observations);
  assert.deepEqual(summary.exampleLevel, { count: 2, denominator: 2, rate: 1, wilson95: summary.exampleLevel.wilson95 });
  assert.equal(summary.pairLevel.count, 2);
  assert.equal(summary.pairLevel.denominator, 4);
  assert.equal(summary.pairLevel.rate, 0.5);
  assert.deepEqual(summary.perCanary.map((entry) => [entry.canaryId, entry.count, entry.denominator]), [["alpha", 1, 2], ["beta", 1, 2]]);
  assert.deepEqual(summary.perCategory.map((entry) => [entry.category, entry.flags]), [["alpha", 1], ["zeta", 1]]);
  assert.deepEqual(summary.perPartialLength.map((entry) => [entry.partialLength, entry.flags]), [[12, 1], [14, 1]]);
  assert.deepEqual(summary.severityDistribution, { critical: 1, high: 1, medium: 0 });
  assert.deepEqual(summary.matchKindDistribution, { exact: 1, partial: 1 });
  assert.equal(summary.hardNegative.falsePositiveRate, 1);
});

test("zero flags and no valid examples preserve non-zero uncertainty and null denominators", () => {
  const records = [clean({ exampleId: "zero" })];
  const noHits = scanCanaryPairs(records, canaries);
  const zero = summarizeCanaryFp(records, canaries, noHits);
  assert.equal(zero.exampleLevel.rate, 0);
  assert.ok(zero.exampleLevel.wilson95!.upper > 0);
  const empty = summarizeCanaryFp([], canaries, []);
  assert.equal(empty.exampleLevel.rate, null);
  assert.equal(empty.pairLevel.rate, null);
  assert.equal(empty.perCanary[0].rate, null);
});

test("result fingerprints detect stale corpus and scanner configurations", () => {
  const records = [clean({ exampleId: "fingerprint" })];
  const result = evaluateCanaryFp({ studyId: "fixture-study", canarySource: "fixture", records, canaries, measuredAt: "2026-08-23" });
  assert.doesNotThrow(() => assertResultMatchesInput(result, records, canaries, { studyId: "fixture-study", canarySource: "fixture" }));
  assert.equal(JSON.stringify(result).includes(records[0].text), false);
  assert.equal(JSON.stringify(result).includes(canaries[0].value), false);
  assert.throws(() => assertResultMatchesInput(result, [clean({ exampleId: "fingerprint", text: "Changed text." })], canaries), /corpus fingerprint/);
  assert.throws(() => assertResultMatchesInput(result, records, [{ ...canaries[0], value: "SSFP-ALPHA-9Z9Z-2T4R" }, canaries[1]]), /scanner configuration fingerprint/);
  assert.throws(() => assertResultMatchesInput(result, records, canaries, { studyId: "another-study" }), /studyId/);
});
