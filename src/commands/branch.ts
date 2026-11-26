import { DEFAULT_PROTECTED_BRANCHES, branchConfig, loadConfig, type BranchConfig } from "../config.js";
import { slugify } from "../docs/adr.js";
import { matchesBranch } from "../git/branches.js";
import { isCommit, isRepository, runGit } from "../git/exec.js";

export interface BranchOptions {
  type?: string;
  ticket?: string;
  from?: string;
  dryRun?: boolean;
  cwd?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/** Bad input (exit 2). */
export class BranchInputError extends Error {}

/**
 * `<type>/<TICKET>-<slug>`, or `<type>/<slug>` without a ticket. The first word is the ticket when it matches
 * the pattern and `--ticket` was not given.
 */
export function branchName(words: string[], options: { type?: string; ticket?: string }, config: BranchConfig): string {
  const type = options.type ?? config.defaultType;
  if (!config.types.includes(type)) throw new BranchInputError(`Unknown type "${type}". Use: ${config.types.join(", ")}.`);

  const pattern = new RegExp(`^(?:${config.ticketPattern})$`);
  let rest = words;
  let ticket = options.ticket;
  if (ticket !== undefined) {
    if (!pattern.test(ticket)) throw new BranchInputError(`Ticket "${ticket}" does not match the pattern ${config.ticketPattern}.`);
  } else if (words[0] !== undefined && pattern.test(words[0])) {
    ticket = words[0];
    rest = words.slice(1);
  }
  if (ticket === undefined && config.requireTicket) {
    throw new BranchInputError(
      `A ticket ID is required ("branch.requireTicket" in .engkit.json) and must match ${config.ticketPattern}, e.g. engkit branch ABC-123 "short description".`
    );
  }

  const slug = slugify(rest.join(" "));
  if (slug === "") throw new BranchInputError("A description with letters or numbers is required.");
  return `${type}/${ticket === undefined ? "" : `${ticket}-`}${slug}`;
}

/** `engkit branch`. Returns the exit code: 0 ok, 1 refused or git failed, 2 bad input. The name goes to `out`. */
export function runBranch(words: string[], options: BranchOptions = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.out ?? ((l: string) => console.log(l));
  const err = options.err ?? ((l: string) => console.error(l));
  const refuse = (code: 1 | 2, message: string) => {
    err(`error: ${message}`);
    return code;
  };

  const config = loadConfig(cwd);
  let name: string;
  try {
    name = branchName(words, options, branchConfig(config));
  } catch (e) {
    if (e instanceof BranchInputError) return refuse(2, e.message);
    throw e;
  }
  if (!runGit(cwd, ["check-ref-format", `refs/heads/${name}`]).ok) return refuse(2, `"${name}" is not a valid git branch name.`);

  // Case-insensitive: on macOS and Windows "Release/x" and "release/x" can be the same ref.
  const protectedBranches = config.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;
  if (matchesBranch(name, protectedBranches, { ignoreCase: true })) {
    return refuse(1, `"${name}" matches a protected branch (${protectedBranches.join(", ")}). Choose another type or description.`);
  }

  const inRepo = isRepository(cwd);
  if (inRepo) {
    const existing = runGit(cwd, ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"]).stdout.split("\n");
    const clash = existing.find((b) => b.toLowerCase() === name.toLowerCase());
    if (clash !== undefined) return refuse(1, `the branch "${clash}" already exists (switch to it with: git switch ${clash}).`);
  }

  if (options.dryRun) {
    out(name);
    return 0;
  }
  if (!inRepo) return refuse(2, "not a git repository (use --dry-run to only print the name).");
  if (options.from !== undefined && !isCommit(cwd, options.from)) return refuse(2, `--from "${options.from}" is not a commit or branch.`);

  // --no-track: a branch created from a remote branch must not push to it by default.
  const created = runGit(cwd, ["switch", "--no-track", "-c", name, ...(options.from !== undefined ? [options.from] : [])]);
  if (!created.ok) return refuse(1, `git could not create the branch: ${created.stderr}`);
  out(name);
  err(`switched to the new branch "${name}"`);
  return 0;
}
