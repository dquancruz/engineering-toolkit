import * as clack from "@clack/prompts";

/** Thrown when the user cancels (Ctrl+C). */
export class PromptCancelled extends Error {
  constructor() {
    super("Cancelled.");
  }
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Everything the interactive flow needs from a terminal UI. The flow only talks to this interface,
 * so tests use a fake and the library behind it can be replaced.
 */
export interface Asker {
  intro(title: string): void;
  note(message: string, title?: string): void;
  text(o: { message: string; placeholder?: string; initialValue?: string; multiline?: boolean }): Promise<string>;
  select<T extends string>(o: { message: string; options: Choice<T>[]; initialValue?: T }): Promise<T>;
  multiselect<T extends string>(o: { message: string; options: Choice<T>[]; initialValues?: T[] }): Promise<T[]>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<boolean>;
  outro(message: string): void;
}

/** @clack/prompts implementation. The UI goes to stderr, so stdout carries only the prompt. */
export function clackAsker(output: NodeJS.WriteStream = process.stderr): Asker {
  const common = { output };
  const unwrap = <T>(value: T): Exclude<T, symbol> => {
    if (clack.isCancel(value)) throw new PromptCancelled();
    return value as Exclude<T, symbol>;
  };
  const opt = <T extends string>(c: Choice<T>) => (c.hint ? { value: c.value, label: c.label, hint: c.hint } : { value: c.value, label: c.label });

  return {
    intro: (title) => clack.intro(title, common),
    note: (message, title) => clack.note(message, title, common),
    async text(o) {
      const base = {
        ...common,
        message: o.message,
        ...(o.placeholder !== undefined ? { placeholder: o.placeholder } : {}),
        ...(o.initialValue !== undefined ? { initialValue: o.initialValue } : {}),
      };
      return unwrap(await (o.multiline ? clack.multiline(base) : clack.text(base)));
    },
    async select(o) {
      return unwrap(
        await clack.select<string>({
          ...common,
          message: o.message,
          options: o.options.map(opt),
          ...(o.initialValue !== undefined ? { initialValue: o.initialValue } : {}),
        })
      ) as never;
    },
    async multiselect(o) {
      return unwrap(
        await clack.multiselect<string>({
          ...common,
          message: o.message,
          options: o.options.map(opt),
          required: false,
          ...(o.initialValues !== undefined ? { initialValues: o.initialValues } : {}),
        })
      ) as never;
    },
    async confirm(o) {
      return unwrap(await clack.confirm({ ...common, message: o.message, ...(o.initialValue !== undefined ? { initialValue: o.initialValue } : {}) }));
    },
    outro: (message) => clack.outro(message, common),
  };
}
