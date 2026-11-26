---
id: STRANGLER
date: {{date}}
owner: {{owner_yaml}}
tables: []
---

# Plan estrangulador

Estado al {{date}}. <!-- engkit:date -->

<!--
Una entrada por tabla en `tables`, y un solo escritor por tabla en cada momento:
  tables:
    - table: esquema.tabla
      writer: legacy              # legacy | new
      order: 1                    # orden de traslado
      handover: { to: new, date: AAAA-MM-DD, owner: nombre, slice: <rebanada>, status: planned }
      verify: "`comando que prueba que nadie más escribe`"
Al terminar un traspaso: `writer: new` y `status: done`, en el mismo cambio.
`engkit check` valida el plan; no mira la base de datos.
-->

## Notas

TODO: cómo se sincronizan las lecturas mientras conviven los dos sistemas.
