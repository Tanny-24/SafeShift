// A deliberately small, portable description of an agent for deterministic
// change analysis. It has no provider, model, or runtime dependencies.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type AgentSpec = {
  name: string;
  systemPrompt: string;
  toolGrants: string[];
};

export type NormalizedAgentSpec = {
  name: string;
  systemPrompt: string;
  clauses: string[];
  toolGrants: string[];
};

export type AgentSpecAnalysis = {
  spec: AgentSpec;
  normalized: NormalizedAgentSpec;
  hash: string;
  shortHash: string;
};

export class AgentSpecValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSpecValidationError";
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !collapseWhitespace(value)) {
    throw new AgentSpecValidationError(`Agent spec field "${field}" must be a non-empty string.`);
  }
  return value;
}

/** Validate a JSON-shaped value without changing the caller's display text. */
export function validateAgentSpec(value: unknown): AgentSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentSpecValidationError("Agent spec must be a JSON object.");
  }

  const source = value as Record<string, unknown>;
  const name = requireText(source.name, "name");
  const systemPrompt = requireText(source.systemPrompt, "systemPrompt");

  if (!Array.isArray(source.toolGrants)) {
    throw new AgentSpecValidationError('Agent spec field "toolGrants" must be an array of strings.');
  }
  const toolGrants = source.toolGrants.map((tool, index) => {
    if (typeof tool !== "string" || !collapseWhitespace(tool)) {
      throw new AgentSpecValidationError(
        `Agent spec toolGrants[${index}] must be a non-empty string.`
      );
    }
    return tool;
  });

  return { name, systemPrompt, toolGrants };
}

/** Read and validate a standalone JSON agent specification. */
export async function loadAgentSpec(filePath: string): Promise<AgentSpec> {
  let body: string;
  try {
    body = await readFile(filePath, "utf8");
  } catch (error) {
    throw new AgentSpecValidationError(
      `Could not read agent spec "${filePath}": ${(error as Error).message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new AgentSpecValidationError(
      `Agent spec "${filePath}" is not valid JSON: ${(error as Error).message}`
    );
  }
  return validateAgentSpec(parsed);
}

/**
 * Split a prompt at deterministic sentence boundaries after whitespace is
 * normalised. Keeping the clause text's original case preserves readable CLI
 * explanations while making line wrapping and repeated spacing irrelevant.
 */
export function splitSystemPromptClauses(systemPrompt: string): string[] {
  const lines = systemPrompt.replace(/\r\n?/g, "\n").trim().split(/\n+/);
  const clauses: string[] = [];
  for (const line of lines) {
    const compact = collapseWhitespace(line);
    if (!compact) continue;
    for (const clause of compact.split(/(?<=[.!?])\s+(?=["'“‘(]*[A-Z0-9])/)) {
      const normalized = collapseWhitespace(clause);
      if (normalized) clauses.push(normalized);
    }
  }
  return clauses;
}

function normalizeToolGrants(toolGrants: string[]): string[] {
  return Array.from(new Set(toolGrants.map(collapseWhitespace))).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
}

export function normalizeAgentSpec(spec: AgentSpec): NormalizedAgentSpec {
  const clauses = splitSystemPromptClauses(spec.systemPrompt);
  return {
    name: collapseWhitespace(spec.name),
    systemPrompt: clauses.join("\n"),
    clauses,
    toolGrants: normalizeToolGrants(spec.toolGrants),
  };
}

/** Stable SHA-256 fingerprint of the canonical, formatting-insensitive spec. */
export function hashAgentSpec(spec: AgentSpec): string {
  const normalized = normalizeAgentSpec(spec);
  const canonical = JSON.stringify({
    name: normalized.name,
    systemPrompt: normalized.systemPrompt,
    toolGrants: normalized.toolGrants,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function analyzeAgentSpec(spec: AgentSpec): AgentSpecAnalysis {
  const normalized = normalizeAgentSpec(spec);
  const hash = hashAgentSpec(spec);
  return { spec, normalized, hash, shortHash: hash.slice(0, 7) };
}
