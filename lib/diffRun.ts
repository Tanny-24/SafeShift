// The non-dry change gate: deterministic selection first, then recorded
// attacker replay, shared execution/grading, and deterministic comparison.

import type { AgentSpec } from "./agentSpec";
import { findBaselineByHash, loadBaseline, type Baseline, type BaselineScenario } from "./baseline";
import { attributeRegression, type Attribution } from "./attribute";
import {
  compareEvidence,
  confirmComparison,
  evidenceSnapshot,
  type ComparisonResult,
  type RegressionStatus,
} from "./compare";
import { getScenario, runCrashTest, type ScenarioReport } from "./core";
import {
  findRelevantRegressionCases,
  markRegressionFixed,
  recordRegression,
  regressionCaseId,
  type RegressionCase,
} from "./regressionMemory";
import { selectScenarios, type SelectedScenario } from "./selection";
import { diffAgentSpecs, type AgentChange, type SpecDiff } from "./specDiff";

export class BaselineNotFoundError extends Error {
  constructor(name: string, hash: string) {
    super(
      `No baseline exists for ${name} @ ${hash.slice(0, 7)}. Create one first with \`safeshift baseline <old-spec.json>\`.`
    );
    this.name = "BaselineNotFoundError";
  }
}

export type DiffRunScenarioResult = {
  scenarioId: string;
  label: string;
  source: "baseline" | "regression_memory" | "unbaselined";
  status: RegressionStatus;
  reason: string;
  comparison?: ComparisonResult;
  confirmation?: ComparisonResult;
  report?: ScenarioReport;
  regressionCaseId?: string;
  attribution?: Attribution | null;
  attributionError?: string;
};

export type DiffRunResult = {
  mode: "replay";
  from: { name: string; hash: string; shortHash: string };
  to: { name: string; hash: string; shortHash: string };
  changes: AgentChange[];
  selectedScenarios: SelectedScenario[];
  omittedScenarios: SelectedScenario[];
  totalScenarioCount: number;
  baseline: { name: string; specHash: string; createdAt: string };
  results: DiffRunScenarioResult[];
  summary: Record<RegressionStatus, number> & { confirmedRegressions: number };
};

type ReplayJob = {
  scenario: SelectedScenario;
  source: "baseline" | "regression_memory";
  attackerMessages: string[];
  baselineScenario?: BaselineScenario;
  regressionCase?: RegressionCase;
};

function scenarioLabel(id: string): string {
  return getScenario(id)?.label ?? id;
}

function jobKey(scenarioId: string, messages: string[]): string {
  return `${scenarioId}\u0000${messages.map((message) => message.replace(/\s+/g, " ").trim()).join("\u0001")}`;
}

function summaryFor(results: DiffRunScenarioResult[]): DiffRunResult["summary"] {
  const statuses: RegressionStatus[] = ["PASS", "REGRESSION", "FIXED", "FLAKY", "NEW", "UNCONFIRMED"];
  const summary = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<RegressionStatus, number>;
  for (const result of results) summary[result.status]++;
  return { ...summary, confirmedRegressions: summary.REGRESSION };
}

async function matchingBaseline(diff: SpecDiff): Promise<Baseline | null> {
  return (
    (await loadBaseline(diff.from.normalized.name, diff.from.hash)) ??
    (await findBaselineByHash(diff.from.hash))
  );
}

function selectedRiskTags(scenario: SelectedScenario): import("./changeRisks").RiskTag[] {
  return scenario.reasons.flatMap((reason) => {
    if (reason.type === "risk_tag" || reason.type === "category_match") return [reason.tag];
    return [];
  });
}

