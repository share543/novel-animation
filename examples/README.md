# 範例

## demo-project.json

一份完整的示範專案：2 個角色、2 個場景、8 個鏡頭（推理短篇〈雨夜來客〉單元一開場）。

### 怎麼用

**方式一：工具內建（最快）**
開啟 `storyboard.html`，點右上角「**載入範例**」。

**方式二：匯入這個檔案**
1. 開啟 `storyboard.html`
2. 點右上角「**匯入**」
3. 選擇 `demo-project.json`

兩者的內容相同。載入後可以：

- 切到「**③ 鏡頭表**」看四段式 prompt 如何自動組裝
- 觀察參考強度如何依景別自動變化（遠景 0.30 / 中景 0.85 / 特寫 0.90）
- 切到「**⑤ 輸出**」試試四種匯出格式

### 檔案結構

```json
{
  "meta":   { "title", "unit", "model", "ratio", "wpm" },
  "style":  "畫風基底（第④段）",
  "styleEn":"英文備用",
  "neg":    "反向提示詞",
  "chars":  [{ "id","name","role","desc","ref","face","body" }],
  "scenes": [{ "id","name","type","desc","ref","body" }],
  "shots":  [{ "id","narr","size","move","dur","charId","sceneId","lens","st","file" }]
}
```

`shots[].charId` / `sceneId` 指向 `chars[].id` / `scenes[].id`。

### 建議的起步方式

不要照抄這個範例的內容，而是：

1. 載入範例，理解結構
2. 點「**新專案**」清空
3. 用你自己小說的第一個場景，照著填

**先做 5 個鏡頭就好**，生成出來看效果，確認一致性可以控制再往下鋪量。
