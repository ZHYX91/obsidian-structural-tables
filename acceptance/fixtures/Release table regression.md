# Release table regression

## Short GFM row

KEEP BEFORE

| Name | Value |
| --- | --- |
| Alice | One |
Bob
| Carol | Three |

^short-row-audit

KEEP AFTER

## Similar tables in one callout

> [!note]
> | Label | Reference | Inline link |
> | --- || --- | --- |
> | A B | [Guide][audit-guide] | [Guide](https://example.org/first) |
>
> | Label | Reference | Inline link |
> | --- || --- | --- |
> | AB | [Guide][audit-guide] | [Guide](https://example.org/first) |

[audit-guide]: https://example.org/first

## Headerless interchange

| --- || --- |
| Literal | `A\|[x](y)` |
| Destination | [Guide](<https://example.org/a\|b>) |
| Imported text | AT&amp;T |
