# ✅ Checklists

Reusable checklists for everyday engineering work. A checklist is short, actionable and meant to be copied into a PR, ticket or design doc and ticked off.

## Available checklists

All of them exist in Spanish and English (`es/`, `en/`).

| File | Purpose |
|---|---|
| `ai-prompt.md` | Make sure a prompt has context, constraints, expected output and verification steps. Source of `engkit prompt` |
| `code-review.md` | What to check before approving a pull request: a common part and one per PR type (feature, bugfix, refactor, docs, dependencies) |
| `definition-of-done.md` | When a story is really finished |
| `system-design.md` | Requirements, scale, trade-offs and failure modes to cover in a design |
| `threat-model.md` | Assets, entry points, the six STRIDE categories and mitigations |

## Conventions

- One file per checklist and language, named in kebab-case: `checklists/<lang>/<name>.md` (e.g. `es/code-review.md`)
- Use Markdown task lists (`- [ ] item`)
- Keep each checklist to one screen where possible
- Add a one-line "when to use this" at the top

## Machine-readable checklists

### `ai-prompt.md`

`ai-prompt.md` is read by `engkit prompt`, so it keeps a fixed structure that still renders well in GitHub:

- Frontmatter with the localized `labels` and the `strings` the tool prints.
- One `## N. Title <!-- element: id -->` section per prompt element, with `**Question:**`, `**Example:**`, `**Weak signals:**` (and `**Checkable signals:**`) lines and a task list of checks. Signals are comma-separated.
- A `## Presets` section with `### Title <!-- preset: id -->` and `#### Title <!-- limits|verify -->` sub-sections made of bullet lists.

The HTML comments are invisible when rendered. Edit the file to change what the tool asks, warns about or preloads; tests check that both languages stay in sync.

### The other checklists

Used by `engkit prompt --checklist <id>[:<variant>]`:

- Frontmatter with `id` and `lang`, an `# H1` title and the "when to use it" line.
- One `## Title <!-- section: id -->` per section, with a `- [ ]` task list.
- A final `## Title <!-- prompt -->` section with `### … <!-- limits -->` and `### … <!-- verify -->` bullet lists: the few items a prompt gets. The whole checklist is not copied into prompts.
- Optional variants inside it: `### Title <!-- variant: id -->` with `#### … <!-- limits -->` and `#### … <!-- verify -->`.

Section and variant ids are the same in both languages; tests check that they stay in sync.
