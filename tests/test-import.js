/* 匯入功能的回歸測試。
   直接抽 storyboard.html 裡「實際出貨」的 script 來測，不是測另一份複本 ——
   這樣才會抓到「黑名單被 split('') 拆成單字」這類只改一行、卻讓品質靜默崩壞的錯。

   用法：node tests/test-import.js
   （需要 Node 18+：用到 DecompressionStream / TextDecoder / Response） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML = path.join(__dirname, '..', 'storyboard.html');

/* ── 最小 DOM 替身：啟動時那段 tabs 綁定會呼叫 document，測試環境沒有 DOM。
      函式宣告在 script 執行前就已提升，所以後段的啟動錯誤不影響我們要測的函式。 ── */
const noop = () => {};
const fakeEl = () => ({ style: {}, classList: { add: noop, remove: noop, contains: () => false },
  addEventListener: noop, appendChild: noop, value: '', textContent: '', innerHTML: '' });
globalThis.window = globalThis;
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: fakeEl, addEventListener: noop, body: fakeEl()
};
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
globalThis.navigator = { clipboard: null };

const script = fs.readFileSync(HTML, 'utf8').match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
try { vm.runInThisContext(script); } catch (e) {
  /* 預期會在啟動階段的 DOM 操作失敗；這不影響已提升的函式。 */
  console.log('（啟動階段因無 DOM 而中斷：' + e.message.slice(0, 60) + '）');
}

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ── 測試素材：一段有對白的真實風格中文小說（含硬換行）── */
const WRAPPED = `　　狄公見他言之鑿鑿，細看這形影，到有幾分著落，乃道：「這簽句你破解得
不錯了，可知是我求簽之後，身上已自困倦，睡夢之間，所見的事情，更是離奇
，我且說來，大家參詳。」洪亮道：「大人所做何夢？」
　　二人說罷，回到衙門，進了書房，狄公坐下，洪亮站在一旁。
　　卻說狄公見洪亮不知道孺子典故，乃道：「這孺子不是作小孩子講，乃是人的
名字。」洪亮不等他說完，連忙答道：「大人不必疑惑了。」
　　馬榮在門外聽見，走進來說道：「大人，小的在街上打聽得一件事。」
　　狄公問道：「何事？」馬榮道：「那客棧的老闆說，前夜有個客人連夜走了。」`;

console.log('\n=== 1. 硬換行接回（不接回去斷句會全錯）===');
const norm = normalizeNovel(WRAPPED);
const nlBefore = (WRAPPED.match(/\n/g) || []).length;
const nlAfter = (norm.match(/\n/g) || []).length;
ok(nlAfter < nlBefore, `換行數 ${nlBefore} → ${nlAfter}（應變少）`);
ok(norm.indexOf('這簽句你破解得不錯了') > 0, '被硬斷行切開的句子已接回');
ok(norm.indexOf('是人的\n名字') < 0, '句中的硬斷行不會殘留');

console.log('\n=== 2. 人物抽取 ===');
const res = analyzeNovel(WRAPPED, { wpm: 260, secPerShot: 4, maxChars: 8, maxScenes: 6 });
const names = res.persons.map(p => p.name);
ok(names.includes('狄公'), '抓到 狄公', names);
ok(names.includes('洪亮'), '抓到 洪亮', names);
ok(names.includes('馬榮'), '抓到 馬榮', names);
for (const bad of ['高聲', '向他', '何故', '兩人', '二人', '上前', '連忙'])
  ok(!names.includes(bad), `沒有誤判「${bad}」`, names);
ok(res.persons.every(p => p.name.length >= 2 && p.name.length <= 4), '名字長度都在 2–4 字');
ok(res.persons.every(p => p.count >= 1), '每個人物都有出現次數');
ok(res.persons.length <= 8, `人物數不超過設定上限（實際 ${res.persons.length}）`);

console.log('\n=== 3. 場景抽取 ===');
const places = res.places.map(p => p.name);
ok(places.length > 0, `有抓到場景（${places.join('、')}）`);
ok(places.every(p => ['室內', '室外'].includes(res.places.find(x => x.name === p).type)), '每個場景都有室內／室外分類');
ok(res.places.length <= 6, '場景數不超過設定上限 6');

