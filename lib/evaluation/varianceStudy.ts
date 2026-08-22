// Deterministic planning and resumption helpers for a larger end-to-end
// variance study. A successful plan cell is never repeated; a failed one is
// deliberately eligible for a later, explicit retry.

import { createHash } from "node:crypto";
import type { VarianceRunRecord } from "./variance";

export const VARIANCE_STUDY_SCHEMA_VERSION = 1 as const;

export type VarianceStudySpec = {
  path: string;
  hash: string;
};

export type VarianceStudyManifest = {
  schemaVersion: typeof VARIANCE_STUDY_SCHEMA_VERSION;
  studyId: string;
  createdAt: string;
  measurementMode: "end-to-end";
  model: string;
  specs: VarianceStudySpec[];
  scenarioIds: string[];
  repeatCount: number;
  plannedRunCount: number;
};

export type PlannedVarianceRun = {
  planRunId: string;
  runIndex: number;
  spec: VarianceStudySpec;
  scenarioId: string;
  repeatIndex: number;
};

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must not contain duplicates.`);
}

/** Validate both the manifest shape and arithmetic before spending provider quota. */
export function validateVarianceStudyManifest(value: unknown): VarianceStudyManifest {
  const object = requireObject(value, "Variance study manifest");
  if (object.schemaVersion !== VARIANCE_STUDY_SCHEMA_VERSION) {
    throw new Error(`Variance study manifest schemaVersion must be ${VARIANCE_STUDY_SCHEMA_VERSION}.`);
  }
  const studyId = requireText(object.studyId, "studyId");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(studyId)) throw new Error("studyId contains unsupported characters.");
  const createdAt = requireText(object.createdAt, "createdAt");
  if (Number.isNaN(Date.parse(createdAt))) throw new Error("createdAt must be an ISO-compatible timestamp.");
  if (object.measurementMode !== "end-to-end") throw new Error("Only end-to-end variance studies are supported.");
  const model = requireText(object.model, "model");
  if (!Array.isArray(object.specs) || !object.specs.length) throw new Error("specs must be a non-empty array.");
  const specs = object.specs.map((value, index) => {
    const spec = requireObject(value, `specs[${index}]`);
    const path = requireText(spec.path, `specs[${index}].path`);
    const hash = requireText(spec.hash, `specs[${index}].hash`).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`specs[${index}].hash must be a SHA-256 hash.`);
    return { path, hash };
  });
  unique(specs.map((spec) => spec.path), "spec paths");
  unique(specs.map((spec) => spec.hash), "spec hashes");
  if (!Array.isArray(object.scenarioIds) || !object.scenarioIds.length || !object.scenarioIds.every((id) => typeof id === "string" && /^[A-Za-z0-9_]+$/.test(id))) {
    throw new Error("scenarioIds must be a non-empty array of scenario ids.");
  }
  const scenarioIds = object.scenarioIds as string[];
  unique(scenarioIds, "scenarioIds");
  if (!Number.isInteger(object.repeatCount) || (object.repeatCount as number) < 1 || (object.repeatCount as number) > 100) {
    throw new Error("repeatCount must be an integer from 1 through 100.");
  }
  const repeatCount = object.repeatCount as number;
  const plannedRunCount = specs.length * scenarioIds.length * repeatCount;
  if (object.plannedRunCount !== plannedRunCount) {
    throw new Error(`plannedRunCount must equal specs × scenarios × repeats (${plannedRunCount}).`);
  }
  return {
    schemaVersion: VARIANCE_STUDY_SCHEMA_VERSION,
    studyId,
    createdAt,
    measurementMode: "end-to-end",
    model,
    specs,
    scenarioIds: [...scenarioIds],
    repeatCount,
    plannedRunCount,
  };
}

export function plannedVarianceRunId(studyId: string, specHash: string, scenarioId: string, repeatIndex: number): string {
  const fingerprint = createHash("sha256")
    .update(`${studyId}\u0000${specHash}\u0000${scenarioId}\u0000${repeatIndex}`, "utf8")
    .digest("hex")
    .slice(0, 20);
  return `plan_${fingerprint}`;
}

export function planVarianceStudy(manifest: VarianceStudyManifest): PlannedVarianceRun[] {
  const plan: PlannedVarianceRun[] = [];
  for (const spec of manifest.specs) {
    for (const scenarioId of manifest.scenarioIds) {
      for (let repeatIndex = 1; repeatIndex <= manifest.repeatCount; repeatIndex++) {
        plan.push({
          planRunId: plannedVarianceRunId(manifest.studyId, spec.hash, scenarioId, repeatIndex),
          runIndex: plan.length + 1,
          spec,
          scenarioId,
          repeatIndex,
        });
      }
    }
  }
  return plan;
}

/** Successful cells remain complete; failed cells intentionally remain pending. */
export function pendingVarianceStudyRuns(
  manifest: VarianceStudyManifest,
  records: VarianceRunRecord[]
): PlannedVarianceRun[] {
  const plan = planVarianceStudy(manifest);
  const allowed = new Set(plan.map((item) => item.planRunId));
  const complete = new Set<string>();
  for (const record of records) {
    if (record.experimentId !== manifest.studyId) {
      throw new Error(`Variance record belongs to unexpected experiment "${record.experimentId}".`);
    }
    if (!record.planRunId || !allowed.has(record.planRunId)) {
      throw new Error("Variance record does not match this study manifest.");
    }
    if (record.success) {
      if (complete.has(record.planRunId)) throw new Error(`Duplicate successful variance record "${record.planRunId}".`);
      complete.add(record.planRunId);
    }
  }
  return plan.filter((item) => !complete.has(item.planRunId));
}
