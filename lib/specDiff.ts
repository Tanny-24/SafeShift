// Deterministic, clause-level change detection for AgentSpec. The algorithm is
// intentionally small enough to inspect: LCS for exact clauses plus a token
// similarity pass for obvious edits.

import { analyzeAgentSpec, type AgentSpec, type AgentSpecAnalysis } from "./agentSpec";
import { riskTagsForChange, type RiskChangeKind, type RiskTag } from "./changeRisks";

export type AgentChangeKind = RiskChangeKind;

export type AgentChange = {
  id: string;
  kind: AgentChangeKind;
  before?: string;
  after?: string;
  tool?: string;
  riskTags: RiskTag[];
};

export type SpecDiff = {
  from: AgentSpecAnalysis;
  to: AgentSpecAnalysis;
  changes: AgentChange[];
};

type ClausePair = { oldIndex: number; newIndex: number };
type PendingChange = Omit<AgentChange, "id"> & { order: number };

function lcsPairs(oldClauses: string[], newClauses: string[]): ClausePair[] {
  const rows = oldClauses.length + 1;
  const cols = newClauses.length + 1;
  const lengths = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let oldIndex = oldClauses.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newClauses.length - 1; newIndex >= 0; newIndex--) {
      lengths[oldIndex][newIndex] =
        oldClauses[oldIndex] === newClauses[newIndex]
          ? lengths[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
    }
  }

  const pairs: ClausePair[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldClauses.length && newIndex < newClauses.length) {
    if (oldClauses[oldIndex] === newClauses[newIndex]) {
      pairs.push({ oldIndex, newIndex });
      oldIndex++;
      newIndex++;
    } else if (lengths[oldIndex + 1][newIndex] >= lengths[oldIndex][newIndex + 1]) {
      oldIndex++;
    } else {
      newIndex++;
    }
  }
  return pairs;
}

function tokens(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

function similarity(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token)).length;
  const total = new Set([...leftTokens, ...rightTokens]).size;
  return total === 0 ? 0 : shared / total;
}

function modificationPairs(
  oldClauses: string[],
  newClauses: string[],
  unmatchedOld: number[],
  unmatchedNew: number[]
): ClausePair[] {
  const candidates: Array<ClausePair & { score: number }> = [];
  for (const oldIndex of unmatchedOld) {
    for (const newIndex of unmatchedNew) {
      const score = similarity(oldClauses[oldIndex], newClauses[newIndex]);
      if (score >= 0.6) candidates.push({ oldIndex, newIndex, score });
    }
  }

  candidates.sort(
    (a, b) => b.score - a.score || a.oldIndex - b.oldIndex || a.newIndex - b.newIndex
  );
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const pairs: ClausePair[] = [];
  for (const candidate of candidates) {
    if (usedOld.has(candidate.oldIndex) || usedNew.has(candidate.newIndex)) continue;
    usedOld.add(candidate.oldIndex);
    usedNew.add(candidate.newIndex);
    pairs.push({ oldIndex: candidate.oldIndex, newIndex: candidate.newIndex });
  }
  return pairs;
}

function withRisks(change: Omit<AgentChange, "id" | "riskTags">, order: number): PendingChange {
  return { ...change, riskTags: riskTagsForChange(change), order };
}

/** Compare two specifications without executing an agent or importing Gemini. */
export function diffAgentSpecs(fromSpec: AgentSpec, toSpec: AgentSpec): SpecDiff {
  const from = analyzeAgentSpec(fromSpec);
  const to = analyzeAgentSpec(toSpec);
  const exactPairs = lcsPairs(from.normalized.clauses, to.normalized.clauses);
  const exactOld = new Set(exactPairs.map((pair) => pair.oldIndex));
  const exactNew = new Set(exactPairs.map((pair) => pair.newIndex));
  const unmatchedOld = from.normalized.clauses.map((_, index) => index).filter((index) => !exactOld.has(index));
  const unmatchedNew = to.normalized.clauses.map((_, index) => index).filter((index) => !exactNew.has(index));
  const modified = modificationPairs(
    from.normalized.clauses,
    to.normalized.clauses,
    unmatchedOld,
    unmatchedNew
  );
  const modifiedNew = new Set(modified.map((pair) => pair.newIndex));

  const pending: PendingChange[] = [];
  for (const oldIndex of unmatchedOld) {
    const pair = modified.find((candidate) => candidate.oldIndex === oldIndex);
    if (pair) {
      pending.push(
        withRisks(
          {
            kind: "clause_modified",
            before: from.normalized.clauses[pair.oldIndex],
            after: to.normalized.clauses[pair.newIndex],
          },
          oldIndex
        )
      );
    } else {
      pending.push(
        withRisks(
          { kind: "clause_removed", before: from.normalized.clauses[oldIndex] },
          oldIndex
        )
      );
    }
  }
  for (const newIndex of unmatchedNew) {
    if (!modifiedNew.has(newIndex)) {
      pending.push(
        withRisks(
          { kind: "clause_added", after: to.normalized.clauses[newIndex] },
          from.normalized.clauses.length + newIndex
        )
      );
    }
  }

  pending.sort((a, b) => a.order - b.order);
  const oldTools = new Set(from.normalized.toolGrants);
  const newTools = new Set(to.normalized.toolGrants);
  for (const tool of from.normalized.toolGrants) {
    if (!newTools.has(tool)) pending.push(withRisks({ kind: "tool_revoked", tool }, Number.MAX_SAFE_INTEGER));
  }
  for (const tool of to.normalized.toolGrants) {
    if (!oldTools.has(tool)) pending.push(withRisks({ kind: "tool_granted", tool }, Number.MAX_SAFE_INTEGER));
  }

  return {
    from,
    to,
    changes: pending.map(({ order: _order, ...change }, index) => ({ ...change, id: `c${index + 1}` })),
  };
}
