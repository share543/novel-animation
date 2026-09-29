/* 品質稽核：把「準不準」變成數字。
   用法：node tools/quality-audit.js <小說檔>... （不給檔案就掃 corpus/） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const noop = () => {};
globalThis.window = globalThis;
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, contains: () => false }, addEventListener: noop, appendChild: noop }),
  addEventListener: noop, body: {}
};
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
globalThis.navigator = { clipboard: null };

const html = fs.readFileSync(path.join(__dirname, '..', 'storyboard.html'), 'utf8');
const src = html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1];
try { vm.runInThisContext(src); } catch (e) { }

/* 泛用（沒講到任何具體東西）的場所描述特徵 */
const GENERIC = /戶外環境，空間層次分明|室內空間，陳設簡單|四周沒有明顯的人工物/;
/* 自然場景不該拿到的都會材質 */
const URBAN = /騎樓|招牌|玻璃帷幕|柏油|連鎖磚|電線桿|人行道|霓虹|摩托車|超商/;
const NATURAL = /樹|林|花|草|溪|山|湖|潭|海|田野|草原|竹林|蘆葦|沙灘/;
/* 前言雜訊：書名、作者、刊載資訊、轉載聲明被當成鏡 */
const FRONTMATTER = /推理雜誌|轉載自|著刊載|胡柏源|第\d+期|月號|徵文|作者[:：]/;

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(path.join(process.env.HOME, '.hermes/cache/scratch/corpus'))
      .filter(f => /^0.*\.txt$/.test(f))
      .map(f => path.join(process.env.HOME, '.hermes/cache/scratch/corpus', f));

/* 原本「無明確動作」的鏡頭，現在是靠哪一層補上的（組成分析） */
const FILL = [
  ['對白不露臉', /群像或背影/],
  ['場景空景', /的空景，畫面裡沒有人/],
  ['閃回', /閃回/],
  ['心理特寫', /背景壓暗留空/],
  ['時間過場', /時鐘指針|日曆翻頁/],
  ['推論／線索', /線索物件並排|手指點在/],
  ['現場俯角', /地面痕跡與遺留物/],
  ['環境空景', /氣象與光線變化/]
];
let T = { shots: 0, noAction: 0, front: 0, generic: 0, mismatch: 0, places: 0, persons: 0, objClose: 0 };
const fillCount = {};
console.log('每篇：人物／場景／鏡數　以及四項缺陷（前言雜訊／泛用描述／類型錯配／無明確動作）');
console.log('-'.repeat(78));
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const r = analyzeNovel(txt, { secPerShot: 4, maxChars: 8, maxScenes: 8, wpm: 260 });
  const shots = r.shots || [];
  const places = r.places || [];
  let front = 0, noAction = 0, objClose = 0;
  for (const s of shots) {
    if (FRONTMATTER.test(s.narr || '')) front++;
    if (/無明確動作/.test(s.lens || '')) noAction++;
    for (const [name, re] of FILL) if (re.test(s.lens || '')) fillCount[name] = (fillCount[name] || 0) + 1;
  }
  let generic = 0, mismatch = 0;
  for (const p of places) {
    const d = p.descDraft || '';
    if (GENERIC.test(d)) generic++;
    else if (NATURAL.test(p.name) && URBAN.test(d)) mismatch++;
  }
  T.shots += shots.length; T.noAction += noAction; T.front += front;
  T.generic += generic; T.mismatch += mismatch;
  T.places += places.length; T.persons += (r.persons || []).length;
  console.log(`${path.basename(f, '.txt').padEnd(14)} 人物 ${String((r.persons || []).length).padStart(3)}　場景 ${String(places.length).padStart(2)}　鏡 ${String(shots.length).padStart(4)}　`
    + `前言雜訊 ${String(front).padStart(2)}／泛用 ${String(generic).padStart(2)}／錯配 ${String(mismatch).padStart(2)}／無動作 ${String(noAction).padStart(3)}`);
}
console.log('-'.repeat(78));
console.log(`合計：人物 ${T.persons}　場景 ${T.places}　鏡 ${T.shots}`);
console.log(`  前言雜訊鏡   ${T.front}（${(100 * T.front / T.shots).toFixed(1)}%）`);
console.log(`  泛用場所描述 ${T.generic}／${T.places}（${(100 * T.generic / T.places).toFixed(1)}%）`);
console.log(`  類型錯配　   ${T.mismatch}／${T.places}（${(100 * T.mismatch / T.places).toFixed(1)}%）`);
console.log(`  無明確動作   ${T.noAction}／${T.shots}（${(100 * T.noAction / T.shots).toFixed(1)}%）`);
console.log('  補上的鏡頭語言：' + (Object.keys(fillCount).length
  ? Object.entries(fillCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('　')
  : '（無）'));
