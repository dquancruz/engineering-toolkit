# 🧰 Engineering Toolkit

A knowledge base, a set of tools and a collection of checklists for software engineering work.

This repository is my **second brain**: notes I reference regularly, small TypeScript tools that automate repetitive tasks, and checklists that keep quality consistent.

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
├── knowledge/                  Reference notes
│   ├── git/
│   │   └── basics.md
│   └── markdown/
│       └── symbols-and-meaning.md
├── tools/                      TypeScript tools (shared package.json / tsconfig)
│   ├── jira-defects-report/
│   └── oncall-ticket-creator/
├── checklists/                 Reusable checklists
│   └── README.md
└── README.md
```

---

## 🛠️ Tools

| Tool | Description |
|---|---|
| [`jira-defects-report`](tools/jira-defects-report/) | Turns a Jira CSV export into a JSON report and summary of defects (optionally filtered by person) |
| [`oncall-ticket-creator`](tools/oncall-ticket-creator/) | Turns that JSON report into a Markdown oncall ticket, ordered by priority |

**Workflow:** Jira CSV → `jira-defects-report` (JSON report) → `oncall-ticket-creator` (oncall ticket)

Setup, from the `tools/` folder:

```bash
cd tools
npm ci
```

Each tool runs with `npm start -- <args>`, which compiles the TypeScript and executes it. See each tool's README for details.

---

## 🗺️ Roadmap

Nothing below exists yet.

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

- AI prompt builder (next)
- Git branch creator
- AI commit message generator
- AI PR description generator
- JSON formatter (→ TS types / Zod)
- Type converter (JSON / YAML / TOML / CSV / XML)
- Regex tester
- JWT decoder
- Env file manager
- API mock server
- Project scaffolder
- Changelog generator
- Requirements collector
- ADR generator
- Test plan generator

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
