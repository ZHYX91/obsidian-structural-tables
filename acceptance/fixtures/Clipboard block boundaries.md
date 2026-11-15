# Clipboard block boundaries

Copy this complete table as Word / HTML. Unsupported block content must retain
its exact source as literal cell text in both HTML and plain-text clipboard data.
The inline control retains bold text and the real break. Copy makes no note edit.

| Content | Value |
| --- || --- |
| <div>FIRST</div><div>SECOND</div> | KEEP |
| <ul><li>FIRST</li><li>SECOND</li></ul> | KEEP |
| **FIRST** <span>SECOND</span><br>THIRD | KEEP |

## Range-carrier paste destination

Use the browser samples in Clipboard range markers.html, or run the provider's
Prepare range marker clipboard samples command for explicitly synthetic system
clipboard input. Record which source supplied the input; provider setup does not
qualify external-browser copying. Paste into Alpha using native Paste and the
active-cell menu. Inspect draft text before committing, then compare the complete
note after Commit, Undo and Redo.

| H | V |
| --- || --- |
| A | Alpha |
| B | KEEP |
