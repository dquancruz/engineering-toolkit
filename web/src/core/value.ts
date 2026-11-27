/** The data shared by every format: what JSON can hold, plus big integers and non-finite numbers. */
export type Value = null | boolean | number | bigint | string | Value[] | { [key: string]: Value };

export const MAX_DEPTH = 500;

export const isObject = (v: Value): v is { [key: string]: Value } => typeof v === "object" && v !== null && !Array.isArray(v);

/** An object whose keys are always its own properties: `__proto__` is an ordinary key here. */
export function makeObject(entries: Iterable<readonly [string, Value]>): { [key: string]: Value } {
  const out: { [key: string]: Value } = {};
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

export const childPath = (path: string, key: string | number): string =>
  typeof key === "number" ? `${path}[${key}]` : path === "" ? key : `${path}.${key}`;

/** Sign, significant digits and exponent of a decimal literal, so two spellings of a number compare equal. */
function decimalParts(text: string): string | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.replace(/_/g, ""));
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const digits = `${m[2]}${m[3] ?? ""}`.replace(/^0+/, "");
  const trimmed = digits.replace(/0+$/, "");
  if (trimmed === "") return "0";
  const exponent = Number(m[4] ?? 0) - (m[3] ?? "").length + (digits.length - trimmed.length);
  return `${m[1] === "-" ? "-" : ""}${trimmed}e${exponent}`;
}

/** True when a decimal literal cannot be held exactly by a JavaScript number (as far as printing it back). */
export function losesPrecision(literal: string): boolean {
  const written = decimalParts(literal);
  if (written === null) return false;
  const n = Number(literal.replace(/_/g, ""));
  return !Number.isFinite(n) || decimalParts(String(n)) !== written;
}
