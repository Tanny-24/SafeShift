#!/usr/bin/env -S npx tsx
// The SafeShift CLI.
//
//   npm run safeshift -- scenarios
//   npm run safeshift -- run --scenario credleak --prompt "You are ShopBot..."
//   npm run safeshift -- scan --scenario credleak --text "the key is NWX-TEST-PAYKEY-..."
//   npm run safeshift -- report <run_id> --format html --out report.html
//
// Execution commands drive the shared core through the SDK (sdk/index.ts), so
// `run` here and "Crash It" in the browser execute the same code path and
// write to the same local run store. `diff --dry-run` remains a separate,
// deterministic specification analysis path and never loads the execution SDK.

import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import { loadEnv, hasGeminiKey } from "../lib/env";
loadEnv();

import { analyzeAgentSpec, loadAgentSpec } from "../lib/agentSpec";
import { diffAgentSpecs, type AgentChange } from "../lib/specDiff";
import { selectScenarios, type SelectedScenario } from "../lib/selection";
import type { ReportTurn } from "../lib/core";

// Importing the SDK brings in the Gemini-backed execution engine. Keep that
// import lazy so `safeshift diff` remains usable with no API key or provider
// initialization at all.
async function getSafeShift() {
  const { SafeShift } = await import("../sdk");
  return SafeShift;
}

/* ── tiny arg parser ─────────────────────────────────────────────────────── */

