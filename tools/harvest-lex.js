#!/usr/bin/env node
/* 詞庫採礦：從真實小說挖出「詞庫還沒有」的候選詞，並列出「詞庫有但從沒命中」的死條目。
   用法：node harvest-lex.js 檔1.txt 檔2.txt ...  [--top 40] [--out 報告路徑]

   原則：只產出候選清單，不自動改詞庫 —— 收不收由人判斷（命中率證明過的才收）。
*/
const fs = require('fs'), vm = require('vm');
const CORE = '/home/arthur/.hermes/cache/scratch/novel-import-core.js';

const args = process.argv.slice(2);
const files = []; let TOP = 40, OUT = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--top') { TOP = +args[++i]; continue; }
  if (args[i] === '--out') { OUT = args[++i]; continue; }
  files.push(args[i]);
}
if (!files.length) { console.error('用法：node harvest-lex.js 檔1.txt [檔2.txt ...] [--top 40]'); process.exit(2); }

/* ── 載入詞庫（核心有 DOM 啟動段，用替身吃掉）── */
const ctx = vm.createContext({ document: { addEventListener: function () {}, querySelector: function () { return null; }, querySelectorAll: function () { return []; }, getElementById: function () { return null; }, createElement: function () { return { style: {}, classList: { add: function () {}, remove: function () {}, toggle: function () {} }, appendChild: function () {}, addEventListener: function () {} }; }, body: { appendChild: function () {} } }, window: {}, navigator: { clipboard: {} }, localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} } });
try { vm.runInContext(fs.readFileSync(CORE, 'utf8'), ctx); } catch (e) { /* 啟動段失敗不影響已提升的函式與常數 */ }
const g = function (expr) { try { return vm.runInContext(expr, ctx); } catch (e) { return null; } };

const ROLE_WORDS = g('ROLE_WORDS') || [];
const FAMILY_WORDS = g('Array.from(FAMILY_WORDS)') || [];
const NAME_TITLES = g('NAME_TITLES') || [];
const ACTION_PHRASES = g('ACTION_PHRASES') || [];
const FACE_PHRASES = g('FACE_PHRASES') || [];
const TRAIT_PHRASES = g('TRAIT_PHRASES') || [];
const LIGHT_PHRASES = g('LIGHT_PHRASES') || [];
const OBJ_CLOSEUP = g('OBJ_CLOSEUP') || [];
const NOUN_VISUALS = g('NOUN_VISUALS') || [];
const TIME_JUMP = g('TIME_JUMP') || [];
const PLACE_TEX = g('PLACE_TEX_BY_NAME') || [];

const KNOWN_ROLES = new Set([].concat(ROLE_WORDS, FAMILY_WORDS, NAME_TITLES));
const knownPlace = function (w) { for (const r of PLACE_TEX) { if (r[0].test(w)) return true; } return false; };

/* 泛用詞／代名詞／方位詞：不是角色也不是場所，先擋掉 */
const STOP = new Set(('他們 我們 你們 咱們 自己 大家 眾人 有人 那人 此人 什麼 怎麼 這樣 那樣 一切 所有 一些 這些 那些 於是 但是 因為 所以 如果 只是 已經 突然 立刻 馬上 趕緊 連忙 地方 時候 東西 事情 問題 方法 意思 樣子 聲音 眼睛 目光 臉色 神情 心裡 口中 手裡 身上 眼前 背後 身旁 旁邊 上面 下面 裡面 外面 中間 附近 到處 四周 左右 前後 之後 之前 當時 現在 今天 明天 昨天 晚上 早上 中午 下午 一天 幾天 一年 十年 相當 非常 十分 有點 有些 一直 仍然 依然 終於 果然 居然 竟然 突然 忽然 只是 而且 不但 而且 或是 或者 不過 可是 然後 接著 後來 最後 一開始 那時 這時 同時 於是 因此 這樣子 這麼 那麼 怎樣 如何 為何 為了 關於 對於 由於 為了 只要 只有 除了 以及 並且 甚至 尤其 譬如 例如 包括 其他 其它 另外 別的 某個 每個 各種 許多 很多 少數 多數 全部 部分 大部分'.split(' ')));

