# Protected reference tabs

The destination below contains a literal backslash followed by a Tab. The pipe
lines in the following HTML block remain literal and must not become editable.
The separate REAL table remains editable. Keep the Tab unchanged in Source mode.

[a]:
  a\	b
<span>
| H | < |
| --- | --- |
| a | b |
</span>

| REAL | < |
| --- | --- |
| keep | safe |

## Invalid destination control

The destination below contains a backslash followed by an ordinary space. It is
ordinary prose, so its following pipe table remains eligible for editing.

[b]:
  a\ b
<span>
| CONTROL | < |
| --- | --- |
| visible | safe |
</span>

## Empty list container

-
    ```
  | H | < |
  | --- | --- |
  | literal | safe |
  ```

## Continued quote

> text
lazy
    > ```
> | H | < |
> | --- | --- |
> | literal | safe |
> ```