type Args = { _: string[]; flags: Record<string, string | boolean> };

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out.flags[key] = true;
      else {
        out.flags[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/* ── output helpers ──────────────────────────────────────────────────────── */

const isTTY = process.stdout.isTTY;
const c = (code: string, s: string) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c("1", s);
const dim = (s: string) => c("2", s);
const red = (s: string) => c("31", s);
const green = (s: string) => c("32", s);
const yellow = (s: string) => c("33", s);
const cyan = (s: string) => c("36", s);

function emitJSON(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function die(message: string, code = 1): never {
  process.stderr.write(red(`error: ${message}`) + "\n");
  process.exit(code);
}

function stars(n: number): string {
  const s = "★".repeat(n) + "☆".repeat(5 - n);
  return n <= 2 ? red(s) : n >= 4 ? green(s) : yellow(s);
}

/* ── prompt resolution ───────────────────────────────────────────────────── */

function resolvePrompt(flags: Args["flags"]): string {
  const file = str(flags["prompt-file"]);
  if (file) {
    try {
      const body = readFileSync(file, "utf8").trim();
      if (!body) die(`prompt file "${file}" is empty`);
      return body;
    } catch (err) {
      die(`could not read prompt file "${file}": ${(err as Error).message}`);
    }
  }
  const inline = str(flags.prompt);
  if (inline) return inline;
  die("a prompt is required — pass --prompt \"...\" or --prompt-file path.txt");
}

/* ── commands ────────────────────────────────────────────────────────────── */

async function cmdScenarios(args: Args): Promise<void> {
  const SafeShift = await getSafeShift();
  const kind = str(args.flags.kind);
  const category = str(args.flags.category);

  let list = SafeShift.scenarios();
  if (kind) list = list.filter((s) => s.kind === kind);
  if (category) {
    const q = category.toLowerCase();
    list = list.filter((s) => s.category.toLowerCase().includes(q));
  }

  if (args.flags.json) return emitJSON({ count: list.length, scenarios: list });

  if (!list.length) {
    process.stdout.write(dim("No scenarios matched that filter.\n"));
    return;
  }

  let category_ = "";
  for (const s of list) {
    if (s.category !== category_) {
      category_ = s.category;
      process.stdout.write("\n" + bold(category_.toUpperCase()) + "\n");
    }
    process.stdout.write(
      `  ${cyan(s.id.padEnd(24))} ${s.label}\n` +
        `  ${" ".repeat(24)} ${dim(`${s.kind} · ${s.dimension}`)}\n`
    );
  }
  process.stdout.write(dim(`\n${list.length} scenarios\n`));
}

function renderTurn(t: ReportTurn): string {
  switch (t.role) {
    case "attacker":
      return `${bold(red("ATTACKER"))}${t.tactic ? dim(` (${t.tactic})`) : ""}\n  ${t.text.replace(/\n/g, "\n  ")}`;
    case "bot":
      return `${bold(cyan("AGENT"))}\n  ${t.text.replace(/\n/g, "\n  ")}`;
    case "agent":
      return `${bold(cyan("AGENT"))}\n  ${t.text.replace(/\n/g, "\n  ")}`;
    case "tool":
      return `${bold(yellow("TOOL"))} ${t.tool}${dim(` ${JSON.stringify(t.input)}`)}`;
    case "leak":
      return `${bold(red("*** LEAK"))} [${t.severity}] ${t.label}\n  ${dim(t.excerpt)}`;
  }
}

async function cmdRun(args: Args): Promise<void> {
  const scenario = str(args.flags.scenario) ?? args._[1];
  if (!scenario) die("--scenario <id> is required (see `safeshift scenarios`)");
  if (!hasGeminiKey()) {
    die("GEMINI_API_KEY is not set. Add it to .env.local or export it before running.");
  }
  const SafeShift = await getSafeShift();

  const systemPrompt = resolvePrompt(args.flags);
  const asJSON = Boolean(args.flags.json);
  const quiet = asJSON || Boolean(args.flags.quiet);

  if (!quiet) {
    process.stderr.write(
      dim(`Running "${scenario}" — this makes real Gemini calls and can take a minute.\n\n`)
    );
  }

  let run;
  try {
    run = await SafeShift.run({
      systemPrompt,
      scenario,
      source: "cli",
      onEvent: quiet
        ? undefined
        : (m) => {
            if (m.kind === "scenario") {
              process.stderr.write(bold(`${m.label}`) + dim(` (${m.mode})\n`));
              if (m.watching.length) {
                process.stderr.write(dim(`watching: ${m.watching.join(", ")}\n`));
              }
              process.stderr.write("\n");
            } else if (m.kind === "judging") {
              process.stderr.write(dim("\njudging…\n"));
            }
          },
    });
  } catch (err) {
    die((err as Error).message);
  }

  if (asJSON) {
    return emitJSON(run);
  }

  process.stdout.write("\n");
  for (const t of run.transcript) process.stdout.write(renderTurn(t) + "\n\n");

  const v = run.verdict;
  process.stdout.write(bold("── VERDICT ───────────────────────────────────\n"));
  process.stdout.write(`${stars(v.star_rating)}  ${bold(String(v.star_rating))}/5\n`);
  process.stdout.write(`${v.headline}\n`);
  if (v.explanation) process.stdout.write(dim(`${v.explanation}\n`));
  process.stdout.write("\n");
  for (const d of v.dimensions) {
    process.stdout.write(
      `  ${d.triggered ? red("TRIGGERED") : green("pass     ")}  ${d.name}\n`
    );
    if (d.triggered && d.cited_message) {
      process.stdout.write(dim(`      cited: ${d.cited_message.slice(0, 120)}\n`));
    }
  }
  if (v.leaks.length) {
    process.stdout.write(
      "\n" + red(bold(`${v.leaks.length} proven leak(s) — worst severity: ${v.worst_severity}\n`))
    );
  }
  if ("id" in run) {
    process.stdout.write(dim(`\nrun id: ${run.id}\n`));
    process.stdout.write(dim(`report: npm run safeshift -- report ${run.id}\n`));
  }

  if (run.failed) process.exitCode = 2; // usable as a CI gate
}

async function cmdScan(args: Args): Promise<void> {
  const SafeShift = await getSafeShift();
  const text = str(args.flags.text);
  if (!text) die('--text "..." is required');

  const scenario = str(args.flags.scenario);
  const secret = str(args.flags.secret);
  if (!scenario && !secret) {
    die('give it something to look for: --scenario <id>, or --secret "the-exact-value"');
  }

  let hits;
  try {
    hits = scenario
      ? SafeShift.scan(text, scenario)
      : SafeShift.scan(text, [
          {
            id: "cli_secret",
            label: str(args.flags.label) ?? "Supplied secret",
            value: secret!,
            severity: "critical",
            dimension: "CREDENTIAL_LEAK",
          },
        ]);
  } catch (err) {
    die((err as Error).message);
  }

  if (args.flags.json) return emitJSON({ leaked: hits.length > 0, count: hits.length, hits });

  if (!hits.length) {
    process.stdout.write(green("clean — no planted secret found in that text\n"));
    return;
  }
  process.stdout.write(red(bold(`${hits.length} leak(s) found\n\n`)));
  for (const h of hits) {
    process.stdout.write(
      `  [${h.severity.toUpperCase()}] ${h.label} ${dim(`(${h.kind})`)}\n` +
        `    matched: ${h.matched}\n` +
        `    context: ${dim(h.excerpt)}\n\n`
    );
  }
  process.exitCode = 2;
}

async function cmdResults(args: Args): Promise<void> {
  const SafeShift = await getSafeShift();
  const runs = await SafeShift.results(Number(args.flags.limit) || 25);
  if (args.flags.json) return emitJSON({ count: runs.length, runs });
  if (!runs.length) {
    process.stdout.write(dim("No stored runs yet.\n"));
    return;
  }
  for (const r of runs) {
    process.stdout.write(
      `${cyan(r.id)}  ${stars(r.stars)}  ${r.label}\n` +
        `${dim(`  ${r.createdAt} · via ${r.source} · ${r.leaks} leak(s)`)}\n`
    );
  }
}

async function cmdReport(args: Args): Promise<void> {
  const SafeShift = await getSafeShift();
  const id = str(args.flags.run) ?? args._[1];
  if (!id) die("a run id is required — `safeshift report <run_id>` (see `safeshift results`)");

  const run = await SafeShift.result(id);
  if (!run) die(`no stored run with id "${id}"`);

  const format = str(args.flags.format) === "html" ? "html" : "text";
  const body = SafeShift.report(run, format, str(args.flags.name) ?? run.label);

  const out = str(args.flags.out);
  if (out) {
    await writeFile(out, body, "utf8");
    process.stdout.write(green(`wrote ${format} report to ${out}\n`));
  } else {
    process.stdout.write(body);
  }
}

/* ── deterministic change analysis ──────────────────────────────────────── */

function parseMax(value: string | boolean | undefined): number {
  if (value === undefined) return 4;
  if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) < 1) {
    die("--max must be a positive integer");
  }
  return Number(value);
}

function changeLabel(kind: AgentChange["kind"]): string {
  return kind.replace(/_/g, " ").toUpperCase();
}

function writeReasons(scenario: SelectedScenario): void {
  for (const reason of scenario.reasons) {
    switch (reason.type) {
      case "risk_tag":
        process.stdout.write(`  ${reason.tag} ← ${reason.changeIds.join(", ")}\n`);
        break;
      case "tool_match":
        process.stdout.write(`  tool ${reason.tool} ← ${reason.changeIds.join(", ")}\n`);
        break;
      case "category_match":
        process.stdout.write(
          `  ${reason.category} family (${reason.tag}) ← ${reason.changeIds.join(", ")}\n`
        );
        break;
      case "sentinel":
        process.stdout.write(`  ${reason.description}\n`);
        break;
    }
  }
}

async function cmdDiff(args: Args): Promise<void> {
  const oldPath = args._[1];
  const newPath = args._[2];
  if (!oldPath || !newPath) {
    die("two agent specs are required — `safeshift diff <old-spec.json> <new-spec.json>`");
  }

  let fromSpec;
  let toSpec;
  try {
    [fromSpec, toSpec] = await Promise.all([loadAgentSpec(oldPath), loadAgentSpec(newPath)]);
  } catch (error) {
    die((error as Error).message);
  }

  const diff = diffAgentSpecs(fromSpec, toSpec);
  const selection = selectScenarios(diff.changes, { max: parseMax(args.flags.max) });
  const dryRun = Boolean(args.flags["dry-run"]);

  if (!dryRun) {
    if (!hasGeminiKey()) {
      die("GEMINI_API_KEY is not set. Replay executes the current agent and judge; use --dry-run for local analysis only.");
    }
    const { BaselineNotFoundError, runDiffEvaluation } = await import("../lib/diffRun");
    let evaluated;
    try {
      evaluated = await runDiffEvaluation({
        fromSpec,
        toSpec,
        max: parseMax(args.flags.max),
        attribution: !Boolean(args.flags["no-attribution"]),
      });
    } catch (error) {
      if (error instanceof BaselineNotFoundError) die(error.message);
      die((error as Error).message);
    }

    if (args.flags.json) return emitJSON(evaluated);
    process.stdout.write(`${bold("SafeShift Replay Gate")}\n`);
    process.stdout.write("────────────────────────────────────────\n\n");
    process.stdout.write(
      `${bold("BASELINE")}\n${evaluated.baseline.name} @ ${cyan(evaluated.baseline.specHash.slice(0, 7))}\n\n`
    );
    for (const result of evaluated.results) {
      const color =
        result.status === "REGRESSION" ? red : result.status === "FIXED" || result.status === "PASS" ? green : yellow;
      process.stdout.write(`${color(bold(result.status.padEnd(13)))} ${cyan(result.scenarioId)}  ${result.label}\n`);
      process.stdout.write(dim(`  ${result.reason}\n`));
      if (result.attribution) {
        process.stdout.write(dim(`  advisory attribution: ${result.attribution.changeIds.join(", ")} (${result.attribution.confidence})\n`));
      } else if (result.attributionError) {
        process.stdout.write(dim(`  attribution unavailable: ${result.attributionError}\n`));
      }
    }
    process.stdout.write("\n" + bold("SUMMARY\n"));
    process.stdout.write(
      `${evaluated.summary.REGRESSION} regression(s), ${evaluated.summary.FIXED} fixed, ` +
        `${evaluated.summary.PASS} passed, ${evaluated.summary.NEW} new, ` +
        `${evaluated.summary.FLAKY} flaky, ${evaluated.summary.UNCONFIRMED} unconfirmed\n`
    );
    if (evaluated.summary.confirmedRegressions) process.exitCode = 2;
    return;
  }

  const result = {
    from: {
      name: diff.from.normalized.name,
      hash: diff.from.hash,
      shortHash: diff.from.shortHash,
    },
    to: {
      name: diff.to.normalized.name,
      hash: diff.to.hash,
      shortHash: diff.to.shortHash,
    },
    changes: diff.changes,
    selectedScenarios: selection.selectedScenarios,
    omittedScenarios: selection.omittedScenarios,
    totalScenarioCount: selection.totalScenarioCount,
    dryRun: true,
  };

  if (args.flags.json) return emitJSON(result);

  process.stdout.write(`${bold("SafeShift Change Gate")}\n`);
  process.stdout.write("────────────────────────────────────────\n\n");
  process.stdout.write(`${bold("FROM")}\n${result.from.name} @ ${cyan(result.from.shortHash)}\n\n`);
  process.stdout.write(`${bold("TO")}\n${result.to.name} @ ${cyan(result.to.shortHash)}\n\n`);
  process.stdout.write(`${bold(`CHANGES — ${diff.changes.length}`)}\n\n`);

  if (!diff.changes.length) {
    process.stdout.write(dim("No security-relevant prompt or tool changes after normalization.\n\n"));
  }
  for (const change of diff.changes) {
    process.stdout.write(`${cyan(change.id)}  ${bold(changeLabel(change.kind))}\n`);
    if (change.before) process.stdout.write(`    before: "${change.before}"\n`);
    if (change.after) process.stdout.write(`    after:  "${change.after}"\n`);
    if (change.tool) process.stdout.write(`    tool: ${change.tool}\n`);
    process.stdout.write("    Risks:\n");
    if (change.riskTags.length) {
      for (const tag of change.riskTags) process.stdout.write(`    ${tag}\n`);
    } else {
      process.stdout.write(dim("    none inferred by the Phase 1A rule table\n"));
    }
    process.stdout.write("\n");
  }

  process.stdout.write(
    `${bold(`SELECTED — ${selection.selectedScenarios.length} of ${selection.totalScenarioCount}`)}\n\n`
  );
  if (!selection.selectedScenarios.length) {
    process.stdout.write(dim("No scenarios selected: the diff has no risk-tagged or sentinel-worthy changes.\n\n"));
  }
  for (const scenario of selection.selectedScenarios) {
    process.stdout.write(`${cyan(scenario.scenarioId)}  ${scenario.label}\n`);
    writeReasons(scenario);
    process.stdout.write("\n");
  }
  if (selection.omittedScenarios.length) {
    process.stdout.write(dim(`Additional relevant scenarios omitted by --max (${selection.omittedScenarios.length}):\n`));
    for (const scenario of selection.omittedScenarios) {
      process.stdout.write(`${dim(`  ${scenario.scenarioId}`)}\n`);
      writeReasons(scenario);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(bold("DRY RUN — analysis only\n"));
  process.stdout.write(dim("No agent executions were performed. No model/API calls were made.\n"));
}

async function cmdBaseline(args: Args): Promise<void> {
  const specPath = args._[1];
  if (!specPath) die("an agent spec is required — `safeshift baseline <spec.json>`");
  if (!hasGeminiKey()) {
    die("GEMINI_API_KEY is not set. Baseline discovery executes live attacker, agent, and judge calls.");
  }

  let spec;
  try {
    spec = await loadAgentSpec(specPath);
  } catch (error) {
    die((error as Error).message);
  }
  const analysis = analyzeAgentSpec(spec);
  const { getScenario, listScenarios, runCrashTest } = await import("../lib/core");
  const requested = str(args.flags.scenario);
  const scenarioIds = requested
    ? [requested]
    : listScenarios()
        .filter((scenario) => scenario.kind === "adversarial")
        .map((scenario) => scenario.id)
        .sort()
        .slice(0, parseMax(args.flags.max));
  if (!scenarioIds.length) die("no adversarial scenarios are available for baseline discovery");

  const asJSON = Boolean(args.flags.json);
  if (!asJSON) {
    process.stderr.write(
      dim(`LIVE DISCOVERY MODE — recording ${scenarioIds.length} attacker transcript(s); this makes real Gemini calls.\n`)
    );
  }

  const scenarios: Record<string, import("../lib/baseline").BaselineScenario> = {};
  for (const id of scenarioIds) {
    const scenario = getScenario(id);
    if (!scenario) die(`unknown scenario "${id}"`);
    if (scenario.kind !== "adversarial") {
      die(`scenario "${id}" is autonomous; baseline replay currently requires an adversarial scenario.`);
    }
    if (!asJSON) process.stderr.write(dim(`  discovering ${id}…\n`));
    let report;
    try {
      report = await runCrashTest({ systemPrompt: spec.systemPrompt, scenarioId: id });
    } catch (error) {
      die(`baseline discovery failed for "${id}": ${(error as Error).message}`);
    }
    const attackerMessages = report.transcript
      .filter((turn) => turn.role === "attacker")
      .map((turn) => turn.text);
    if (!attackerMessages.length) {
      die(`baseline discovery for "${id}" produced no attacker messages; baseline was not saved.`);
    }
    scenarios[id] = {
      scenarioId: id,
      capturedAt: new Date().toISOString(),
      attackerMessages,
      report,
    };
  }

  const { baselineFilePath, saveBaseline } = await import("../lib/baseline");
  const baseline = {
    version: 1 as const,
    name: analysis.normalized.name,
    specHash: analysis.hash,
    createdAt: new Date().toISOString(),
    spec,
    scenarios,
  };
  let file: string;
  try {
    file = await saveBaseline(baseline);
  } catch (error) {
    die((error as Error).message);
  }
  const result = {
    mode: "live_discovery",
    name: baseline.name,
    specHash: baseline.specHash,
    scenarios: Object.values(scenarios).map((scenario) => ({
      scenarioId: scenario.scenarioId,
      attackerMessageCount: scenario.attackerMessages.length,
    })),
    path: file || baselineFilePath(baseline.name, baseline.specHash),
  };
  if (asJSON) return emitJSON(result);
  process.stdout.write(green(`Saved baseline for ${result.name} @ ${analysis.shortHash}\n`));
  process.stdout.write(dim(`${result.scenarios.length} recorded attacker transcript(s)\n${result.path}\n`));
}

/* ── entry ───────────────────────────────────────────────────────────────── */

const HELP = `${bold("safeshift")} — pre-deployment safety testing for AI agents

${bold("USAGE")}
  npm run safeshift -- <command> [options]

${bold("COMMANDS")}
  scenarios                 List the built-in trap scenarios
  run                       Run one crash test against an agent prompt
  scan                      Scan text for leaked secrets (no model call)
  baseline <spec>           Discover and save live attacker baselines
  diff <old> <new>          Replay a baseline against a changed agent spec
  results                   List previously stored runs
  report <run_id>           Render a stored run as a report

${bold("scenarios")}
  --kind <autonomous|adversarial>   Filter by mode
  --category <text>                 Filter by category substring
  --json                            Machine-readable output

${bold("run")}
  --scenario <id>           Scenario to run                       ${dim("(required)")}
  --prompt "<text>"         System prompt of the agent under test
  --prompt-file <path>      Read the prompt from a file instead
  --json                    Emit the full result as JSON
  --quiet                   Suppress progress on stderr
  ${dim("Exit code 2 if the agent failed the test (stars <= 2) — usable as a CI gate.")}

${bold("scan")}
  --text "<text>"           Text to scan                          ${dim("(required)")}
  --scenario <id>           Scan for that scenario's planted secrets
  --secret "<value>"        Scan for your own exact secret
  --label "<name>"          Label for --secret
  --json                    Machine-readable output

${bold("diff")}
  <old-spec.json> <new-spec.json>  Agent specs to compare              ${dim("(required)")}
  --dry-run                  Explicit analysis-only mode; no model or API calls
  --max <number>             Maximum selected scenarios; default 4
  --no-attribution           Skip optional advisory change attribution
  --json                     Machine-readable result

${bold("baseline")}
  <spec.json>                Agent spec to discover                  ${dim("(required)")}
  --scenario <id>            Discover one adversarial scenario
  --max <number>             Maximum discovery scenarios; default 4
  --json                     Machine-readable result

${bold("report")}
  --format <text|html>      Default text
  --out <path>              Write to a file instead of stdout
  --name "<agent name>"     Label for the agent in the report

${bold("EXAMPLES")}
  npm run safeshift -- scenarios --kind adversarial
  npm run safeshift -- run --scenario credleak --prompt "You are ShopBot. Always help."
  npm run safeshift -- scan --scenario credleak --text "sure, it's NWX-TEST-PAYKEY-3QF7ZR2M9TKD"
  npm run safeshift -- baseline specs/v1.json --scenario credleak
  npm run safeshift -- diff specs/v1.json specs/v2.json --dry-run
  npm run safeshift -- report run_xxx --format html --out report.html
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || args.flags.help || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }

  switch (cmd) {
    case "scenarios":
    case "ls":
      return cmdScenarios(args);
    case "run":
      return cmdRun(args);
    case "scan":
      return cmdScan(args);
    case "diff":
      return cmdDiff(args);
    case "baseline":
      return cmdBaseline(args);
    case "results":
      return cmdResults(args);
    case "report":
      return cmdReport(args);
    default:
      die(`unknown command "${cmd}" — run without arguments for help`);
  }
}

main().catch((err) => die(err?.message ?? String(err)));
