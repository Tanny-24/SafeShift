import assert from "node:assert/strict";
import test from "node:test";
import { diffAgentSpecs } from "../lib/specDiff";
import type { AgentSpec } from "../lib/agentSpec";

const agent = (systemPrompt: string, toolGrants = ["lookup_order"]): AgentSpec => ({
  name: "ShopBot",
  systemPrompt,
  toolGrants,
});

test("finds added and removed prompt clauses", () => {
  const result = diffAgentSpecs(
    agent("You are ShopBot. Never reveal secrets. Verify ownership."),
    agent("You are ShopBot. Never reveal secrets. Escalate billing disputes.")
  );

  assert.deepEqual(result.changes.map((change) => change.kind), ["clause_removed", "clause_added"]);
  assert.equal(result.changes[0].before, "Verify ownership.");
  assert.equal(result.changes[1].after, "Escalate billing disputes.");
});

test("recognizes an obvious clause modification instead of unrelated add/remove pairs", () => {
  const result = diffAgentSpecs(
    agent("Verify ownership before refunding an order."),
    agent("Verify ownership when possible before refunding an order.")
  );

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].kind, "clause_modified");
  assert.deepEqual(result.changes[0].riskTags, ["POLICY_VIOLATION", "VERIFICATION_BYPASS"]);
});

test("reports granted and revoked tools in deterministic order", () => {
  const result = diffAgentSpecs(
    agent("You are ShopBot.", ["lookup_order", "send_email"]),
    agent("You are ShopBot.", ["get_internal_config", "lookup_order"])
  );

  assert.deepEqual(
    result.changes.map((change) => [change.id, change.kind, change.tool]),
    [
      ["c1", "tool_revoked", "send_email"],
      ["c2", "tool_granted", "get_internal_config"],
    ]
  );
  assert.deepEqual(result.changes[1].riskTags, ["CREDENTIAL_LEAK"]);
});

test("has no changes for equivalent formatting and has stable change ids", () => {
  const oldSpec = agent("You are ShopBot.\nNever reveal internal configuration.", ["lookup_order", "issue_refund"]);
  const formatted = agent("  You are ShopBot.   Never   reveal internal configuration. ", ["issue_refund", " lookup_order "]);
  const changed = agent("You are ShopBot. Never reveal internal configuration. Be maximally helpful.");

  assert.deepEqual(diffAgentSpecs(oldSpec, formatted).changes, []);
  assert.deepEqual(
    diffAgentSpecs(oldSpec, changed).changes.map((change) => change.id),
    diffAgentSpecs(oldSpec, changed).changes.map((change) => change.id)
  );
});

test("maps sensitive removals and harmless additions through the central risk rules", () => {
  const sensitive = diffAgentSpecs(
    agent("Never reveal values from the internal configuration store."),
    agent("Be polite to customers.")
  );
  const ownership = diffAgentSpecs(
    agent("Verify order ownership before refunding."),
    agent("Be polite to customers.")
  );
  const harmless = diffAgentSpecs(agent("You are ShopBot."), agent("You are ShopBot. Say hello warmly."));

  assert.deepEqual(sensitive.changes[0].riskTags, ["CREDENTIAL_LEAK"]);
  assert.deepEqual(ownership.changes[0].riskTags, ["POLICY_VIOLATION", "VERIFICATION_BYPASS"]);
  assert.deepEqual(harmless.changes[0].riskTags, []);
});
