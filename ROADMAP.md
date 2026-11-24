# Roadmap

Goal: a single CLI, `engkit`, that gathers my engineering tools. Requires Node.js 22 or newer.

One phase = one branch = one PR. Status is updated in the PR that finishes each phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | **CLI base**: `engkit` skeleton (`--help`, `--version`, `--lang`, `.engkit.json`, es/en i18n), Jira tools migrated to `engkit jira report` / `engkit jira oncall`, `prepare` script, smoke tests, CI, `csv-parse` fix | Done |
| 1 | **Base documents**: `engkit init`, `engkit new adr\|pendiente`, `engkit index` (ADR, BITACORA, CLAUDE.md/AGENTS.md, glossary, pending items, current design) | Done |
| 2 | **Verifier**: `engkit check` (ADR immutability, dates, unique IDs, references, append-only log, owners, TODO fields, deleted ADRs), `engkit adr accept`, `engkit new adr --supersedes` | In review |
| 3 | **Prompt builder**: `engkit prompt` (interactive, task presets, warnings, `checklists/ai-prompt.md` as source) | Planned |
| 4 | **Agent profile**: `engkit init --profile agent` (subagent template, Claude Code permissions and hooks) | Planned |
| 5 | **Git workflow and checklists**: `engkit branch`, `engkit changelog`, `engkit env`; code review, DoD, system design and threat model checklists | Planned |
| 6 | **Legacy profile**: business rules, defects, evidence sources, acceptance tests; extra `check` rules | Planned |
| 7 | **Rebuild profile**: non-functional requirements, rebuild plan, `engkit requirements`, `engkit testplan` | Planned |
| 8 | **Utilities web app** (`web/`): JSON formatter, type converter, regex tester, JWT decoder (static site) | Planned |
| 9 | **AI features**: `engkit ai commit`, `engkit ai pr` (needs `ANTHROPIC_API_KEY`) | Planned |
| 10 | **The rest**: `engkit mock`, `engkit scaffold` | Planned |

## Decisions

- Frontmatter keys (`id`, `status`, `date`, `owner`, `source`, `supersedes`, `superseded_by`) and status values are English and identical in es and en; only bodies and headings are translated.
- `engkit init` stores the path of every document in `.engkit.json`; other commands read paths from there, not from the language.
- The log has no `date` in its frontmatter (entries carry their own date), so appending never edits existing lines.

- One CLI with subcommands; the Jira tools live inside it.
- Templates and checklists in Spanish and English, selected with `--lang es|en` (default `es`); `engkit init` stores the language in `.engkit.json`.
- Not published to npm. Main install method: `npm i -g <URL of the .tgz attached to a GitHub Release>`, built by the `release.yml` workflow on `v*` tags. Alternatives: clone + `npm link`, and `npm i github:...` inside a project. `npm i -g github:...` does not complete with npm 11.20.0 (see README, Install).
- JSON, type converter, regex and JWT utilities are a separate web app, not CLI commands.
- AI features come last and read `ANTHROPIC_API_KEY`; without it they fail with a clear message.

## Future ideas

- **Auditable exceptions for `engkit check`.** Today an accepted ADR cannot be corrected in place (a typo needs a superseding ADR) and there is no way to silence a rule. Idea: an `exceptions` list in `.engkit.json`, each entry with the ADR/line ID, the commit it applies to and a reason, reported by `check` as a **warning** so exceptions stay visible.
