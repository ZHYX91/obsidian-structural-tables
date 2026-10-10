# Whole-table HTML copy

Copy each complete table using the command palette and the Word / HTML menu entry.
In a rich destination, inspect the spans and the header relationships separately.
On a text-only clipboard, check the flattened TSV and the plain-text notice.
Copy the first table twice into one document to check independent header IDs.

## Three header levels and crossing row-header spans

The 10 cell spans Q1's A/B columns and the Basic/Premium rows. Premium crosses
the North/South boundary. Region and Item label the row-header columns; they
are not global headings for every data cell.

| Region | Item | Year | < | < | < |
| ^ | ^ | Q1 | < | Q2 | < |
| ^ | ^ | A | B | A | B |
| --- | --- || --- | --- | --- | --- |
| North | Basic | 10 | < | 12 | 13 |
| ^ | Premium | ^ | ^ | 22 | < |
| South | ^ | 30 | 31 | 32 | 33 |
| ^ | Other | 40 | 41 | 42 | 43 |

## Headerless with two row-header columns

There is no column-header row. Blank data cells and 中文😊 remain present.

| --- | --- || --- | --- |
| North | A | 中文😊 |  |
| ^ | B | 3 | < |
| South | ^ | 5 | 6 |
