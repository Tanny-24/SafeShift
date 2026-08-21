// Environment loading for the standalone entry points.
//
// Next.js loads .env.local automatically, but the MCP server and the CLI are
// plain Node processes and get nothing. This reads the same file so all three
// entry points authenticate identically, with no extra dependency.
//
// Values already present in the real environment always win, so
// `GEMINI_API_KEY=... npm run mcp` overrides the file rather than fighting it.
// Nothing here logs a value.

import { readFileSync } from "node:fs";
import path from "node:path";

const FILES = [".env.local", ".env"];

let loaded = false;

export function loadEnv(cwd = process.cwd()): void {
  if (loaded) return;
  loaded = true;

  for (const file of FILES) {
    let raw: string;
    try {
      raw = readFileSync(path.join(cwd, file), "utf8");
    } catch {
      continue; // absent is fine — the key may come from the real environment
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;

      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue; // real environment wins

      let value = trimmed.slice(eq + 1).trim();
      // Strip one layer of matching quotes, the way dotenv does.
      if (value.length >= 2 && /^(".*"|'.*')$/.test(value)) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

/** True when a Gemini credential is available — without revealing it. */
export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}
