# Clipboard fidelity and migration

<!-- structural-tables-clipboard-fidelity -->

Use the acceptance provider's clipboard sample commands to prepare input only.
Paste through the product's cell editor, commit, leave/reopen the note and inspect
the recorded source and rendered code points. Undo/redo must preserve the complete note.

## Cell paste destination

| Value | Guard |
| --- || --- |
| Replace this | KEEP-CELL |
| Leave this | KEEP-ROW |

## Normal Sheets Extended migration

| Person | - | Q1 |
| --- | --- | --- |
| Alice | - | 1 |

## Migration boundary refusal

| KEEP-BEFORE | Unrelated pipe row |
| Person | - | Q1 |
| --- | --- | --- |
| Alice | - | 1 |

KEEP-AFTER remains ordinary prose.

## Whole-table paste destination

Paste the external HTML table below this paragraph. Earlier sections must remain exact.
