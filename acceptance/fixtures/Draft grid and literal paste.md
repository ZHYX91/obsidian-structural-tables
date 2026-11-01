# Draft grid and literal paste

KEEP-BEFORE

| Name | Value | Extra |
| --- || --- | --- |
| Alpha | Beta | KEEP-CELL |
| Gamma | Delta | KEEP-ROW |
| Last | Last value | KEEP-LAST |

KEEP-BETWEEN

| Name | Value | Extra |
| --- || --- | --- |
| KEEP-MERGED | Merged owner | < |
| Below | Value | KEEP-BELOW |

KEEP-AFTER

Use the first table for unchanged/changed draft crossings, right-click A → B → A,
local history, menu commands and refusal. Use the second for a single merged-owner
target. Preserve all KEEP values except an explicitly selected test operation,
then restore the full-note baseline through actual Undo.

Plain-text sample (tabs and actual newlines stay inside one cell):

```text
甲 | 乙\path	TAB
[[Plan]] `hello` **important** <!--VISIBLE--> &copy; <br>
<
^
```

Protected fragment examples: `` `code` ``, `$x+1$`, `[label](a(b)c)` and
`<span title="a>b">text</span>`. Keep the complete draft when the insertion
context cannot preserve literal meaning.
