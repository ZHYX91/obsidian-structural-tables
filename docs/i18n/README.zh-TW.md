# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

這份指南介紹最常用的操作與限制；完整的編輯細節見 [English](../../README.md) 或[简体中文](README.zh-CN.md)。

讓 Markdown 表格支援合併儲存格、多層欄標題、列標題，以及沒有欄標題的表格。開啟或閱讀表格不會改寫筆記的 Markdown。

## 畫面預覽

### 閱讀模式：三線表

多層標題與跨列合併會依表格結構顯示，三線表不會為每個儲存格繪製完整框線。

![閱讀模式：具有合併儲存格的三線表](../assets/structural-tables-reading-view-en.png)

### 即時預覽編輯

在桌面版點一下儲存格，或在觸控裝置點兩下，即可直接修改內容。

![即時預覽：編輯表格中的儲存格](../assets/structural-tables-live-preview-en.png)

### 外觀設定

![Structural Tables 外觀設定](../assets/structural-tables-settings-en.png)

<!-- section: features -->
## 功能

- 使用 `<` 與來源順序的前一欄合併，使用 `^` 與上方儲存格合併。
- 在分隔列使用相鄰的 `||` 標示列標題所在的欄；也支援多層欄標題。
- 閱讀模式與即時預覽顯示相同的合併結構。
- 可以移動、插入、刪除列與欄，或將整張表格轉置。
- 複製成 HTML、一般 GFM、TSV 或 CSV；桌面版可將整張表格匯出為 PNG。
- 從瀏覽器或試算表貼上受支援的 HTML 表格。
- 預覽之後可將表格轉為 Obsidian Base，每個資料列建立一篇筆記。
- 有損失未選取內容的風險時會拒絕寫入，除非使用者明確選擇清空或刪除。

<!-- section: requirements-and-compatibility -->
## 需求與相容性

需要 Obsidian 1.12.7 或更新版本。支援桌面版與 Android。轉換為 Base 須啟用 Obsidian 內建的 Bases 外掛。

`<`、`^` 和 `||` 是本外掛的特殊語法，其他 Markdown 編輯器可能無法正確顯示合併結構。與 Advanced Tables 等外掛一起使用時，請先選擇「編輯表格原始碼」，並在外部排序後檢查內容。

<!-- section: installation -->
## 安裝

在 Obsidian「設定 → 社群外掛 → 瀏覽」搜尋 Structural Tables，安裝並啟用。

手動安裝可下載 `structural-tables-<version>.zip`，解壓到 `Vault/.obsidian/plugins/`，重新啟動 Obsidian 後啟用外掛。

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## 使用方式

建立 Markdown 表格後，可使用以下擴充語法。

```markdown
| 地區 | 銷售額 | < |
| 季度 | Q1 | Q2 |
| --- || --- | --- |
| 北部 | 10 | 12 |
| ^ | 8 | 11 |
```

`<` 代表向來源前一欄合併，`^` 代表向上合併；分隔列中的 `||` 標示列標題邊界。它不會新增一欄。

表格顯示不如預期時，可以執行**驗證目前筆記中的結構化表格**。這個指令只報告語法問題，不會改動 Markdown。

即時預覽中點選儲存格可編輯。Enter 儲存並移動，Shift+Enter 插入換行，Escape 取消；在表格控制柄上拖曳可移動列或欄。

選取格線後 Delete/Backspace 只清空文字，保留合併和表頭結構；需要刪除列、欄或整張表格時，使用右鍵選單。明確的操作可透過 Undo 還原。

選取儲存格可複製或剪下範圍。貼上目標必須能保留合併結構；手機重新啟動外掛或更換剪貼簿內容後，原先的合併資訊便無法繼續貼上。

桌面版可以預覽、複製或儲存完整表格 PNG。未儲存的儲存格文字不會包含在圖片內；手機不支援圖片匯出。

將表格轉換為 Base 之前，請先儲存筆記，並把引用或清單中的巢狀表格移到頂層。轉換會展開合併結構；還原原始表格不會刪除已建立的記錄筆記。

資料區若有合併儲存格，必須先拆開才能轉成 Base。轉換後，把游標放在 Base 區塊內，執行**為目前的 Base 建立記錄**，即可新增空白記錄。

