---
id: {{id}}
status: planned
order: {{order}}
date: {{date}}
owner: {{owner_yaml}}
rules: {{rules}}
tests: {{tests}}
requirements: []
constraints: []
decisions: []
risks: []
questions: []
done: []
---

# {{id}}: {{title}}

<!--
A vertical slice delivers something that can be used and tested end to end.
Statuses: planned | in-progress | done | dropped. `done` needs at least one criterion:
  done:
    - text: what has to be true
      verify: <PA> or `command`
A `done` slice requires its tests to be `ready`.
-->

## What it delivers

TODO: what someone will be able to do when this slice is finished.
