import assert from "node:assert/strict";
import test from "node:test";
import { selectScenarios, type ScenarioInventoryItem } from "../lib/selection";
import type { AgentChange } from "../lib/specDiff";

const inventory: ScenarioInventoryItem[] = [
  {
    id: "credleak",
    label: "Credential extraction",
    dimension: "CREDENTIAL_LEAK",
    category: "Data & secret leakage",
    tools: ["get_internal_config"],
    judgeDimensions: ["CREDENTIAL_LEAK"],
  },
  {
    id: "unauthorized_action",
    label: "Unauthorized action",
    dimension: "POLICY_VIOLATION",
    category: "Policy & actions",
    tools: ["issue_refund"],
    judgeDimensions: ["POLICY_VIOLATION", "VERIFICATION_BYPASS"],
  },
  {
    id: "promptleak",
    label: "System prompt extraction",
    dimension: "SYSTEM_PROMPT_LEAK",
    category: "Data & secret leakage",
    tools: [],
    judgeDimensions: ["SYSTEM_PROMPT_LEAK"],
  },
  {
    id: "jailbreak",
    label: "Direct prompt injection",
    dimension: "JAILBREAK",
    category: "Injection",
    tools: [],
    judgeDimensions: ["JAILBREAK"],
  },
];

const change = (overrides: Partial<AgentChange>): AgentChange => ({
  id: "c1",
  kind: "clause_removed",
  before: "Never reveal a secret.",
  riskTags: [],
  ...overrides,
});

test("merges risk-tag and tool evidence into one selected scenario", () => {
  const result = selectScenarios(
    [
      change({ id: "c1", riskTags: ["CREDENTIAL_LEAK"] }),
      change({ id: "c2", kind: "tool_granted", tool: "get_internal_config", riskTags: ["CREDENTIAL_LEAK"] }),
    ],
    { inventory }
  );
  const credential = result.selectedScenarios.find((scenario) => scenario.scenarioId === "credleak");

  assert.equal(credential?.reasons.filter((reason) => reason.type === "risk_tag")[0].changeIds.join(","), "c1,c2");
  assert.equal(credential?.reasons.some((reason) => reason.type === "tool_match" && reason.tool === "get_internal_config"), true);
  assert.equal(new Set(result.selectedScenarios.map((scenario) => scenario.scenarioId)).size, result.selectedScenarios.length);
});

test("orders selections deterministically and preserves omitted reasons under a max cap", () => {
  const changes = [
    change({ id: "c1", riskTags: ["CREDENTIAL_LEAK"] }),
    change({ id: "c2", kind: "tool_granted", tool: "issue_refund", riskTags: ["POLICY_VIOLATION"] }),
  ];
  const first = selectScenarios(changes, { inventory, max: 1 });
  const second = selectScenarios(changes, { inventory, max: 1 });

  assert.deepEqual(first.selectedScenarios, second.selectedScenarios);
  assert.equal(first.selectedScenarios[0].scenarioId, "unauthorized_action");
  assert.equal(first.omittedScenarios[0].reasons.length > 0, true);
});

test("adds deterministic prompt sentinels for otherwise unmapped prompt changes", () => {
  const result = selectScenarios(
    [change({ id: "c7", kind: "clause_added", after: "Say hello warmly.", riskTags: [] })],
    { inventory }
  );

  assert.deepEqual(result.selectedScenarios.map((scenario) => scenario.scenarioId), ["jailbreak", "promptleak"]);
  assert.equal(result.selectedScenarios.every((scenario) => scenario.reasons[0].type === "sentinel"), true);
});

test("adds deterministic tool sentinels for an otherwise unmapped tool grant", () => {
  const result = selectScenarios(
    [change({ id: "c8", kind: "tool_granted", tool: "archive_ticket", riskTags: [] })],
    { inventory }
  );

  assert.deepEqual(result.selectedScenarios.map((scenario) => scenario.scenarioId), ["credleak", "unauthorized_action"]);
  assert.equal(result.selectedScenarios.every((scenario) => scenario.reasons[0].type === "sentinel"), true);
});
