/* 用實際出貨的 storyboard.html 產出完整分鏡表（Markdown + TSV）。
   用法：node tools/make-storyboard.js <小說.txt> <輸出目錄> [每鏡秒數] [場景上限]
   產出：整篇一份，外加每個單元各一份（逐集交付）。
   內容與介面「套用到專案」後按「匯出」完全相同：
   buildPrompt = ①角色描述 + ②場景描述 + ③鏡頭描述 + ④畫風基底
   逐集檔案的時間碼從該集的 0:00 起算（剪輯要看的是每一集自己的長度）。 */
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

const plans = r.stats.unitPlans || [];
const unitOf = [];
plans.forEach((u, ui) => { for (let k = u.from; k <= u.to; k++) unitOf[k] = ui + 1; });
const hanAll = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
const totalDur = S.shots.reduce((a, s) => a + num(s.dur, 3), 0);
const mmss = t => Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0');

/* 相對時間碼：從這一份文件的第 0 鏡起算（逐集檔案要看每一集自己的長度） */
function tcWithin(idxs, k) {
  let t = 0;
  for (let j = 0; j < k; j++) t += num(S.shots[idxs[j]].dur, 3);
  return mmss(t);
}

function storyboardMd(idxs, label, note) {
  const dur = idxs.reduce((a, i) => a + num(S.shots[i].dur, 3), 0);
  const chars = idxs.reduce((a, i) => a + (S.shots[i].narr || '').replace(/\s/g, '').length, 0);
  /* 只列出這一集真的會用到的角色與場景（整部片的人物表對單集導演沒用） */
  const usedC = [], usedS = [];
  idxs.forEach(i => {
    const s = S.shots[i];
    const c = charById(s.charId), sc = sceneById(s.sceneId);
    if (c && usedC.indexOf(c) < 0) usedC.push(c);
    if (sc && usedS.indexOf(sc) < 0) usedS.push(sc);
  });
  const seasons = idxs.map(i => (sceneById(S.shots[i].sceneId) || {}).desc || '').map(d => d.split('；').pop().trim());
  const season = seasons.filter(Boolean).sort((a, b) => seasons.filter(x => x === b).length - seasons.filter(x => x === a).length)[0] || '';

  let md = `# ${title}${label ? ' — ' + label : ''} 分鏡表\n\n`;
  md += `| 項目 | 值 |\n|---|---|\n`;
  md += `| 鏡頭數 | ${idxs.length} |\n| 預估長度 | ${mmss(dur)} |\n| 字數 | ${chars} |\n`;
  md += `| 節奏 | 260 字／分，每鏡上限 ${sec} 秒 |\n| 建議畫風 | ${r.styleName} |\n`;
  md += `| 年代／季節 | ${detectEra(raw)}／${season} |\n`;
  if (!label) md += `| 單元數 | ${plans.length}（10–15 分鐘一單元，切點落在換場） |\n`;
  md += `\n${note || ''}\n`;

  md += `\n## ① 人物（本集出現 ${usedC.length}／全篇 ${S.chars.length}）— 鎖臉用\n\n`;
  md += `| 角色 | 出現次數 | 身份 | 描述字串 |\n|---|---|---|---|\n`;
  r.persons.forEach(p => {
    const c = usedC.filter(x => x.name === p.name)[0];
    if (!c) return;
    md += `| ${p.name} | ${p.count} | ${p.role || '—'} | ${p.descDraft || ''} |\n`;
  });
  const missing = S.chars.filter(c => usedC.indexOf(c) < 0).map(c => c.name);
  md += `\n> 本集未出現（造型仍要保留，後續集數會用到）：${missing.length ? missing.join('、') : '無'}\n`;

  md += `\n## ② 場景（本集 ${usedS.length}／全篇 ${S.scenes.length}）— 鎖場景用\n\n`;
  md += `| 場景 | 類型 | 描述字串 |\n|---|---|---|\n`;
  r.places.forEach(p => {
    const s = usedS.filter(x => x.name === p.name)[0];
    if (!s) return;
    md += `| ${p.name} | ${p.type} | ${p.descDraft || ''} |\n`;
  });

  md += `\n## ④ 畫風基底\n\n${S.style}\n\n`;
  md += `## ③ 分鏡表（${idxs.length} 鏡）\n\n`;
  md += `| # | 鏡號 | 時間碼 | 景別 | 運鏡 | 秒 | 角色 | 場景 | 字幕（旁白） | 鏡頭描述 |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  idxs.forEach((gi, k) => {
    const s = S.shots[gi];
    const c = charById(s.charId), sc = sceneById(s.sceneId);
    const narr = (s.narr || '').replace(/\|/g, '｜').replace(/\n/g, ' ');
    md += `| ${k + 1} | ${s.id} | ${tcWithin(idxs, k)} | ${s.size} | ${s.move} | ${s.dur} | ${c ? c.name : '—'} | ${sc ? sc.name : '—'} | ${narr} | ${s.lens} |\n`;
  });

  md += `\n## 完整 prompt（每鏡可直接貼進即夢）\n\n`;
  idxs.forEach(gi => {
    const s = S.shots[gi];
    md += `### ${s.id}（${s.size}／${s.move}／${s.dur}s，${refHint(s)}）\n\n\`\`\`\n${buildPrompt(s)}\n\`\`\`\n\n`;
  });
  md += `---\n\n反向提示詞：\n\n\`\`\`\n${S.neg}\n\`\`\`\n`;
  return { md, dur, chars, usedC, usedS };
}

