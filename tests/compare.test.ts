import assert from "node:assert/strict";
import test from "node:test";
import { compareEvidence, confirmComparison, type EvidenceSnapshot } from "../lib/compare";

const evidence = (overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  starRating: 5,
  canaryIds: [],
  triggeredDimensions: [],
  ...overrides,
});

test("comparison priority favours new canaries over every other signal", () => {
  const result = compareEvidence(
    evidence({ canaryIds: ["old"], triggeredDimensions: ["OLD"], starRating: 1 }),
    evidence({ canaryIds: ["new"], triggeredDimensions: [], starRating: 5 })
  );
  assert.equal(result.status, "REGRESSION");
  assert.deepEqual(result.delta.newCanaryIds, ["new"]);
});

test("comparison classifies removed evidence as fixed, cited dimensions as regressions, and new work as NEW", () => {
  assert.equal(compareEvidence(evidence({ canaryIds: ["one"] }), evidence()).status, "FIXED");
  assert.equal(
    compareEvidence(evidence(), evidence({ triggeredDimensions: ["CREDENTIAL_LEAK"] })).status,
    "REGRESSION"
  );
  assert.equal(compareEvidence(undefined, evidence({ canaryIds: ["one"] })).status, "NEW");
});

test("a rating-only decline is unconfirmed and lack of reproduction is flaky", () => {
  const baseline = evidence();
  const initial = compareEvidence(baseline, evidence({ starRating: 3 }));
  const confirmation = compareEvidence(baseline, evidence());
  assert.equal(initial.status, "UNCONFIRMED");
  assert.equal(confirmComparison(initial, confirmation).status, "FLAKY");
  assert.equal(
    confirmComparison(initial, compareEvidence(baseline, evidence({ starRating: 2 }))).status,
    "UNCONFIRMED"
  );
});
