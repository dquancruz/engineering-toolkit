import fs from "node:fs";
import path from "node:path";
import { runPrompt, type PromptCommandOptions, type PromptDeps } from "../../src/commands/prompt.js";
import type { Asker, Choice } from "../../src/prompt/asker.js";
import type { Lang } from "../../src/i18n/index.js";
import { fixtures, tmpDir } from "../helpers.js";

/** A copy of the check base project: accepted ADR-0001, proposed ADR-0002, open P-01, CLAUDE.md. */
export function projectCopy(): string {
  const dir = tmpDir();
  fs.cpSync(path.join(fixtures, "check", "base"), dir, { recursive: true });
  return dir;
}

export const promptFixture = (name: string) => path.join(fixtures, "prompt", name);
export const fixtureText = (name: string) => fs.readFileSync(promptFixture(name), "utf-8");

export interface Run {
  code: number;
  out: string;
  err: string;
}

export async function run(cwd: string, options: PromptCommandOptions, deps: PromptDeps = {}, lang: Lang = "es"): Promise<Run> {
  let out = "";
  let err = "";
  const code = await runPrompt(lang, options, { cwd, out: (t) => void (out += t), err: (t) => void (err += t), isTTY: false, ...deps });
  return { code, out, err };
}

/** Fake terminal UI: handlers answer by looking at the message. Every call is recorded. */
export class FakeAsker implements Asker {
  calls: { kind: string; message: string; options?: Choice<string>[]; initialValue?: unknown }[] = [];
  /** A stuck flow must fail the test, not exhaust the memory of the worker. */
  private guard() {
    if (this.calls.length > 300) throw new Error("FakeAsker: more than 300 questions, the flow is probably looping");
  }
  notes: string[] = [];
  constructor(
    private handlers: {
      text?: (o: { message: string; initialValue?: string; multiline?: boolean }) => string | undefined;
      select?: (o: { message: string }) => string | undefined;
      multiselect?: (o: { message: string; options: Choice<string>[]; initialValues?: string[] }) => string[] | undefined;
      confirm?: (o: { message: string; initialValue?: boolean }) => boolean | undefined;
    }
  ) {}
  intro() {}
  outro() {}
  note(message: string, title?: string) {
    this.notes.push(`${title ?? ""}\n${message}`);
  }
  async text(o: { message: string; placeholder?: string; initialValue?: string; multiline?: boolean }) {
    this.guard();
    this.calls.push({ kind: "text", message: o.message, initialValue: o.initialValue });
    return this.handlers.text?.(o) ?? o.initialValue ?? "";
  }
  async select<T extends string>(o: { message: string; options: Choice<T>[]; initialValue?: T }): Promise<T> {
    this.guard();
    this.calls.push({ kind: "select", message: o.message, options: o.options });
    return (this.handlers.select?.(o) ?? o.initialValue ?? o.options[0]!.value) as T;
  }
  async multiselect<T extends string>(o: { message: string; options: Choice<T>[]; initialValues?: T[] }): Promise<T[]> {
    this.guard();
    this.calls.push({ kind: "multiselect", message: o.message, options: o.options, initialValue: o.initialValues });
    return (this.handlers.multiselect?.(o as never) ?? o.initialValues ?? []) as T[];
  }
  async confirm(o: { message: string; initialValue?: boolean }) {
    this.guard();
    this.calls.push({ kind: "confirm", message: o.message, initialValue: o.initialValue });
    return this.handlers.confirm?.(o) ?? false;
  }
}
