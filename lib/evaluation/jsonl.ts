import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonl(file: string): Promise<unknown[]> {
  let body: string;
  try {
    body = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const values: unknown[] = [];
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid JSONL in "${file}" on line ${index + 1}: ${(error as Error).message}`);
    }
  }
  return values;
}

/** Replace the complete JSONL file atomically, preserving interruption safety. */
export async function writeJsonlAtomic(file: string, values: unknown[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const body = values.map((value) => JSON.stringify(value)).join("\n");
  await writeFile(temporary, body ? `${body}\n` : "", "utf8");
  await rename(temporary, file);
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, file);
}
