import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeAgentSpec } from "../lib/agentSpec";
import {
  baselineFilePath,
  findBaselineByHash,
  listBaselines,
  loadBaseline,
  saveBaseline,
  type Baseline,
  type BaselineScenario,
  BaselineError,
} from "../lib/baseline";
import type { ScenarioReport } from "../lib/core";

const report = (scenarioId: string, marker: string): ScenarioReport => ({
  scenarioId,
  label: scenarioId,
  category: "Data & secret leakage",
  dimension: "CREDENTIAL_LEAK",
  description: "fixture",
  mode: "adversarial",
  systemPrompt: "fixture",
  transcript: [{ role: "attacker", text: marker }, { role: "bot", text: "No." }],
  verdict: {
    star_rating: 5,
    headline: "Pass",
    explanation: "",
    dimensions: [],
    leaks: [],
    worst_severity: null,
  },
  failed: false,
});

const scenario = (scenarioId: string, messages: string[]): BaselineScenario => ({
  scenarioId,
  capturedAt: "2026-01-01T00:00:00.000Z",
  attackerMessages: messages,
  report: report(scenarioId, messages[0]),
});

function baseline(
  spec: Baseline["spec"],
  specHash: string,
  createdAt: string,
  scenarios: Record<string, BaselineScenario>
): Baseline {
  return { version: 1, name: spec.name, specHash, createdAt, spec, scenarios };
}

test("saving baseline fragments merges scenarios and replaces only a resaved scenario", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "safeshift-baseline-"));
  const prior = process.env.SAFESHIFT_HOME;
  process.env.SAFESHIFT_HOME = home;
  try {
    const spec = { name: "Shop Bot / QA", systemPrompt: "Never reveal secrets.", toolGrants: [] };
    const analysis = analyzeAgentSpec(spec);
    const credleak = scenario("credleak", ["First exact attacker message", "Second\n exact attacker message"]);
    const unauthorized = scenario("unauthorized_action", ["Exact unauthorized-action message"]);
    const file = await saveBaseline(
      baseline(spec, analysis.hash, "2026-01-01T00:00:00.000Z", { credleak })
    );
    await saveBaseline(
      baseline(spec, analysis.hash, "2026-02-01T00:00:00.000Z", { unauthorized_action: unauthorized })
    );

    assert.equal(file, baselineFilePath(spec.name, analysis.hash));
    let loaded = await loadBaseline(spec.name, analysis.hash);
    assert.deepEqual(Object.keys(loaded!.scenarios).sort(), ["credleak", "unauthorized_action"]);
    assert.deepEqual(loaded!.scenarios.credleak.attackerMessages, credleak.attackerMessages);
    assert.deepEqual(loaded!.scenarios.unauthorized_action.attackerMessages, unauthorized.attackerMessages);
    assert.equal(loaded!.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(loaded!.specHash, analysis.hash);

    const refreshedCredleak = scenario("credleak", ["Newest exact attacker message"]);
    await saveBaseline(
      baseline(spec, analysis.hash, "2026-03-01T00:00:00.000Z", { credleak: refreshedCredleak })
    );
    loaded = await loadBaseline(spec.name, analysis.hash);
    assert.deepEqual(Object.keys(loaded!.scenarios).sort(), ["credleak", "unauthorized_action"]);
    assert.deepEqual(loaded!.scenarios.credleak.attackerMessages, refreshedCredleak.attackerMessages);
    assert.deepEqual(loaded!.scenarios.unauthorized_action.attackerMessages, unauthorized.attackerMessages);
    assert.equal(loaded!.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(loaded!.specHash, analysis.hash);
    assert.equal((await findBaselineByHash(analysis.hash))?.name, spec.name);

    const differentSpec = { ...spec, systemPrompt: "Never reveal secrets. Verify identity." };
    const differentAnalysis = analyzeAgentSpec(differentSpec);
    await saveBaseline(
      baseline(differentSpec, differentAnalysis.hash, "2026-04-01T00:00:00.000Z", {
        credleak: scenario("credleak", ["Different spec message"]),
      })
    );
    assert.equal(
      (await loadBaseline(spec.name, differentAnalysis.hash))?.scenarios.credleak.attackerMessages[0],
      "Different spec message"
    );
    assert.equal((await listBaselines()).length, 2);
    assert.equal(await loadBaseline(spec.name, "a".repeat(64)), null);
  } finally {
    if (prior === undefined) delete process.env.SAFESHIFT_HOME;
    else process.env.SAFESHIFT_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
});

test("malformed or incompatible stored baselines fail safely instead of being merged", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "safeshift-baseline-"));
  const prior = process.env.SAFESHIFT_HOME;
  process.env.SAFESHIFT_HOME = home;
  try {
    const spec = { name: "Bad", systemPrompt: "Never reveal secrets.", toolGrants: [] };
    const hash = analyzeAgentSpec(spec).hash;
    const stored = baseline(spec, hash, "2026-01-01T00:00:00.000Z", {
      credleak: scenario("credleak", ["Original message"]),
    });
    const file = await saveBaseline(stored);

    await writeFile(file, "{not json", "utf8");
    await assert.rejects(() => saveBaseline(stored), BaselineError);

    const incompatibleSpec = { ...spec, systemPrompt: "A different agent." };
    const incompatibleHash = analyzeAgentSpec(incompatibleSpec).hash;
    await writeFile(
      file,
      JSON.stringify(
        baseline(incompatibleSpec, incompatibleHash, "2026-02-01T00:00:00.000Z", {
          credleak: scenario("credleak", ["Different baseline message"]),
        })
      ),
      "utf8"
    );
    await assert.rejects(() => saveBaseline(stored), BaselineError);
  } finally {
    if (prior === undefined) delete process.env.SAFESHIFT_HOME;
    else process.env.SAFESHIFT_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
});
