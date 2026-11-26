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
Una rebanada vertical entrega algo que se puede usar y probar de punta a punta.
Estados: planned | in-progress | done | dropped. `done` necesita al menos un criterio:
  done:
    - text: qué tiene que cumplirse
      verify: <PA> o `comando`
Una rebanada `done` exige que sus pruebas estén en `ready`.
-->

## Qué entrega

TODO: lo que alguien podrá hacer cuando esta rebanada esté terminada.
