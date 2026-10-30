# HTML conversion boundaries

Use this fixture only in a disposable Obsidian Vault. Preserve the source before each separate scenario. Work in Source mode when targeting an HTML block.

## Markdown source → HTML

The table below has two column-header rows, a row-header column and a horizontal header merge. Convert to HTML, check the preview, confirm, then Undo and Redo. Confirm that the surrounding text and subsequent table remain unchanged.

| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| South | 8 | 11 |

## Existing HTML source → Markdown

Place the source cursor inside this table and convert to Markdown. Check that row/column headers and spans survive.

<table>
  <thead>
    <tr><th>Region</th><th colspan="2">Sales</th></tr>
    <tr><th>Quarter</th><th>Q1</th><th>Q2</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">North</th><td>10</td><td>12</td></tr>
    <tr><th scope="row">South</th><td>8</td><td>11</td></tr>
  </tbody>
</table>

## Styling loss requires a separate decision

Converting this HTML must describe the style loss. Declining or closing must make no source change; accepting the separate acknowledgement then confirming makes one Undo step.

<table style="background-color: beige">
  <thead><tr><th>Name</th><th>Value</th></tr></thead>
  <tbody><tr><td>Alpha</td><td style="color: red">1</td></tr></tbody>
</table>

## Unsafe source never converts

This is a literal example inside a code fence. It must never be recognized as a live table:

~~~html
<table><tr><td>literal</td><td>only</td></tr></table>
~~~

An HTML table nested inside another HTML element, an unclosed table, a link or rich HTML element in a cell, and a table adjacent to unseparated pipe prose must refuse rather than drop content. Repeat while a text cell draft is active, after a source edit during preview and after unloading the plugin. Record real desktop and Android observations separately.