export async function runDiffEvaluation(input: {
  fromSpec: AgentSpec;
  toSpec: AgentSpec;
  max?: number;
  attribution?: boolean;
}): Promise<DiffRunResult> {
  const diff = diffAgentSpecs(input.fromSpec, input.toSpec);
  const selection = selectScenarios(diff.changes, { max: input.max });
  const baseline = await matchingBaseline(diff);
  if (!baseline) throw new BaselineNotFoundError(diff.from.normalized.name, diff.from.hash);

  const results: DiffRunScenarioResult[] = [];
  const jobs: ReplayJob[] = [];
  const scheduled = new Set<string>();
  const selectedIds = selection.selectedScenarios.map((scenario) => scenario.scenarioId);
  const allTags = Array.from(
    new Set([
      ...selection.selectedScenarios.flatMap(selectedRiskTags),
      ...diff.changes.flatMap((change) => change.riskTags),
    ])
  );

  for (const selected of selection.selectedScenarios) {
    const stored = baseline.scenarios[selected.scenarioId];
    if (!stored) {
      // Do not infer a regression for a scenario that has no comparable run.
      results.push({
        scenarioId: selected.scenarioId,
        label: selected.label,
        source: "unbaselined",
        status: "NEW",
        reason: "Selected scenario is not present in the baseline; no comparison was made.",
      });
      continue;
    }
    const key = jobKey(selected.scenarioId, stored.attackerMessages);
    scheduled.add(key);
    jobs.push({
      scenario: selected,
      source: "baseline",
      attackerMessages: stored.attackerMessages,
      baselineScenario: stored,
    });
  }

  // Historical cases are additional controls. Their attack messages are kept
  // even when a new selection no longer contains the original scenario.
  for (const remembered of await findRelevantRegressionCases(selectedIds, allTags)) {
    const key = jobKey(remembered.scenarioId, remembered.attackerMessages);
    if (scheduled.has(key)) continue;
    scheduled.add(key);
    jobs.push({
      scenario: {
        scenarioId: remembered.scenarioId,
        label: scenarioLabel(remembered.scenarioId),
        dimension: getScenario(remembered.scenarioId)?.dimension ?? "historical regression",
        category: "Regression memory",
        reasons: [],
      },
      source: "regression_memory",
      attackerMessages: remembered.attackerMessages,
      regressionCase: remembered,
    });
  }

  for (const job of jobs) {
    const scenario = getScenario(job.scenario.scenarioId);
    if (!scenario || scenario.kind !== "adversarial") {
      results.push({
        scenarioId: job.scenario.scenarioId,
        label: job.scenario.label,
        source: job.source,
        status: "UNCONFIRMED",
        reason: "Recorded attacker replay is available only for an existing adversarial scenario.",
      });
      continue;
    }

    const baselineEvidence = job.regressionCase
      ? job.regressionCase.baselineEvidence
      : evidenceSnapshot(job.baselineScenario!.report);
    const report = await runCrashTest({
      systemPrompt: diff.to.spec.systemPrompt,
      scenarioId: job.scenario.scenarioId,
      replayAttackerMessages: job.attackerMessages,
    });
    let comparison = compareEvidence(baselineEvidence, evidenceSnapshot(report));
    let confirmation: ComparisonResult | undefined;
    if (comparison.status === "UNCONFIRMED") {
      const confirmationReport = await runCrashTest({
        systemPrompt: diff.to.spec.systemPrompt,
        scenarioId: job.scenario.scenarioId,
        replayAttackerMessages: job.attackerMessages,
      });
      confirmation = compareEvidence(baselineEvidence, evidenceSnapshot(confirmationReport));
      comparison = confirmComparison(comparison, confirmation);
    }

    const result: DiffRunScenarioResult = {
      scenarioId: job.scenario.scenarioId,
      label: job.scenario.label,
      source: job.source,
      status: comparison.status,
      reason: comparison.reason,
      comparison,
      ...(confirmation ? { confirmation } : {}),
      report,
    };
    const caseId = regressionCaseId(job.scenario.scenarioId, job.attackerMessages);
    if (comparison.status === "REGRESSION") {
      const recorded = await recordRegression({
        scenarioId: job.scenario.scenarioId,
        attackerMessages: job.attackerMessages,
        riskTags: allTags,
        sourceChangeIds: diff.changes.map((change) => change.id),
        specHash: diff.to.hash,
        baselineEvidence,
        currentReport: report,
        currentEvidence: evidenceSnapshot(report),
      });
      result.regressionCaseId = recorded.id;
      if (input.attribution !== false) {
        try {
          result.attribution = await attributeRegression({
            changes: diff.changes,
            delta: comparison.delta,
            scenarioId: job.scenario.scenarioId,
          });
        } catch (error) {
          result.attributionError = (error as Error).message;
        }
      }
    } else if (comparison.status === "FIXED") {
      const updated = await markRegressionFixed(caseId, diff.to.hash, evidenceSnapshot(report));
      if (updated) result.regressionCaseId = updated.id;
    }
    results.push(result);
  }

  return {
    mode: "replay",
    from: { name: diff.from.normalized.name, hash: diff.from.hash, shortHash: diff.from.shortHash },
    to: { name: diff.to.normalized.name, hash: diff.to.hash, shortHash: diff.to.shortHash },
    changes: diff.changes,
    selectedScenarios: selection.selectedScenarios,
    omittedScenarios: selection.omittedScenarios,
    totalScenarioCount: selection.totalScenarioCount,
    baseline: { name: baseline.name, specHash: baseline.specHash, createdAt: baseline.createdAt },
    results,
    summary: summaryFor(results),
  };
}
