# 小說動畫工作台

把自寫小說轉成 AI 動畫影片的工作流工具。**單檔、零依賴、完全離線** —— 雙擊 `report.html` 就能用。

核心是一件事：**讓 AI 生成的畫面跨鏡頭保持一致**。

## 線上使用

GitHub Pages：<https://share543.github.io/novel-animation/report.html>

## 為什麼需要這個工具

用 AI 把小說做成影片，最常崩壞的不是畫質，是**一致性**。

你寫「林佑安穿米白色風衣、左手戴黃銅戒指」，第一次生成很完美。第二個鏡頭 AI 可能給他紅外套、多一根手指、換一張臉。等到 50 個鏡頭生成完，你有 50 個不同的主角。

根因是：**每次重打 prompt，描述就會漂移。**

解法是把 prompt 切成「固定段」與「變動段」：

```
完整 prompt ＝ ① 主體描述 ＋ ② 環境描述 ＋ ③ 鏡頭描述 ＋ ④ 畫風基底
                 ↑從設定檔複製  ↑從設定檔複製  ↑ 每格不同   ↑從設定檔複製
                   永不手改        永不手改                   永不手改
```

**固定段只在設定檔寫一次，全案 prompt 自動沿用。** 這份工具就是做這件事的自動化 —— 你填鏡頭表，prompt 自動組好，你不需要再手動拼字串。

搭配**參考圖鎖定**（見下方即夢設定），角色臉就不會跳。

## 特色

- **單一檔案**：HTML + CSS + JS 全部內嵌在 `report.html`，無任何外部資源。
- **完全離線**：不使用 CDN、不引入任何 JS 框架，全部原生 Web API。
- **本機開啟即用**：直接雙擊 `report.html`（`file://`）即可，不需安裝或架設伺服器。
- **零依賴**：37KB 純文字，`<script>` 與 `<style>` 各一個，沒有 `fetch`／`XMLHttpRequest`。
- **四段式 prompt 自動組裝**：改設定檔一次，全部鏡頭同步更新。
- **參考強度自動推算**：依景別自動建議臉部／主體參考強度，不用查表。
- **鏡頭表表格內直接編輯**：不用逐筆開表單，每列即時預覽組裝後的 prompt。
- **旁白字數換算**：依語速自動估算總時長、建議切成幾個單元、每格建議秒數。
- **四種匯出**：TXT（貼進生成工具）、CSV（批次管理）、Markdown（存檔）、JSON（備份／交換）。
- **自動記憶**：資料存瀏覽器 `localStorage`，關掉視窗不會不見。
- **內建範例**：點「載入範例」立刻看到完整運作（2 角色、2 場景、8 鏡頭）。

## 使用方式

1. 下載 `report.html`，用瀏覽器開啟（或直接用 Pages 線上版）。
2. 點「**載入範例**」先看一遍流程。
3. 切到「**① 人物**」新增角色，寫**固定描述字串**（50–80 字：性別年齡＋髮型＋臉部特徵＋固定服裝＋一個辨識記憶點）。用這串描述去生成參考圖，挑一張滿意的放大下載。
4. 切到「**② 場景**」新增場景（偵探小說通常只有 3–6 個），同樣生成參考圖。
5. 切到「**③ 鏡頭表**」逐列填旁白、選景別運鏡、填第③段鏡頭描述 → prompt 自動組裝，參考強度自動算出。
6. 切到「**⑤ 輸出**」複製全部 prompt 或匯出 TXT，貼到即夢批次生成。
7. 生成後回「③ 鏡頭表」把狀態改成 ✅，重跑失敗的鏡頭。
8. 匯出 CSV 當作剪輯清單，照時間碼排素材。

## 產量換算

中文旁白，推理節奏約 **260 字/分鐘**（要留白讓讀者推想；新聞口播才用 300+）。

| 小說字數 | 旁白長度 | 切成幾個單元 |
|---|---|---|
| 5,000 字 | 約 19 分 | 2 個單元 |
| 8,000 字 | 約 31 分 | 3 個單元 |
| 10,000 字 | 約 38 分 | 3–4 個單元 |

10 分鐘單元約需 **35–50 個鏡頭**。工具會即時顯示這些數字。

## 文件體系

工具的六個分頁對應六份文件，完整模板與說明在 [`docs/`](docs/)：