/* ── 讀語料 ── */
let corpus = '';
files.forEach(function (f) { corpus += fs.readFileSync(f, 'utf8') + '\n'; });
const sents = corpus.split(/[。！？\n\r]+/).map(function (s) { return s.trim(); }).filter(Boolean);
console.log('語料：' + files.length + ' 篇 / ' + corpus.length + ' 字 / ' + sents.length + ' 句\n');

const bump = function (m, k, n) { m.set(k, (m.get(k) || 0) + n); };

/* ── A. 角色／身份候選 ── */
const roleHit = new Map();
const ROLE_CTX = [
  /([\u4e00-\u9fff]{2,4})(?:說道|問道|答道|回道|笑道|叫道|喊道|喝道|插嘴|接著說|開口|回答)/g,
  /([\u4e00-\u9fff]{2,4})(?:走進|走出|推開|拿起|放下|低頭|抬頭|轉身|點頭|搖頭|坐下|站起|伸手|看著|望了)/g,
  /(?:老|小|阿)([\u4e00-\u9fff]{1,2})(?:說道|走進|問|答)/g,
  /([\u4e00-\u9fff]{1,2})(員|師|手|官|長|匠|販|醫|警|兵|賊|客|漢|婆|嫂|嬸|叔|伯|爺|姊|妹|哥|弟|夫|婦|倌|侍|ㄚ鬟|丫鬟|丫頭)(?:說道|走進|問|答|來|去|說)/g
];
sents.forEach(function (s) {
  for (const re of ROLE_CTX) { re.lastIndex = 0; let m; while ((m = re.exec(s))) bump(roleHit, m[1] + (m[2] || ''), 1); }
});

/* ── B. 場所候選 ── */
const placeHit = new Map();
const PLACE_CTX = [
  /(?:在|到|回|往|向|走進|走出|離開|經過)([\u4e00-\u9fff]{2,4})(?:裡|裏|內|中|上|前|後|旁|口|外)/g,
  /([\u4e00-\u9fff]{2,4})(?:裡|裏|內)(?:有|沒|擺|放|傳|飄|亮|暗|坐|站)/g
];
sents.forEach(function (s) {
  for (const re of PLACE_CTX) { re.lastIndex = 0; let m; while ((m = re.exec(s))) bump(placeHit, m[1], 1); }
});

/* ── C. 表情／氣質候選 ── */
const faceHit = new Map();
const FACE_CTX = [
  /(?:神情|臉色|表情|神色|面色)([\u4e00-\u9fff]{2,3})/g,
  /([\u4e00-\u9fff]{2,3})(?:的說道|地說|地說道|地回答)/g
];
sents.forEach(function (s) {
  for (const re of FACE_CTX) { re.lastIndex = 0; let m; while ((m = re.exec(s))) bump(faceHit, m[1], 1); }
});

/* ── D. 動作候選（2-3 字 + 著／了）── */
const actHit = new Map();
const ACT_CTX = [/([\u4e00-\u9fff]{2,3})著(?:[他她我你]|，|。|，|$)/g, /([\u4e00-\u9fff]{2,3})了起來/g];
sents.forEach(function (s) {
  for (const re of ACT_CTX) { re.lastIndex = 0; let m; while ((m = re.exec(s))) bump(actHit, m[1], 1); }
});

/* ── 死條目：詞庫有、全語料 0 命中 ── */
const dead = function (pairs) {
  return pairs.filter(function (p) {
    const k = p[0];
    if (Object.prototype.toString.call(k) === '[object RegExp]') {
      const src = k.source.replace(/^\^|\$$/g, '');
      return !src.split('|').some(function (alt) { return alt.length > 1 && corpus.indexOf(alt) >= 0; });
    }
    return typeof k === 'string' && k.length > 1 && corpus.indexOf(k) < 0;
  }).map(function (p) { return String(p[0]); });
};