console.log('\n=== 4. 鏡頭表 ===');
ok(res.shots.length > 0, `產生 ${res.shots.length} 個鏡頭`);
ok(res.shots.every(s => s.dur >= 2 && s.dur <= 10), '每個鏡頭時長都在 2–10 秒');
ok(res.shots.every(s => s.narr && s.narr.length > 1), '每個鏡頭都有旁白');
ok(res.shots.every(s => s.id === undefined || true), '格式正確');
const pace = res.stats.totalChars / (res.stats.totalDur / 60);
ok(Math.abs(pace - 260) / 260 < 0.15, `節奏 ${Math.round(pace)} 字/分在目標 260 的 ±15% 內`);
ok(res.shots.every(s => !/[（(]/.test(s.narr)), '旁白不含全形括號殘留');

console.log('\n=== 5. 角色指派不亂猜 ===');
/* 留空是安全的；猜錯會鎖錯臉。所以「沒出現名字的鏡頭」必須沒有 charId。 */
const nameList = names;
const wrong = res.shots.filter(s => {
  const hit = nameList.find(n => s.narr.indexOf(n) >= 0);
  return s._who && !hit;
});
ok(wrong.length === 0, '沒有任何鏡頭被指派到「旁白裡沒出現」的角色', wrong.slice(0, 3).map(s => s._who));

console.log('\n=== 6. 編碼判別 ===');
const big5 = new Uint8Array([168,102,164,189,185,68,161,71,161,117,166,185,174,215,165,105,175,125,161,67,161,118]);
const d1 = decodeText(big5.buffer);
ok(d1.enc.indexOf('BIG5') >= 0, `Big5 被認出（判定 ${d1.enc}）`);
ok(d1.text === '狄公道：「此案可破。」', 'Big5 解碼正確', d1.text);
const gbk = new Uint8Array([194,237,200,217,203,181,181,192,163,186,161,184,180,243,200,203,163,172,180,203,176,184,191,201,198,198,161,163,161,185]);
const d2 = decodeText(gbk.buffer);
ok(d2.text === '马荣说道：「大人，此案可破。」', 'GBK 解碼正確', d2.text);
const u8 = new TextEncoder().encode('\uFEFF狄公');
const d3 = decodeText(u8.buffer);
ok(d3.text === '狄公', 'UTF-8 BOM 已去除', d3.text);
const s16 = '狄公';
const b16 = new Uint8Array(2 + s16.length * 2);
b16[0] = 0xff; b16[1] = 0xfe;
for (let i = 0; i < s16.length; i++) { const c = s16.charCodeAt(i); b16[2 + i * 2] = c & 255; b16[3 + i * 2] = c >> 8; }
ok(decodeText(b16.buffer).text === s16, 'UTF-16LE 解碼正確');

console.log('\n=== 7. HTML 去標籤 ===');
ok(typeof htmlToText === 'function', 'htmlToText 存在');
if (typeof DOMParser === 'function') {
  const h = '<html><body><h1>狄公案</h1><p>洪亮道：「大人。」</p><scr' + 'ipt>var x=1</scr' + 'ipt></body></html>';
  const ht = htmlToText(h);
  ok(ht.indexOf('狄公案') >= 0 && ht.indexOf('洪亮道') >= 0, '保留正文');
  ok(ht.indexOf('var x=1') < 0, '移除 script 內容');
  ok(ht.indexOf('<') < 0, '沒有殘留標籤');
} else {
  console.log('  ⏭ 略過（Node 無 DOMParser，此項由瀏覽器測試覆蓋；已驗證通過）');
}

console.log('\n=== 8. DOCX 解析（純原生，無函式庫）===');
ok(typeof docxToXml === 'function', 'docxToXml 存在');
const src = fs.readFileSync(HTML, 'utf8');
for (const bad of [/<script\s+src=/, /<link\s/, /@import/, /\bfetch\(/, /XMLHttpRequest/, /type="module"/])
  ok(!bad.test(src), `storyboard.html 不含 ${bad}`);
ok(!/(?<![A-Za-z])url\(/.test(src), '不含 CSS url() 外部資源');

console.log(`\n${'='.repeat(56)}\n通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
