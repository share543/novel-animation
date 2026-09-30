/* 新詞庫條目的命中驗證：只收「在真實文本真的命中」的條目 */
const fs = require('fs'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
const LEX = process.argv[2] || '/home/arthur/novel-animation/tools/lexicon/stories2.js';
vm.runInContext(fs.readFileSync(LEX, 'utf8'), ctx);
const g = (k) => vm.runInContext("typeof " + k + "!=='undefined'?" + k + ":null", ctx);

const DIR = '/home/arthur/.hermes/cache/scratch/';
/* digong.txt 是古裝語料，放在 DIR 直下；語料目錄只有現代作品。
   任何一個檔案不在就跳過並講明白 —— 不要整個腳本掛掉、也不要靜默少驗。 */
const wanted = ['digong.txt'].concat(fs.readdirSync(DIR + 'corpus').filter(f => /\.txt$/.test(f)).map(f => 'corpus/' + f));
const files = wanted.filter(f => fs.existsSync(DIR + f));
const missing = wanted.filter(f => !fs.existsSync(DIR + f));
if (missing.length) console.log('⚠️ 語料缺少（未納入驗證）：' + missing.join('、'));
console.log('語料：' + files.length + ' 個檔（' + (files.join('、') || '空') + '）\n');
const corpus = files.map(f => fs.readFileSync(DIR + f, 'utf8')).join('\n');
const cnt = (w) => { let n = 0, i = 0; while ((i = corpus.indexOf(w, i)) >= 0) { n++; i += w.length; } return n; };
const RE = Object.prototype.toString.call(/x/) === '[object RegExp]';
function rep(name, arr, kh) {
  const miss = [], hit = [];
  arr.forEach(function (x) {
    const k = kh ? kh(x) : x;
    const c = cnt(k);
    if (c > 0) hit.push(k + '×' + c); else miss.push(k);
  });
  const rate = Math.round(hit.length / arr.length * 100);
  console.log(name + '：命中 ' + hit.length + '/' + arr.length + '（' + rate + '%）');
  if (miss.length) console.log('   零命中：' + miss.join('、'));
}
/* 沒有這個池就講明白跳過 —— 人物批次（stories8／stories9）只有
   FULL_NAMES／NAME_ALIASES，不該讓整支腳本掛掉。 */
function repSafe(name, arr, kh) {
  if (!arr) { console.log(name + '：此批詞庫沒有這個池，跳過'); return; }
  rep(name, arr, kh);
}
repSafe('角色詞', g('ROLE_WORDS'));
repSafe('場所樣式', g('PLACE_TEX_BY_NAME'), function (x) { return String(x[0]).replace(/^\/|\/$/g, '').split('|')[0]; });
repSafe('動作', g('ACTION_PHRASES'), function (x) { return x[0]; });
repSafe('氣質', g('TRAIT_PHRASES'), function (x) { return x[0]; });
repSafe('物證', g('OBJ_CLOSEUP'), function (x) { return x[0]; });
repSafe('名詞', g('NOUN_VISUALS'), function (x) { return x[0]; });
/* 人物批次：完整人名與別名都必須在語料裡真的命中（0 命中的條目要拿掉）。 */
repSafe('完整人名', g('FULL_NAMES'));
repSafe('別名', g('NAME_ALIASES') ? Object.keys(g('NAME_ALIASES')) : null);
