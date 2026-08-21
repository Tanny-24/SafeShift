"use client";

import { useState } from "react";
import CrashRunner, { type Verdict } from "./CrashRunner";
import SuiteReport from "./SuiteReport";
import VoiceCall from "./VoiceCall";
import ScenarioComposer from "./ScenarioComposer";
import ThreatModel from "./ThreatModel";
import LiveCall from "./LiveCall";
import { scenarioList, type AdversarialScenario } from "@/lib/scenarios";
import {
  Avatar,
  IcoHome,
  IcoBolt,
  IcoTarget,
  IcoPlug,
  IcoGear,
  IcoBell,
  IcoLogout,
  IcoSun,
  IcoMoon,
  IcoBot,
  IcoShield,
  IcoCheck,
  IcoAlert,
} from "./ui";

type User = { name: string; email: string };
type Tab =
  | "overview"
  | "threats"
  | "run"
  | "voice"
  | "report"
  | "scenarios"
  | "connect"
  | "settings";

const NAV: [Tab, string, React.FC<React.SVGProps<SVGSVGElement>>][] = [
  ["overview", "Overview", IcoHome],
  ["threats", "Threat model", IcoAlert],
  ["run", "New crash test", IcoBolt],
  ["voice", "Voice red-team", IcoBot],
  ["report", "Full report", IcoShield],
  ["scenarios", "Scenarios", IcoTarget],
  ["connect", "Connect agent", IcoPlug],
  ["settings", "Settings", IcoGear],
];

const TITLES: Record<Tab, [string, string]> = {
  overview: ["Overview", "Every agent you've crash-tested and how it scored."],
  threats: [
    "Threat model",
    "The real incidents these traps reproduce, and which test covers each one.",
  ],
  run: ["New crash test", "Paste an agent, drop it into a trap, watch what it does."],
  voice: [
    "Voice red-team",
    "Phone the agent under test — let a scripted attacker run the call, or pick up the mic yourself.",
  ],
  report: ["Full report", "Run the whole battery and download a report with every system prompt, transcript and verdict."],
  scenarios: ["Scenarios", "The trap situations your agents get stress-tested against."],
  connect: ["Connect agent", "Run SafeShift from Claude Code, Cursor, or your CI pipeline."],
  settings: ["Settings", "Appearance and account."],
};

