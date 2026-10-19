# HTML boundaries and code interchange

The literal HTML examples retain their attributes and pipe text. Only the
tables explicitly labelled editable are owned by Structural Tables.

## Editable in a Callout

> [!note] Boundary control
> | Editable callout | < |
> | --- | --- |
> | Beta | KEEP-Q |

## HTML after a heading
<span id="literal-heading" class="keep" data-case="heading">
| Literal heading | < |
| --- | --- |
| unchanged | KEEP-H |
</span>

## HTML in a new sibling list item

- First item
- <span id="literal-list" class="keep" data-case="list">
  | Literal list | < |
  | --- | --- |
  | unchanged | KEEP-L |
  </span>

## HTML after a reference definition

[Example]: https://example.com
<span id="literal-reference" class="keep" data-case="reference">
| Literal reference | < |
| --- | --- |
| unchanged | KEEP-R |
</span>

## Editable after an indented paragraph continuation

Paragraph
    continuation
<span id="inline-continuation">
| Editable continuation | < |
| --- | --- |
| Alpha | KEEP-C |

## Escaped tag and protected fence

\<span id="escaped">
| Editable escaped tag | < |
| --- | --- |
| Gamma | KEEP-E |

```md
<span id="fenced">
| Literal fence | < |
| --- | --- |
| unchanged | KEEP-F |
</span>
```

## Code export

| Code | Result |
| --- || --- |
| `a|b` | KEEP-0 |
| `a\|b` | KEEP-1 |
| ``a\\|b`` | KEEP-2 |
| ``a\\\|b & <c>`` | KEEP-3 |

## Clipboard destination

Paste the external HTML table below this paragraph. Preserve all earlier text.
