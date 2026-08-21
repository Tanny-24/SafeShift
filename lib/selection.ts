// Deterministic scenario selection for Phase 1A. Selection consumes only the
// existing scenario catalogue; it never executes a scenario or calls a model.

import { scenarios, type Scenario } from "./scenarios";
import type { RiskTag } from "./changeRisks";
import type { AgentChange } from "./specDiff";

export type ScenarioInventoryItem = {
  id: string;
  label: string;
  dimension: string;
  category: string;
  tools: string[];
  judgeDimensions: string[];
};

export type SelectionReason =
  | { type: "risk_tag"; tag: RiskTag; changeIds: string[] }
  | { type: "tool_match"; tool: string; changeIds: string[] }
  | { type: "category_match"; category: string; tag: RiskTag; changeIds: string[] }
  | { type: "sentinel"; description: string; changeIds: string[] };

export type SelectedScenario = {
  scenarioId: string;
  label: string;
  dimension: string;
  category: string;
  reasons: SelectionReason[];
};

export type SelectionResult = {
  selectedScenarios: SelectedScenario[];
  omittedScenarios: SelectedScenario[];
  totalScenarioCount: number;
  max: number;
};

export type SelectionOptions = {
  max?: number;
  inventory?: ScenarioInventoryItem[];
};

function scenarioToInventoryItem(scenario: Scenario): ScenarioInventoryItem {
  return {
    id: scenario.id,
    label: scenario.label,
    dimension: scenario.dimension,
    category: scenario.kind === "adversarial" ? scenario.category ?? "Data & secret leakage" : "Agentic misalignment",
    tools: scenario.kind === "adversarial" ? scenario.tools : [],
    judgeDimensions:
      scenario.kind === "adversarial" ? [scenario.dimension, ...(scenario.judgeDimensions ?? [])] : [scenario.dimension],
  };
}

export function defaultScenarioInventory(): ScenarioInventoryItem[] {
  return Object.values(scenarios).map(scenarioToInventoryItem);
}

const CATEGORY_BY_RISK: Partial<Record<RiskTag, readonly string[]>> = {
  SYSTEM_PROMPT_LEAK: ["Data & secret leakage", "Injection"],
  CREDENTIAL_LEAK: ["Data & secret leakage"],
  CROSS_CUSTOMER_LEAK: ["Data & secret leakage", "Robustness"],
  PII_SPILLAGE: ["Data & secret leakage", "Voice (phone) agents"],
  DATA_LEAK: ["Agentic misalignment"],
  POLICY_VIOLATION: ["Policy & actions", "Voice (phone) agents"],
  PRIVILEGE_ESCALATION: ["Policy & actions"],
  VERIFICATION_BYPASS: ["Policy & actions", "Voice (phone) agents"],
  JAILBREAK: ["Injection", "Voice (phone) agents"],
  INDIRECT_INJECTION: ["Injection"],
  REFUSAL_CONSISTENCY: ["Robustness", "Voice (phone) agents"],
};

// These are broad, deterministic controls used only when evidence yields fewer
// than two scenarios. promptleak checks confidentiality of edited instructions;
// jailbreak checks whether edited instructions still resist conflicting ones.
const PROMPT_SENTINELS = [
  {
    scenarioId: "promptleak",
    description: "Sentinel: system-prompt edits can accidentally expose hidden instructions.",
  },
  {
    scenarioId: "jailbreak",
    description: "Sentinel: system-prompt edits can weaken resistance to conflicting instructions.",
  },
] as const;

// Tool grants expand capability even when their name is not in the Phase 1A
// rule table. unauthorized_action is the broad action-authority control;
// credleak is the broad protected-data/configuration control.
const TOOL_SENTINELS = [
  {
    scenarioId: "unauthorized_action",
    description: "Sentinel: a newly granted tool can enable an action outside the agent's policy.",
  },
  {
    scenarioId: "credleak",
    description: "Sentinel: a newly granted tool can expose protected configuration or customer data.",
  },
] as const;

type Candidate = { scenario: ScenarioInventoryItem; reasons: SelectionReason[] };

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function reasonKey(reason: SelectionReason): string {
  switch (reason.type) {
    case "risk_tag":
      return `risk:${reason.tag}`;
    case "tool_match":
      return `tool:${reason.tool}`;
    case "category_match":
      return `category:${reason.tag}:${reason.category}`;
    case "sentinel":
      return `sentinel:${reason.description}`;
  }
}

function mergeReason(reasons: SelectionReason[], next: SelectionReason): void {
  const existing = reasons.find((reason) => reasonKey(reason) === reasonKey(next));
  if (existing) {
    existing.changeIds = uniqueIds([...existing.changeIds, ...next.changeIds]);
  } else {
    reasons.push({ ...next, changeIds: uniqueIds(next.changeIds) });
  }
}

