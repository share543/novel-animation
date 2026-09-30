# AGENTS.md

給在此 repo 工作的 AI agent 的指引。

## 專案定位

單檔離線 HTML 工具，把小說轉成 AI 動畫（Motion Comic）的製作文件。無建置流程、無依賴、無後端。

## 硬性約束（不可違反）

`storyboard.html` 必須永遠滿足：

1. **單一檔案** — HTML + CSS + JS 全部內嵌，檔名固定 `storyboard.html`
2. **零外部資源** — 不得有 `<script src>`、`<link>`、`@import`、CDN、遠端字型、遠端圖片
3. **零網路請求** — 不得有 `fetch`、`XMLHttpRequest`、`WebSocket`、`importScripts`
4. **零框架** — 不得引入 React／Vue／jQuery，只用原生 Web API
5. **`file://` 可用** — 雙擊即開，不得依賴伺服器、建置步驟或安裝程序

**這五條是使用者明確要求，不是建議。** 任何改動若破壞其中一項，即為無效改動。

## 改動前的必要動作

```bash
# 依賴稽核（應全為 0）
grep -c 'https\?://'     storyboard.html
grep -c '<link'          storyboard.html
grep -c '@import'        storyboard.html
grep -c 'fetch('         storyboard.html
grep -c 'XMLHttpRequest' storyboard.html
grep -c 'type="module"'  storyboard.html
grep -c '<script'        storyboard.html   # 應為 1

# CSS url() 專用（排除 URL.createObjectURL 的誤報）
grep -oP '(?<![A-Za-z])url\(' storyboard.html | wc -l   # 應為 0
```

> `grep -i 'url('` 會把 `URL.createObjectURL` 誤判成 CSS `url()`。用上面的 lookbehind 排除。

## 改動後的驗證

**必須用瀏覽器開 `file://` 實測，不能只測 http://。**

用 `browser_console` 注入測試資料直接呼叫函式：

```js
// 注意：loadDemo / newProject / delShot 等會呼叫 confirm()，
// 在無頭環境會阻塞。測試前必須 stub：
window.alert = () => true;
window.confirm = () => true;
```

驗證清單：

- [ ] `buildPrompt(shot)` 回傳 4 段（角色／場景／鏡頭／畫風）
- [ ] `refHint(shot)` 依景別回傳正確強度（遠景 0.30 / 中景 0.85 / 特寫 0.90）
- [ ] 時間碼 `timecode(i)` 累加正確
- [ ] 儲存 → 載入往返資料完整
- [ ] 四種匯出檔名正確（`shot-list.csv`／`prompts.txt`／`project.md`／`novel-project.json`）
- [ ] 統計數字與表格列數一致
- [ ] 匯入小說後：`S.shots[i].charId`／`sceneId` 必須真的指向存在的 `S.chars[].id`／`S.scenes[].id`
- [ ] PDF 匯入：`pdfToText()` 對真實中文 PDF 必須 `unmapped === 0`（有亂碼就是 CMap 沒逐字型套對）
- [ ] PDF 匯入：掃描版要回 `status === 'scanned'`，**不可**回一堆亂碼當成功
- [ ] 匯入小說後：`buildPrompt()` 仍能組出四段（角色／場景／鏡頭／畫風）
- [ ] 壞 JSON 匯入失敗時 `S` 不可被改動（形狀驗證必須在指派之前）

**測試注入的 `charId` / `sceneId` 必須與 `S.chars`／`S.scenes` 的實際 `id` 一致**，
否則會誤報「prompt 段數不足」或「未鎖臉」。測試失敗先懷疑測試資料，不是程式。

## 資料結構（改動時勿破壞）

```js
S = {
  meta:   { title, unit, model, ratio, wpm },
  style:  String,     // 畫風基底（第④段）
  styleEn:String,
  neg:    String,     // 反向提示詞
  chars:  [{ id, name, role, desc, ref, face, body }],
  scenes: [{ id, name, type, desc, ref, body }],
  shots:  [{ id, narr, size, move, dur, charId, sceneId, lens, st, file }]
}
```

關鍵函式：

