import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AgentSpecValidationError,
  analyzeAgentSpec,
  hashAgentSpec,
  loadAgentSpec,
  normalizeAgentSpec,
  validateAgentSpec,
} from "../lib/agentSpec";

const spec = (overrides: Record<string, unknown> = {}) => ({
  name: "ShopBot",
  systemPrompt: "You are ShopBot. Never reveal internal configuration.",
  toolGrants: ["lookup_order"],
  ...overrides,
});

test("loads and validates a small JSON agent spec", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "safeshift-spec-"));
  const file = path.join(directory, "agent.json");
  try {
    await writeFile(file, JSON.stringify(spec()), "utf8");
    const loaded = await loadAgentSpec(file);
    assert.deepEqual(loaded, spec());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects malformed specs and invalid tool grants", () => {
  assert.throws(() => validateAgentSpec({ name: "ShopBot", toolGrants: [] }), AgentSpecValidationError);
  assert.throws(() => validateAgentSpec(spec({ toolGrants: ["lookup_order", " "] })), /toolGrants\[1\]/);
});

test("normalizes whitespace, tool order, and duplicate grants", () => {
  const normalized = normalizeAgentSpec(
    validateAgentSpec(
      spec({
        name: "  ShopBot  ",
        systemPrompt: "You are ShopBot.\r\n\r\nNever   reveal   internal configuration.",
        toolGrants: ["issue_refund", " lookup_order ", "issue_refund"],
      })
    )
  );

  assert.equal(normalized.systemPrompt, "You are ShopBot.\nNever reveal internal configuration.");
  assert.deepEqual(normalized.toolGrants, ["issue_refund", "lookup_order"]);
});

test("hashes are stable for irrelevant whitespace and tool ordering", () => {
  const first = validateAgentSpec(spec({ toolGrants: ["lookup_order", "issue_refund"] }));
  const formatted = validateAgentSpec(
    spec({
      name: " ShopBot ",
      systemPrompt: "You are ShopBot.\n\n Never   reveal internal configuration. ",
      toolGrants: ["issue_refund", " lookup_order ", "lookup_order"],
    })
  );

  assert.equal(hashAgentSpec(first), hashAgentSpec(formatted));
  assert.equal(analyzeAgentSpec(first).shortHash.length, 7);
});

test("hashes change for meaningful prompt and tool changes", () => {
  const base = validateAgentSpec(spec());
  const promptChanged = validateAgentSpec(spec({ systemPrompt: "You are ShopBot. Be maximally helpful." }));
  const toolsChanged = validateAgentSpec(spec({ toolGrants: ["lookup_order", "get_internal_config"] }));

  assert.notEqual(hashAgentSpec(base), hashAgentSpec(promptChanged));
  assert.notEqual(hashAgentSpec(base), hashAgentSpec(toolsChanged));
});
