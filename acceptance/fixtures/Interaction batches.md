# Interaction batches: editing, handles and range paste

This is a disposable-Vault fixture. Work only on a copy; record full note source
before each action, then Undo/Redo and verify the other tables and prose.

## Same-table first-click editing

| Label | Notes | More |
| --- || :---: | --- |
| Alpha | **bold** *italic* `code` | [Display](https://example.com) |
| Beta | R&amp;D and emoji 😀 | [[Linked note\|alias]] |
| Gamma | First line with enough words to wrap in a narrow pane | Keep unchanged |
| Delta | Another wrapped line | Keep too |

## Another table

| Group | Value | Notes |
| --- || --- | --- |
| North | Old | Preserve |
| South | Destination | Preserve |
| East | Other | Preserve |

> [!note] Callout click transition
> | Category | Details |
> | --- || --- |
> | First | Edit me |
> | Second | Open me |
> | Third | Keep me |

## Merge and paste anchor

| Region | Value | Extra |
| --- || --- | --- |
| Keep | Old merged | < |
| Keep too | ^ | < |
| Last | Blank anchor | Keep untouched |

## Manual event sequences

- Edit Alpha, change the draft and click Beta once; check that the changed
  source commits and the first keystroke immediately goes to Beta. Repeat
  unchanged, cross-table, and Callout transitions. Test rejected math and IME.
- Double-click bold/italic/code/link-label text and check the word selection.
  Normal link clicks should still open the link. Alt-click edits its label.
- Shift-select a grid range and drag across cells. Verify the grid selection
  and text selection never overwrite each other.
- Press and hold a row or column handle once, then drag to reorder. Click
  without moving to select. Extend with Shift-click or a second touch. Test
  merged closure, header boundary refusal, RTL and cancellation.
- Copy a 2x2 region with merged owners and paste at one unmerged destination
  cell while its freshly opened textarea is unchanged; verify right/down
  expansion and unchanged data outside the destination. Modified drafts and
  composition must refuse the range paste without losing draft text.
  Repeat an incompatible partial merged destination; there must be no write.
- Verify Up/Down from first/last actual textarea visual rows of wrapped
  content, including a tall draft with a vertical scrollbar; inside rows,
  IME, text selections and mixed bidi remain native.
  Undo and redo every successful source write and check focus.
- Commit A by clicking B, then leave B unchanged and press Ctrl/Cmd+Z.
  A must undo; Ctrl+Shift+Z or Ctrl+Y redoes it at the correct table and cell.
