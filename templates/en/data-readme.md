# Data plan

One `.md` file per target table (this `README.md` is not checked). Your script takes the counts; engkit does not connect to any database.

Equation verified by `engkit check`: `source + adjustments − excluded = target`. `excluded` cites cleaning rules (`C-x`); `adjustments`, signed, cite `C-x` rules or `T-x` transformations. A control total that differs needs `difference: C-x` or `T-x` in its declaration. The results file only takes numbers: never rows or personal data.

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
