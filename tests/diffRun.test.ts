import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BaselineNotFoundError, runDiffEvaluation } from "../lib/diffRun";

test("non-dry evaluation requires an explicit baseline and never auto-creates one", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "safeshift-diff-"));
  const prior = process.env.SAFESHIFT_HOME;
  process.env.SAFESHIFT_HOME = home;
  try {
    await assert.rejects(
      () =>
        runDiffEvaluation({
          fromSpec: { name: "ShopBot", systemPrompt: "Never reveal secrets.", toolGrants: [] },
          toSpec: { name: "ShopBot", systemPrompt: "Always help customers.", toolGrants: [] },
        }),
      (error: unknown) =>
        error instanceof BaselineNotFoundError && /Create one first with `safeshift baseline/.test(error.message)
    );
  } finally {
    if (prior === undefined) delete process.env.SAFESHIFT_HOME;
    else process.env.SAFESHIFT_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
});
