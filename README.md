# 🧰 Engineering Toolkit

A knowledge base, a CLI (`engkit`) and a collection of checklists for software engineering work.

This repository is my **second brain**: notes I reference regularly, a TypeScript CLI that automates repetitive tasks, and checklists that keep quality consistent.

---

## 🎯 Purpose

- Quickly find useful commands and workflows
- Document things I learn over time
- Automate repetitive engineering chores
- Reduce context switching and Googling
- Share reusable references across projects

---

## 📁 Repository Structure

```
engineering-toolkit/
├── src/                        engkit CLI (TypeScript)
│   ├── cli.ts                  entry point (bin)
│   ├── program.ts              command definitions
│   ├── config.ts               .engkit.json
│   ├── i18n/                   es/en support
│   ├── docs/                   frontmatter, ADR and pending helpers
│   └── commands/               one module per command
├── templates/                  es/en document templates
├── test/                       vitest tests and fixtures
├── knowledge/                  Reference notes
├── checklists/                 Reusable checklists
├── ROADMAP.md                  Phases and status
└── README.md
```

---

## 🛠️ `engkit` CLI

Requires **Node.js 22 or newer**.

### Install

The CLI is not published to npm. `dist/` is not versioned, so releases ship a prebuilt tarball.

**Main method: install the tarball from a GitHub Release**

```bash
npm i -g https://github.com/dquancruz/engineering-toolkit/releases/download/v0.1.0/engineering-toolkit-0.1.0.tgz
engkit --help
```

npm may print an `install-scripts` warning about `prepare`; it is harmless because the tarball already contains the built `dist/`. Replace `0.1.0` (in both places) with the version you want. Releases are listed at <https://github.com/dquancruz/engineering-toolkit/releases>. A release is created by pushing a `v*` tag; the workflow in `.github/workflows/release.yml` runs the tests, runs `npm pack` and attaches the `.tgz`. The tag must match the version in `package.json`.

**Alternative: clone and link** (for development)

```bash
git clone git@github.com:dquancruz/engineering-toolkit.git
cd engineering-toolkit
npm ci          # also builds dist/ via the prepare script
npm link        # exposes `engkit` on your PATH
engkit --help
```

**Alternative: inside a project**

```bash
npm i github:dquancruz/engineering-toolkit    # not global; `prepare` builds dist/
npx engkit --help
```

**Known problem: `npm i -g github:dquancruz/engineering-toolkit`**

With npm 11.20.0, a global install of *any* git package that has a `prepare` script ends with a dangling symlink and no `engkit` binary: npm blocks dependency install scripts by default (see `npm help install-scripts`), and the global git install flow does not complete. It was reproduced with a minimal package that only has `prepare`, so it is not specific to this repo. Use the release tarball instead.

Development:

```bash
npm test             # builds, then runs vitest
npx tsc --noEmit
```

### Global options

| Option | Description |
|---|---|
| `-v, --version` | Print the version |
| `--lang es\|en` | Language for templates and messages. Default: `es` |
| `-h, --help` | Help for any command, e.g. `engkit jira report --help` |

Language precedence: `--lang` flag, then `.engkit.json` in the current directory, then `es`.
`.engkit.json` example:

```json
{ "lang": "en" }
```

### `engkit init [--profile base] [--owner "<name>"]`

Creates the base documents of a project and stores the language and the **path of each document** in `.engkit.json`. `engkit new` and `engkit index` read the paths from that file, not from the language. Existing files are never overwritten: they are reported and skipped.

```bash
engkit init                              # Spanish (default)
engkit --lang en init --owner "Jane Doe"
```

| Document (es / en) | Purpose |
|---|---|
| `docs/adr/0000-plantilla.md` / `0000-template.md` | ADR template: context, decision, consequences, alternatives, sources |
| `BITACORA.md` / `LOG.md` | Append-only log; each `## YYYY-MM-DD` entry separates verified from unverified |
| `CLAUDE.md`, `AGENTS.md` | Rules and constraints for coding agents; `AGENTS.md` links to `CLAUDE.md` instead of duplicating it |
| `docs/glosario.md` / `glossary.md` | Terms, each with source, date and owner |
| `docs/pendientes.md` / `pending.md` | Open reviews and questions (`P-xx`), each with type, status and owner |
| `docs/diseno-vigente.md` / `current-design.md` | Minimal current-design skeleton with a visible date |
| `docs/DECISIONES.md` / `DECISIONS.md` | Generated ADR index (also created by `init`) |

`--owner` takes priority over `git config user.name`; without either, owner fields say `TODO`. Dates are today's date.

**Frontmatter.** Every template starts with YAML frontmatter. Keys and status values are the same in Spanish and English (only the body and headings are translated), so tools do not depend on the language:

| Key | Used in | Values |
|---|---|---|
| `id` | all | `ADR-0000`, `LOG`, `CLAUDE`, `AGENTS`, `GLOSSARY`, `PENDING`, `CURRENT-DESIGN`, `DECISIONS` |
| `status` | ADR, current design | ADR: `proposed` \| `accepted` \| `superseded`. Design: `current` \| `outdated` |
| `date` | all except the log | `YYYY-MM-DD` |
| `owner` | all | name or `TODO` |
| `source` | ADR, current design | link or reference to where the information comes from |
| `supersedes`, `superseded_by` | ADR | an ADR id such as `ADR-0003` (blank when unused) |

The log has only `id` and `owner`: its dates live in each `## YYYY-MM-DD` entry, so appending an entry never edits the frontmatter. Each pending entry (`### P-xx`) lists `type` (`review` \| `question`), `status` (`open` \| `closed`), `owner` and `date`.

The templates are generic and follow a few principles: every fact carries a source, a date and an owner; link instead of duplicating; status documents show their date; what an automated test can verify is a test, not a paragraph; write only what someone will need for a future decision and cannot be derived from the code.

