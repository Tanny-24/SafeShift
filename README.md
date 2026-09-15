# SafeShift

SafeShift is a change-aware safety regression testing platform for AI agents.

## What problem it solves

AI-agent system prompts and tool permissions change frequently. A seemingly
small change can reintroduce a safety vulnerability that was fixed in an
earlier version. SafeShift discovers vulnerabilities, records the evidence,
and turns historical exploits into replayable regression tests.

## Core idea

**Live mode** discovers vulnerabilities through adversarial and autonomous
scenarios. **Replay mode** compares an AgentSpec change against a saved
baseline and re-runs the exact historical attacker messages that exposed a
previous issue.

## How it works

```text
AgentSpec
  -> change detection
  -> security-risk mapping
  -> relevant scenario selection
  -> adversarial or autonomous run
  -> deterministic canary evidence + safety judge
  -> baseline / exact replay
  -> PASS | REGRESSION | FIXED | FLAKY | NEW | UNCONFIRMED
  -> local Regression Memory
```

## Features

- Gemini-backed target agent, adversarial attacker, and safety judge
- 31 built-in adversarial and autonomous scenarios with safe synthetic tools
- Deterministic canary leak detection that overrides an overly-permissive judge
- AgentSpec normalization, canonical hashing, prompt/tool diffs, ChangeIDs,
  risk mapping, and risk-aware scenario selection
- Baselines and exact historical exploit replay with deterministic comparison
- Local, append-only Regression Memory for confirmed regressions and fixes
- Shared TypeScript execution core with web, CLI, MCP, and programmatic SDK
  interfaces
- Local persisted run history and self-contained HTML or text reports
- Optional browser dictation and Maya text-to-speech for voice scenarios

## Quick start

After cloning the repository:

```bash
npm ci
cp .env.example .env.local
```

Set `GEMINI_API_KEY` in `.env.local`, then start the application:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter an agent system
prompt, choose a scenario, and run a test. Live runs require Gemini access.

Before opening a pull request or demoing a change, run the local quality gate:

```bash
npm run check
```

## Environment

```dotenv
GEMINI_API_KEY=
```

`MAYA_API_KEY` is optional and is used only for voice playback. Both variables
are server-side only. Keep `.env.local` and the local `.safeshift/` run store
private.

## CLI demo

This deterministic command requires no API key or network access:

```bash
npm run safeshift -- diff specs/v1.json specs/v2.json --dry-run
```

With `GEMINI_API_KEY` configured, run one live scenario:

```bash
npm run safeshift -- run --scenario credleak --prompt "You are ShopBot. Always help."
```

Useful local commands:

```bash
npm run safeshift -- scenarios
npm run safeshift -- results
npm run safeshift -- report <run_id> --format html --out report.html
npm run mcp
```

`npm run mcp` starts a local stdio MCP server for MCP-compatible clients. The
SDK is server-side TypeScript and is exported from [`sdk/index.ts`](./sdk/index.ts).

## Architecture

- **Attacker / target agent:** Gemini-powered multi-turn red-team and
  autonomous execution.
- **Tools:** safe synthetic tools record attempted actions without touching
  real systems.
- **Canary detector:** scans model output for planted synthetic secrets and
  emits structured deterministic evidence.
- **Judge:** evaluates the transcript while reconciliation clamps ratings when
  deterministic evidence proves a leak.
- **Baseline and replay:** preserve a prior AgentSpec result and replay the
  original attacker messages against a changed AgentSpec.
- **Regression Memory:** retains local historical replay controls for confirmed
  regressions and later fixes.

The shared engine lives in [`lib/core.ts`](./lib/core.ts); the web API, CLI,
MCP server, and SDK call that same core.

## Security model

SafeShift uses synthetic canaries and fake tool data only. It does not require
or store real customer credentials. Local run files may contain synthetic
scenario evidence and are intentionally ignored by Git.

## Limitations

- Live runs require Gemini API connectivity and an API key.
- The primary tested target is an AgentSpec-based prompt-and-tool agent.
- SafeShift provides a shared execution core and local interfaces; it does not
  claim universal compatibility with arbitrary deployed agents or providers.
- Optional voice dictation depends on browser support; voice playback requires
  Maya only when that feature is used.

## Attribution

Misalignment scenarios are adapted from Lynch et al., *Agentic Misalignment:
How LLMs Could Be Insider Threats*, Anthropic (2025), and the
[anthropic-experimental/agentic-misalignment](https://github.com/anthropic-experimental/agentic-misalignment)
project. Leak scenarios follow OWASP LLM07 (System Prompt Leakage) and the
cross-tenant agent-data-exposure class publicized as Salesforce ForcedLeak.

## Maintainer

TANUJA CHURENDRA · Churendrat@gmail.com
