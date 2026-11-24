export type Severity = "error" | "warning";

export interface Finding {
  rule: string;
  severity: Severity;
  /** Project-relative path, or "." for project-wide findings. */
  file: string;
  /** 1-based line, or null when it does not apply. */
  line: number | null;
  message: string;
}

export type Report = (finding: Omit<Finding, "severity"> & { severity?: Severity }) => void;
