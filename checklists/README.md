# ✅ Checklists

Reusable checklists for everyday engineering work. A checklist is short, actionable and meant to be copied into a PR, ticket or design doc and ticked off.

## Planned checklists

| Checklist | Purpose |
|---|---|
| AI prompts | Make sure a prompt has context, constraints, expected output and verification steps. Available now, in Spanish and English (`es/ai-prompt.md`, `en/ai-prompt.md`), and used by `engkit prompt` as its source |
| Code review | What to check before approving a pull request |
| Definition of Done | When a story is really finished |
| System design | Requirements, scale, trade-offs and failure modes to cover in a design |
| Threat model | Assets, entry points, threats and mitigations |

## Conventions

- One file per checklist and language, named in kebab-case: `checklists/<lang>/<name>.md` (e.g. `es/code-review.md`)
- Use Markdown task lists (`- [ ] item`)
- Keep each checklist to one screen where possible
- Add a one-line "when to use this" at the top

## Machine-readable checklists

`ai-prompt.md` is read by `engkit prompt`, so it keeps a fixed structure that still renders well in GitHub:

- Frontmatter with the localized `labels` and the `strings` the tool prints.
- One `## N. Title <!-- element: id -->` section per prompt element, with `**Question:**`, `**Example:**`, `**Weak signals:**` (and `**Checkable signals:**`) lines and a task list of checks. Signals are comma-separated.
- A `## Presets` section with `### Title <!-- preset: id -->` and `#### Title <!-- limits|verify -->` sub-sections made of bullet lists.

The HTML comments are invisible when rendered. Edit the file to change what the tool asks, warns about or preloads; tests check that both languages stay in sync.