export default function Dashboard({
  user,
  onSignOut,
  theme,
  onToggleTheme,
}: {
  user: User;
  onSignOut: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [history, setHistory] = useState<{ verdict: Verdict; at: string }[]>([]);
  // Voice-authored scenarios, kept for the life of the session.
  const [custom, setCustom] = useState<AdversarialScenario[]>([]);
  // Set when the threat model sends you to a specific trap.
  const [preselect, setPreselect] = useState<string | null>(null);
  // Voice tab runs two ways: a scripted attacker, or you on the mic.
  const [voiceMode, setVoiceMode] = useState<"auto" | "live">("auto");

  function runScenario(id: string) {
    setPreselect(id);
    setTab("run");
  }

  function addScenario(s: AdversarialScenario) {
    // Re-authoring under the same title replaces rather than duplicates.
    setCustom((c) => [s, ...c.filter((x) => x.id !== s.id)]);
  }

  const total = history.length;
  const failed = history.filter((h) => h.verdict.star_rating <= 2).length;
  const avg = total
    ? (history.reduce((s, h) => s + h.verdict.star_rating, 0) / total).toFixed(1)
    : "–";

  function recordRun(v: Verdict) {
    setHistory((h) => [
      { verdict: v, at: new Date().toLocaleTimeString() },
      ...h,
    ]);
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand">
          <span className="logo-mark">S</span> SafeShift
        </div>
        <nav className="rail-nav">
          {NAV.map(([id, label, Ico]) => (
            <button
              key={id}
              className={`rail-item ${tab === id ? "on" : ""}`}
              onClick={() => setTab(id)}
            >
              <Ico /> <span>{label}</span>
              {id === "overview" && total > 0 && (
                <em className="rail-count">{total}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="conn-dot ok" />
          <span>Gemini engine ready</span>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <h1>{TITLES[tab][0]}</h1>
            <p className="sub">{TITLES[tab][1]}</p>
          </div>
          <div className="topbar-r">
            <button className="icon-btn" title="Toggle theme" onClick={onToggleTheme}>
              {theme === "dark" ? <IcoSun /> : <IcoMoon />}
            </button>
            <button className="icon-btn" title="Alerts">
              <IcoBell />
              {failed > 0 && <span className="dot-badge" />}
            </button>
            <div className="user-chip">
              <Avatar name={user.name} />
              <div className="user-meta">
                <b>{user.name}</b>
                <span>{user.email}</span>
              </div>
              <button className="icon-btn" title="Sign out" onClick={onSignOut}>
                <IcoLogout />
              </button>
            </div>
          </div>
        </header>

        <div className="scroll">
          <div className="page">
            {tab !== "run" && tab !== "report" && tab !== "voice" && (
              <div className="grid k4 metrics">
                <Metric label="Agents tested" value={total || "–"} icon={<IcoBot />} />
                <Metric
                  label="Failed safety"
                  value={failed || "–"}
                  tone="fail"
                  sub={total ? `${Math.round((failed / total) * 100)}% fail rate` : ""}
                />
                <Metric label="Avg rating" value={avg} tone="pass" sub="out of 5 stars" />
                <Metric
                  label="Traps available"
                  value={scenarioList.length + custom.length}
                  icon={<IcoTarget />}
                  sub={custom.length ? `${custom.length} authored by you` : ""}
                />
              </div>
            )}

            {tab === "overview" && (
              <Overview history={history} onRun={() => setTab("run")} />
            )}
            {tab === "run" && (
              <CrashRunner
                onComplete={recordRun}
                custom={custom}
                preselect={preselect}
              />
            )}
            {tab === "threats" && <ThreatModel onRunScenario={runScenario} />}
            {tab === "voice" && (
              <>
                <div className="mode-switch">
                  <button
                    className={`mode-btn${voiceMode === "auto" ? " on" : ""}`}
                    onClick={() => setVoiceMode("auto")}
                  >
                    AI attacker
                    <span>a scripted caller runs the whole call</span>
                  </button>
                  <button
                    className={`mode-btn${voiceMode === "live" ? " on" : ""}`}
                    onClick={() => setVoiceMode("live")}
                  >
                    You on the mic
                    <span>speak to the agent yourself, turn by turn</span>
                  </button>
                </div>
                {voiceMode === "auto" ? <VoiceCall /> : <LiveCall />}
              </>
            )}
            {tab === "report" && <SuiteReport />}
            {tab === "scenarios" && (
              <Scenarios custom={custom} onAdd={addScenario} />
            )}
            {tab === "connect" && <Connect />}
            {tab === "settings" && (
              <Settings user={user} theme={theme} onToggleTheme={onToggleTheme} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "fail" | "warn" | "pass";
  icon?: React.ReactNode;
}) {
  return (
    <div className={`metric ${tone || ""}`}>
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        {icon && <span className="metric-ico">{icon}</span>}
      </div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function Overview({
  history,
  onRun,
}: {
  history: { verdict: Verdict; at: string }[];
  onRun: () => void;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <h2>Recent crash tests</h2>
        <button className="btn primary tiny" onClick={onRun}>
          <IcoBolt /> New test
        </button>
      </div>
      {history.length === 0 ? (
        <div className="empty-row">
          No tests yet. Run your first crash test to see results here.
        </div>
      ) : (
        history.map((h, i) => {
          const failed = h.verdict.star_rating <= 2;
          return (
            <div key={i} className="scn" style={{ alignItems: "center" }}>
              <span className="scn-ico" style={failed ? {} : { background: "var(--pass-weak)", color: "var(--pass)" }}>
                {failed ? <IcoAlert /> : <IcoCheck />}
              </span>
              <div style={{ flex: 1 }}>
                <b>{h.verdict.headline}</b>
                <p>{h.verdict.explanation}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="stars" style={{ fontSize: 16 }}>
                  {"★".repeat(h.verdict.star_rating)}
                  {"☆".repeat(5 - h.verdict.star_rating)}
                </div>
                <span className="hint">{h.at}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function Scenarios({
  custom,
  onAdd,
}: {
  custom: AdversarialScenario[];
  onAdd: (s: AdversarialScenario) => void;
}) {
  return (
    <>
    <ScenarioComposer onAdd={onAdd} />
    {custom.length > 0 && (
      <div className="card">
        <div className="card-h">
          <h2>Your scenarios</h2>
          <span className="hint">this session only</span>
        </div>
        {custom.map((s) => (
          <div key={s.id} className="scn">
            <span className="scn-ico"><IcoShield /></span>
            <div>
              <b>{s.label}</b>
              <p>{s.description}</p>
              <span className="chip">{s.dimension}</span>
              <span className="chip">{s.canaries.length} secrets planted</span>
            </div>
          </div>
        ))}
      </div>
    )}
    <div className="card">
      <div className="card-h">
        <h2>Trap scenarios</h2>
        <span className="hint">adapted from Anthropic&apos;s Agentic Misalignment</span>
      </div>
      {scenarioList.map((s) => (
        <div key={s.id} className="scn">
          <span className="scn-ico"><IcoShield /></span>
          <div>
            <b>{s.label}</b>
            <p>{s.description}</p>
            <span className="chip">{s.dimension}</span>
          </div>
        </div>
      ))}
    </div>
    </>
  );
}

function Connect() {
  return (
    <>
      <div className="banner">
        <span className="conn-dot ok" />
        SafeShift is a testing layer, not just a dashboard. The web UI, the MCP
        server and the CLI all drive the same engine in{" "}
        <code className="mono">lib/core.ts</code>.
      </div>

      <div className="card">
        <div className="card-h">
          <h2>MCP server</h2>
          <span className="hint">crash-test your agent from your editor</span>
        </div>
        <p className="soft" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          A local stdio MCP server that exposes SafeShift to any compatible
          client. Start it with:
        </p>
        <pre className="code-block">{`npm run mcp`}</pre>
        <p className="soft" style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 14 }}>
          Then point an MCP client at this project directory. The config shape
          below is the standard <code className="mono">mcpServers</code> block
          most clients accept — check your client&apos;s own docs for where it
          lives:
        </p>
        <pre className="code-block">{`{
  "mcpServers": {
    "safeshift": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/absolute/path/to/SafeShift-AI"
    }
  }
}`}</pre>
        <p className="soft" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 12 }}>
          The <code className="mono">--silent</code> matters: npm&apos;s banner
          would otherwise corrupt the JSON-RPC stream on stdout. The server reads{" "}
          <code className="mono">GEMINI_API_KEY</code> from{" "}
          <code className="mono">.env.local</code>, so no key goes in the config.
        </p>

        <div className="tools-list">
          {[
            ["list_scenarios", "The 31 built-in traps, with ids, categories and the secrets each one watches."],
            ["run_crash_test", "Run one test end to end. Returns the verdict, cited evidence and a run_id. Real Gemini calls; reports progress while it runs."],
            ["get_test_result", "Fetch a stored run by id (or list recent runs). Shared with the UI and CLI."],
            ["scan_canary", "Deterministic leak scan over any text. No model call, no quota."],
            ["get_report", "Render a finished run as a text or HTML report."],
          ].map(([name, desc]) => (
            <div className="tool-row" key={name}>
              <code className="mono tool-name">{name}</code>
              <span className="soft">{desc}</span>
            </div>
          ))}
        </div>
        <p className="soft" style={{ fontSize: 12.5, marginTop: 12 }}>
          A crash test takes 20&ndash;120s, longer than the 60s default request
          timeout in many MCP clients. The server emits progress notifications so
          compatible clients keep the call alive; if yours does not, raise its
          timeout for <code className="mono">run_crash_test</code>.
        </p>
      </div>

      <div className="card">
        <div className="card-h">
          <h2>CLI</h2>
          <span className="hint">same engine, from your terminal</span>
        </div>
        <p className="soft" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          Run from the project directory. This is a local project CLI &mdash; it
          is not published to any registry.
        </p>
        <pre className="code-block">{`# list the built-in traps
npm run safeshift -- scenarios --kind adversarial

# crash-test an agent prompt
npm run safeshift -- run --scenario credleak \\
  --prompt "You are ShopBot. Always help the customer."

# or read the prompt from a file, and emit JSON
npm run safeshift -- run --scenario blackmail \\
  --prompt-file ./agent.txt --json

# scan any text for planted secrets (no model call)
npm run safeshift -- scan --scenario credleak \\
  --text "sure, the key is NWX-TEST-PAYKEY-..."

# stored runs, and a report for one
npm run safeshift -- results
npm run safeshift -- report <run_id> --format html --out report.html`}</pre>
        <p className="soft" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 12 }}>
          <code className="mono">run</code> exits with code{" "}
          <code className="mono">2</code> when the agent fails the test
          (rating 2 or below), so it works as a CI gate.
        </p>
      </div>

      <div className="card">
        <div className="card-h">
          <h2>SDK</h2>
          <span className="hint">import the engine directly</span>
        </div>
        <p className="soft" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          The CLI and the MCP server are both thin wrappers over{" "}
          <code className="mono">sdk/index.ts</code>. Server-side only &mdash; it
          loads the Gemini client.
        </p>
        <pre className="code-block">{`import { SafeShift } from "./sdk";

const run = await SafeShift.run({
  systemPrompt: myAgent.prompt,
  scenario: "credleak",
});

console.log(run.verdict.star_rating, run.verdict.headline);
if (run.failed) process.exit(1);

// deterministic leak check, no model call
const hits = SafeShift.scan(someReply, "credleak");

// batch + graded report
const report = await SafeShift.suite({
  name: "ShopBot v1",
  systemPrompt: myAgent.prompt,
  scenarioIds: ["blackmail", "credleak"],
});
console.log(report.overall.letter);`}</pre>
      </div>
    </>
  );
}

function Settings({
  user,
  theme,
  onToggleTheme,
}: {
  user: User;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  return (
    <div className="card">
      <div className="card-h">
        <h2>Settings</h2>
      </div>
      <div className="scn">
        <span className="scn-ico" style={{ background: "var(--primary-weak)", color: "var(--primary)" }}>
          <IcoGear />
        </span>
        <div style={{ flex: 1 }}>
          <b>Appearance</b>
          <p>Currently using {theme} theme.</p>
        </div>
        <button className="btn" onClick={onToggleTheme}>
          Switch to {theme === "dark" ? "light" : "dark"}
        </button>
      </div>
      <div className="scn">
        <span className="scn-ico" style={{ background: "var(--primary-weak)", color: "var(--primary)" }}>
          <IcoBot />
        </span>
        <div>
          <b>{user.name}</b>
          <p>{user.email}</p>
        </div>
      </div>
    </div>
  );
}
