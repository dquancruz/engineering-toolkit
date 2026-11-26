---
id: system-design
lang: es
---

# Checklist: diseño de sistema

Cuándo usarlo: antes de aprobar el diseño de un sistema o de un cambio grande.

## Requisitos <!-- section: requirements -->

- [ ] El problema y quién lo tiene están escritos
- [ ] Los requisitos funcionales y lo que queda fuera están claros
- [ ] Hay objetivos medibles de latencia, disponibilidad y coste

## Escala y datos <!-- section: scale -->

- [ ] Hay estimaciones de carga, volumen y crecimiento, con su fuente
- [ ] El modelo de datos, su dueño y su retención están definidos
- [ ] Se identificó qué limita primero al crecer

## Diseño y trade-offs <!-- section: design -->

- [ ] Las interfaces y dependencias están descritas
- [ ] Se compararon al menos dos alternativas y se explica la elegida
- [ ] Las decisiones difíciles de revertir tienen un ADR

## Fallos y operación <!-- section: failure -->

- [ ] Se dice qué pasa cuando falla cada dependencia
- [ ] Hay timeouts, reintentos e idempotencia donde hacen falta
- [ ] Están definidas las señales, alertas y quién responde
- [ ] Hay plan de despliegue, migración y reversión

## Para un prompt <!-- prompt -->

Lo que `engkit prompt --checklist system-design` agrega al prompt.

### Límites <!-- limits -->

- No presentar estimaciones sin decir de dónde salen
- No decidir por tu cuenta algo difícil de revertir

### Verificación <!-- verify -->

- Cada requisito medible tiene su forma de comprobarse
- Cada dependencia tiene descrito su fallo
- Se compararon al menos 2 alternativas
