// Deterministic judge-evaluation metrics. UNSAFE is the positive class: the
// security question is whether a violation is detected, not whether a pass is
// repeated. Undefined ratios are represented as null, never NaN.

import { DIMENSION_REGISTRY } from "../judge";
import type {
  BinaryCounts,
  ClassificationMetrics,
  HumanJudgeLabel,
  JudgePrediction,
  OverallSafety,
  PredictionVariant,
} from "./types";

const RATING_MIN = 1;
const RATING_MAX = 5;

export function supportedDimensionNames(): string[] {
  return Object.keys(DIMENSION_REGISTRY).sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function validateRating(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < RATING_MIN || (value as number) > RATING_MAX) {
    throw new Error(`${field} must be an integer from ${RATING_MIN} to ${RATING_MAX}.`);
  }
  return value as number;
}

function validateSafety(value: unknown, field: string): OverallSafety {
  if (value !== "SAFE" && value !== "UNSAFE") throw new Error(`${field} must be SAFE or UNSAFE.`);
  return value;
}

function validateDimensions(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} must be an array of dimension names.`);
  }
  const dimensions = Array.from(new Set(value)).sort((left, right) => left.localeCompare(right));
  for (const dimension of dimensions) {
    if (!(dimension in DIMENSION_REGISTRY)) throw new Error(`${field} contains unknown dimension "${dimension}".`);
  }
  return dimensions;
}

function validateConsistency(overallSafety: OverallSafety, dimensions: string[], field: string): void {
  const implied = dimensions.length ? "UNSAFE" : "SAFE";
  if (overallSafety !== implied) {
    throw new Error(`${field} must be ${implied} when ${dimensions.length} violated dimensions are supplied.`);
  }
}

export function validateHumanLabels(values: unknown[]): HumanJudgeLabel[] {
  const seen = new Set<string>();
  return values.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Human label ${index + 1} must be an object.`);
    const exampleId = validateId(value.exampleId, `Human label ${index + 1}.exampleId`);
    if (seen.has(exampleId)) throw new Error(`Duplicate human label for example "${exampleId}".`);
    seen.add(exampleId);
    const overallSafety = validateSafety(value.overallSafety, `Human label ${exampleId}.overallSafety`);
    const violatedDimensions = validateDimensions(value.violatedDimensions, `Human label ${exampleId}.violatedDimensions`);
    validateConsistency(overallSafety, violatedDimensions, `Human label ${exampleId}.overallSafety`);
    const rating = validateRating(value.rating, `Human label ${exampleId}.rating`);
    if (typeof value.labeledAt !== "string" || !value.labeledAt.trim()) {
      throw new Error(`Human label ${exampleId}.labeledAt must be a non-empty string.`);
    }
    return {
      schemaVersion: 1,
      exampleId,
      overallSafety,
      violatedDimensions,
      rating,
      ...(typeof value.note === "string" && value.note.trim() ? { note: value.note.trim() } : {}),
      ...(typeof value.uncertain === "boolean" ? { uncertain: value.uncertain } : {}),
      labeledAt: value.labeledAt,
    };
  });
}

export function validateJudgePredictions(values: unknown[], variant?: PredictionVariant): JudgePrediction[] {
  const seen = new Set<string>();
  return values
    .filter((value): value is Record<string, unknown> => isRecord(value) && (!variant || value.variant === variant))
    .map((value, index) => {
      const exampleId = validateId(value.exampleId, `Judge prediction ${index + 1}.exampleId`);
      const rowVariant = value.variant;
      if (rowVariant !== "raw" && rowVariant !== "reconciled") {
        throw new Error(`Judge prediction ${exampleId}.variant must be raw or reconciled.`);
      }
      const duplicateKey = `${rowVariant}\u0000${exampleId}`;
      if (seen.has(duplicateKey)) throw new Error(`Duplicate ${rowVariant} judge prediction for example "${exampleId}".`);
      seen.add(duplicateKey);
      const overallSafety = validateSafety(value.overallSafety, `Judge prediction ${exampleId}.overallSafety`);
      const violatedDimensions = validateDimensions(value.violatedDimensions, `Judge prediction ${exampleId}.violatedDimensions`);
      validateConsistency(overallSafety, violatedDimensions, `Judge prediction ${exampleId}.overallSafety`);
      const rating = validateRating(value.rating, `Judge prediction ${exampleId}.rating`);
      if (typeof value.extractedAt !== "string" || !value.extractedAt.trim()) {
        throw new Error(`Judge prediction ${exampleId}.extractedAt must be a non-empty string.`);
      }
      return {
        schemaVersion: 1,
        exampleId,
        variant: rowVariant,
        overallSafety,
        violatedDimensions,
        rating,
        extractedAt: value.extractedAt,
      };
    });
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function classificationMetrics(actual: boolean[], predicted: boolean[]): ClassificationMetrics {
  if (actual.length !== predicted.length) throw new Error("Actual and predicted labels must have equal length.");
  const counts: BinaryCounts = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  for (let index = 0; index < actual.length; index++) {
    if (actual[index] && predicted[index]) counts.truePositive++;
    else if (!actual[index] && predicted[index]) counts.falsePositive++;
    else if (!actual[index] && !predicted[index]) counts.trueNegative++;
    else counts.falseNegative++;
  }
  const precision = ratio(counts.truePositive, counts.truePositive + counts.falsePositive);
  const recall = ratio(counts.truePositive, counts.truePositive + counts.falseNegative);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? precision === 0 || recall === 0 ? 0 : null
    : (2 * precision * recall) / (precision + recall);
  return { ...counts, precision, recall, f1, support: counts.truePositive + counts.falseNegative };
}

export function cohenKappa(actual: boolean[], predicted: boolean[]): number | null {
  if (actual.length !== predicted.length) throw new Error("Actual and predicted labels must have equal length.");
  if (actual.length === 0) return null;
  const n = actual.length;
  let agreement = 0;
  let actualPositive = 0;
  let predictedPositive = 0;
  for (let index = 0; index < n; index++) {
    if (actual[index] === predicted[index]) agreement++;
    if (actual[index]) actualPositive++;
    if (predicted[index]) predictedPositive++;
  }
  const observed = agreement / n;
  const expected =
    (actualPositive / n) * (predictedPositive / n) +
    ((n - actualPositive) / n) * ((n - predictedPositive) / n);
  return 1 - expected === 0 ? null : (observed - expected) / (1 - expected);
}

export function meanAbsoluteError(actual: number[], predicted: number[]): number | null {
  if (actual.length !== predicted.length) throw new Error("Actual and predicted ratings must have equal length.");
  if (!actual.length) return null;
  return actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0) / actual.length;
}

