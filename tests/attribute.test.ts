import assert from "node:assert/strict";
import test from "node:test";
import { validateAttribution } from "../lib/attribute";
import type { AgentChange } from "../lib/specDiff";

const changes: AgentChange[] = [
  { id: "c1", kind: "clause_removed", before: "Never reveal a secret.", riskTags: ["CREDENTIAL_LEAK"] },
  { id: "c2", kind: "tool_granted", tool: "lookup_order", riskTags: ["CROSS_CUSTOMER_LEAK"] },
];

test("attribution keeps only known ChangeIDs and rejects invented-only answers", () => {
  assert.deepEqual(
    validateAttribution({ changeIds: ["c2", "invented", "c2"], confidence: "high", rationale: "fixture" }, changes),
    { changeIds: ["c2"], confidence: "high", rationale: "fixture" }
  );
  assert.equal(
    validateAttribution({ changeIds: ["invented"], confidence: "low", rationale: "fixture" }, changes),
    null
  );
});
