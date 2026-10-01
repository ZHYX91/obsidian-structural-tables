# GFM write safety

Enable Take over ordinary Markdown tables before editing these tables.

## Short row

| A | B |
| - | -- |
| First |

## Hidden source content

| A | B |
| - | -- |
| First | | KEEP |
| | |

Inspect source after each refused write. KEEP must remain in the exact original row.
