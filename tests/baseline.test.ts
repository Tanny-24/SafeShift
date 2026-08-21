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
  BaselineError,
} from "../lib/baseline";
import type { ScenarioReport } from "../lib/core";

const report = (): ScenarioReport => ({
  scenarioId: "credleak",
  label: "Credential / API key extraction",
  category: "Data & secret leakage",
  dimension: "CREDENTIAL_LEAK",
  description: "fixture",
  mode: "adversarial",
  systemPrompt: "fixture",
  transcript: [{ role: "attacker", text: "First exact attacker message" }, { role: "bot", text: "No." }],
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

test("baselines round-trip exact attacker messages and can be found by hash", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "safeshift-baseline-"));
  const prior = process.env.SAFESHIFT_HOME;
  process.env.SAFESHIFT_HOME = home;
  try {
    const spec = { name: "Shop Bot / QA", systemPrompt: "Never reveal secrets.", toolGrants: [] };
    const analysis = analyzeAgentSpec(spec);
    const baseline: Baseline = {
      version: 1,
      name: spec.name,
      specHash: analysis.hash,
      createdAt: "2026-01-01T00:00:00.000Z",
      spec,
      scenarios: {
        credleak: {
          scenarioId: "credleak",
          capturedAt: "2026-01-01T00:00:00.000Z",
          attackerMessages: ["First exact attacker message", "Second\n exact attacker message"],
          report: report(),
        },
      },
    };
    const file = await saveBaseline(baseline);
    assert.equal(file, baselineFilePath(spec.name, analysis.hash));
    const loaded = await loadBaseline(spec.name, analysis.hash);
    assert.deepEqual(loaded?.scenarios.credleak.attackerMessages, baseline.scenarios.credleak.attackerMessages);
    assert.equal((await findBaselineByHash(analysis.hash))?.name, spec.name);
    assert.equal((await listBaselines()).length, 1);
    assert.equal(await loadBaseline(spec.name, "a".repeat(64)), null);
  } finally {
    if (prior === undefined) delete process.env.SAFESHIFT_HOME;
    else process.env.SAFESHIFT_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
});

test("malformed baseline files are rejected rather than silently used", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "safeshift-baseline-"));
  const prior = process.env.SAFESHIFT_HOME;
  process.env.SAFESHIFT_HOME = home;
  try {
    const hash = "b".repeat(64);
    const file = baselineFilePath("Bad", hash);
    await writeFile(file, "{not json", "utf8").catch(async () => {
      // Ensure the target directory exists without relying on implementation internals.
      await saveBaseline({
        version: 1,
        name: "Bad",
        specHash: hash,
        createdAt: "2026-01-01T00:00:00.000Z",
        spec: { name: "Bad", systemPrompt: "x", toolGrants: [] },
        scenarios: {},
      });
      await writeFile(file, "{not json", "utf8");
    });
    await assert.rejects(() => loadBaseline("Bad", hash), BaselineError);
  } finally {
    if (prior === undefined) delete process.env.SAFESHIFT_HOME;
    else process.env.SAFESHIFT_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
});
