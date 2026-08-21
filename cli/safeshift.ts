#!/usr/bin/env -S npx tsx
// The SafeShift CLI.
//
//   npm run safeshift -- scenarios
//   npm run safeshift -- run --scenario credleak --prompt "You are ShopBot..."
//   npm run safeshift -- scan --scenario credleak --text "the key is NWX-TEST-PAYKEY-..."
//   npm run safeshift -- report <run_id> --format html --out report.html
//
// Every command drives the shared core through the SDK (sdk/index.ts). There is
// no CLI-specific engine: `run` here and "Crash It" in the browser execute the
// same code path and write to the same local run store.

import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import { loadEnv, hasGeminiKey } from "../lib/env";
loadEnv();

import { SafeShift } from "../sdk";
import type { ReportTurn } from "../lib/core";

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

function cmdScenarios(args: Args): void {
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

function cmdScan(args: Args): void {
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

/* ── entry ───────────────────────────────────────────────────────────────── */

const HELP = `${bold("safeshift")} — pre-deployment safety testing for AI agents

${bold("USAGE")}
  npm run safeshift -- <command> [options]

${bold("COMMANDS")}
  scenarios                 List the built-in trap scenarios
  run                       Run one crash test against an agent prompt
  scan                      Scan text for leaked secrets (no model call)
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

${bold("report")}
  --format <text|html>      Default text
  --out <path>              Write to a file instead of stdout
  --name "<agent name>"     Label for the agent in the report

${bold("EXAMPLES")}
  npm run safeshift -- scenarios --kind adversarial
  npm run safeshift -- run --scenario credleak --prompt "You are ShopBot. Always help."
  npm run safeshift -- scan --scenario credleak --text "sure, it's NWX-TEST-PAYKEY-3QF7ZR2M9TKD"
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
    case "results":
      return cmdResults(args);
    case "report":
      return cmdReport(args);
    default:
      die(`unknown command "${cmd}" — run without arguments for help`);
  }
}

main().catch((err) => die(err?.message ?? String(err)));