function storyboardTsv(idxs) {
  const head = ['shot_id', '時間碼', '旁白', '景別', '運鏡', '時長秒', '角色', '場景', '鏡頭描述', '參考設定', '完整prompt', '狀態', '檔案'];
  let tsv = head.join('\t') + '\n';
  idxs.forEach((gi, k) => {
    const s = S.shots[gi];
    const c = charById(s.charId), sc = sceneById(s.sceneId);
    const row = [s.id, tcWithin(idxs, k), s.narr, s.size, s.move, s.dur, c ? c.name : '', sc ? sc.name : '',
      s.lens, refHint(s), buildPrompt(s).replace(/\n+/g, ' '), s.st, ''];
    tsv += row.map(v => String(v).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t') + '\n';
  });
  return tsv;
}

fs.mkdirSync(outDir, { recursive: true });
const written = [];

/* 整篇一份 */
{
  const all = S.shots.map((_, i) => i);
  const unitTable = plans.map((u, ui) => {
    const a = S.shots[u.from], b = S.shots[u.to];
    const sa = sceneById(a.sceneId), sb = sceneById(b.sceneId);
    const ch = S.shots.slice(u.from, u.to + 1).reduce((x, s) => x + (s.narr || '').replace(/\s/g, '').length, 0);
    return `| U${ui + 1} | ${mmss(plans.slice(0, ui).reduce((t, p) => t + p.dur, 0))}–` +
      `${mmss(plans.slice(0, ui + 1).reduce((t, p) => t + p.dur, 0))} | ${mmss(u.dur)} | ${u.to - u.from + 1} 鏡 | ${ch} 字 | ` +
      `${sa ? sa.name : '—'} → ${sb ? sb.name : '—'} | ${u.hard ? '⚠️ 硬切' : '換場'}${u.dur < 600 ? ' ⚠️ 短於 10 分鐘' : ''} |`;
  }).join('\n');
  const note = plans.length > 1
    ? `\n## 📑 單元切分（切點落在換場）\n\n| 單元 | 時間碼 | 時長 | 規模 | 字數 | 場景 | 切點 |\n|---|---|---|---|---|---|---|\n${unitTable}\n`
    : `\n> ⚠️ 全篇 ${mmss(totalDur)}，不足一個 10–15 分鐘單元（約 2,600–3,900 字）—— 可與同系列其他短篇併集。\n`;
  const out = storyboardMd(all, '', note);
  const p1 = path.join(outDir, title + '_分鏡表.md');
  const p2 = path.join(outDir, title + '_分鏡表.tsv');
  fs.writeFileSync(p1, out.md);
  fs.writeFileSync(p2, storyboardTsv(all));
  written.push(p1, p2);
  console.log(`${title}：${hanAll} 漢字 → ${S.shots.length} 鏡／${mmss(totalDur)}／${plans.length} 單元／${S.chars.length} 角色／${S.scenes.length} 場景`);
}

/* 逐集各一份（單元多於一個才有意義） */
plans.forEach((u, ui) => {
  if (plans.length < 2) return;
  const idxs = [];
  for (let k = u.from; k <= u.to; k++) idxs.push(k);
  const label = `U${ui + 1}`;
  const out = storyboardMd(idxs, label,
    `\n> 這是《${title}》四集之中的第 ${ui + 1} 集（全篇 ${mmss(totalDur)}）。本集時間碼從 0:00 起算。\n`);
  const p1 = path.join(outDir, `${title}_${label}_分鏡表.md`);
  const p2 = path.join(outDir, `${title}_${label}_分鏡表.tsv`);
  fs.writeFileSync(p1, out.md);
  fs.writeFileSync(p2, storyboardTsv(idxs));
  written.push(p1, p2);
  console.log(`  ${label}：${mmss(u.dur)}／${idxs.length} 鏡／${out.chars} 字／角色 ${out.usedC.length}／場景 ${out.usedS.length}` +
    `${u.hard ? '（硬切）' : ''}`);
});
console.log('  共寫出 ' + written.length + ' 個檔案 → ' + outDir);
