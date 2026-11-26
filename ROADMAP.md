# Roadmap

Goal: a single CLI, `engkit`, that gathers my engineering tools. Requires Node.js 22 or newer.

One phase = one branch = one PR. Status is updated in the PR that finishes each phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | **CLI base**: `engkit` skeleton (`--help`, `--version`, `--lang`, `.engkit.json`, es/en i18n), Jira tools migrated to `engkit jira report` / `engkit jira oncall`, `prepare` script, smoke tests, CI, `csv-parse` fix | Done |
| 1 | **Base documents**: `engkit init`, `engkit new adr\|pendiente`, `engkit index` (ADR, BITACORA, CLAUDE.md/AGENTS.md, glossary, pending items, current design) | Done |
| 2 | **Verifier**: `engkit check` (ADR immutability, dates, unique IDs, references, append-only log, owners, TODO fields, deleted ADRs), `engkit adr accept`, `engkit new adr --supersedes` | Done |
| 3 | **Prompt builder**: `engkit prompt` (guided and non-interactive, task presets, warnings, project links, secret detection, `checklists/{es,en}/ai-prompt.md` as source) | Done |
| 4 | **Agent profile**: `engkit init --profile agent` (reviewer and builder subagents, Claude Code permissions and a Node guard hook, settings merge with diff), `engkit agent test-guards`, `protectedBranches` | Done |
| 5 | **Git workflow and checklists**: `engkit branch`, `engkit changelog`, `engkit env`; code review, DoD, system design and threat model checklists, `engkit prompt --checklist`, `ask` rules for git commands that discard work, `CHANGELOG.md` | In review |
| 6 | **Legacy profile**: business rules, defects, evidence sources, acceptance tests; extra `check` rules | Planned |
| 7 | **Rebuild profile**: non-functional requirements, rebuild plan, `engkit requirements`, `engkit testplan` | Planned |
| 8 | **Utilities web app** (`web/`): JSON formatter, type converter, regex tester, JWT decoder (static site) | Planned |
| 9 | **AI features**: `engkit ai commit`, `engkit ai pr` (needs `ANTHROPIC_API_KEY`) | Planned |
| 10 | **The rest**: `engkit mock`, `engkit scaffold` | Planned |

## Decisions

- Git commands that discard work (`git clean`, `reset --hard`, `checkout .`, `restore .`, `stash drop|clear`) are `ask`, not `deny`: they are legitimate but unrecoverable, so a person decides. Both `permissions.ask` and the guard (`permissionDecision: "ask"`) cover them, because rules do not match forms such as `git -C dir reset --hard`.
- Every phase ends with a `chore(release)` commit, in the same PR, that bumps the version and adds its `CHANGELOG.md` section with `engkit changelog`. The release workflow builds the notes with the same command. PRs are merged with merge commits.
- `engkit env` reads and writes variable names only and fails closed on anything it cannot parse for certain.
- `engkit prompt` adds checklist items only on request (`--checklist`, or accepting the offer in guided mode), and only the short prompt block of each checklist.

- The agent guards are one dependency-free Node script (`.claude/hooks/engkit-guard.mjs`) registered in exec form with `"onFailure": "block"`, so one entry works on Linux, macOS and Windows and fails closed. Deny rules in `permissions.deny` back it up for exact cases; `.env*` patterns and branch checks live only in the hook. Protected branches are `protectedBranches` in `.engkit.json` (default `main`, `master`; `*` wildcard). `engkit init` merges into an existing `.claude/settings.json` showing a diff first and never edits `CLAUDE.md` or `AGENTS.md`.

- `engkit prompt` uses `@clack/prompts` behind an `Asker` interface (small, native multi-line input). Generated prompts go to `prompts/`, git-ignored by default; a detected secret blocks the output unless `--allow-secrets`.

- Frontmatter keys (`id`, `status`, `date`, `owner`, `source`, `supersedes`, `superseded_by`) and status values are English and identical in es and en; only bodies and headings are translated.
- `engkit init` stores the path of every document in `.engkit.json`; other commands read paths from there, not from the language.
- The log has no `date` in its frontmatter (entries carry their own date), so appending never edits existing lines.

- One CLI with subcommands; the Jira tools live inside it.
- Templates and checklists in Spanish and English, selected with `--lang es|en` (default `es`); `engkit init` stores the language in `.engkit.json`.
- Not published to npm. Main install method: `npm i -g <URL of the .tgz attached to a GitHub Release>`, built by the `release.yml` workflow on `v*` tags. Alternatives: clone + `npm link`, and `npm i github:...` inside a project. `npm i -g github:...` does not complete with npm 11.20.0 (see README, Install).
- JSON, type converter, regex and JWT utilities are a separate web app, not CLI commands.
- AI features come last and read `ANTHROPIC_API_KEY`; without it they fail with a clear message.

## Future ideas

- **Make the tests that assume Linux portable.** CI runs the whole suite on Ubuntu only; Windows and macOS run just `test/agent` (the guard is the part that runs on every developer machine). Several other tests assume Linux (for example `/dev/null` and path separators; `test/global-setup.ts` already starts `npm` through a shell on Windows). Make them portable and run the full suite on all three systems.

- **Auditable exceptions for `engkit check`.** Today an accepted ADR cannot be corrected in place (a typo needs a superseding ADR) and there is no way to silence a rule. Idea: an `exceptions` list in `.engkit.json`, each entry with the ADR/line ID, the commit it applies to and a reason, reported by `check` as a **warning** so exceptions stay visible.
