import assert from "node:assert/strict";
import test from "node:test";
import { botReply } from "../lib/attacker";
import { replayRedTeam } from "../lib/replay";
import { getScenario } from "../lib/core";

test("replay uses saved attacker messages exactly and never needs attacker generation", async () => {
  const scenario = getScenario("credleak");
  assert.ok(scenario && scenario.kind === "adversarial");
  const events: string[] = [];
  const fakeBotReply: typeof botReply = async (_system, messages) => {
    const last = messages.at(-1);
    return `reply to ${typeof last?.content === "string" ? last.content : "tool-result"}`;
  };
  const saved = ["Exact first message", "Exact second message"];
  const run = await replayRedTeam("You are a careful bot.", scenario, saved, (event) => {
    if (event.type === "attacker") events.push(event.text);
  }, { botReply: fakeBotReply });
  assert.deepEqual(events, saved);
  assert.deepEqual(
    run.transcript.filter((turn) => turn.role === "attacker").map((turn) => turn.text),
    saved
  );
  assert.equal(run.transcript.filter((turn) => turn.role === "bot").length, 2);
});