const rank = function (m, uniqSet, knownFn, min) {
  return Array.from(m.entries())
    .filter(function (e) { return !uniqSet.has(e[0]) && !STOP.has(e[0]) && !knownFn(e[0]) && e[1] >= min; })
    .sort(function (a, b) { return b[1] - a[1]; }).slice(0, TOP);
};

const inKeys = function (pairs) { const s = new Set(); pairs.forEach(function (p) { if (typeof p[0] === 'string') s.add(p[0]); }); return s; };
const isName = function (w) { return KNOWN_ROLES.has(w) || w.length < 2; };

const newRoles = rank(roleHit, new Set(), isName, 3);
const newPlaces = rank(placeHit, new Set(), knownPlace, 3);
const newFaces = rank(faceHit, inKeys(FACE_PHRASES.concat(TRAIT_PHRASES)), function () { return false; }, 3);
const newActs = rank(actHit, inKeys(ACTION_PHRASES), function (w) { return /^(?:看|想|說|笑|哭|坐|躺|站|走|聽|記|等|忙|接|拿|開|關|停|醒|睡|活|過|對|有|沒|要|會|能|該|像|似|變|成|來|去|出|入|上|下|起|落|住|完|好|壞|對|錯)/.test(w); }, 4);

const out = [];
out.push('# 詞庫採礦報告', '');
out.push('語料：' + files.map(function (f) { return f.split('/').pop(); }).join('、'));
out.push('共 ' + corpus.length + ' 字 / ' + sents.length + ' 句', '');
const sec = function (t, arr, note) {
  out.push('## ' + t + '（' + arr.length + ' 條' + (note ? '，' + note : '') + '）', '');
  arr.forEach(function (e) { out.push('- `' + e[0] + '` ×' + e[1]); });
  out.push('');
};
sec('A. 未收錄的角色／身份詞候選', newRoles, '出現在「說道／走進」句型，詞庫沒有，出現 ≥3 次');
sec('B. 未收錄的場所候選', newPlaces, '出現在「在X裡／走進X」句型');
sec('C. 未收錄的表情／氣質詞候選', newFaces, '出現在「神情X／X地說道」');
sec('D. 未收錄的動作詞候選', newActs, '出現在「X著／X了起來」');
out.push('## E. 死條目（詞庫有、全語料 0 命中）', '');
[['動作', ACTION_PHRASES], ['表情', FACE_PHRASES], ['氣質', TRAIT_PHRASES], ['光線', LIGHT_PHRASES], ['物件特寫', OBJ_CLOSEUP], ['名詞插鏡', NOUN_VISUALS], ['時間跳躍', TIME_JUMP], ['場所材質', PLACE_TEX]].forEach(function (p) {
  const d = dead(p[1]);
  out.push('- **' + p[0] + '**：' + d.length + ' / ' + p[1].length + ' 條沒命中' + (d.length ? '　' + d.slice(0, 20).join('、') : ''));
});
const report = out.join('\n');
if (OUT) { fs.writeFileSync(OUT, report); console.log('報告：' + OUT); }
const brief = [];
brief.push('A 角色候選 ' + newRoles.length + '：' + newRoles.slice(0, 14).map(function (e) { return e[0] + '×' + e[1]; }).join('、'));
brief.push('B 場所候選 ' + newPlaces.length + '：' + newPlaces.slice(0, 14).map(function (e) { return e[0] + '×' + e[1]; }).join('、'));
brief.push('C 表情候選 ' + newFaces.length + '：' + newFaces.slice(0, 12).map(function (e) { return e[0] + '×' + e[1]; }).join('、'));
brief.push('D 動作候選 ' + newActs.length + '：' + newActs.slice(0, 12).map(function (e) { return e[0] + '×' + e[1]; }).join('、'));
console.log(brief.join('\n'));
