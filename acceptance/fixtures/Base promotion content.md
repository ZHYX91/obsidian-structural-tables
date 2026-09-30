# Base promotion content

Use this fixture only in a disposable acceptance Vault with the Bases core plugin enabled.

| Group<br>Key | Text | Code | Escaped | Entity | Math | HTML |
| --- || --- | --- | --- | --- | --- | --- |
| First<br>Second | First<br>Second | `First<br>Second` | \<br> | &lt;br&gt; | $x+\text{<br>}$ | <span title="<br>">value</span> |
| ^ | First<BR/>Second | `First<br/>Second` | \<BR/> | &lt;BR/&gt; | $y+\text{<BR/>}$ | <!-- <br> --> |
| ^ | First<br />Second | `First<br />Second` | \<br /> | &lt;br /&gt; | $z+\text{<br />}$ | <pre><br></pre> |
