import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendCollectedCorpusRecord,
  appendCorpusCollectionAttempt,
  collectionKey,
  corpusRecordId,
  makeCorpusRecord,
  readCollectedCorpusRecords,
  summarizeBlindJudgeCorpus,
} from "../lib/evaluation/corpus";
import { writeJsonlAtomic } from "../lib/evaluation/jsonl";
import { blindExampleFromReport } from "../lib/evaluation/judgeDataset";
import type { ScenarioReport } from "../lib/core";

const specHash = "a".repeat(64);
const report: ScenarioReport = {
  scenarioId: "credleak", label: "Credential leak", category: "Data", dimension: "CREDENTIAL_LEAK",
  description: "fixture", mode: "adversarial", systemPrompt: "synthetic only",
  transcript: [{ role: "attacker", text: "request" }, { role: "tool", tool: "lookup_order", input: {} }, { role: "bot", text: "refusal" }],
  verdict: { star_rating: 5, headline: "hidden", explanation: "hidden", leaks: [], worst_severity: null,
    dimensions: [{ name: "CREDENTIAL_LEAK", triggered: false, cited_message: "", reasoning: "hidden" }] },
  failed: false,
};

function record() {
  return makeCorpusRecord({
    agentSpec: { hash: specHash, name: "Fixture", toolGrants: ["lookup_order"] },
    scenarioId: "credleak",
    report,
    collectedAt: "2026-08-23T00:00:00.000Z",
  });
}

test("corpus record ids and configuration keys are stable and reject mismatched reports", () => {
  assert.equal(collectionKey(specHash, "credleak"), collectionKey(specHash, "credleak"));
  assert.notEqual(collectionKey(specHash, "credleak"), collectionKey(specHash, "jailbreak"));
  assert.equal(corpusRecordId(specHash, "credleak"), corpusRecordId(specHash, "credleak"));
  assert.throws(() => makeCorpusRecord({
    agentSpec: { hash: specHash, name: "Fixture", toolGrants: [] },
    scenarioId: "promptleak",
    report,
  }), /does not match/);
});

test("corpus persists atomically, deduplicates completed configurations, and keeps failures separate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "safeshift-corpus-"));
  const file = path.join(directory, "corpus.jsonl");
  const attempts = path.join(directory, "attempts.jsonl");
  const labels = path.join(directory, "labels.jsonl");
  await writeJsonlAtomic(labels, [{ exampleId: "human-only", overallSafety: "SAFE" }]);
  await appendCorpusCollectionAttempt({
    schemaVersion: 1, attemptId: "attempt_failure", collectionKey: collectionKey(specHash, "jailbreak"),
    attemptedAt: "2026-08-23T00:00:00.000Z", agentSpecHash: specHash, scenarioId: "jailbreak",
    outcome: "failure", error: { kind: "network", message: "timeout" },
  }, attempts);
  assert.equal((await readCollectedCorpusRecords(file)).length, 0);
  const first = await appendCollectedCorpusRecord(record(), file);
  const second = await appendCollectedCorpusRecord(record(), file);
  assert.equal(first.added, true);
  assert.equal(second.added, false);
  assert.equal((await readCollectedCorpusRecords(file)).length, 1);
  assert.match(await readFile(file, "utf8"), /corpus_/);
  assert.match(await readFile(attempts, "utf8"), /timeout/);
  assert.deepEqual(JSON.parse((await readFile(labels, "utf8")).trim()), { exampleId: "human-only", overallSafety: "SAFE" });
  // The corpus append API requires a full successful report, so failures stay
  // as separate metadata and do not alter a pre-existing label file.
  assert.equal((await readCollectedCorpusRecords(file))[0].report.scenarioId, "credleak");
});

test("objective composition is deterministic and never reads a verdict", () => {
  const example = blindExampleFromReport({
    kind: "collection", id: "corpus_fixture", capturedAt: "2026-08-23",
    agentSpec: { hash: specHash, name: "Fixture", toolGrants: ["lookup_order"] },
  }, report);
  const composition = summarizeBlindJudgeCorpus([example]);
  assert.equal(composition.totalExamples, 1);
  assert.deepEqual(composition.sourceCounts, { collection: 1 });
  assert.deepEqual(composition.dimensionCounts, [{ dimension: "CREDENTIAL_LEAK", count: 1 }]);
  assert.deepEqual(composition.agentSpecCounts, [{ hash: specHash, name: "Fixture", count: 1 }]);
  assert.deepEqual(composition.toolActivity, { examplesWithTools: 1, totalToolTurns: 1 });
  assert.equal("verdict" in example, false);
});
