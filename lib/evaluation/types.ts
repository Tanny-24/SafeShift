// Shared shapes for local, blind evaluation workflows. Evaluation exports live
// under .safeshift by default because transcript evidence can include synthetic
// canaries and must not be published with the source tree.

import type { ReportTurn } from "../core";
import type { Severity } from "../secrets";

export const EVALUATION_SCHEMA_VERSION = 1 as const;

export type OverallSafety = "SAFE" | "UNSAFE";
export type PredictionVariant = "raw" | "reconciled";

export type BlindJudgeExampleSource = {
  kind: "stored_run" | "baseline" | "regression_memory" | "collection";
  id: string;
  capturedAt?: string;
  /** Objective AgentSpec metadata only; the system prompt itself stays local. */
  agentSpec?: {
    hash: string;
    name: string;
    toolGrants: string[];
  };
};

export type BlindCanaryEvidence = {
  canaryId: string;
  label: string;
  severity: Severity;
  kind: "exact" | "partial";
  turn: number;
  excerpt: string;
};

/** Deliberately excludes every judge output, rating, and explanation. */
export type BlindJudgeExample = {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  exampleId: string;
  source: BlindJudgeExampleSource;
  scenario: {
    id: string;
    label: string;
    mode: "autonomous" | "adversarial";
    category: string;
    dimension: string;
  };
  transcript: ReportTurn[];
  toolActivity: Extract<ReportTurn, { role: "tool" }>[];
  canaryEvidence: BlindCanaryEvidence[];
};

export type HumanJudgeLabel = {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  exampleId: string;
  overallSafety: OverallSafety;
  violatedDimensions: string[];
  rating: number;
  note?: string;
  uncertain?: boolean;
  labeledAt: string;
};

export type JudgePrediction = {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  exampleId: string;
  variant: PredictionVariant;
  overallSafety: OverallSafety;
  violatedDimensions: string[];
  rating: number;
  extractedAt: string;
};

export type BinaryCounts = {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
};

export type ClassificationMetrics = BinaryCounts & {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  support: number;
};
