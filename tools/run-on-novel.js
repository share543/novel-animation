/* 用「實際出貨」的 storyboard.html 跑一篇真實小說，印出抽取結果。
   用法：node tools/run-on-novel.js <小說.txt> [場景上限]
   這是出貨程式碼的驗收工具（不是另一份複本）。 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = path.join(__dirname, '..', 'storyboard.html');
const noop = () => {};
const fakeEl = () => ({ style: {}, classList: { add: noop, remove: noop, contains: () => false }, addEventListener: noop, appendChild: noop, value: '', textContent: '', innerHTML: '' });
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: fakeEl, addEventListener: noop, body: fakeEl() };
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
globalThis.navigator = { clipboard: null };
const script = fs.readFileSync(HTML, 'utf8').match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
try { vm.runInThisContext(script); } catch (e) { /* 啟動段無 DOM，函式已提升 */ }

const file = process.argv[2];
const sc = +(process.argv[3] || 8);
const text = normalizeNovel(fs.readFileSync(file, 'utf8'));
const r = analyzeNovel(text, { secPerShot: 4, maxChars: 8, maxScenes: sc, wpm: 260 });
const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
console.log('檔案：' + path.basename(file) + '　' + han + ' 漢字　→ ' + r.shots.length + ' 鏡');
console.log('\n人物（' + r.persons.length + '）：');
r.persons.slice(0, 8).forEach(function (p) {
  console.log('  ' + p.name.padEnd(8) + ' ×' + String(p.count).padStart(3) + '　' + (p.descDraft || '').split('；')[0]);
});
console.log('\n場景（' + r.places.length + '）：');
r.places.forEach(function (p) { console.log('  ' + p.name.padEnd(8) + ' ' + p.type + '　' + (p.descDraft || '').slice(0, 44)); });
const seasons = r.places.map(p => (p.descDraft || '').split('；').pop().trim());
console.log('\n年代：' + detectEra(text) + '　季節一致：' + (new Set(seasons).size <= 1 ? '✅ 一致' : '❌ ' + new Set(seasons).size + ' 種'));
console.log('物件特寫鏡：' + r.shots.filter(s => /特寫：/.test(s.lens || '')).length + '　無明確動作：' + r.shots.filter(s => /無明確動作/.test(s.lens || '')).length);
console.log('\n前 5 鏡：');
r.shots.slice(0, 5).forEach(function (s) {
  console.log('  ' + (s.lens || '').slice(0, 38) + '　／　' + (s.narr || '').slice(0, 18));
});
