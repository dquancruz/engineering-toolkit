---
id: {{id}}
status: draft
area:{{area}}
date: {{date}}
owner: {{owner_yaml}}
evidence: []
questions: {{questions}}
decision:
---

# {{id}}: {{title}}

<!--
Statuses: draft | confirmed | modified | discarded | disputed.
- confirmed: the rule holds today and has evidence.
- modified: the new system changes it on purpose. Needs `decision: ADR-xxxx` and keeps the evidence of the old behaviour.
- discarded: it no longer applies. Do not delete the file.
- disputed: there is an open doubt; link the P-xx question in `questions`.
Add code evidence with `engkit evidence add {{id}} <root>:<path>:<lines>`; evidence that is not code with `- source: F-xx`.
Do not copy code here: the reference and its hash are enough.
-->

## Rule

TODO: a single rule, in business language.

## Exceptions

TODO: cases where it does not apply, or "none known".