| 函式 | 職責 |
|---|---|
| `buildPrompt(shot)` | 四段式組裝，核心邏輯 |
| `refHint(shot)` | 依 `SIZES[shot.size]` 推算參考強度 |
| `SIZES` | 景別 → { 模板文字, 臉部強度, 主體強度 } |
| `timecode(i)` | 累加前 i 個鏡頭的時長 |
| `storageOK` / `put()` / `get()` | localStorage 安全包裝 |
| `decodeText(buf)` | 位元組 → 文字，自動判別 UTF-8／Big5／GBK／UTF-16 |
| `docxToXml(buf)` | 純原生解 `.docx` ZIP（`DecompressionStream`），取 `word/document.xml` |
| `pdfToText(buf)` | 純原生抽 PDF 文字：物件索引 → 頁面樹 → 逐字型 CMap → 依座標重排；回 `{status, text, pages, fonts, cmaps, unmapped}` |
| `parseCMap(text)` | 解 `ToUnicode`（`bfchar`＋`bfrange` 含陣列型；碼長依 `codespacerange` 判 1／2 位元組） |
| `normalizeNovel(t)` / `joinWrapped(t)` | 正規化：**硬換行要先接回句子**，否則斷句全錯 |
| `analyzeNovel(t, opt)` | 抽取人物／場景／鏡頭，回傳 `{persons, places, shots, stats}` |
| `applyNovel()` | 把分析結果寫進 `S`（覆蓋前必須 `confirm`） |

## 離線相容性

**不可移除**這兩個防護：

1. `storageOK` 偵測 + 記憶體退回 —— Safari 在 `file://` 下封鎖 localStorage
2. `navigator.clipboard` 失敗時退回 `document.execCommand('copy')`

## 匯入功能的實作約束

匯入必須維持「單檔零依賴」，改動時注意：

1. **`.docx` 只能用原生 `DecompressionStream('deflate-raw')` 解** —— 不得引入 JSZip 等函式庫。
2. **`.pdf` 只能用原生 API** —— 不得引入 pdf.js。`stream` 長度一律看 `/Length`；靠 `endstream` 反推再刪結尾換行會把壓縮資料剃壞（實測整個檔抽不到字）。
3. **CMap 必須逐字型套** —— 每個字型子集各用同一段碼域指向不同字，合併成一張表就是亂碼。
4. **文字段位置只用 `tm`（＋ Form 的 `/Matrix`），刻意不套 CTM** —— 設計工具匯出常用 `cm` 做 y 翻轉，套上去會讓 y 排序上下顛倒（實測某表格檔 82% → 35%）。
5. **不得改成把檔案送到遠端解析** —— 那會同時違反「零網路請求」與使用者隱私期待。
6. **停用詞表要用「詞」的陣列，不可寫成大字串再 `split('')`** —— 那會把「高聲」拆成「高」「聲」，多字詞永遠比對不到，人名抽取會冒出大量誤判。
7. **名字抽取要有邊界檢查**，並擋掉以介詞／助詞開頭的候選，否則「向狄公道」會被抓成「向狄公」。
8. **找不到對應角色時要留空，不要沿用上一個鏡頭** —— 猜錯會鎖錯臉，留白讓使用者自己指定才安全。
9. **`normalizeNovel` 必須先做 `joinWrapped`** —— 中文 txt 常在 30 字斷行，不接回去斷句會全錯。
10. **職稱型角色（警員／管理員／郵差／警官等）是刻意保留的設計，不是雜訊** ——
    它們會被寫進 `S.shots[].charId`，讓「無法具名的重複配角」跨鏡維持同一張臉。
    實測《鬼針》：分別被分到 7／5／5／4／3 鏡，收掉會讓 24 個鏡頭失去角色鎖定。
    要收掉之前先量，別憑出現次數判斷 —— 量測方式：載入 `storyboard.html` →
    `analyzeNovel()` → 設 `novelRes` 後 `applyNovel()` → 統計 `S.shots` 的 `charId` 分佈。
    只有「全被姓名包住」的職稱才不另立角色，且**雙向都要判**：
    名字在前（「高老先生」的「先生」）與職稱在前（「警員小張」的「警員」）。

## 文件同步

`docs/*.md` 是 `storyboard.html` 內建結構的紙本版。改動資料結構時，
必須同步更新 `docs/01`–`docs/06` 與 `examples/demo-project.json`。

`examples/demo-project.json` 的 `style` / `neg` 必須與 `storyboard.html` 中的
`DEF_STYLE` / `DEF_NEG` 完全一致。

## Git 慣例

commit 訊息用 `type(scope): 描述`。常見 type：

- `feat(ui)` / `feat(export)` — 新功能
- `fix(...)` — 修錯
- `docs` — 只改文件
- `chore` — 雜項

## 禁止事項

- 不要加入帳號、登入、雲端同步
- 不要加入生成 API 呼叫（會違反「完全離線」）
- 不要為了「功能更強」而引入框架或 CDN
- 不要生成假資料充當測試結果
- 不要宣稱未經 `file://` 實測的相容性
