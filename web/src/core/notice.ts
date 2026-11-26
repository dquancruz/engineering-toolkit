/** Something the user should know about a result: usually information that a conversion cannot keep. */
export interface Notice {
  code: NoticeCode;
  /** Where it happened, such as `customer.tags[0]`. */
  path?: string;
}

export type NoticeCode =
  | "duplicate-key"
  | "number-precision"
  | "big-integer"
  | "non-finite"
  | "date-as-text"
  | "comments-lost"
  | "key-as-text"
  | "yaml-multi-document"
  | "yaml-aliases"
  | "yaml-warning"
  | "toml-null"
  | "toml-wrapped"
  | "csv-text"
  | "csv-types"
  | "csv-null"
  | "csv-missing"
  | "csv-flattened"
  | "csv-array"
  | "csv-single-row"
  | "csv-scalar-rows"
  | "csv-formula"
  | "xml-text"
  | "xml-order"
  | "xml-mixed"
  | "xml-trimmed"
  | "xml-cdata"
  | "xml-instructions"
  | "xml-wrapped"
  | "xml-types"
  | "xml-null"
  | "xml-empty-array"
  | "xml-single-item"
  | "jwt-alg-none"
  | "jwt-unsigned"
  | "jwt-claim-not-number";

export type ErrorCode =
  | "json-syntax"
  | "too-deep"
  | "yaml-syntax"
  | "toml-syntax"
  | "toml-range"
  | "csv-syntax"
  | "csv-header"
  | "csv-collision"
  | "xml-syntax"
  | "xml-doctype"
  | "xml-name"
  | "xml-value"
  | "unsupported-value"
  | "jwt-parts"
  | "jwt-jwe"
  | "jwt-base64"
  | "jwt-json";

/** An input that cannot be processed. The interface translates `code`; `detail` is technical and in English. */
export class CoreError extends Error {
  readonly line: number | undefined;
  readonly column: number | undefined;
  readonly detail: string | undefined;
  constructor(
    readonly code: ErrorCode,
    info: { line?: number; column?: number; detail?: string } = {}
  ) {
    super(info.detail ?? code);
    this.line = info.line;
    this.column = info.column;
    this.detail = info.detail;
  }
}

/** Collects notices without repeating the same one for the same place. */
export class Notices {
  private seen = new Map<string, Notice>();
  add(code: NoticeCode, path?: string): void {
    const key = `${code} ${path ?? ""}`;
    if (!this.seen.has(key)) this.seen.set(key, path === undefined || path === "" ? { code } : { code, path });
  }
  list(): Notice[] {
    return [...this.seen.values()];
  }
}
