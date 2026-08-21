// Turns a spoken problem statement into a runnable scenario draft.

import { NextRequest } from "next/server";
import { draftScenario } from "@/lib/scenarioDraft";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { transcript } = await req.json();

    if (typeof transcript !== "string" || transcript.trim().length < 15) {
      return Response.json(
        {
          error:
            "Describe the scenario in a sentence or two — who the bot is, what secret it holds, and who is trying to get it.",
        },
        { status: 400 }
      );
    }
    if (transcript.length > 4000) {
      return Response.json({ error: "That description is too long." }, { status: 413 });
    }

    const draft = await draftScenario(transcript);
    return Response.json(draft);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
