---
id: system-design
lang: en
---

# Checklist: system design

When to use it: before approving the design of a system or of a large change.

## Requirements <!-- section: requirements -->

- [ ] The problem and who has it are written down
- [ ] Functional requirements and what is out of scope are clear
- [ ] There are measurable targets for latency, availability and cost

## Scale and data <!-- section: scale -->

- [ ] Load, volume and growth are estimated, with their source
- [ ] The data model, its owner and its retention are defined
- [ ] The first limit reached when growing is identified

## Design and trade-offs <!-- section: design -->

- [ ] Interfaces and dependencies are described
- [ ] At least two alternatives were compared and the choice is explained
- [ ] Decisions that are hard to reverse have an ADR

## Failures and operation <!-- section: failure -->

- [ ] It says what happens when each dependency fails
- [ ] There are timeouts, retries and idempotency where needed
- [ ] Signals, alerts and who responds are defined
- [ ] There is a rollout, migration and rollback plan

## For a prompt <!-- prompt -->

What `engkit prompt --checklist system-design` adds to the prompt.

### Limits <!-- limits -->

- Do not present estimates without saying where they come from
- Do not decide on your own anything hard to reverse

### Verification <!-- verify -->

- Every measurable requirement has a way to check it
- Every dependency has its failure described
- At least 2 alternatives were compared
