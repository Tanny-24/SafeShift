// Runs one crash test and streams events (agent thoughts, attacker turns, tool
// calls, canary hits, final verdict) to the browser as newline-delimited JSON.
//
// The engine lives in lib/core.ts, shared with the MCP server and the CLI.
// This route only does HTTP: parse, stream, translate errors into status codes.

import { NextRequest } from "next/server";
import { runCrashTest, resolveScenario } from "@/lib/core";
import { saveRun } from "@/lib/store";
import type { StreamMessage } from "@/lib/events";

export const runtime = "nodejs";
// Adversarial runs are a multi-turn conversation between two models plus a
// judge pass, so they need real headroom.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { systemPrompt, scenarioId, scenario: inline } = body;

  // Resolve up front so a bad scenario is a 400 rather than an error buried
  // inside a 200 stream the browser has already started reading.
  try {
    resolveScenario({ scenarioId, scenario: inline });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: StreamMessage) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        const result = await runCrashTest({
          systemPrompt,
          scenarioId,
          scenario: inline,
          onEvent: send,
        });
        // Persist so the same run can be fetched later by id — this is what
        // lets an MCP client or the CLI pull the report for a UI-started test.
        await saveRun(result);
      } catch (err) {
        send({ kind: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
