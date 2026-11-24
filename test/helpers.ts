import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

/** Same normalization used to produce the golden files (timestamps only). */
export function normalize(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/g, "TS")
        .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g, "ISO")
        .replace(/(generated_at|\*\*Date\*\* \|)[^,]*/g, "$1 X")
    )
    .join("\n");
}

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "engkit-test-"));
}

/** Runs `fn` capturing console.log/error output. */
export function captureConsole<T>(fn: () => T): { result: T; stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  try {
    const result = fn();
    return { result, stdout: out.join("\n") + "\n", stderr: err.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

export const fixtures = path.join(import.meta.dirname, "fixtures");
