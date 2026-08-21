// The single AI provider for SafeShift: Google Gemini.
//
// The engine (agent / attacker / judge / live / scenarioDraft) is written
// against a block-shaped message API — text blocks and tool_use blocks in,
// tool_result blocks back — because that is how a tool-using conversation is
// actually structured. This module keeps that shape and speaks Gemini
// underneath, so the red-team loop, the canary scan and the judge's forced
// structured output all work unchanged.
//
// Server-only. GEMINI_API_KEY is read from the environment here and never
// crosses into the client bundle: every caller lives behind an /api route.

import { GoogleGenAI } from "@google/genai";
import type { ToolDef } from "./tools";

/* ── the message shape the engine speaks ─────────────────────────────────── */

// `signature` carries Gemini 3's thought_signature. The model returns one on
// the parts it produces, and demands the same value back when that turn is
// replayed as history — a tool loop without it fails on the SECOND request
// with 400 INVALID_ARGUMENT. The engine passes blocks around opaquely, so
// keeping the value on the block is enough to round-trip it.
export type TextBlock = { type: "text"; text: string; signature?: string };

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  signature?: string;
};

export type ToolResultBlockParam = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};

export type ContentBlock = TextBlock | ToolUseBlock;

export type MessageParam = {
  role: "user" | "assistant";
  content: string | (ContentBlock | ToolResultBlockParam)[];
};

export type MessageResponse = { content: ContentBlock[] };

export type CreateParams = {
  max_tokens: number;
  system?: string;
  tools?: ToolDef[];
  // Forces the model to answer by calling one specific tool — this is how the
  // judge and the scenario drafter get structured output instead of prose.
  tool_choice?: { type: "tool"; name: string };
  messages: MessageParam[];
};

/* ── configuration ───────────────────────────────────────────────────────── */

// One model for all three roles (agent under test, attacker, judge). The roles
// are separated by prompt and tool schema, exactly as they were before.
//
// gemini-2.5-flash still appears in models.list but generateContent now returns
// 404 "no longer available to new users" for keys issued after its retirement,
// so the default has to be a current model.
//
// Model choice is also a quota decision: one crash test is a dozen-plus calls
// (attacker turn + bot turn per round, then the judge), and the newest model
// carries a free-tier allowance of only 20 requests per DAY — barely one run.
// The flash-lite tier is the only one with a free-tier allowance big enough to
// run the battery more than once a day. Override with GEMINI_MODEL if you have
// paid quota — gemini-3.5-flash and gemini-3.6-flash both judge more sharply.
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// Gemini 3 replaced 2.5's numeric `thinkingBudget` with `thinkingLevel`, and
// rejects the old field outright (400 INVALID_ARGUMENT). Reasoning tokens are
// still billed against maxOutputTokens, so keep the level low — the engine
// wants short spoken turns and structured verdicts, not visible deliberation.
const THINKING = { thinkingLevel: "low" };

// ...and because those reasoning tokens eat the same budget, a caller asking
// for a 500-token phone reply would otherwise be truncated by its own thinking.
// Give thinking its own room so max_tokens keeps meaning "output length".
const THINKING_HEADROOM = 1024;

export function apiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your key from https://aistudio.google.com/apikey"
    );
  }
  return key;
}

let cached: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!cached) cached = new GoogleGenAI({ apiKey: apiKey() });
  return cached;
}

/* ── JSON Schema -> Gemini function-declaration schema ───────────────────── */

// Gemini takes an OpenAPI-flavoured subset: uppercase type names, and no
// vocabulary beyond type/description/properties/items/required/enum. Anything
// else (additionalProperties, $schema, format hints it doesn't know) makes the
// request 400, so strip down to what it accepts.
type GeminiSchema = {
  type: string;
  description?: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  enum?: string[];
};

const TYPE_MAP: Record<string, string> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

