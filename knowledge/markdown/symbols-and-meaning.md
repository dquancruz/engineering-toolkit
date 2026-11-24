# Markdown — Symbols & Meaning (cheat sheet)
---
## `#` - Headings (titles & sections)
Used for titles and subtitles
The quantity of `#` indicates the hierarchy 

```md
- # Title (H1) - Main title of the document (just one)
- ## Section (H2) - Big sections 
- ### Subsection  (H3) - Subsections
- #### Sub-section (H4) - Small details
```

---

## `---` - Horizontal Rule (separator)
Creates a separator visual line

```md
---
```

It's used to:
- Separate big sections 
- Identify big topic changes
- Give esthetic design to the document
Doesn't affect the structure, just the legibility

---

## `**text**` - Bold (strong emphasis)
Highlights important concepts

```md 
**Important**
```
Result: **Important**

---

## `*text*` or `_text_` - Italic (soft emphasis)
For clarifications or terms

```md
*note*
```
Result: *note*

---

## `~~text~~` - Strikethrough (striked through)
Indicates something obsolete or discarded

```md 
~~deprecated~~
```
Result: ~~deprecated~~

---

## ``code`` - Inline Code
For commands, variables, or technical words within text

```md
Use `git status` to check the repository
```
Result: Use `git status` to check the repository

---

## ` ` -  Code Block (code blocks)
For complete commands, scripts, or examples

```bash
```bash
git status
git pull
```

It also accepts the following languages:
- bash
- js
- json
- yaml
- sql
- text

---

## `>` — Blockquote (quotes or notes)
For warnings, notes, or quotes.

```md
> This command is destructive
```
Result:
> This command is destructive

---

## `-` or `*` Unordered List
Unordered lists

```md
- item
- item
- item
```

---

## `1.` - Ordered list
Ordered lists

```md
1. First
2. Second
3. Third
```
---

## `-[]`/`-[x]` - Task Lists (checklists)
Widely used in technical documentation

```md
- [ ] Not done
- [x] Done
```
Result:
- [ ] Not done
- [x] Done

## `---` + `text` Top — Front matter (advanced)
Used in doc generators (MkDocs, Docusaurus, Hugo)

```md
---
title: Git Reference
author: You
---
```
It's not pure Markdown, but it's very common

---

## `\` - Escape character
Prevent a symbol from being misinterpreted

```md
\# Not a title
```
Result:
\# Not a title

---

## `|` - Tables
To create tables

```md
| Command | Description |
|--------|-------------|
| git pull | Fetch + merge |
```
Result:
| Command | Description |
|--------|-------------|
| git pull | Fetch + merge |

---

## `[]()` - Links
```md
[Git Docs](https://git-scm.com)
```
Result: [Git Docs](https://git-scm.com)

---

## `![]()` - Images
```md
![Alt text](image.png)
```

---

## `---` vs `***` vs `___`
They all create a horizontal line:

```md
---
***
___
```

Most commonly used convention: ---

---

## Markdown mental model
# → structure

- `---` → separation
- ` → technique
- `**` → emphasis
- `>` → note/warning
- `-` → lists
- `|` → tables