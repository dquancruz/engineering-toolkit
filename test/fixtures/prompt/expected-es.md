# Prompt

## Objetivo

Corregir el error 500 en POST /orders cuando falta el campo items

## Contexto

Solo ocurre con clientes móviles v1.

## Material

- docs/adr/0001-usar-postgresql.md (ADR-0001: Usar PostgreSQL)
- docs/pendientes.md:19 (P-01: Confirmar plazo de retención)
- src/orders/handler.ts

## Límites

- Cambiar lo mínimo necesario para corregir el defecto
- No refactorizar código que no esté relacionado
- No cambiar el comportamiento fuera del caso del defecto
- Respeta las reglas y restricciones de CLAUDE.md.
- No tocar el esquema de la base de datos

## Autonomía

Detenerse y preguntar si hay que cambiar la API pública.

## Criterio de terminado

POST /orders sin items devuelve 400 y el test nuevo pasa

## Verificación

- Una prueba que reproduce el defecto falla antes del cambio y pasa después
- Los tests existentes pasan (`npm test` o el comando del proyecto)
- `npm test`

## Forma de la respuesta

Resumen de 3 líneas y tabla de archivos.
