---
id: ai-prompt
lang: en
labels:
  question: Question
  example: Example
  weak: Weak signals
  checkable: Checkable signals
strings:
  prompt_title: Prompt
  claude_limit: "Follow the rules and constraints in {file}."
---

# Checklist: AI prompt

When to use it: before asking an AI to do work that touches code or documents. It works as a checklist and it is the source for `engkit prompt`: the questions, examples, signals and presets below are the ones the tool uses.

A clear prompt has eight elements. If you cannot answer one in a sentence or two, it is not ready yet.

## 1. Goal <!-- element: goal -->

**Question:** What do you want to achieve, in one sentence?

**Example:** Add pagination to the `GET /orders` endpoint without changing the response for current clients.

**Weak signals:** improve, optimize, fix everything, clean up, take a look, make it nice

- [ ] It is a single sentence and starts with a verb
- [ ] It states the expected result, not how to get there
- [ ] Someone without the context of the conversation understands it

## 2. Context <!-- element: context -->

**Question:** What does whoever runs this need to know that cannot be derived from the code?

**Example:** Mobile clients v1 rely on `items` being a flat array; a migration to v2 is planned.

- [ ] It only includes what cannot be derived from the code
- [ ] It links to sources instead of copying them
- [ ] Each important fact says where it comes from

## 3. Material <!-- element: material -->

**Question:** Which files, documents or links must it read before starting?

**Example:** `src/orders/handler.ts` and `docs/adr/0004-pagination.md`

- [ ] They are paths or links, not copied content
- [ ] It includes the accepted ADRs that apply
- [ ] It includes no keys, tokens or `.env` values

## 4. Limits <!-- element: limits -->

**Question:** What must it not do or touch?

**Example:** Do not change the database schema. Do not add dependencies without justifying them.

**Weak signals:** be careful, don't break anything, whatever you think is best

- [ ] There is at least one explicit limit
- [ ] Each limit is clearly met or violated
- [ ] It includes the project rules (for example `CLAUDE.md`)

## 5. Autonomy <!-- element: autonomy -->

**Question:** When must it stop and ask you instead of deciding?

**Example:** Stop and ask if the public API has to change, data has to be deleted, or tests fail for a reason it does not understand.

**Weak signals:** use your judgment, whatever you see fit, you decide

- [ ] It names concrete situations where it must stop
- [ ] It says what to do with what cannot be verified

## 6. Definition of done <!-- element: done -->

**Question:** How will you know it is finished? It has to be checkable.

**Example:** `GET /orders?page=2&size=20` returns 20 items and the `X-Total-Count` header, and `npm test` passes.

**Weak signals:** it works, make it nice, works correctly, better than before

**Checkable signals:** passes, fails, returns, responds, exit code, test, command, throws, shows, equals, matches

- [ ] It can be checked with a command, a test or a concrete result
- [ ] It has exact numbers, names or values where they apply
- [ ] It does not depend on the opinion of whoever did the work

## 7. Verification <!-- element: verify -->

**Question:** Which commands or steps will you run to check it?

**Example:** `npm test`, `npx tsc --noEmit` and a manual call with `curl`.

**Weak signals:** try it, see that it works, check that it runs

- [ ] Each step is a command or a repeatable action
- [ ] It says which result counts as correct

## 8. Shape of the response <!-- element: response -->

**Question:** In what format do you want the answer?

**Example:** A 3-line summary, a table of changed files and what is left pending.

- [ ] It states the format (summary, table, diff, list...)
- [ ] It asks to separate what is verified from what is not

## Presets

Each task type preloads typical limits and verification. In `engkit prompt` you add them with `--preset` or pick one at the start.

### Research or document <!-- preset: research -->

#### Limits <!-- limits -->

- Do not modify source code or configuration
- Cite the source of every fact (file and line, or link)
- Mark what could not be checked as unverified

#### Verification <!-- verify -->

- Every claim has its source
- The cited paths and links exist (`ls` or open them)

### Feature <!-- preset: feature -->

#### Limits <!-- limits -->

- Do not change the public API without asking
- Do not add dependencies without justifying them
- Keep the existing style and conventions

#### Verification <!-- verify -->

- Existing tests pass (`npm test` or the project command)
- There are new tests for the new behavior
- Typecheck and linter pass (for example `npx tsc --noEmit`)

### Bugfix <!-- preset: bugfix -->

#### Limits <!-- limits -->

- Change only what is needed to fix the defect
- Do not refactor unrelated code
- Do not change behavior outside the defect case

#### Verification <!-- verify -->

- A test that reproduces the defect fails before the change and passes after it
- Existing tests pass (`npm test` or the project command)

### Refactor <!-- preset: refactor -->

#### Limits <!-- limits -->

- Do not change observable behavior
- Do not mix the refactor with functional changes
- Do not modify existing tests, except to rename
- Make small, reviewable changes

#### Verification <!-- verify -->

- Existing tests pass unmodified (`npm test` or the project command)
- Typecheck and linter pass (for example `npx tsc --noEmit`)

### Review <!-- preset: review -->

#### Limits <!-- limits -->

- Read only: do not modify files
- Give the file and line of every finding
- Separate real defects from style preferences

#### Verification <!-- verify -->

- Every finding can be reproduced or pointed to in the code (`git diff` or open the file)
- It states what could not be verified
