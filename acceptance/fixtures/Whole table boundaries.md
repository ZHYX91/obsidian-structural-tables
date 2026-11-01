# Whole table boundaries

<!-- structural-tables-copy-gate-fixture -->

Record the complete source before each operation. For HTML import, copy a real two-column table from the visible Literal clipboard.html browser sample and select only PLACEHOLDER below. Do not select a neighboring line or add a blank line until testing the isolated control. A rejected operation must preserve source, selection and history.

## Adjacent body prose: refuse

PLACEHOLDER
| Later prose | stays visible | IMPORTANT THIRD CELL |

KEEP-AFTER

## Adjacent header prose: refuse

| Before prose | KEEP-BEFORE |
PLACEHOLDER

KEEP-AFTER

## Isolated control: one write and Undo/Redo

PLACEHOLDER

| Later prose | stays visible | IMPORTANT THIRD CELL |

KEEP-AFTER

## Container control: refuse a partial source-line selection

> PLACEHOLDER

- Item

    PLACEHOLDER

## Base restoration

Upgrade this table to a Base through the product preview. Keep its generated records. Immediately after the closing Base fence, add the exact three-cell prose line from the first case with no blank line. Restore through the real preview: it must refuse without changing the Base, prose or records. Add one blank line, restore successfully, then use one host Undo/Redo and verify the complete note and record inventory. Repeat with the two-cell prose line immediately before the opening fence.

| Name | Status |
| --- | --- |
| Alice | Done |

## Copy A

Use Source mode, wait for the note to settle, and place the caret in A. Run the acceptance provider's **Arm one HTML copy renderer gate**, then the product's **Copy current table as HTML**. The nonmodal notice must say **caught/holding A after the real renderer completed** before the next action. **armed only**, caught before the copy command, cancellation, timeout or a failed renderer proves no pending boundary. The gate matches only A's unique first cell in this marked fixture, calls the real renderer and holds its successful result; it never copies or decides the outcome. It expires after two minutes without a match or five minutes after capture. **Disarm HTML copy renderer gate** releases it without a passing observation.

While caught/holding, copy B through the real product command or menu and inspect the clipboard. Run **Release HTML copy renderer gate**: B must remain the latest output, with no late A success notice. For a separate freshly armed A copy, wait for caught/holding, disable Structural Tables through the host UI while keeping the provider enabled, then Release. A must not dispatch or notify; re-enable the product and copy B successfully. A system write already dispatched cannot be retracted.

For each run retain the visible caught/holding signal, operator action order and `_html-copy-gate-observations.json` before another run overwrites old bounded events. The file is diagnostic only. The gate establishes a real product await boundary; it does not claim natural rendering latency. A sequential copy or an armed-only gate is insufficient.

| ST_COPY_GATE_A_ONLY | Value |
| --- | --- |
| **A snapshot** | $\frac{a}{b}$ |
| [External](https://example.com) | A-LAST |

## Copy B

| B | Value |
| --- | --- |
| B-LATEST | KEEP |

During a separate A copy, edit its source without issuing a newer copy. The command still owns its captured A snapshot. Menus continue their existing stale-source checks. No copy action changes this note's Markdown.
