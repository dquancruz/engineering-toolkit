---
id: STRANGLER
date: {{date}}
owner: {{owner_yaml}}
tables: []
---

# Strangler plan

Status as of {{date}}. <!-- engkit:date -->

<!--
One entry per table in `tables`, and one writer per table at any time:
  tables:
    - table: schema.table
      writer: legacy              # legacy | new
      order: 1                    # order of the moves
      handover: { to: new, date: YYYY-MM-DD, owner: name, slice: <slice>, status: planned }
      verify: "`command proving nothing else writes it`"
When a handover is done: `writer: new` and `status: done`, in the same change.
`engkit check` validates the plan; it does not look at the database.
-->

## Notes

TODO: how reads are kept in sync while both systems run.
