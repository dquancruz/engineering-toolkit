import { readCsv, writeCsv, type Delimiter } from "./formats/csv.js";
import { readJson, writeJson } from "./formats/json.js";
import { readToml, writeToml } from "./formats/toml.js";
import { readXml, writeXml } from "./formats/xml.js";
import { readYaml, writeYaml } from "./formats/yaml.js";
import { CoreError, Notices, type Notice } from "./notice.js";
import type { Value } from "./value.js";

export const FORMATS = ["json", "yaml", "toml", "csv", "xml"] as const;
export type Format = (typeof FORMATS)[number];

export interface ConvertOptions {
  delimiter?: Delimiter;
}

export function read(format: Format, text: string, notices: Notices, options: ConvertOptions = {}): Value {
  switch (format) {
    case "json":
      return readJson(text, notices);
    case "yaml":
      return readYaml(text, notices);
    case "toml":
      return readToml(text, notices);
    case "csv":
      return readCsv(text, notices, options.delimiter);
    case "xml":
      return readXml(text, notices);
  }
}

export function write(format: Format, value: Value, notices: Notices, options: ConvertOptions = {}): string {
  switch (format) {
    case "json":
      return writeJson(value, notices);
    case "yaml":
      return writeYaml(value);
    case "toml":
      return writeToml(value, notices);
    case "csv":
      return writeCsv(value, notices, options.delimiter);
    case "xml":
      return writeXml(value, notices);
  }
}

/** Converts text between formats. Throws CoreError; everything that cannot be kept is in `notices`. */
export function convert(from: Format, to: Format, text: string, options: ConvertOptions = {}): { text: string; notices: Notice[] } {
  const notices = new Notices();
  try {
    const value = read(from, text, notices, options);
    return { text: write(to, value, notices, options), notices: notices.list() };
  } catch (e) {
    if (e instanceof CoreError) throw e;
    if (e instanceof RangeError) throw new CoreError("too-deep", { detail: e.message });
    throw e;
  }
}
