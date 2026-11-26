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
Estados: draft | confirmed | modified | discarded | disputed.
- confirmed: la regla vale hoy y tiene evidencia.
- modified: el sistema nuevo la cambia a propósito. Exige `decision: ADR-xxxx` y conserva la evidencia del comportamiento viejo.
- discarded: ya no aplica. No borres el archivo.
- disputed: hay una duda abierta; enlaza la pregunta P-xx en `questions`.
La evidencia de código se agrega con `engkit evidence add {{id}} <raíz>:<ruta>:<líneas>`; la que no es código, con `- source: F-xx`.
No copies código aquí: la referencia y su hash bastan.
-->

## Regla

TODO: una sola regla, en lenguaje del negocio.

## Excepciones

TODO: casos en los que no aplica, o "ninguna conocida".
