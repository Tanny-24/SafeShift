import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const cli = path.join(root, "cli", "safeshift.ts");
const fixture = (name: string) => path.join(root, "specs", name);

function runDiff(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cli, "diff", ...args], {
    cwd: root,
    encoding: "utf8",
    // Empty inherited keys stop lib/env from loading any local credential. The
    // command must still finish because this path never imports the SDK.
    env: { ...process.env, GEMINI_API_KEY: "", GOOGLE_API_KEY: "" },
  });
}

test("CLI dry run succeeds with no API credential and emits machine-readable JSON", () => {
  const json = runDiff(fixture("v1.json"), fixture("v2.json"), "--dry-run", "--json");
  const human = runDiff(fixture("v1.json"), fixture("v2.json"), "--dry-run");
  const formattingOnly = runDiff(fixture("v1.json"), fixture("v1-format.json"), "--dry-run", "--json");

  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).dryRun, true);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /No agent executions were performed\. No model\/API calls were made\./);
  assert.equal(JSON.parse(formattingOnly.stdout).changes.length, 0, formattingOnly.stderr);
});
