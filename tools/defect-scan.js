/* 缺陷掃描：用可量化的方式找出分鏡表裡「不智慧」的地方。
   用法：node tools/defect-scan.js <小說.txt> [每鏡秒數] [場景上限] */
const fs = require('fs'), vm = require('vm'), path = require('path');
const noop = () => {};
const fakeEl = () => ({ style: {}, classList: { add: noop, remove: noop, contains: () => false }, addEventListener: noop, appendChild: noop, value: '', textContent: '', innerHTML: '' });
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: fakeEl, addEventListener: noop, body: fakeEl() };
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
globalThis.navigator = { clipboard: null };
const script = fs.readFileSync(path.join(__dirname, '..', 'storyboard.html'), 'utf8').match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
try { vm.runInThisContext(script); } catch (e) { }

const file = process.argv[2];
const sec = +(process.argv[3] || 4), maxScenes = +(process.argv[4] || 8);
const raw = normalizeNovel(fs.readFileSync(file, 'utf8'));
const r = analyzeNovel(raw, { secPerShot: sec, maxChars: 8, maxScenes: maxScenes, wpm: 260 });
const shots = r.shots, name = path.basename(file, '.txt');
const han = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
console.log(`《${name}》${han} 漢字 → ${shots.length} 鏡\n`);

/* ① 碎片字幕：切句切壞的短碎片（結尾不是句末標點又是短句） */
const frag = shots.filter(s => {
  const t = (s.narr || '').replace(/\s/g, '');
  return t.length <= 7 && !/[。！？，、；：」』…]$/.test(t);
});
console.log(`① 碎片字幕 ${frag.length}／${shots.length}（${(100 * frag.length / shots.length).toFixed(1)}%）`);
frag.slice(0, 8).forEach(s => console.log('   「' + (s.narr || '').trim() + '」　→ ' + (s.lens || '').slice(0, 34)));

/* ② 同一角色連續太多鏡（真人分鏡不會讓同一張臉連續二十幾鏡） */
let run = 0, best = 0, bestName = '', cur = '';
shots.forEach(s => {
  if (s._who && s._who === cur) { run++; if (run > best) { best = run; bestName = cur; } } else { cur = s._who; run = 1; }
});
console.log(`\n② 同角色最長連續 ${best} 鏡${bestName ? '（' + bestName + '）' : ''}`);

/* ③ 鏡頭描述重複：一字不差的重複是罐頭感 */
const cnt = {};
shots.forEach(s => { const k = s.lens || ''; cnt[k] = (cnt[k] || 0) + 1; });
const rep = Object.entries(cnt).filter(x => x[1] >= 8).sort((a, b) => b[1] - a[1]);
console.log(`\n③ 重複 8 次以上的鏡頭描述 ${rep.length} 種`);
rep.slice(0, 5).forEach(([k, v]) => console.log(`   ×${v}　${k.slice(0, 52)}`));

/* ④ 沒有角色的鏡頭比例（空景／群像） */
const noChar = shots.filter(s => !s._who).length;
console.log(`\n④ 沒有角色的鏡頭（空景／不露臉）${noChar}／${shots.length}（${(100 * noChar / shots.length).toFixed(1)}%）`);

/* ⑤ 場景與字幕矛盾：字幕提到某場景名，但這一鏡標的是別的場景 */
const placeNames = r.places.map(p => p.name);
let conflict = 0; const samples = [];
shots.forEach(s => {
  const hit = placeNames.filter(n => (s.narr || '').indexOf(n) >= 0);
  if (hit.length && s._scene && hit.indexOf(s._scene) < 0) { conflict++; if (samples.length < 5) samples.push(hit[0] + ' vs ' + s._scene + '｜' + (s.narr || '').slice(0, 20)); }
});
console.log(`\n⑤ 場景與字幕矛盾 ${conflict} 鏡`);
samples.forEach(x => console.log('   ' + x));

/* ⑥ 角色身份判斷（role）—— 逐一看，這裡最容易錯 */
console.log(`\n⑥ 角色與身份（${r.persons.length}）`);
r.persons.forEach(p => console.log(`   ${p.name.padEnd(8)} ×${String(p.count).padStart(3)}　身份：${p.role || '（無）'}`));

/* ⑦ 性別判斷 */
console.log(`\n⑦ 性別判斷`);
r.persons.forEach(p => {
  const d = p.descDraft || '';
  const g = /^男性/.test(d) ? '男' : (/^女性/.test(d) ? '女' : '（未判）');
  console.log(`   ${p.name.padEnd(8)} ${g}`);
});

/* ⑧ 疑似漏抓的稱謂：文中出現多次但不在人物表的「老X／小X／X先生」 */
const cand = {};
(raw.match(/[老小][\u4e00-\u9fff]{1,2}|[\u4e00-\u9fff]{1,2}(?:先生|太太|醫師|醫生|老闆|警官|隊長)/g) || []).forEach(w => { cand[w] = (cand[w] || 0) + 1; });
const known = r.persons.map(p => p.name);
const missed = Object.entries(cand).filter(x => x[1] >= 5 && !known.some(k => k === x[0] || x[0].indexOf(k) >= 0 || k.indexOf(x[0]) >= 0))
  .sort((a, b) => b[1] - a[1]);
console.log(`\n⑧ 疑似漏抓的名字（出現 ≥5 次但不在人物表）${missed.length}`);
missed.slice(0, 8).forEach(([w, c]) => console.log(`   ${w} ×${c}`));

/* ⑨ 場景清單 */
console.log(`\n⑨ 場景（${r.places.length}）`);
r.places.forEach(p => console.log(`   ${p.name.padEnd(8)} ${p.type} ×${p.count}`));
