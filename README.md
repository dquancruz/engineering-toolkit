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
│   ├── check/                  engkit check: project loader, git helpers and rules
│   ├── prompt/                 engkit prompt: checklist parser, warnings, secrets, interactive flow
│   ├── agent/                  agent profile: settings.json merge, diff, install, guard checks
│   ├── git/                    git runner and protected branch matching
│   ├── changelog/              Conventional Commits parser, sections and CHANGELOG.md editing
│   ├── env/                    .env variable name reader (never returns values)
│   ├── checklists/             parser of the checklists used by `engkit prompt --checklist`
│   └── commands/               one module per command
├── templates/                  es/en document templates; agent/guard.mjs is the Claude Code guard hook
├── test/                       vitest tests and fixtures
├── knowledge/                  Reference notes
├── checklists/                 Checklists (es/en); ai-prompt.md is the source of `engkit prompt`
├── CHANGELOG.md                Changes per release, generated with `engkit changelog`
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
npm i -g https://github.com/dquancruz/engineering-toolkit/releases/download/v0.5.0/engineering-toolkit-0.5.0.tgz
engkit --help
```

npm may print an `install-scripts` warning about `prepare`; it is harmless because the tarball already contains the built `dist/`. Replace `0.5.0` (in both places) with the version you want. Releases are listed at <https://github.com/dquancruz/engineering-toolkit/releases>. A release is created by pushing a `v*` tag; the workflow in `.github/workflows/release.yml` runs the tests, runs `npm pack` and attaches the `.tgz`. The tag must match the version in `package.json`; see [Release cycle](#release-cycle).

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

### Release cycle

One phase is one branch and one PR, and each phase ends in a release. There is no separate release PR.

**1. Last commit of the phase branch.** Bump the version, update the install URLs in this README and add the changelog section:

```bash
npm version <new version> --no-git-tag-version      # package.json and package-lock.json
npm run build
node dist/cli.js --lang en changelog v<previous tag> HEAD --release v<new version>
git commit -am "chore(release): v<new version>"
```

If more commits land during review, run the same `changelog` command with `--force`. If the section changes (a `feat`, `fix`, `perf` or breaking commit), commit it again so the release commit stays last; commits of the types that are left out do not change it.

**2. Merge** the PR once CI is green, with a **merge commit** (squash or rebase would rewrite the commit IDs listed in `CHANGELOG.md`).

**3. Pull:**

```bash
git switch main && git pull --ff-only
```

**4. Verify** before tagging:

```bash
git log -1                                          # the merge of the PR
node -p "require('./package.json').version"         # the new version
gh run list --branch main --limit 3                 # CI is green on that commit
```

**5. Tag** and push only the tag:

```bash
git tag v<new version>
git push origin v<new version>
```

**6. Check the release.** `release.yml` runs the tests, checks that the tag matches `package.json`, builds the `.tgz` and creates the GitHub Release. Its notes are `engkit changelog <previous tag> <tag> --stdout` plus a compare link (GitHub's generated notes if there is no previous tag).

```bash
gh run watch
gh release view v<new version>                      # includes engineering-toolkit-<new version>.tgz
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

### `engkit init [--profile base[,agent]] [--owner "<name>"]`

Creates the base documents of a project and stores the language and the **path of each document** in `.engkit.json`. `engkit new` and `engkit index` read the paths from that file, not from the language. Existing files are never overwritten: they are reported and skipped.

```bash
engkit init                              # Spanish (default)
engkit --lang en init --owner "Jane Doe"
```

| Document (es / en) | Purpose |
|---|---|
| `docs/adr/0000-plantilla.md` / `0000-template.md` | ADR template: context, decision, consequences, alternatives, sources |
| `BITACORA.md` / `LOG.md` | Append-only log, created with no entries (only the title and an HTML comment with the instructions); each `## YYYY-MM-DD` entry separates verified from unverified |
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

#### Agent profile: `engkit init --profile agent`

