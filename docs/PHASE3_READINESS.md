# Phase 3 Readiness Assessment

Status: **assessment only — no adapter implementation is included.**

## Score: 6/10

SafeShift already has one strong reusable boundary: `runCrashTest` in
`lib/core.ts` owns scenario resolution, orchestration, transcripts, canary
scanning, deterministic reconciliation, and the `ScenarioReport` contract.
Every public execution surface reaches that shared core through the web API,
CLI, MCP server, SDK, or suite runner.

The provider boundary is not yet isolated. `lib/agent.ts`, `lib/attacker.ts`,
`lib/judge.ts`, `lib/live.ts`, `lib/scenarioDraft.ts`, and `lib/attribute.ts`
import Gemini's `createMessage` directly. `lib/gemini.ts` also owns Gemini
schema translation, thought-signature handling, model configuration, retries,
and provider-specific error wording.

## Minimal future interface

A future provider-neutral module should own the current block-shaped request
and response contract (`messages`, text blocks, tool calls, tool results,
forced-tool choice, and token budget). `GeminiAdapter`, `HttpAdapter`, and an
`OpenAICompatAdapter` can implement that interface. The orchestration and
evaluation layers should depend on the interface, not on a provider SDK.

The adapter contract must preserve structured tool forcing for the judge,
scenario drafting, and attribution; multi-round tool conversations for agents;
and a normalized error category suitable for collection and variance failure
accounting. Provider configuration belongs behind the adapter rather than in
scenario or evaluation code.

## Migration risks

- Gemini thought signatures and function-response naming have no guaranteed
  cross-provider equivalent.
- Tool-schema subsets, forced function-call semantics, and token accounting
  differ across providers.
- Retrying must remain bounded and must not blur a provider/network failure
  into a SAFE or UNSAFE evaluation outcome.
- Existing historical replay must continue to reuse fixed attacker messages;
  an adapter change must not introduce attacker regeneration.

## Invariants to preserve

- AgentSpec normalization, hashing, diffing, risk mapping, and scenario
  selection remain deterministic and offline.
- Production canary scanner semantics and Phase 2C denominators remain
  unchanged.
- Blind examples remain separate from judge predictions and human labels.
- Regression comparison precedence remains canary evidence, cited dimensions,
  then advisory rating changes.
- Existing `runCrashTest` transcript and `ScenarioReport` consumers keep their
  behavior while provider choice changes underneath them.

## Suggested first Phase 3 step

Add a provider-neutral interface plus a deterministic fake adapter used only by
tests, then migrate the Gemini implementation behind it without changing any
scenario, scanner, regression, or evaluation semantics. Do not add a second
live provider until those contract tests pass.