function score(candidate: Candidate): number {
  const toolCount = candidate.reasons.filter((reason) => reason.type === "tool_match").length;
  const riskCount = candidate.reasons.filter((reason) => reason.type === "risk_tag").length;
  const categoryCount = candidate.reasons.filter((reason) => reason.type === "category_match").length;
  if (toolCount && riskCount) return 300 + toolCount * 10 + riskCount * 5 + categoryCount;
  if (riskCount >= 2) return 200 + riskCount * 5 + categoryCount;
  if (riskCount === 1) return 100 + categoryCount;
  if (toolCount) return 75 + categoryCount;
  if (categoryCount) return 20 + categoryCount;
  return 1; // sentinel
}

function formatCandidate(candidate: Candidate): SelectedScenario {
  const order = { risk_tag: 0, tool_match: 1, category_match: 2, sentinel: 3 } as const;
  return {
    scenarioId: candidate.scenario.id,
    label: candidate.scenario.label,
    dimension: candidate.scenario.dimension,
    category: candidate.scenario.category,
    reasons: [...candidate.reasons].sort(
      (left, right) => order[left.type] - order[right.type] || reasonKey(left).localeCompare(reasonKey(right))
    ),
  };
}

/** Select and explain scenarios from direct tags, tool grants, and category family. */
export function selectScenarios(changes: AgentChange[], options: SelectionOptions = {}): SelectionResult {
  const max = options.max ?? 4;
  if (!Number.isInteger(max) || max < 1) throw new Error("max scenario count must be a positive integer.");

  const inventory = options.inventory ?? defaultScenarioInventory();
  const candidates = new Map<string, Candidate>();
  const add = (scenario: ScenarioInventoryItem, reason: SelectionReason) => {
    const candidate = candidates.get(scenario.id) ?? { scenario, reasons: [] };
    mergeReason(candidate.reasons, reason);
    candidates.set(scenario.id, candidate);
  };

  for (const change of changes) {
    for (const tag of change.riskTags) {
      const primaryMatches = inventory.filter((scenario) => scenario.dimension === tag);
      const judgeMatches = inventory.filter(
        (scenario) => scenario.dimension !== tag && scenario.judgeDimensions.includes(tag)
      );

      // Prefer a scenario whose headline dimension is the risk itself. If the
      // catalogue lacks one, reuse a scenario that scores the tag as a judge
      // dimension; only then fall back to the scenario family/category.
      if (primaryMatches.length) {
        for (const scenario of primaryMatches) {
          add(scenario, { type: "risk_tag", tag, changeIds: [change.id] });
        }
      } else if (judgeMatches.length) {
        for (const scenario of judgeMatches) {
          add(scenario, { type: "risk_tag", tag, changeIds: [change.id] });
        }
      } else {
        for (const scenario of inventory) {
          if (!(CATEGORY_BY_RISK[tag] ?? []).includes(scenario.category)) continue;
          add(scenario, {
            type: "category_match",
            category: scenario.category,
            tag,
            changeIds: [change.id],
          });
        }
      }
    }
    if (change.kind === "tool_granted" && change.tool) {
      for (const scenario of inventory) {
        if (scenario.tools.includes(change.tool)) {
          add(scenario, { type: "tool_match", tool: change.tool, changeIds: [change.id] });
        }
      }
    }
  }

  const hasPromptChange = changes.some(
    (change) => change.kind === "clause_added" || change.kind === "clause_removed" || change.kind === "clause_modified"
  );
  const hasToolGrant = changes.some((change) => change.kind === "tool_granted");
  const minimumEvidence = Math.min(2, max);
  if ((hasPromptChange || hasToolGrant) && candidates.size < minimumEvidence) {
    const sentinels = hasPromptChange ? PROMPT_SENTINELS : TOOL_SENTINELS;
    for (const sentinel of sentinels) {
      const scenario = inventory.find((item) => item.id === sentinel.scenarioId);
      if (!scenario) continue;
      add(scenario, { type: "sentinel", description: sentinel.description, changeIds: changes.map((change) => change.id) });
      if (candidates.size >= minimumEvidence) break;
    }
  }

  const ordered = Array.from(candidates.values()).sort(
    (left, right) => score(right) - score(left) || left.scenario.id.localeCompare(right.scenario.id)
  );
  return {
    selectedScenarios: ordered.slice(0, max).map(formatCandidate),
    omittedScenarios: ordered.slice(max).map(formatCandidate),
    totalScenarioCount: inventory.length,
    max,
  };
}