| 文件 | 工具分頁 | 用途 |
|---|---|---|
| [人物設定檔](docs/01-character-sheet.md) | ① 人物 | 角色參考圖、參考強度、固定描述字串 |
| [場景設定檔](docs/02-scene-sheet.md) | ② 場景 | 場景參考圖、固定描述字串 |
| [旁白稿](docs/03-narration-script.md) | — | 改編劇本、留白標記、字幕卡 |
| [鏡頭表](docs/04-shot-list.md) | ③ 鏡頭表 | **核心** — 景別、運鏡、時長、prompt |
| [提示詞庫](docs/05-prompt-library.md) | ④ 畫風 | 畫風基底、景別模板、負面提示詞 |
| [素材索引](docs/06-asset-registry.md) | ⑤ 輸出 | 檔案路徑、版本、QC 狀態 |

另有：
- [完整工作流程](docs/workflow.md) — 從小說到成片的九個步驟
- [即夢實務要點](docs/jimeng-notes.md) — 工具限制、免費積分策略、補救順序

## 技術說明

### 為什麼是 Motion Comic

| 路線 | 成本 | 一致性難度 | 建議 |
|---|---|---|---|
| 寫實 2D／3D 全動畫 | 極高（逐幀修） | 極難 | ✗ |
| 圖生影片（圖轉動態） | 中高（每段重抽、耗額度） | 難 | ✗ 第一部不做 |
| **Motion Comic** | **低（生成一次，剪輯加運鏡）** | **可控** | ✓ |

推理小說的視覺重點是**表情、氛圍、線索特寫**，角色不需要真的動。靜態插畫＋緩慢推拉運鏡＋旁白＋字幕，觀感最好且最省額度。

### 資料結構

```js
S = {
  meta:     { title, unit, model, ratio, wpm },
  style:    "畫風基底（第④段）",
  styleEn:  "英文備用",
  neg:      "反向提示詞",
  chars:    [{ id, name, role, desc, ref, face, body }],
  scenes:   [{ id, name, type, desc, ref, body }],
  shots:    [{ id, narr, size, move, dur, charId, sceneId, lens, st, file }]
}
```

`shots[].charId` / `sceneId` 參照前列的 `id`。組裝邏輯：

```js
buildPrompt(shot) = [ char.desc, scene.desc, shot.lens, S.style ]
                      .filter(Boolean).join('\n\n')
```

### 參考強度對照表

依景別自動建議（內建於 `SIZES` 物件）：

| 景別 | 臉部 | 主體 | 理由 |
|---|---|---|---|
| 大遠景、遠景 | 0.30 | 0.70 | 不看臉，鎖環境結構 |
| 中景 | 0.85 | 0.50 | 平衡（最常用） |
| 近景、特寫、大特寫 | 0.90 | 0.35 | 鎖臉優先 |
| 物件 | — | 0.70 | 物證需跨鏡頭一致 |

### 離線相容性處理

要求「雙擊即開、完全離線」時，有兩個真實的坑：

1. **Safari 在 `file://` 下封鎖 `localStorage`**（Chrome／Firefox 不會）
   → 啟動時偵測，失敗則退回記憶體，並在畫面底部顯示紅色警示，提示改用「備份」下載 JSON。
2. **`navigator.clipboard` 在非安全上下文不可用**
   → 加 `document.execCommand('copy')` 後援。

```js
let MEM=null, storageOK=true;
try{ localStorage.setItem('__p','1'); localStorage.removeItem('__p'); }
catch(e){ storageOK=false; }
const put = k => { try{ localStorage.setItem(k, JSON.stringify(S)); }
                    catch(e){ MEM=JSON.stringify(S); } };
const get = k => { try{ return localStorage.getItem(k) || MEM; }
                    catch(e){ return MEM; } };
```

### 離線要求的稽核方式

```bash
# 應全部為 0
grep -c 'https\?://'          report.html
grep -c '<link'               report.html
grep -c '@import'             report.html
grep -c 'fetch('              report.html
grep -c 'XMLHttpRequest'      report.html
grep -c 'type="module"'       report.html
```

注意：`grep -i 'url('` 會把 `URL.createObjectURL` 誤判成 CSS `url()`，需用
`grep -o '(?<![A-Za-z])url('` 排除。

## 適用範圍

**適合**：短篇／連載小說改編、偵探推理有聲漫畫、需要跨鏡頭一致性的批次生圖、
任何「設定檔 ＋ 變動表格」結構的 prompt 管理。

**不適合**：單次生成一張圖（直接寫 prompt 即可）、需要後端或多人協作的系統。
本工具刻意不做帳號、不做雲端同步、不做生成 API 呼叫 —— 這些都與「完全離線」衝突。

## 授權

MIT — 見 [LICENSE](LICENSE)。

---

## 相關專案

- [crm-report](https://github.com/share543/crm-report) — 同樣的單檔離線工具思路，CRM 報表
- [htmldata](https://github.com/share543/htmldata) — 單檔離線資料登錄／合併工具
