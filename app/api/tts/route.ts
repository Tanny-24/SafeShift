// Proxies text-to-speech through the server so MAYA_API_KEY stays out of the
// browser bundle and out of devtools.

import { NextRequest } from "next/server";
import {
  speak,
  isVoice,
  isLanguage,
  MayaError,
  SAMPLE_RATE,
  MAX_CHARS,
} from "@/lib/maya";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text, voice, language } = await req.json();

    if (typeof text !== "string" || !text.trim()) {
      return Response.json({ error: "text is required" }, { status: 400 });
    }
    if (text.length > MAX_CHARS * 4) {
      return Response.json({ error: "text is too long" }, { status: 413 });
    }

    const audio = await speak(text, {
      voice: isVoice(voice) ? voice : undefined,
      language: isLanguage(language) ? language : undefined,
    });

    return new Response(audio, {
      headers: {
        "Content-Type": `audio/L16; rate=${SAMPLE_RATE}; channels=1`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const status = err instanceof MayaError ? err.status : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