Additive (`--profile base,agent` does both; `agent` alone leaves the documents untouched). It prepares a project for [Claude Code](https://code.claude.com/docs) with minimal guards. Everything below is Claude Code specific; see "What is shared with other tools" at the end of this section.

| File | What it is |
|---|---|
| `.claude/agents/reviewer.md` | Subagent with `tools: Read, Grep, Glob` (read-only): reviews and reports findings |
| `.claude/agents/builder.md` | Subagent with `tools: Read, Grep, Glob, Edit, Write, Bash`: implements scoped changes and verifies them |
| `.claude/hooks/engkit-guard.mjs` | The guard: a `PreToolUse` hook in plain Node, no dependencies |
| `.claude/settings.json` | `permissions.deny` rules and the hook registration, **merged** with what is already there |

`--agent reviewer|builder|both` picks the subagents (default `both`). Both link to `CLAUDE.md` and the ADR index (paths from `.engkit.json`) instead of copying rules; they never overwrite an existing file. Subagent files do not set `permissionMode`: enforcement lives in `settings.json`.

**What is blocked**

| Action | Enforced by |
|---|---|
| `rm` with recursive and force flags (`-rf`, `-fr`, `-r -f`, `--recursive --force`) | hook + `permissions.deny` |
| `git push --force`, `-f`, `--force-with-lease`, refspec `+branch` | hook + `permissions.deny` |
| `git push` to a protected branch (explicit, `HEAD:main`, `:main`, or no arguments while on it), `--all`, `--mirror` | hook |
| `git commit` while on a protected branch | hook |
| Reading or writing `.env*` except `.env.example` (Read, Write, Edit, MultiEdit, NotebookEdit, Grep, Glob and Bash words and redirections) | hook; `permissions.deny` for the exact names `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test`, `.env.staging` |

The patterns `.env*` live only in the hook because a deny rule on `.env.*` would also block `.env.example` and an allow rule cannot carve an exception out of a deny.

**What asks for confirmation**

| Command | Enforced by |
|---|---|
| `git clean` with `-f`, `-d`, `-x`, `-X` or `--force` (not a dry run) | `permissions.ask` + hook |
| `git reset --hard` | `permissions.ask` + hook |
| `git checkout .` / `-- .`, `git restore .` | `permissions.ask` + hook |
| `git stash drop`, `git stash clear` | `permissions.ask` + hook |

**Why `ask` and not `deny`.** These have legitimate uses (cleaning a build, dropping your own experiment), unlike `rm -rf` or a force push, which stay denied. They destroy work that git usually cannot recover, so a person should decide each time; a deny cannot be approved at the prompt and would force editing the settings. According to the [permissions documentation](https://code.claude.com/docs/en/permissions) rules are evaluated deny, then ask, then allow, so a broad `allow` such as `Bash(git *)` does not skip the question, and ask rules also prompt in `bypassPermissions`. In `dontAsk` they are denied; in a `-p` run with nobody to answer they are most likely denied too (inferred, not stated for ask rules).

**Why both.** Rules match the command text, so `git -C dir reset --hard` or `sudo git clean -fd` do not match them. The hook parses the command and answers with `permissionDecision: "ask"`, following [PreToolUse decision control](https://code.claude.com/docs/en/hooks#pretooluse-decision-control) (read on 2026-11-26; that page has no literal `"ask"` example and states no minimum version, and what a hook `"ask"` does in `bypassPermissions` or `dontAsk` was not verified). A rule may still ask where the hook would not, for example `git clean -d -n`.

**Protected branches** come from `.engkit.json` (`init` writes the default):

```json
{ "protectedBranches": ["main", "master", "release/*"] }
```

`*` is a wildcard. A custom list replaces the default one.

**Merging `.claude/settings.json`.** The file is read as JSON (if it is not valid JSON, for example because of comments, nothing is changed). `permissions.deny` and `permissions.ask` get the missing rules appended; `allow` and every other key are kept, as are the indentation and line endings. The hook group is identified by `engkit-guard.mjs`: it is added or updated in place, so running `init` again is safe. Then the **diff is printed** and you are asked to confirm (default: no). Without a terminal nothing is written unless you pass `--yes` (exit code 1). `--dry-run` prints what would be created and the diff, and writes nothing. The write is atomic. It warns if `permissions.defaultMode` is `bypassPermissions`. It does not touch `settings.local.json`.

**Upgrading from 0.4.0:** run `engkit init --profile agent --update-guard` to add the ask rules and the new guard; until then `test-guards` fails.

`--update-guard` replaces `.claude/hooks/engkit-guard.mjs` when it differs from the shipped version, showing a diff and asking first (without it, a changed script is reported and left alone).

**Why Node and not shell.** The hook is declared in exec form, so no shell is involved and the same entry works on Linux, macOS and Windows (`node` is a real executable everywhere):

```json
{ "type": "command", "command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/engkit-guard.mjs"], "onFailure": "block", "timeout": 10 }
```

A shell script would need a Bash version and a PowerShell version of a command parser that is hard to test; one `.mjs` file is tested the same way Claude Code runs it. The script is copied into the project, so it works for teammates who do not have `engkit`; they do need `node` in the PATH, and if it is missing `onFailure: "block"` blocks the guarded tools (fail closed). `onFailure` requires Claude Code 2.1.295 or newer. The guard also exits 2 on any internal error or unreadable input.

**Limits** (these are guards against accidents, not a security boundary, as the Claude Code permissions documentation says about Bash rules):

- Scripts that delete or read files on their own (`python -c`, `node -e`), `find -delete`, git or shell aliases, shell variables and globs that expand to a secret file are not covered.
- `echo .env` is blocked (a false positive on purpose); text inside a message such as `git commit -m "document .env"` is not.
- Only `git commit` is guarded on protected branches; `git merge`, `cherry-pick`, `revert`, `am` and `pull` are not.
- PowerShell and `cmd` commands (`Remove-Item -Recurse -Force`, `rd /s`) are not parsed.
- For tools other than Bash the guard checks every short string in the tool input, so a search pattern that is exactly `.env` is blocked too. The input field names of MultiEdit, NotebookEdit, Grep and Glob were not verified against the documentation, which is why it does not depend on them.

**Sources used** (read on 2026-11-24; the pages show no version): `code.claude.com/docs/en/hooks`, `settings`, `permissions` and `sub-agents`. The behavior was also checked live with Claude Code 2.1.331: `rm -rf` and a `.env` read are refused by the hook, and the `Read(./.env)` deny rule refuses the read on its own.

##### `engkit agent test-guards [--json]`

Checks the installation without risk. It starts the hook configured in `.claude/settings.json` like Claude Code does (command and args, JSON on stdin) with synthetic inputs and a throwaway git repository (on `main`, on a working branch, and on a sample branch per extra protected pattern) as working directory. **Nothing is executed**: the guard only receives the text of the command. It checks that:

- every blocked case exits **2** with a reason, every command that discards work exits **0** answering `"ask"`, and every allowed one (`rm file`, `git push origin feature/x`, `cat .env.example`...) exits **0**;
- `permissions.deny` and `permissions.ask` have the rules, the hook has `"onFailure": "block"`, the script exists and `node` starts;
- `claude --version` is at least **2.1.295** (a warning if it is older or `claude` is not installed).

Exit code: `0` all good, `1` a check failed, `2` the guards are not installed. It cannot test Claude Code's own permission engine, only that the rules are there.

**What is shared with other tools (`AGENTS.md`).** `AGENTS.md` is plain instructions: it enforces nothing.

| Can be shared (text, any tool) | Claude Code only |
|---|---|
| The rules and constraints in `CLAUDE.md`, which `AGENTS.md` already links to | `permissions` and `hooks` in `.claude/settings.json` |
| Links to the ADRs, build and test commands | The frontmatter of `.claude/agents/*.md` |
| The agent's role, written as prose | The `engkit-guard.mjs` script |

`init` does not edit `CLAUDE.md` or `AGENTS.md`: it prints a suggested text for the constraints section. How other tools enforce restrictions was not verified, and nothing here claims it.

### `engkit new adr "<title>"`

Creates the next ADR, e.g. `docs/adr/0007-title-in-kebab-case.md`, with `status: proposed`. The number is the highest existing one plus one (the `0000` template does not count). It starts from the project's own ADR template when it exists. Accents and symbols are removed from the file name. `--owner "<name>"` as in `init`. It also regenerates the ADR index.

`--supersedes <ID>` (e.g. `ADR-0003`) creates the new ADR with `supersedes: ADR-0003` and marks the old one `status: superseded` with `superseded_by: <new ADR>`. Nothing else in the old ADR changes (not even its `date`). Only an `accepted` ADR can be superseded; nothing is written if it is not.

### `engkit new pendiente [title]` (alias `new pending`)

Appends an entry with the next ID (`P-01` ... `P-99`, `P-100`, ...) to the pending file and refreshes its date. Options: `--type review|question` (default `question`), `--owner "<name>"`.

### `engkit adr accept <ID>`

Moves an ADR from `proposed` to `accepted` and sets its `date` to today. `<ID>` can be `ADR-0003`, `0003` or `3`. It fails if the ADR is not `proposed`, or if its `owner` is `TODO` or empty (`check` would reject it). It regenerates the ADR index.

After the acceptance is **committed**, the ADR is immutable: `engkit check` allows only `status: accepted` → `superseded` and adding `superseded_by` (use `engkit new adr ... --supersedes`). Any other change is an error.

### `engkit index`

Regenerates the ADR index (number, title, status, date, supersedes / superseded by). It is a generated file and says so in its header: do not edit it. `new adr` and `adr accept` run it for you; `check` warns (`index-stale`) when it is out of date.

### `engkit check [--json] [--strict]`

Verifies the project documents. Output is one line per finding, `file:line  severity  [rule]  message`, and exits **0** without errors, **1** with errors and **2** when the project cannot be checked (no `.engkit.json`: run `engkit init`). `--json` prints `{ ok, errors[], warnings[], summary }`. `--strict` turns warnings into errors.

| Rule | Severity | What it verifies |
|---|---|---|
| `adr-immutable` | error | After acceptance, an ADR only changes `status` → `superseded` and gains `superseded_by`. Any other change (body, `date`, `owner`, `id`, `supersedes`, going back to `proposed`...) is an error |
| `status-date` | error | Status documents and ADRs have a real `date` (YYYY-MM-DD); the visible "status as of" date matches the frontmatter |
| `unique-id` | error | No duplicate ADR numbers/ids, `P-xx` or document ids; an ADR's id matches its file number |
| `broken-ref` | error | Every `ADR-xxxx` and `P-xx` reference (body, `supersedes`, `superseded_by`) points to something that exists. Code blocks, inline code and HTML comments are ignored |
| `log-append-only` | error | In every version of the log, the earlier lines are unchanged: lines are only added at the end |
| `pending-owner` | error | Every `open` pending item has an owner |
| `pending-entry` | error | Pending items have a valid `type`, `status` and `date` |
| `todo-field` | error | `owner` and `date` are present and not `TODO` |
| `frontmatter` | error | Every managed document has frontmatter with an `id` (and an ADR has a valid `status`) |
| `supersede-coherence` | error | `supersedes`, `superseded_by` and `status: superseded` agree with each other; a superseded ADR has `superseded_by` |
| `adr-deleted` | warning | An ADR file was deleted from the ADR folder (found with `git log --diff-filter=D`) |
| `index-stale` | warning | The generated ADR index does not match the ADRs |
| `git-history` | warning | The git-based rules could not run or cannot be trusted (see below) |
| `missing-doc` | warning | A document configured in `.engkit.json` does not exist |

**How the git rules work.** For each ADR, `check` lists the commits that touched the file (following renames) and finds the first one where `status` is `accepted`. From there, every step (commit to commit, and finally the working tree against `HEAD`) must be an allowed change, so an edit that is later reverted is still caught, and an uncommitted edit is caught before you commit. The log is checked the same way: each version must start with all the lines of the previous one. Commit order is used, not dates.

**When there is no usable history,** the rules never pass silently:

| Situation | Result |
|---|---|
| Not a git repository, or no `git` | `git-history` warning; `adr-immutable`, `log-append-only` and `adr-deleted` are skipped, the rest runs |
| ADR accepted only in the working tree (not committed yet) | `adr-immutable` warning: it cannot be verified until the acceptance is committed |
| Untracked or never-committed log | nothing to compare yet |
| Shallow clone | `git-history` warning: the history is incomplete. In CI use `fetch-depth: 0` |
| `--strict` | all of the above become errors |

Known limits: history is assumed to be mostly linear, and an accepted ADR cannot be corrected in place (a typo needs a superseding ADR). With no owner (`git config user.name` empty and no `--owner`), documents are created with `owner: TODO` and `check` fails until it is set.

Use it in CI:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0        # full history, needed by adr-immutable and log-append-only
- run: npm i -g https://github.com/dquancruz/engineering-toolkit/releases/download/v0.5.0/engineering-toolkit-0.5.0.tgz
- run: engkit check --strict
```

### `engkit prompt`

Builds a well-formed prompt for an AI from eight elements: **goal, context, material, limits, autonomy** (when to stop and ask), **definition of done, verification** and **shape of the response**. The prompt is printed as Markdown on **stdout**; questions, warnings and messages go to **stderr**, so you can pipe it: `engkit prompt --from p.yaml | pbcopy`. Headings use the language of the checklist (`--lang`); what you type is kept as is.

**Single source.** The questions, examples, checks, "weak" and "checkable" wording and the presets live in [`checklists/es/ai-prompt.md`](checklists/es/ai-prompt.md) and [`checklists/en/ai-prompt.md`](checklists/en/ai-prompt.md). The tool reads them, nothing is duplicated in the code: edit the Markdown to change what it asks, warns about or preloads. The format is described in [`checklists/README.md`](checklists/README.md).

**Guided mode** (needs a terminal): `engkit prompt` asks one question per element, showing the question, an example and the checks. In multi-line fields press **Enter twice** to submit; **Ctrl+C** cancels (exit 130). It starts by offering a preset; the preset's limits and verification are pre-filled and editable. At the end it shows the warnings and lets you fix the weak elements, then offers to save.

**Non-interactive mode**: with `--from <file.yaml|json>` or any element flag nothing is asked. Flags override the file, element by element (lists are replaced).

```bash
engkit prompt --from prompt.yaml
engkit prompt --preset bugfix --goal "Fix the 500 on POST /orders" \
  --done "POST /orders without items returns 400 and the new test passes" \
  --verify '`npm test`' --material @adr:ADR-0001 --limit @claude --save fix-orders
```

| Option | Description |
|---|---|
| `--from <file>` | Answers file (`.yaml`, `.yml` or `.json`) |
| `--preset <id>` | `research`, `feature`, `bugfix`, `refactor` or `review`: adds typical limits and verification before yours |
| `--goal`, `--context`, `--autonomy`, `--done`, `--response` | One value per element |
| `--material`, `--limit`, `--verify` | Repeatable |
| `--checklist <id>` | Repeatable: add the limits and verification of a checklist (see below) |
| `--save [name]` | Save the prompt and its answers (see below) |
| `--no-gitignore` | Do not add the prompts folder to `.gitignore` |
| `--allow-secrets` | Print and save even if a possible secret is detected |
| `--no-env-scan` | Do not compare the prompt with values from `.env` files |
| `--strict` | Exit 1 when there are warnings about empty or weak elements |

Answers file (keys are always in English; unknown keys are an error):

```yaml
preset: bugfix            # optional
goal: Fix the 500 on POST /orders when items is missing
context: Only happens with mobile clients v1.
material:
  - "@adr:ADR-0001"        # a path, see "Project integration"
  - src/orders/handler.ts
limits:
  - "@claude"
  - Do not change the database schema
autonomy: Stop and ask if the public API has to change.
done: POST /orders without items returns 400 and the new test passes
verify: "`npm test`"       # text or a list
response: A 3-line summary and a table of changed files.
```

**Warnings** never block (exit 0, or 1 with `--strict`): an empty element (with specific messages for "no limits set" and "does not say when to stop and ask"), vague wording taken from the checklist (`improve`, `make it work`...), a definition of done that is not checkable (no command in backticks, no number and no checkable wording) and a verification without a command.

**Project integration** (needs `.engkit.json`). The guided mode offers the **accepted ADRs** and the **open pending items** as material, and `CLAUDE.md` as a limit (it says when `CLAUDE.md` has no rules yet). Only a path is added, never the content of the document:

```
- docs/adr/0001-use-postgresql.md (ADR-0001: Use PostgreSQL)
- docs/pending.md:19 (P-01: Confirm retention period)
- Follow the rules and constraints in CLAUDE.md.
```

In files and flags use `@adr:ADR-0003`, `@pending:P-04` and `@claude`. A reference that does not resolve is an error (exit 2), and so is an ADR that is not accepted (use its path as plain text to include it anyway). Without those tokens nothing is added automatically.

**Checklists.** `--checklist <id>` (or `<id>:<variant>`) adds the short "For a prompt" block of a [checklist](checklists/README.md) to the limits and verification, after the preset's items and before yours. It is never automatic: in guided mode the one that fits the preset is offered, and the default answer is no.

| Checklist | Variants | Offered with preset |
|---|---|---|
| `code-review` | `feature`, `bugfix`, `refactor`, `docs`, `dependencies` | `review` (asks the PR type) |
| `definition-of-done` | | `feature`, `bugfix`, `refactor` |
| `system-design` | | only with the flag |
| `threat-model` | | only with the flag |

With only `--checklist` the mode is still guided, with the items pre-filled. A saved answers file contains the added items, so `--from` rebuilds the same prompt without the flag.

**Secrets.** Before anything is printed or saved the prompt is checked for private keys, AWS, GitHub, Anthropic, OpenAI, Slack, Google and Stripe keys, JWTs, URLs with credentials, `api_key=`/`password=`-style assignments, and for **values from your `.env` files** (variables whose name suggests a secret, or whose value looks like a token; `.env.example` is ignored). If one is found, **nothing is printed or saved**, the findings are shown on stderr masked (`ghp_***`, or `.env:API_TOKEN`, never the value) and the exit code is 1. `--allow-secrets` overrides it. This is a heuristic, not a replacement for a real secret scanner. The `.env` files are only read in memory to compare; use `--no-env-scan` to skip it.

**Saving.** `--save [name]` writes `prompts/YYYY-MM-DD-<name>.md` and a `.yaml` with the answers next to it, never overwriting a file; `engkit prompt --from prompts/<file>.yaml` rebuilds the same prompt. In a git repository the folder is added to `.gitignore` the first time (and the command says so): generated prompts are working artifacts, may carry internal context, and only point to your documents instead of copying them. To keep one, move its `.yaml` to a versioned folder. Change the folder with `"promptsDir": "docs/prompts"` in `.engkit.json`.

Exit codes: **0** ok, **1** blocked (secret, or warnings with `--strict`), **2** bad input or no terminal (use `--from` or flags), **130** cancelled.

### `engkit branch [ticket] <description...>`

Creates and switches to `<type>/<TICKET>-<description>`, or `<type>/<description>` without a ticket. The name is printed on stdout.

```bash
engkit branch ABC-123 "Agregar paginación" --type fix   # fix/ABC-123-agregar-paginacion
engkit branch update dependencies --type chore          # chore/update-dependencies
engkit branch "Add login" --dry-run                     # only prints feature/add-login
```

| Option | Description |
|---|---|
| `--type <type>` | Prefix. Default: `branch.defaultType` |
| `--ticket <id>` | Ticket ID; without it the first word is used if it matches the pattern |
| `--from <ref>` | Base commit or branch (no upstream is set) |
| `--dry-run` | Only print the name |

Settings in `.engkit.json`, all optional (these are the defaults):

```json
{
  "branch": {
    "types": ["feature", "fix", "chore", "docs", "refactor", "test"],
    "defaultType": "feature",
    "ticketPattern": "[A-Z][A-Z0-9]+-\\d+",
    "requireTicket": false
  }
}
```

`ticketPattern` must match the whole ID and is case-sensitive: with the default, `abc-123` is part of the description. With `"requireTicket": true` a branch without a ticket is refused. The description is lower-cased, loses its accents and is cut at 60 characters. If a custom `types` list lacks `feature`, its first entry is the default.

It **refuses** to create a branch whose name matches `protectedBranches` (compared ignoring case, also with `--dry-run`) or that already exists. Exit code: **0** ok, **1** refused or git failed, **2** bad input.

### `engkit changelog <from> <to>`

Adds a section to `CHANGELOG.md` from the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) in `<from>..<to>`.

```bash
engkit --lang en changelog v1.1.0 HEAD --release v1.2.0
engkit changelog v1.1.0 v1.2.0 --stdout
engkit changelog v1.0.0 --from-start       # first release: everything up to v1.0.0
```

| Option | Description |
|---|---|
| `--release <name>` | Heading name. Default: `<to>` if it is a tag, else `Unreleased` |
| `--from-start` | Take only `<to>` and read its whole history |
| `--stdout` | Print the section and write nothing |
| `--force` | Rewrite the section when the release is already in the file |
| `--all` | Also list `docs`, `refactor`, `test`, `build`, `ci`, `style`, `chore` and `revert` |

Sections: breaking changes (`type!:` or a `BREAKING CHANGE:` footer, whatever the type), features, fixes, performance and **other**, which holds every message that does not follow the convention or has an unknown type, so nothing is dropped silently. Merge commits are skipped, and the number of commits left out by type is reported on stderr. The section date is the date of the `<to>` commit, so the same history gives the same text. New sections go above the previous releases and no other line changes. Headings follow `--lang`. `@name` is wrapped in backticks and `<` is escaped, so publishing the text notifies nobody.

Exit code: **0** ok, **1** the release is already in the file, **2** bad input or shallow clone.

### `engkit env example` and `engkit env check [files...]`

Work with the **names** of the variables in `.env*` files. **Values are never printed or written**: output has only variable names, file names, line numbers and fixed messages.

- `env example` creates `.env.example` with `NAME=` lines from `.env` and `.env.*`, or appends the missing names to it. Existing lines are not changed; values and comments are not copied. It does not write through a symlink.
- `env check` lists what each file lacks compared with `.env.example` (without one, with all the compared files together) and warns about variables that are not in the example. A variable with an empty value counts as present. `--json` prints `{ ok, reference, files[], errors[] }`.

Files ending in `.example`, `.sample`, `.template`, `.dist`, `.bak`, `.orig`, `.swp`, `.swo` or `~` are not sources.

**It fails closed.** Quoted multi-line values and PEM blocks are skipped as values. Any line that cannot be read for certain (unknown syntax, unclosed quote, unquoted multi-line value, backslash continuation) makes that file yield no names: only `file:line` and the reason are shown, and `env example` writes nothing. **Limit:** an unquoted multi-line secret is invalid dotenv; it is detected in the usual cases, but a continuation line that looks exactly like a valid assignment cannot be told apart from one. Quote multi-line values.

Exit code: **0** ok, **1** missing variables (`check`), **2** a file could not be read, or there is nothing to do.

With the [agent profile](#agent-profile-engkit-init---profile-agent), an agent can run `engkit env check` (it prints names only), but the guard blocks commands that name an `.env` file.

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

Knowledge notes below do not exist yet.

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

Code review, Definition of Done, system design and threat model are available in [`checklists/`](checklists/README.md).

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
