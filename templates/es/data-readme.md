# Plan de datos

Un archivo `.md` por tabla destino (este `README.md` no se revisa). Los conteos los toma tu script; engkit no se conecta a ninguna base de datos.

Ecuación que verifica `engkit check`: `source + ajustes − excluidos = target`. `excluded` cita reglas de limpieza (`C-x`); `adjustments`, con signo, reglas `C-x` o transformaciones `T-x`. Un total de control que difiera necesita `difference: C-x` o `T-x` en su declaración. El archivo de resultados solo admite números: nunca filas ni datos personales.

```markdown
---
target: billing.invoices
date: 2026-03-09
owner: Jane Doe
sources: [FACT.FACTURAS]
fields:
  - { from: FACT.FACTURAS.NUM, to: number }
  - { from: FACT.FACTURAS.FLAG, dropped: unused, source: F-05 }
cleaning:
  - { id: C-1, rule: exclude voided invoices without amount, source: F-01 }
transformations:
  - { id: T-1, rule: one invoice per currency (1:N) }
totals:
  - { name: amount_cents }
counts:
  command: "`npm run counts -- invoices`"
  results: counts/invoices.json
---
```

```json
{
  "definition": "<engkit data hash <file>>",
  "taken_at": "2026-03-09",
  "source": 10000,
  "excluded": { "C-1": 120 },
  "adjustments": { "T-1": 35 },
  "target": 9915,
  "totals": { "amount_cents": { "source": 5000000, "target": 5000000 } }
}
```
