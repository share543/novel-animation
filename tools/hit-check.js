/* 新詞庫條目的命中驗證：只收「在真實文本真的命中」的條目 */
const fs = require('fs'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
const LEX = process.argv[2] || '/home/arthur/novel-animation/tools/lexicon/stories2.js';
vm.runInContext(fs.readFileSync(LEX, 'utf8'), ctx);
const g = (k) => vm.runInContext("typeof " + k + "!=='undefined'?" + k + ":null", ctx);

const DIR = '/home/arthur/.hermes/cache/scratch/';
const files = ['digong.txt'].concat(fs.readdirSync(DIR + 'corpus').filter(f => /\.txt$/.test(f)).map(f => 'corpus/' + f));
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
rep('角色詞', g('ROLE_WORDS'));
rep('場所樣式', g('PLACE_TEX_BY_NAME'), function (x) { return String(x[0]).replace(/^\/|\/$/g, '').split('|')[0]; });
rep('動作', g('ACTION_PHRASES'), function (x) { return x[0]; });
rep('氣質', g('TRAIT_PHRASES'), function (x) { return x[0]; });
rep('物證', g('OBJ_CLOSEUP'), function (x) { return x[0]; });
rep('名詞', g('NOUN_VISUALS'), function (x) { return x[0]; });