function toGeminiSchema(node: unknown): GeminiSchema | null {
  if (!node || typeof node !== "object") return null;
  const src = node as Record<string, unknown>;

  const rawType = typeof src.type === "string" ? src.type.toLowerCase() : "string";
  const type = TYPE_MAP[rawType] ?? "STRING";
  const out: GeminiSchema = { type };

  if (typeof src.description === "string") out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = src.enum.map(String);

  if (type === "OBJECT") {
    const props = src.properties as Record<string, unknown> | undefined;
    const mapped: Record<string, GeminiSchema> = {};
    for (const [k, v] of Object.entries(props ?? {})) {
      const child = toGeminiSchema(v);
      if (child) mapped[k] = child;
    }
    // Gemini rejects an OBJECT with an empty `properties` map, so a no-argument
    // tool has to be declared with no parameters at all.
    if (Object.keys(mapped).length === 0) return null;
    out.properties = mapped;

    const required = Array.isArray(src.required)
      ? src.required.filter((r): r is string => typeof r === "string" && r in mapped)
      : [];
    if (required.length) out.required = required;
  }

  if (type === "ARRAY") {
    out.items = toGeminiSchema(src.items) ?? { type: "STRING" };
  }

  return out;
}

type FunctionDeclaration = {
  name: string;
  description: string;
  parameters?: GeminiSchema;
};

function toDeclarations(tools: ToolDef[]): FunctionDeclaration[] {
  return tools.map((t) => {
    const parameters = toGeminiSchema(t.input_schema);
    return parameters
      ? { name: t.name, description: t.description, parameters }
      : { name: t.name, description: t.description };
  });
}

/* ── messages -> Gemini contents ─────────────────────────────────────────── */

type Part =
  | { text: string; thoughtSignature?: string }
  | {
      functionCall: { name: string; args: Record<string, unknown> };
      thoughtSignature?: string;
    }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type Content = { role: "user" | "model"; parts: Part[] };

function toContents(messages: MessageParam[]): Content[] {
  // A tool_result only carries the id of the call it answers, but Gemini keys
  // its functionResponse by tool NAME. Walk forward remembering what each id
  // was, so results can be paired back up.
  const nameById = new Map<string, string>();
  const out: Content[] = [];

  for (const msg of messages) {
    const role: Content["role"] = msg.role === "assistant" ? "model" : "user";

    if (typeof msg.content === "string") {
      if (msg.content.trim()) out.push({ role, parts: [{ text: msg.content }] });
      continue;
    }

    const parts: Part[] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        if (block.text.trim()) {
          parts.push({
            text: block.text,
            ...(block.signature ? { thoughtSignature: block.signature } : {}),
          });
        }
      } else if (block.type === "tool_use") {
        nameById.set(block.id, block.name);
        parts.push({
          functionCall: { name: block.name, args: block.input ?? {} },
          ...(block.signature ? { thoughtSignature: block.signature } : {}),
        });
      } else if (block.type === "tool_result") {
        parts.push({
          functionResponse: {
            name: nameById.get(block.tool_use_id) ?? "tool",
            response: { result: block.content },
          },
        });
      }
    }

    // An assistant turn that was pure whitespace would otherwise become an
    // empty content, which Gemini rejects.
    if (parts.length) out.push({ role, parts });
  }

  return out;
}

/* ── the call ────────────────────────────────────────────────────────────── */

const RETRY_STATUSES = [429, 500, 502, 503, 504];
// Enough attempts to ride out a couple of free-tier quota windows.
const MAX_ATTEMPTS = 6;

function statusOf(err: unknown): number | null {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.code === "number") return e.code;
  const m = /\b(400|404|429|500|502|503|504)\b/.exec(e?.message ?? "");
  return m ? Number(m[1]) : null;
}

// True when the model rejected the thinking config itself rather than the
// prompt — 2.5-era and 3-era models disagree about which field is legal, so a
// GEMINI_MODEL override can land on either side of that split.
function isThinkingConfigRejection(err: unknown): boolean {
  const e = err as { message?: string };
  if (statusOf(err) !== 400) return false;
  return /thinking|thought/i.test(e?.message ?? "");
}

// A transport failure never reaches the API, so it has no HTTP status — it
// arrives as a bare TypeError("fetch failed") with the real reason buried in
// `cause`. These are worth retrying: a crash test holds a connection open for
// minutes, and one dropped socket should not discard the whole transcript.
function transportErrorCode(err: unknown): string | null {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code;
  if (code) return code;
  if (e?.name === "TypeError" && /fetch failed|network|socket/i.test(e?.message ?? "")) {
    return e?.cause?.message ?? "NETWORK";
  }
  return null;
}

