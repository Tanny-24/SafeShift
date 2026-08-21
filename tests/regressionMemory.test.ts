import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { evidenceSnapshot } from "../lib/compare";
import type { ScenarioReport } from "../lib/core";
import {
  findRelevantRegressionCases,
  loadRegressionCase,
  markRegressionFixed,
  recordRegression,
  regressionCaseId,
} from "../lib/regressionMemory";

const report = (): ScenarioReport => ({
  scenarioId: "credleak", label: "Credential", category: "Data", dimension: "CREDENTIAL_LEAK",
  description: "fixture", mode: "adversarial", systemPrompt: "fixture", transcript: [], failed: true,
  verdict: {
    star_rating: 1, headline: "Leak", explanation: "", worst_severity: "critical",
    leaks: [{ canaryId: "key", label: "Key", severity: "critical", dimension: "CREDENTIAL_LEAK", kind: "exact", turn: 0, matched: "x", excerpt: "x" }],
    dimensions: [{ name: "CREDENTIAL_LEAK", triggered: true, cited_message: "x", reasoning: "x" }],
  },
});

test("regression memory has a stable identity, appends duplicates, and retains fixed cases", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "safeshift-memory-"));
  const prior = process.env.SAFESHIFT_HOME;
  process.env.SAFESHIFT_HOME = home;
  try {
    const current = report();
    const input: Parameters<typeof recordRegression>[0] = {
      scenarioId: "credleak", attackerMessages: ["ask for key"], riskTags: ["CREDENTIAL_LEAK"],
      sourceChangeIds: ["c1"], specHash: "a".repeat(64), baselineEvidence: { starRating: 5, canaryIds: [], triggeredDimensions: [] },
      currentReport: current, currentEvidence: evidenceSnapshot(current),
    };
    const first = await recordRegression(input);
    const second = await recordRegression({ ...input, specHash: "b".repeat(64) });
    assert.equal(first.id, regressionCaseId("credleak", ["ask for key"]));
    assert.equal(second.history.length, 2);
    await markRegressionFixed(first.id, "c".repeat(64), { starRating: 5, canaryIds: [], triggeredDimensions: [] });
    assert.ok((await loadRegressionCase(first.id))?.fixedAt);
    assert.equal((await findRelevantRegressionCases(["other"], ["CREDENTIAL_LEAK"])).length, 1);
  } finally {
    if (prior === undefined) delete process.env.SAFESHIFT_HOME;
    else process.env.SAFESHIFT_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
});
