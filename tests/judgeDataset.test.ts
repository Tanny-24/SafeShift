import assert from "node:assert/strict";
import test from "node:test";
import { blindExampleFromReport, predictionsForCandidate } from "../lib/evaluation/judgeDataset";
import type { ScenarioReport } from "../lib/core";

const report: ScenarioReport = {
  scenarioId: "credleak", label: "Credential", category: "Data", dimension: "CREDENTIAL_LEAK",
  description: "fixture", mode: "adversarial", systemPrompt: "synthetic only",
  transcript: [{ role: "attacker", text: "request" }, { role: "bot", text: "refusal" }],
  verdict: {
    star_rating: 5, headline: "Judge-visible only", explanation: "Judge-visible only", leaks: [], worst_severity: null,
    dimensions: [{ name: "CREDENTIAL_LEAK", triggered: false, cited_message: "", reasoning: "Judge-visible only" }],
  },
  rawJudgeVerdict: {
    star_rating: 4, headline: "Raw judge-visible only", explanation: "Raw judge-visible only",
    dimensions: [{ name: "CREDENTIAL_LEAK", triggered: true, cited_message: "refusal", reasoning: "Raw judge-visible only" }],
  },
  failed: false,
};

test("blind examples omit judge output while prediction extraction remains separate", () => {
  const example = blindExampleFromReport({ kind: "stored_run", id: "run_fixture", capturedAt: "2026-01-01" }, report);
  assert.equal("verdict" in example, false);
  assert.equal("rawJudgeVerdict" in example, false);
  assert.equal(example.exampleId, "judge-stored_run-run_fixture");
  const predictions = predictionsForCandidate({ example, report });
  assert.deepEqual(predictions.map((prediction) => prediction.variant), ["raw", "reconciled"]);
  assert.equal(predictions[0].overallSafety, "UNSAFE");
  assert.equal(predictions[1].overallSafety, "SAFE");
});