// Node's global fetch ignores HTTP_PROXY/HTTPS_PROXY unless the process opts in
// (Node 24: NODE_USE_ENV_PROXY=1, set by the npm scripts). Behind a proxy that
// surfaces only as an opaque "fetch failed", so name the likely cause.
function describe(err: unknown): string {
  const e = err as { message?: string; status?: number };
  const base = e?.message || String(err);
  const code = transportErrorCode(err);

  if (isDailyQuotaExhausted(err)) {
    return `daily Gemini quota exhausted for model "${MODEL}". The free tier allows only a handful of requests per day per model, and one crash test costs a dozen. Set GEMINI_MODEL to a different model, or enable billing on the key.`;
  }
  if (code) {
    return `could not reach the Gemini API (${code}). Check network egress; if this machine uses an HTTP proxy, the server must run with NODE_USE_ENV_PROXY=1 so Node's fetch honours it.`;
  }
  const status = e?.status;
  return status ? `[${status}] ${base}` : base;
}

// A 429 from the free tier is a scheduling instruction, not a failure: the
// response carries how long to wait. A crash test is a dozen-plus calls in a
// row against a 5-req/min quota, so honouring that delay is the difference
// between a run completing and a run dying halfway through the transcript.
function retryDelayMs(err: unknown): number | null {
  const msg = (err as { message?: string })?.message ?? "";
  const structured = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(msg);
  const prose = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(msg);
  const seconds = structured?.[1] ?? prose?.[1];
  if (!seconds) return null;
  return Math.min(Number(seconds) * 1000 + 1000, 65_000);
}

// A per-minute quota clears if you wait; a per-DAY one does not. Both arrive as
// 429 with a ~60s retryDelay, so retrying a daily cap just burns minutes and
// then fails anyway. Tell them apart and fail fast on the one that won't clear.
function isDailyQuotaExhausted(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? "";
  return /PerDay/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let counter = 0;
const newId = () => `toolu_${Date.now().toString(36)}_${(counter++).toString(36)}`;

// One model turn. Returns the content blocks the engine expects: any prose the
// model spoke, followed by any tools it wants to call.
export async function createMessage(params: CreateParams): Promise<MessageResponse> {
  const contents = toContents(params.messages);

  const config: Record<string, unknown> = {
    maxOutputTokens: params.max_tokens + THINKING_HEADROOM,
    thinkingConfig: THINKING,
  };

  if (params.system?.trim()) config.systemInstruction = params.system;

  if (params.tools?.length) {
    config.tools = [{ functionDeclarations: toDeclarations(params.tools) }];
    config.toolConfig = params.tool_choice
      ? {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [params.tool_choice.name],
          },
        }
      : { functionCallingConfig: { mode: "AUTO" } };
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await ai().models.generateContent({
        model: MODEL,
        contents,
        config,
      });

      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const blocks: ContentBlock[] = [];

      for (const part of parts) {
        const p = part as {
          text?: string;
          thought?: boolean;
          thoughtSignature?: string;
          functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
        };
        if (p.thought) continue; // reasoning trace, not something the agent said
        const signature = p.thoughtSignature ? { signature: p.thoughtSignature } : {};
        if (typeof p.text === "string" && p.text.trim()) {
          blocks.push({ type: "text", text: p.text, ...signature });
        }
        if (p.functionCall?.name) {
          blocks.push({
            type: "tool_use",
            id: p.functionCall.id || newId(),
            name: p.functionCall.name,
            input: (p.functionCall.args ?? {}) as Record<string, unknown>,
            ...signature,
          });
        }
      }

      return { content: blocks };
    } catch (err) {
      lastErr = err;

      // A GEMINI_MODEL pointing at a 2.5-era model rejects `thinkingLevel`.
      // Drop the thinking config and let this attempt run again rather than
      // failing the whole run over a field the engine doesn't depend on.
      if (config.thinkingConfig && isThinkingConfigRejection(err)) {
        delete config.thinkingConfig;
        config.maxOutputTokens = params.max_tokens;
        continue;
      }

      if (isDailyQuotaExhausted(err)) break;

      const status = statusOf(err);
      const retryable = transportErrorCode(err) !== null ||
        (status !== null && RETRY_STATUSES.includes(status));
      if (!retryable || attempt === MAX_ATTEMPTS - 1) break;
      await sleep(retryDelayMs(err) ?? 600 * 2 ** attempt);
    }
  }

  throw new Error(`Gemini request failed: ${describe(lastErr)}`);
}