### `engkit new adr "<title>"`

Creates the next ADR, e.g. `docs/adr/0007-title-in-kebab-case.md`, with `status: proposed`. The number is the highest existing one plus one (the `0000` template does not count). It starts from the project's own ADR template when it exists. Accents and symbols are removed from the file name. `--owner "<name>"` as in `init`.

### `engkit new pendiente [title]` (alias `new pending`)

Appends an entry with the next ID (`P-01` ... `P-99`, `P-100`, ...) to the pending file and refreshes its date. Options: `--type review|question` (default `question`), `--owner "<name>"`.

### `engkit index`

Regenerates the ADR index (number, title, status, date, supersedes / superseded by). It is a generated file and says so in its header: do not edit it.

### `engkit jira report <csv> [person]`

Turns a Jira CSV export (English or Spanish headers) into a JSON report and a summary of defects. Only Bug/Defect/Error rows are kept when the type column exists. `person` filters by assignee **or** reporter.

```bash
engkit jira report Jira.csv
engkit jira report Jira.csv "Jane Doe" --out ./out
```

| Option | Description |
|---|---|
| `--out <dir>` | Directory for the output files. Default: `reports/`, relative to the current directory |

Writes `report_<csv>[_<person>]_<timestamp>.json` and `summary_<csv>[_<person>]_<timestamp>.json`.

| Environment variable | Required | Description |
|---|---|---|
| `JIRA_BASE_URL` | No | Base URL of your Jira instance, e.g. `https://your-company.atlassian.net`. When set, each defect gets `url = <JIRA_BASE_URL>/browse/<KEY>`; otherwise `url` is `null`. `engkit` does not load `.env` files: export the variable in your shell. |

How to export the CSV from Jira: open your project, go to **Issues** (or filter the bugs you want), choose **Export → CSV (All fields)**.

Report structure:

```json
{
  "generated_at": "2026-05-06T...",
  "source_file": "Jira.csv",
  "filter_person": "Jane Doe",
  "total_processed": 12,
  "summary": {
    "byStatus":   { "Open": 5, "In Progress": 4, "Reopened": 3 },
    "byPriority": { "High": 4, "Medium": 6, "Low": 2 },
    "byAssignee": { "Jane Doe": 8, "Unassigned": 4 },
    "byReporter": { "John Smith": 7, "Alex Roe": 5 }
  },
  "defects": [
    {
      "key": "PROJ-123",
      "url": "https://your-company.atlassian.net/browse/PROJ-123",
      "summary": "Login fails on Safari",
      "type": "Bug",
      "status": "Open",
      "priority": "High",
      "assignee": "Jane Doe",
      "reporter": "John Smith",
      "created": { "iso": "2026-04-01T10:00:00.000Z", "readable": "April 1, 2026 at 10:00 AM" },
      "last_updated": { "iso": "2026-05-05T15:30:00.000Z", "readable": "May 5, 2026 at 03:30 PM" }
    }
  ]
}
```

### `engkit jira oncall <report> [name] [sprint]`

Turns a report JSON from `engkit jira report` into a Markdown oncall ticket, ordered by priority (Blocker, Highest, High, Medium, Low). Prints the ticket and saves it.

```bash
engkit jira oncall reports/report_Jira_2026-05-13T19-06-42.json
engkit jira oncall reports/report_Jira_2026-05-13T19-06-42.json "Daniel Quan" "Sprint 42"
```

| Option | Description |
|---|---|
| `--out <dir>` | Directory for the ticket. Default: `tickets/`, relative to the current directory |

Defaults: name `Oncall Engineer`, sprint `Current Sprint`. Output file: `oncall_<name>_<timestamp>.md`.

**Workflow:** Jira CSV → `engkit jira report` (JSON) → `engkit jira oncall` (ticket)

### Migrating from the old `tools/` scripts

- `npm start -- <args>` in `tools/jira-defects-report` is now `engkit jira report <args>`; `tools/oncall-ticket-creator` is now `engkit jira oncall <args>`. Report and ticket contents are unchanged.
- Output goes to `reports/` and `tickets/` **in the current directory** (previously the tool's own folder). Use `--out <dir>` to choose another directory.
- The usage error for a missing argument now comes from the CLI parser, so its wording differs.

---

## 🗺️ Roadmap

Knowledge notes and checklists below do not exist yet.

### Knowledge

- Linux, Docker, SQL, Node.js
- Cloud, DevOps
- Game development
- Productivity
- Regex
- Shell aliases, PowerShell
- System design
- CI/CD templates
- Security
- Interview prep

### Tools

See [ROADMAP.md](ROADMAP.md) for the phased plan of the `engkit` CLI and its status.

### Checklists

- AI prompt checklist
- Code review
- Definition of Done
- System design
- Threat model

---

## ✍️ Documentation Style

Each file should include:

- Command or concept
- Short description
- Example usage
- Common scenarios
- Gotchas, warnings, or tips

### Example

```
git reset --hard HEAD~1
Revert last commit locally and discard changes
WARNING: This is destructive and cannot be undone
```

---

## 📌 Naming Conventions

- Use kebab-case for file names
- Use clear, descriptive names
- Group related topics into folders
- Keep files focused and easy to scan
- Prefer multiple small files over one massive file

---

## 🧠 Philosophy

Write it down once.  
Never waste time re-learning the same thing twice.

This toolkit evolves with my skills, projects, and experience as an engineer.

---

## 🤝 Contribution (Personal Rules)

- Keep it practical
- Keep it concise
- Prefer real-world examples
- Update notes when better practices are learned
- Treat this repo as a living document

---

Built for learning.  
Built for speed.  
Built for future me.