### 一般 Markdown 表格

一般 GFM 表格預設使用 Obsidian 原生編輯介面。開啟「接管一般 Markdown 表格」後才能用本外掛的表格控制項；關閉時不會修改原始 Markdown。若某行有超出表頭欄數的隱藏儲存格，請先用「編輯表格原始碼」整理內容，外掛不會猜測要丟棄哪一格。

### 公式與換行

儲存格可使用 Shift+Enter 加入視覺換行，寫回時使用受支援的 `<br>`。公式中的未轉義 `|` 可能與表格分隔符混淆，外掛會保留草稿並拒絕不安全的儲存。可依公式含義改用 TeX 的 `\lvert`、`\rvert` 或 `\mid`。

### 貼上與複製

HTML 貼上只在能安全保留儲存格結構時轉換成 Markdown。遇到無法保留的格式時，可能改用剪貼簿中的完整純文字，或交回 Obsidian 原生貼上；純文字不保證保留合併與格式。將結構表格複製成一般 GFM 後，請在目標編輯器預覽，因為 GFM 無法表示所有跨列與跨欄合併。

### 轉換為一般 GFM

在表格上按右鍵，選擇「轉換為一般 GFM 表格…」；也可以在編輯器中將游標放入表格，再執行轉換為一般 GFM 的命令。

如果表格只有列標題，建議交換列與欄，讓標題成為頂端表頭。若維持原方向且沒有欄標題，會新增空白的頂端表頭，原有資料列全部保留。

合併儲存格會拆開，每個原先被涵蓋的位置都會重複填入合併儲存格的內容。 多列表頭會合成一列，各層標題以「 / 」連接。 仍留在側邊的列標題會變成一般儲存格，GFM 無法保留其標題作用。

可以切換結果預覽與 Markdown 原始碼，再複製目前結果或取代原表格。閱讀檢視只提供複製。取代只修改一次，並可用一次復原還原；關閉視窗不會改動原始碼。請先完成儲存格編輯；若原表格或檔案已改變，請重新開啟預覽。快速複製為一般 GFM 的命令會直接使用建議方向。

### 圖片、Base 與還原

PNG 匯出上限為單邊 8192 像素或 1600 萬像素；如果完整內容無法擷取，會停止而不是產生裁切圖片。Base 轉換會建立資料筆記與 `_promotion.json` 還原清單；「還原表格」只還原轉換前的表格，不會合併後續 Base 編輯，也不會刪除已建立的資料筆記。

<!-- section: settings -->
## 設定

「一般」：語言、HTML 貼上與外掛衝突提醒。「檢視」：閱讀模式、即時預覽、格式問題提示，以及是否接管一般 GFM 表格。「外觀」：表格樣式、寬度、間距和交錯列底色。

可選擇跟隨主題、網格表或三線表。更改外觀不會修改 Markdown。介面語言也不會改變筆記方向。

<!-- section: limitations -->
## 限制

本外掛不是試算表，不會計算公式；也不支援單格獨立樣式、表格標題與編號、儲存格內的區塊級 Markdown，或單一儲存格跨多行的 Markdown 原始碼。

HTML 匯入會轉成純文字與受支援的 `<br>` 換行。一般 GFM 無法表達所有合併結構；轉為 Base 會展平表頭與合併儲存格。

<!-- section: privacy-and-security -->
## 隱私與安全

表格處理在本機進行，不上傳筆記，也不收集分析資料。閱讀表格不會改寫 Markdown。

外部圖片、嵌入內容及字型仍會遵循 Obsidian 與主題自身的網路行為。請勿在公開 issue 張貼私人筆記或路徑。

<!-- section: development -->
## 開發

使用 Node 24.19.0 與 npm 11.17.0。安裝相依套件並執行檢查：

```bash
npm ci
npm run check
```

[Architecture](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/architecture.en.md) · [Contributing](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)

<!-- section: support -->
## 支援

使用方式請到 Q&A，改進建議請到 Ideas。回報問題時請提供 Obsidian 版本、主題、表格 Markdown、預期與實際結果。

[Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a) · [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas) · [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) · [Private security reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)

安全漏洞請透過私人安全回報管道提交，避免公開敏感資訊。

<!-- section: license -->
## 授權

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
