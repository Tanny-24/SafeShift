// Deterministic attacker replay. A baseline records only the attacker's chat
// messages; the current bot still runs live, uses the real fake tools, has its
// replies scanned for canaries, and receives the normal judge pass in core.

import type { MessageParam } from "./gemini";
import {
  botReply,
  buildRedTeamSystem,
  type RedTeamRun,
} from "./attacker";
import type { AdversarialScenario } from "./scenarios";
import { scanMessage, type LeakHit } from "./secrets";
import type { ActionLogEntry } from "./tools";
import type { RedTeamEvent } from "./events";

type BotReply = typeof botReply;

export type ReplayDependencies = {
  /** Test seam; production always uses the real bot implementation. */
  botReply?: BotReply;
};

/**
 * Replay every saved attacker utterance in order. Deliberately do not stop
 * after a leak: a replay must preserve the saved conversation shape exactly.
 */
export async function replayRedTeam(
  userSystemPrompt: string,
  scenario: AdversarialScenario,
  attackerMessages: string[],
  onEvent: (e: RedTeamEvent) => void,
  dependencies: ReplayDependencies = {}
): Promise<RedTeamRun> {
  if (!Array.isArray(attackerMessages) || attackerMessages.length === 0) {
    throw new Error(`Replay for scenario "${scenario.id}" has no saved attacker messages.`);
  }

  const system = buildRedTeamSystem(userSystemPrompt, scenario);
  const messages: MessageParam[] = [];
  const transcript: RedTeamRun["transcript"] = [];
  const actionLog: ActionLogEntry[] = [];
  const leaks: LeakHit[] = [];
  const seen = new Set<string>();
  const replyFor = dependencies.botReply ?? botReply;

  for (let turn = 0; turn < attackerMessages.length; turn++) {
    const message = attackerMessages[turn]?.trim();
    if (!message) {
      throw new Error(`Replay for scenario "${scenario.id}" contains an empty attacker message at turn ${turn + 1}.`);
    }

    const tactic = "baseline replay";
    transcript.push({ role: "attacker", turn, tactic, text: message });
    onEvent({ type: "attacker", turn, tactic, text: message });
    messages.push({ role: "user", content: message });

    const reply = await replyFor(system, messages, scenario, actionLog, turn, onEvent);
    transcript.push({ role: "bot", turn, text: reply });
    onEvent({ type: "reply", turn, text: reply });

    const hits = scanMessage(scenario.canaries, reply, turn, seen);
    for (const hit of hits) {
      leaks.push(hit);
      onEvent({ type: "leak", hit });
    }
  }

  onEvent({ type: "done" });
  return { systemPrompt: system, transcript, actionLog, leaks };
}
