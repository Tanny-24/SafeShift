// Runs a batch of scenarios and streams progress (per-scenario start, each
// transcript turn, judging, verdict) as newline-delimited JSON, then the final
// graded report with the full per-scenario logs.

import { NextRequest } from "next/server";
import { runSuite, type CrashConfig, type SafetyReport } from "@/lib/suite";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { config } = (await req.json()) as { config: CrashConfig };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const partial = await runSuite(config, (p) => send({ ...p }));
        const report: SafetyReport = {
          ...partial,
          createdAt: new Date().toISOString(),
        };
        send({ kind: "report", report });
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
