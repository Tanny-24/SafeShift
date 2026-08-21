// Local, versioned regression baselines. These files contain synthetic
// canaries and recorded attack messages, so they intentionally live under the
// ignored SafeShift home instead of the repository.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentSpec } from "./agentSpec";
import type { ScenarioReport } from "./core";
import { safeShiftHome } from "./store";

export type BaselineScenario = {
  scenarioId: string;
  capturedAt: string;
  /** Exact attacker utterances, in their original order. */
  attackerMessages: string[];
  report: ScenarioReport;
};

export type Baseline = {
  version: 1;
  name: string;
  specHash: string;
  createdAt: string;
  spec: AgentSpec;
  scenarios: Record<string, BaselineScenario>;
};

export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineError";
  }
}

export function safeBaselineName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "agent";
}

function safeHash(specHash: string): string {
  const hash = specHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new BaselineError("Baseline spec hash must be a 64-character SHA-256 hex string.");
  }
  return hash;
}

function root(): string {
  return path.join(safeShiftHome(), "baselines");
}

export function baselineFilePath(name: string, specHash: string): string {
  return path.join(root(), safeBaselineName(name), `${safeHash(specHash)}.json`);
}

function validateBaseline(value: unknown, source: string): Baseline {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BaselineError(`Baseline "${source}" is not a JSON object.`);
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.name !== "string" || typeof record.specHash !== "string") {
    throw new BaselineError(`Baseline "${source}" has an unsupported or malformed shape.`);
  }
  safeHash(record.specHash);
  if (!record.spec || typeof record.spec !== "object" || !record.scenarios || typeof record.scenarios !== "object") {
    throw new BaselineError(`Baseline "${source}" is missing its spec or scenarios.`);
  }
  for (const [id, scenario] of Object.entries(record.scenarios as Record<string, unknown>)) {
    if (!scenario || typeof scenario !== "object") {
      throw new BaselineError(`Baseline "${source}" has a malformed scenario "${id}".`);
    }
    const entry = scenario as Record<string, unknown>;
    if (entry.scenarioId !== id || !Array.isArray(entry.attackerMessages) || !entry.report) {
      throw new BaselineError(`Baseline "${source}" has a malformed scenario "${id}".`);
    }
    if (!entry.attackerMessages.every((message) => typeof message === "string" && message.trim())) {
      throw new BaselineError(`Baseline "${source}" has an empty attacker message in "${id}".`);
    }
  }
  return record as unknown as Baseline;
}

async function readBaseline(file: string): Promise<Baseline> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    const wrapped = new BaselineError(
      `Could not read baseline "${file}": ${(error as Error).message}`
    ) as BaselineError & { code?: string };
    wrapped.code = (error as NodeJS.ErrnoException).code;
    throw wrapped;
  }
  try {
    return validateBaseline(JSON.parse(raw), file);
  } catch (error) {
    if (error instanceof BaselineError) throw error;
    throw new BaselineError(`Baseline "${file}" is not valid JSON: ${(error as Error).message}`);
  }
}

/** Write then rename, so a stopped process never leaves a partial baseline. */
export async function saveBaseline(baseline: Baseline): Promise<string> {
  validateBaseline(baseline, "new baseline");
  const file = baselineFilePath(baseline.name, baseline.specHash);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  await rename(temporary, file);
  return file;
}

/** Load the one baseline for an agent name/hash pair, if it exists. */
export async function loadBaseline(name: string, specHash: string): Promise<Baseline | null> {
  const file = baselineFilePath(name, specHash);
  try {
    return await readBaseline(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Find a baseline by canonical spec hash, independent of the display name. */
export async function findBaselineByHash(specHash: string): Promise<Baseline | null> {
  const hash = safeHash(specHash);
  let names: string[];
  try {
    names = await readdir(root());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  for (const name of names.sort()) {
    const candidate = path.join(root(), name, `${hash}.json`);
    try {
      return await readBaseline(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  return null;
}

export async function listBaselines(): Promise<Baseline[]> {
  let names: string[];
  try {
    names = await readdir(root());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const baselines: Baseline[] = [];
  for (const name of names.sort()) {
    let files: string[];
    try {
      files = await readdir(path.join(root(), name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOTDIR") continue;
      throw error;
    }
    for (const file of files.filter((item) => item.endsWith(".json")).sort()) {
      baselines.push(await readBaseline(path.join(root(), name, file)));
    }
  }
  return baselines.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
