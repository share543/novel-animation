/* 用實際出貨的 storyboard.html 產出完整分鏡表（Markdown + TSV）。
   用法：node tools/make-storyboard.js <小說.txt> <輸出目錄> [每鏡秒數] [場景上限]
   產出內容與介面「套用到專案」後按「匯出」完全相同：
   buildPrompt = ①角色描述 + ②場景描述 + ③鏡頭描述 + ④畫風基底 */
const fs = require('fs'), vm = require('vm'), path = require('path');

const noop = () => {};
const fakeEl = () => ({ style: {}, classList: { add: noop, remove: noop, contains: () => false }, addEventListener: noop, appendChild: noop, value: '', textContent: '', innerHTML: '' });
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: fakeEl, addEventListener: noop, body: fakeEl() };
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
globalThis.navigator = { clipboard: null };
const script = fs.readFileSync(path.join(__dirname, '..', 'storyboard.html'), 'utf8').match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
try { vm.runInThisContext(script); } catch (e) { /* 啟動段需要 DOM；函式已提升 */ }

const file = process.argv[2];
const outDir = process.argv[3] || path.dirname(file);
const sec = +(process.argv[4] || 4);
const maxScenes = +(process.argv[5] || 8);
const raw = normalizeNovel(fs.readFileSync(file, 'utf8'));
const r = analyzeNovel(raw, { secPerShot: sec, maxChars: 8, maxScenes: maxScenes, wpm: 260 });
r.styleName = guessStyle(raw, '');
const title = path.basename(file).replace(/\.txt$/, '');

/* 與 applyNovel() 相同的對應關係（headless：不碰 DOM、不覆寫既有分段） */
S.chars = r.persons.map((p, i) => ({ id: 'c' + i, name: p.name, role: p.role || '', desc: p.descDraft || '', ref: '', face: .85, body: .5 }));
S.scenes = r.places.map((p, i) => ({ id: 's' + i, name: p.name, type: p.type, desc: p.descDraft || '', ref: '', body: .65 }));
S.style = STYLE_PRESETS[r.styleName] || DEF_STYLE;
const cid = {}, sid = {};
S.chars.forEach(c => { cid[c.name] = c.id; });
S.scenes.forEach(s => { sid[s.name] = s.id; });
S.shots = r.shots.map((x, i) => ({
  id: 'S' + String(i + 1).padStart(3, '0'), narr: x.narr, size: x.size, move: x.move, dur: x.dur,
  charId: cid[x._who] || '', sceneId: sid[x._scene] || '', lens: x.lens, st: '🔄'
}));

