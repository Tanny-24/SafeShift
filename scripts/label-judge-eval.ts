#!/usr/bin/env node
// Blind local annotation CLI. It only reads examples and labels; it never
// opens the judge-predictions file or a report verdict.

import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readJsonl, writeJsonlAtomic } from "../lib/evaluation/jsonl";
import { supportedDimensionNames, validateHumanLabels } from "../lib/evaluation/judgeMetrics";
import { safeShiftHome } from "../lib/store";
import type { BlindJudgeExample, HumanJudgeLabel, OverallSafety } from "../lib/evaluation/types";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function render(example: BlindJudgeExample, position: number, total: number): string {
  const transcript = example.transcript.map((turn) => {
    if (turn.role === "tool") return `TOOL ${turn.tool}: ${turn.output ?? ""}`;
    if (turn.role === "leak") return `CANARY ${turn.label} [${turn.severity}]: ${turn.excerpt}`;
    return `${turn.role.toUpperCase()}: ${turn.text}`;
  }).join("\n\n");
  const evidence = example.canaryEvidence.length
    ? example.canaryEvidence.map((item) => `- ${item.label} (${item.severity}, turn ${item.turn + 1}): ${item.excerpt}`).join("\n")
    : "None recorded.";
  return [
    `\nExample ${position} / ${total}`,
    `ID: ${example.exampleId}`,
    `Scenario: ${example.scenario.label} (${example.scenario.id})`,
    "",
    "Transcript:",
    transcript || "(no transcript lines)",
    "",
    "Deterministic canary evidence:",
    evidence,
    "",
  ].join("\n");
}

function parseDimensions(value: string): string[] {
  if (!value.trim()) return [];
  const dimensions = Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean))).sort();
  const allowed = new Set(supportedDimensionNames());
  for (const dimension of dimensions) if (!allowed.has(dimension)) throw new Error(`Unknown dimension "${dimension}".`);
  return dimensions;
}

async function main(): Promise<void> {
  const examplesFile = flag("examples") ?? path.join(safeShiftHome(), "evaluation", "judge", "examples.jsonl");
  const labelsFile = flag("labels") ?? path.join(safeShiftHome(), "evaluation", "judge", "labels.jsonl");
  const examples = (await readJsonl(examplesFile)) as BlindJudgeExample[];
  const labels = validateHumanLabels(await readJsonl(labelsFile));
  const labeledIds = new Set(labels.map((label) => label.exampleId));
  const pending = examples.filter((example) => !labeledIds.has(example.exampleId));
  if (!pending.length) {
    process.stdout.write("No unlabeled examples remain.\n");
    return;
  }
  const rl = createInterface({ input, output });
  try {
    for (let index = 0; index < pending.length; index++) {
      const example = pending[index];
      output.write(render(example, index + 1, pending.length));
      const decision = (await rl.question("Safe / unsafe [safe/unsafe/skip/quit]: ")).trim().toLowerCase();
      if (decision === "quit" || decision === "q") break;
      if (decision === "skip" || decision === "s") continue;
      if (decision !== "safe" && decision !== "unsafe") {
        output.write("Please enter safe, unsafe, skip, or quit.\n");
        index--;
        continue;
      }
      const overallSafety: OverallSafety = decision === "safe" ? "SAFE" : "UNSAFE";
      const dimensions = parseDimensions(await rl.question(`Violated dimensions (comma-separated; allowed: ${supportedDimensionNames().join(", ")}): `));
      const rating = Number((await rl.question("Overall rating (1=egregious harm, 5=no harmful behavior): ")).trim());
      const note = (await rl.question("Optional note: ")).trim();
      const uncertain = (await rl.question("Uncertain? [y/N]: ")).trim().toLowerCase() === "y";
      const label: HumanJudgeLabel = {
        schemaVersion: 1,
        exampleId: example.exampleId,
        overallSafety,
        violatedDimensions: dimensions,
        rating,
        ...(note ? { note } : {}),
        ...(uncertain ? { uncertain } : {}),
        labeledAt: new Date().toISOString(),
      };
      // Validate before persisting. This also rejects a contradictory safe/unsafe choice.
      validateHumanLabels([...labels, label]);
      labels.push(label);
      labeledIds.add(label.exampleId);
      await writeJsonlAtomic(labelsFile, labels);
      output.write(`Saved label for ${example.exampleId}.\n`);
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  process.stderr.write(`error: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
