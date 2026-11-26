---
id: REBUILD-PLAN
date: {{date}}
owner: {{owner_yaml}}
excluded: []
done: []
---

# Rebuild plan

Status as of {{date}}. <!-- engkit:date -->

<!--
Link, do not copy. What is in scope is the union of the slices. What is left out is declared above:
  excluded:
    - rule: <rule ID>
      reason: why
      decision: <ADR>        # optional
`done` holds the done criteria of the whole rebuild: { text, verify: <PA> or `command` }.
Risks: `### K-01: title` with probability and impact (low | medium | high), mitigation and owner.
-->

## Goal

TODO: what is rebuilt and why, in two sentences.

## Documents

- [Requirements and constraints]({{requirements_link}})
- [Sources]({{sources_link}})
- [Business rules]({{rules_link}})
- [Decisions]({{decisions_link}})
- [Open questions]({{pending_link}})
- [Test plan]({{testplan_link}}) (generated with `engkit testplan`)

## Out of scope

TODO: what is not rebuilt and is not a rule (rules go in `excluded`).

## Risks
