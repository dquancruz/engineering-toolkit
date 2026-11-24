# Prompt

## Goal

Corregir el error 500 en POST /orders cuando falta el campo items

## Context

Solo ocurre con clientes móviles v1.

## Material

- docs/adr/0001-usar-postgresql.md (ADR-0001: Usar PostgreSQL)
- docs/pendientes.md:19 (P-01: Confirmar plazo de retención)
- src/orders/handler.ts

## Limits

- Change only what is needed to fix the defect
- Do not refactor unrelated code
- Do not change behavior outside the defect case
- Follow the rules and constraints in CLAUDE.md.
- No tocar el esquema de la base de datos

## Autonomy

Detenerse y preguntar si hay que cambiar la API pública.

## Definition of done

POST /orders sin items devuelve 400 y el test nuevo pasa

## Verification

- A test that reproduces the defect fails before the change and passes after it
- Existing tests pass (`npm test` or the project command)
- `npm test`

## Shape of the response

Resumen de 3 líneas y tabla de archivos.
