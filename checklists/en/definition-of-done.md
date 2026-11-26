---
id: definition-of-done
lang: en
---

# Checklist: Definition of Done

When to use it: before calling a story or task finished.

## Behavior <!-- section: behavior -->

- [ ] It meets every acceptance criterion
- [ ] Error and edge cases are handled
- [ ] Someone tried it in an environment close to production

## Quality <!-- section: quality -->

- [ ] There are automated tests for the new behavior
- [ ] Tests, typecheck and linter pass in CI
- [ ] The code was reviewed and the comments resolved
- [ ] No TODO is left without a pending item that tracks it

## Delivery <!-- section: delivery -->

- [ ] The affected documentation is up to date
- [ ] Important decisions are recorded in an ADR
- [ ] The configuration, migrations and permissions it needs are ready
- [ ] It is clear how to observe it and how to roll it back

## For a prompt <!-- prompt -->

What `engkit prompt --checklist definition-of-done` adds to the prompt.

### Limits <!-- limits -->

- Do not call the task finished while a criterion is unchecked

### Verification <!-- verify -->

- Every acceptance criterion was checked, saying how
- Tests, typecheck and linter pass (`npm test` or the project command)
- The affected documentation was updated, or it says it does not change
