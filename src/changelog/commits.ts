export interface Commit {
  sha: string;
  message: string;
}

export interface Entry {
  sha: string;
  /** Conventional Commit type in lower case, or null for a message that does not follow the convention. */
  type: string | null;
  scope: string | null;
  description: string;
  /** Set for `type!:` or a `BREAKING CHANGE:` footer; holds the footer text when there is one. */
  breaking: { note: string | null } | null;
}

const HEADER = /^([A-Za-z]+)(?:\(([^()]*)\))?(!)?:\s+(\S.*)$/;
const FOOTER = /^BREAKING[ -]CHANGE:[ \t]*(.*(?:\n(?![A-Za-z-]+(?::| #))[^\n]+)*)/m;

/** Reads a commit message as a Conventional Commit (https://www.conventionalcommits.org/en/v1.0.0/). */
export function parseCommit({ sha, message }: Commit): Entry {
  const text = message.replace(/\r\n/g, "\n").trim();
  const subject = text.split("\n")[0] ?? "";
  const body = text.slice(subject.length);
  const header = HEADER.exec(subject);
  const footer = FOOTER.exec(body);
  const note = footer ? footer[1]!.replace(/\s+/g, " ").trim() || null : null;

  if (!header) {
    return { sha, type: null, scope: null, description: subject || "(no message)", breaking: footer ? { note } : null };
  }
  return {
    sha,
    type: header[1]!.toLowerCase(),
    scope: header[2]?.trim() || null,
    description: header[4]!.trim(),
    breaking: header[3] || footer ? { note } : null,
  };
}
