#!/usr/bin/env node
/* 把出貨詞庫匯出成 JSON，供 Python 採礦器比對「哪些詞還沒收」。
   注意：核心整份載入會在啟動段炸掉（缺 DEF_STYLE 等 DOM 全域），
   const 也就拿不到 —— 所以改成「抽出宣告、單獨 eval」，並對空清單大聲報錯。 */
const fs = require('fs'), vm = require('vm');
const CORE = '/home/arthur/.hermes/cache/scratch/novel-import-core.js';
const src = fs.readFileSync(CORE, 'utf8');

function grab(name, kind) {
  /* 宣告形式有三種：陣列、物件、new Set([...]) —— 用「下一個 const 宣告」當結尾最穩 */
  const s = src.indexOf('const ' + name + ' = ');
  if (s < 0) throw new Error('找不到宣告：' + name);
  /* 宣告結尾：合併脚本固定的寫法是「\n];」「\n]);」「\n};」收尾 */
  const cands = ['\n];', '\n]);', '\n};'].map(function (t) { return src.indexOf(t, s); }).filter(function (i) { return i > 0; });
  if (!cands.length) throw new Error('找不到宣告結尾：' + name);
  const end = Math.min.apply(null, cands) + 3;
  let txt = src.slice(s, end).replace(/^const \w+ = /, '').trim().replace(/;$/, '');
  let v = vm.runInNewContext('(' + txt + ')');
  if (Object.prototype.toString.call(v) === '[object Set]') v = Array.from(v);
  if (Array.isArray(v) && v.length === 0) throw new Error(name + ' 匯出為空 —— 抽取失敗，不要相信這份 JSON');
  return v;
}
const out = {
  roles: grab('ROLE_WORDS'), family: grab('FAMILY_WORDS'), titles: grab('NAME_TITLES'),
  pairs: {}, raw: {}
};
['ACTION_PHRASES', 'FACE_PHRASES', 'TRAIT_PHRASES', 'LIGHT_PHRASES', 'OBJ_CLOSEUP', 'NOUN_VISUALS', 'TIME_JUMP', 'PLACE_TEX_BY_NAME', 'MARK_POOL', 'FACE_SHAPES', 'EYES'].forEach(function (n) {
  const v = grab(n);
  out.pairs[n] = v.map(function (x) { return typeof x[0] === 'string' ? x[0] : String(x[0]); });
  out.raw[n] = v.map(function (x) { return [typeof x[0] === 'string' ? x[0] : String(x[0]), Array.isArray(x[1]) ? x[1] : [x[1]]]; });
});
['HAIR', 'OUTFITS', 'SCENE_TEXTURE'].forEach(function (n) {
  const v = grab(n, 'obj');
  const flat = [];
  Object.keys(v).forEach(function (a) { Object.keys(v[a] || {}).forEach(function (k) { const leaf = v[a][k]; if (Array.isArray(leaf)) flat.push(a + '/' + k + '｜' + leaf.join('｜')); else flat.push(a + '/' + k + '｜' + leaf); }); });
  out.pairs[n] = flat;
});
fs.writeFileSync('/tmp/lex.json', JSON.stringify(out));
console.log('已匯出 /tmp/lex.json');
Object.keys(out.pairs).forEach(function (k) { console.log('  ' + k.padEnd(20) + out.pairs[k].length); });
console.log('  ' + '角色詞'.padEnd(18) + out.roles.length + '／家族 ' + out.family.length + '／稱謂 ' + out.titles.length);