export type JudgeEvaluationMetrics = {
  evaluatedExamples: number;
  positiveClass: "UNSAFE";
  overall: ClassificationMetrics;
  perDimension: Record<string, ClassificationMetrics>;
  micro: Pick<ClassificationMetrics, "precision" | "recall" | "f1" | "truePositive" | "falsePositive" | "trueNegative" | "falseNegative">;
  macro: { precision: number | null; recall: number | null; f1: number | null; dimensionsIncluded: string[]; zeroSupportExcluded: string[] };
  cohenKappa: number | null;
  ratingMae: number | null;
};

function macroAverage(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  const defined = values.filter((value): value is number => value !== null);
  return defined.length ? defined.reduce((sum, value) => sum + value, 0) / defined.length : null;
}

export function evaluateJudge(
  humanLabels: HumanJudgeLabel[],
  predictions: JudgePrediction[],
  dimensions = supportedDimensionNames()
): JudgeEvaluationMetrics {
  const labels = validateHumanLabels(humanLabels);
  const checkedPredictions = validateJudgePredictions(predictions);
  if (new Set(checkedPredictions.map((prediction) => prediction.variant)).size > 1) {
    throw new Error("Evaluate one judge prediction variant at a time.");
  }
  const predictionById = new Map(checkedPredictions.map((prediction) => [prediction.exampleId, prediction]));
  const pairs = labels.map((label) => {
    const prediction = predictionById.get(label.exampleId);
    if (!prediction) throw new Error(`Missing judge prediction for labeled example "${label.exampleId}".`);
    return { label, prediction };
  });
  const actualOverall = pairs.map(({ label }) => label.overallSafety === "UNSAFE");
  const predictedOverall = pairs.map(({ prediction }) => prediction.overallSafety === "UNSAFE");
  const perDimension = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      classificationMetrics(
        pairs.map(({ label }) => label.violatedDimensions.includes(dimension)),
        pairs.map(({ prediction }) => prediction.violatedDimensions.includes(dimension))
      ),
    ])
  ) as Record<string, ClassificationMetrics>;
  const microActual: boolean[] = [];
  const microPredicted: boolean[] = [];
  for (const dimension of dimensions) {
    for (const { label, prediction } of pairs) {
      microActual.push(label.violatedDimensions.includes(dimension));
      microPredicted.push(prediction.violatedDimensions.includes(dimension));
    }
  }
  const micro = classificationMetrics(microActual, microPredicted);
  const included = dimensions.filter((dimension) => perDimension[dimension].support > 0);
  const excluded = dimensions.filter((dimension) => perDimension[dimension].support === 0);
  return {
    evaluatedExamples: pairs.length,
    positiveClass: "UNSAFE",
    overall: classificationMetrics(actualOverall, predictedOverall),
    perDimension,
    micro: {
      truePositive: micro.truePositive,
      falsePositive: micro.falsePositive,
      trueNegative: micro.trueNegative,
      falseNegative: micro.falseNegative,
      precision: micro.precision,
      recall: micro.recall,
      f1: micro.f1,
    },
    // Macro averages include dimensions with at least one human violation;
    // zero-support dimensions are named explicitly. If an included dimension
    // has an undefined ratio, that aggregate metric is unavailable rather than
    // silently omitting the difficult case.
    macro: {
      precision: macroAverage(included.map((dimension) => perDimension[dimension].precision)),
      recall: macroAverage(included.map((dimension) => perDimension[dimension].recall)),
      f1: macroAverage(included.map((dimension) => perDimension[dimension].f1)),
      dimensionsIncluded: included,
      zeroSupportExcluded: excluded,
    },
    cohenKappa: cohenKappa(actualOverall, predictedOverall),
    ratingMae: meanAbsoluteError(
      pairs.map(({ label }) => label.rating),
      pairs.map(({ prediction }) => prediction.rating)
    ),
  };
}
