// Append-only local memory for confirmed regressions. It lets a later relevant
// change replay the exact attack that first exposed a bug, even after the
// original baseline no longer selects that scenario.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RiskTag } from "./changeRisks";
import type { EvidenceSnapshot } from "./compare";
import type { ScenarioReport } from "./core";
import { safeShiftHome } from "./store";

export type RegressionHistoryEntry = {
  observedAt: string;
  specHash: string;
  status: "REGRESSION" | "FIXED";
  evidence: EvidenceSnapshot;
};

export type RegressionCase = {
  version: 1;
  id: string;
  scenarioId: string;
  attackerMessages: string[];
  riskTags: RiskTag[];
  sourceChangeIds: string[];
  initialFailure: {
    observedAt: string;
    specHash: string;
    evidence: EvidenceSnapshot;
    report: ScenarioReport;
  };
  /** Baseline evidence against which the original failure was proven. */
  baselineEvidence: EvidenceSnapshot;
  history: RegressionHistoryEntry[];
  fixedAt?: { observedAt: string; specHash: string };
};

function directory(): string {
  return path.join(safeShiftHome(), "regressions");
}

function normalizedMessages(messages: string[]): string[] {
  return messages.map((message) => message.replace(/\s+/g, " ").trim());
}

export function regressionCaseId(scenarioId: string, attackerMessages: string[]): string {
  if (!/^[a-z0-9_-]{1,80}$/i.test(scenarioId)) throw new Error(`Invalid scenario id "${scenarioId}".`);
  if (!attackerMessages.length || normalizedMessages(attackerMessages).some((message) => !message)) {
    throw new Error("Regression memory requires one or more non-empty attacker messages.");
  }
  const identity = JSON.stringify({ scenarioId, attackerMessages: normalizedMessages(attackerMessages) });
  return `reg_${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 24)}`;
}

function fileFor(id: string): string {
  if (!/^reg_[a-f0-9]{24}$/.test(id)) throw new Error(`Invalid regression id "${id}".`);
  return path.join(directory(), `${id}.json`);
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, file);
}

export async function loadRegressionCase(id: string): Promise<RegressionCase | null> {
  try {
    return JSON.parse(await readFile(fileFor(id), "utf8")) as RegressionCase;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listRegressionCases(): Promise<RegressionCase[]> {
  let names: string[];
  try {
    names = await readdir(directory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const cases: RegressionCase[] = [];
  for (const name of names.filter((item) => /^reg_[a-f0-9]{24}\.json$/.test(item)).sort()) {
    cases.push(JSON.parse(await readFile(path.join(directory(), name), "utf8")) as RegressionCase);
  }
  return cases;
}

export type RecordRegressionInput = {
  scenarioId: string;
  attackerMessages: string[];
  riskTags: RiskTag[];
  sourceChangeIds: string[];
  specHash: string;
  baselineEvidence: EvidenceSnapshot;
  currentReport: ScenarioReport;
  currentEvidence: EvidenceSnapshot;
};

/** Create a case once, then append a new observation when it recurs. */
export async function recordRegression(input: RecordRegressionInput): Promise<RegressionCase> {
  const id = regressionCaseId(input.scenarioId, input.attackerMessages);
  const now = new Date().toISOString();
  const prior = await loadRegressionCase(id);
  const history: RegressionHistoryEntry = {
    observedAt: now,
    specHash: input.specHash,
    status: "REGRESSION",
    evidence: input.currentEvidence,
  };
  const next: RegressionCase = prior
    ? {
        ...prior,
        riskTags: Array.from(new Set([...prior.riskTags, ...input.riskTags])).sort(),
        sourceChangeIds: Array.from(new Set([...prior.sourceChangeIds, ...input.sourceChangeIds])).sort(),
        history: [...prior.history, history],
        fixedAt: undefined,
      }
    : {
        version: 1,
        id,
        scenarioId: input.scenarioId,
        attackerMessages: [...input.attackerMessages],
        riskTags: Array.from(new Set(input.riskTags)).sort(),
        sourceChangeIds: Array.from(new Set(input.sourceChangeIds)).sort(),
        initialFailure: {
          observedAt: now,
          specHash: input.specHash,
          evidence: input.currentEvidence,
          report: input.currentReport,
        },
        baselineEvidence: input.baselineEvidence,
        history: [history],
      };
  await atomicWrite(fileFor(id), next);
  return next;
}

export async function markRegressionFixed(
  id: string,
  specHash: string,
  evidence: EvidenceSnapshot
): Promise<RegressionCase | null> {
  const prior = await loadRegressionCase(id);
  if (!prior) return null;
  const now = new Date().toISOString();
  const next: RegressionCase = {
    ...prior,
    history: [...prior.history, { observedAt: now, specHash, status: "FIXED", evidence }],
    fixedAt: { observedAt: now, specHash },
  };
  await atomicWrite(fileFor(id), next);
  return next;
}

/** Relevant means the selected scenario or one of the current risk families matches. */
export async function findRelevantRegressionCases(
  scenarioIds: string[],
  riskTags: RiskTag[]
): Promise<RegressionCase[]> {
  const selected = new Set(scenarioIds);
  const risks = new Set(riskTags);
  return (await listRegressionCases()).filter(
    (item) => selected.has(item.scenarioId) || item.riskTags.some((tag) => risks.has(tag))
  );
}
