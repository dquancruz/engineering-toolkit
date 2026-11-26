---
id: REBUILD-PLAN
date: {{date}}
owner: {{owner_yaml}}
excluded: []
done: []
---

# Plan de reconstrucción

Estado al {{date}}. <!-- engkit:date -->

<!--
Enlaza, no copies. El alcance incluido es la unión de las rebanadas. Lo que queda fuera se declara arriba:
  excluded:
    - rule: <ID de la regla>
      reason: por qué
      decision: <ADR>        # opcional
`done` son los criterios de terminado de toda la reconstrucción: { text, verify: <PA> o `comando` }.
Riesgos: `### K-01: título` con probability y impact (low | medium | high), mitigation y owner.
-->

## Objetivo

TODO: qué se reconstruye y por qué, en dos frases.

## Documentos

- [Requisitos y restricciones]({{requirements_link}})
- [Fuentes]({{sources_link}})
- [Reglas de negocio]({{rules_link}})
- [Decisiones]({{decisions_link}})
- [Preguntas abiertas]({{pending_link}})
- [Plan de pruebas]({{testplan_link}}) (generado con `engkit testplan`)

## Fuera de alcance

TODO: lo que no se reconstruye y no es una regla (las reglas van en `excluded`).

## Riesgos
