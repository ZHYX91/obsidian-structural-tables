# Legacy Base

```base
# structural-tables-promotion: stb_acceptance_legacy
# structural-tables-manifest: "_structural-table-records/stb_acceptance_legacy/_promotion.json"
filters:
  and:
    - 'list(note.structural_table_ids).contains("stb_acceptance_legacy")'
properties:
  name:
    displayName: "Name"
views:
  - type: table
    name: Table
    order:
      - note.name
```