const han = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
const totalDur = S.shots.reduce((a, s) => a + num(s.dur, 3), 0);
const mm = Math.floor(totalDur / 60) + ':' + String(Math.round(totalDur % 60)).padStart(2, '0');
const tc = i => { let t = 0; for (let k = 0; k < i; k++) t += num(S.shots[k].dur, 3); return Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0'); };

/* ── Markdown ── */
let md = `# ${title} — 分鏡表\n\n`;
md += `| 項目 | 值 |\n|---|---|\n`;
md += `| 小說字數 | ${han} 漢字 |\n| 鏡頭數 | ${S.shots.length} |\n| 預估總長 | ${mm} |\n`;
md += `| 單元數 | ${r.stats.units}（10–15 分鐘一單元，切點落在換場） |\n| 節奏 | 260 字／分，每鏡上限 ${sec} 秒 |\n`;
md += `| 年代／季節 | ${detectEra(raw)}／${r.places[0] ? (r.places[0].descDraft || '').split('；').pop() : ''} |\n\n`;

md += `## ① 人物（${S.chars.length}）— 鎖臉用，整部片要一致\n\n`;
md += `| 角色 | 出現次數 | 身份 | 描述字串 | 臉部參考 |\n|---|---|---|---|---|\n`;
r.persons.forEach((p, i) => { md += `| ${p.name} | ${p.count} | ${p.role || '—'} | ${p.descDraft || ''} | ${(SIZES['近景'] || { f: .85 }).f.toFixed(2)} |\n`; });

md += `\n## ② 場景（${S.scenes.length}）— 鎖場景用\n\n`;
md += `| 場景 | 類型 | 出現次數 | 描述字串 |\n|---|---|---|---|\n`;
r.places.forEach(p => { md += `| ${p.name} | ${p.type} | ${p.count} | ${p.descDraft || ''} |\n`; });

md += `\n## ④ 畫風基底\n\n${S.style}\n\n`;
/* 單元切分（與 analyzeNovel 的 stats 同一個來源） */
const plans = r.stats.unitPlans || [];
const unitOf = [];
plans.forEach((u, ui) => { for (let k = u.from; k <= u.to; k++) unitOf[k] = ui + 1; });

md += `\n## ③ 分鏡表（${S.shots.length} 鏡／${plans.length} 個單元）\n\n`;
if (plans.length) {
  md += `### 單元切分（切點落在換場，不在場景中間斷）\n\n`;
  md += `| 單元 | 時間碼 | 時長 | 分鐘 | 鏡數 | 字數 | 起始場景 | 結束場景 | 切點 |\n|---|---|---|---|---|---|---|---|---|\n`;
  plans.forEach((u, ui) => {
    const a = S.shots[u.from], b = S.shots[u.to];
    const ca = charById(a.charId), cb = charById(b.charId);
    const sa = sceneById(a.sceneId), sb = sceneById(b.sceneId);
    const chars = S.shots.slice(u.from, u.to + 1).reduce((x, s) => x + (s.narr || '').replace(/\s/g, '').length, 0);
    const m = Math.floor(u.dur / 60), sec2 = String(Math.round(u.dur % 60)).padStart(2, '0');
    md += `| U${ui + 1} | ${tc(u.from)}–${tc(u.to + 1)} | ${u.dur}s | ${m}:${sec2} | ${u.to - u.from + 1} | ${chars} | ` +
      `${sa ? sa.name : '—'}${ca ? '（' + ca.name + '）' : ''} | ${sb ? sb.name : '—'}${cb ? '（' + cb.name + '）' : ''} | ${u.hard ? '⚠️ 無換場可用，硬切' : '換場'}` +
      `${(!u.hard && u.dur < 600) ? ' ⚠️ 短於 10 分鐘（收尾段，可與前後單元合併）' : ''} |\n`;
  });
  const short = plans.filter(u => u.dur < 600 && plans.length === 1);
  if (short.length) {
    md += `\n> ⚠️ 全篇 ${Math.round(plans[0].dur / 60)} 分鐘，不足一個 10–15 分鐘單元。` +
      `旁白 260 字／分推算，一個單元約 2,600–3,900 字 —— 可以和同系列其他短篇併成一集。\n`;
  }
  md += `\n`;
}

md += `| 單元 | # | 時間碼 | 景別 | 運鏡 | 秒 | 角色 | 場景 | 字幕（旁白） | 鏡頭描述 |\n|---|---|---|---|---|---|---|---|---|---|\n`;
S.shots.forEach((s, i) => {
  const c = charById(s.charId), sc = sceneById(s.sceneId);
  const narr = (s.narr || '').replace(/\|/g, '｜').replace(/\n/g, ' ');
  md += `| U${unitOf[i] || 1} | ${s.id} | ${tc(i)} | ${s.size} | ${s.move} | ${s.dur} | ${c ? c.name : '—'} | ${sc ? sc.name : '—'} | ${narr} | ${s.lens} |\n`;
});

md += `\n## 完整 prompt（每鏡可直接貼進即夢）\n\n`;
S.shots.forEach((s, i) => {
  md += `### ${s.id}（${s.size}／${s.move}／${s.dur}s，${refHint(s)}）\n\n\`\`\`\n${buildPrompt(s)}\n\`\`\`\n\n`;
});
md += `---\n\n反向提示詞：\n\n\`\`\`\n${S.neg}\n\`\`\`\n`;

/* ── TSV（給剪輯／表格用）── */
const head = ['shot_id', '時間碼', '旁白', '景別', '運鏡', '時長秒', '角色', '場景', '鏡頭描述', '參考設定', '完整prompt', '狀態', '檔案'];
let tsv = head.join('\t') + '\n';
S.shots.forEach((s, i) => {
  const c = charById(s.charId), sc = sceneById(s.sceneId);
  const row = [s.id, tc(i), s.narr, s.size, s.move, s.dur, c ? c.name : '', sc ? sc.name : '',
    s.lens, refHint(s), buildPrompt(s).replace(/\n+/g, ' '), s.st, ''];
  tsv += row.map(v => String(v).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t') + '\n';
});

fs.mkdirSync(outDir, { recursive: true });
const mdPath = path.join(outDir, title + '_分鏡表.md');
const tsvPath = path.join(outDir, title + '_分鏡表.tsv');
fs.writeFileSync(mdPath, md);
fs.writeFileSync(tsvPath, tsv);
console.log(`${title}：${han} 漢字 → ${S.shots.length} 鏡／${mm}／${S.chars.length} 角色／${S.scenes.length} 場景`);
console.log('  ' + mdPath);
console.log('  ' + tsvPath);
