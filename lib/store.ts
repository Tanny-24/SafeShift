// Where finished runs go.
//
// The web app, the MCP server and the CLI are three separate Node processes, so
// "get me the result of that test" cannot be answered from memory. Runs are
// written as one JSON file each under .safeshift/runs/ — no database, no
// server to keep alive, and a run started in the browser can be fetched later
// from the CLI or an MCP client.
//
// Runs contain the scenario's planted secrets (that is the evidence), so the
// directory is local-only and git-ignored. Nothing here touches the network.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ScenarioReport } from "./core";

export type StoredRun = ScenarioReport & {
  id: string;
  createdAt: string;
  /** Where the run came from, so a listing can tell them apart. */
  source: "web" | "mcp" | "cli" | "sdk";
};

export type RunSummary = {
  id: string;
  createdAt: string;
  source: StoredRun["source"];
  scenarioId: string;
  label: string;
  stars: number;
  headline: string;
  explanation: string;
  failed: boolean;
  leaks: number;
};

function home(): string {
  return (
    process.env.SAFESHIFT_HOME ||
    process.env.CRASHTEST_HOME || // pre-rename override, still honoured
    path.join(process.cwd(), ".safeshift")
  );
}

function runsDir(): string {
  return path.join(home(), "runs");
}

// Runs written before the rename live in the old directory. New runs always go
// to runsDir(); reads fall back here so existing results stay reachable.
function legacyRunsDir(): string | null {
  if (process.env.SAFESHIFT_HOME || process.env.CRASHTEST_HOME) return null;
  return path.join(process.cwd(), ".crashtest", "runs");
}

// Run ids go into file paths, so never trust one from a caller.
function safeId(id: string): string {
  if (!/^run_[A-Za-z0-9_-]{4,80}$/.test(id)) {
    throw new Error(`Invalid run id "${id}".`);
  }
  return id;
}

function newId(): string {
  return `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

export async function saveRun(
  result: ScenarioReport,
  source: StoredRun["source"] = "web"
): Promise<StoredRun> {
  const stored: StoredRun = {
    ...result,
    id: newId(),
    createdAt: new Date().toISOString(),
    source,
  };
  const dir = runsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${stored.id}.json`),
    JSON.stringify(stored, null, 2),
    "utf8"
  );
  return stored;
}

export async function getRun(id: string): Promise<StoredRun | null> {
  const file = `${safeId(id)}.json`;
  const legacy = legacyRunsDir();
  for (const dir of legacy ? [runsDir(), legacy] : [runsDir()]) {
    try {
      return JSON.parse(await readFile(path.join(dir, file), "utf8")) as StoredRun;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return null;
}

export function summarizeRun(run: StoredRun): RunSummary {
  return {
    id: run.id,
    createdAt: run.createdAt,
    source: run.source,
    scenarioId: run.scenarioId,
    label: run.label,
    stars: run.verdict.star_rating,
    headline: run.verdict.headline,
    explanation: run.verdict.explanation,
    failed: run.failed,
    leaks: run.verdict.leaks.length,
  };
}

export async function listRuns(limit = 25): Promise<RunSummary[]> {
  const legacy = legacyRunsDir();
  const dirs = legacy ? [runsDir(), legacy] : [runsDir()];

  const runs: StoredRun[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      if (seen.has(name)) continue; // current store wins over the legacy one
      seen.add(name);
      try {
        runs.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));
      } catch {
        // A half-written or hand-edited file should not take the listing down.
      }
    }
  }

  return runs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 200)))
    .map(summarizeRun);
}
