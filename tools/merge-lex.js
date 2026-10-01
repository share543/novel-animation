#!/usr/bin/env node
/* 把 lexicon/*.js 合併進 novel-import-core.js
   用法：node merge-lex.js [--dry]
   原則：
     - 片語對：新 + 舊，再依「關鍵詞長度由長到短」排序（比對是先命中先用）
     - 純字串／Set：新的在前、去重
     - 池子物件（HAIR/OUTFITS/SCENE_TEXTURE/SCENE_LIGHT）：逐鍵合併去重
   ⚠️ lexicon 是在 vm context 裡 eval 的，RegExp/Set 屬於另一個 realm，
      不可以用 instanceof 判斷（會被序列化成 {}）。 */
const fs = require('fs'), vm = require('vm');
/* 兩種擺法都支援：repo 內（tools/ + src/）與工作目錄（同一層） */
const ROOT = __dirname;
const DIR = ROOT + '/lexicon/';
const CORE = fs.existsSync(ROOT + '/../src/novel-import-core.js')
  ? ROOT + '/../src/novel-import-core.js'
  : ROOT + '/novel-import-core.js';
/* cues.js 已否決：698 條 6-8 字長片語在 23 萬字文本命中 0 次 */
/* 自動掃描詞庫目錄（新批次丟進來就會被用到，不必改脚本）。
   cues.js 是早期被否決的長片語型錄（698 條在 23 萬字命中 0 次），永久排除。
   排序是為了幂等：readdir 的順序不保證穩定。 */
const SKIP = new Set(['cues.js']);
const FILES = fs.readdirSync(DIR).filter(function (f) {
  return /\.js$/.test(f) && !SKIP.has(f);
}).sort();
const KEYS = ['ROLE_WORDS','FAMILY_WORDS','NAME_TITLES','FULL_NAMES','NAME_ALIASES','ROLE_OUTFIT_HINTS','HAIR','FACE_SHAPES','EYES',
  'MARK_POOL','OUTFITS','PLACE_TEX_BY_NAME','SCENE_TEXTURE','SCENE_LIGHT','SCENE_SEASON',
  'ACTION_PHRASES','FACE_PHRASES','TRAIT_PHRASES','LIGHT_PHRASES','OBJ_CLOSEUP','NOUN_VISUALS','TIME_JUMP'];

const TAG = Object.prototype.toString;
const NEW = {};
FILES.forEach(function (f) {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), ctx);
  KEYS.forEach(function (k) {
    try {
      let v = vm.runInContext('typeof ' + k + "!=='undefined' ? " + k + ' : null', ctx);
      if (!v) return;
      /* 同名變數跨檔串接（不同批次的詞庫各寫一份 ROLE_WORDS，不能被第一個檔吃掉） */
      if (TAG.call(v) === '[object Set]') v = Array.from(v);
      if (Array.isArray(v)) NEW[k] = (NEW[k] || []).concat(v);
      else if (typeof v === 'object') NEW[k] = Object.assign(NEW[k] || {}, v);
      else NEW[k] = v;
    } catch (e) {}
  });
});

function js(v) {
  if (TAG.call(v) === '[object RegExp]') return v.toString();
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(js).join(', ') + ']';
  if (TAG.call(v) === '[object Set]') return 'new Set([' + Array.from(v).map(js).join(', ') + '])';
  if (v && typeof v === 'object')
    return '{\n' + Object.keys(v).map(function (k) { return '  ' + js(k) + ': ' + js(v[k]); }).join(',\n') + '\n}';
  return 'null';
}

let src = fs.readFileSync(CORE, 'utf8');
const report = [];
/* 沒有新條目就不要改寫 —— 改寫會把人工排版的註解與換行洗掉，讓每次合併
   都產生一大坨無關 diff（實測「現場」場景的說明註解就是這樣被吃掉的）。 */
function skip(name) { report.push('  ' + name.padEnd(20) + '無新增，略過（保留原格式）'); }

function bounds(name, kind) {
  const needle = kind === 'set' ? 'const ' + name + ' = new Set(['
    : (kind === 'obj' ? 'const ' + name + ' = {' : 'const ' + name + ' = [');
  const s = src.indexOf(needle);
  if (s < 0) return null;
  if (kind === 'set') { const e = src.indexOf(']);', s); return e < 0 ? null : [s, e + 3]; }
  if (kind === 'obj') {
    let d = 0, i = s + needle.length - 1;
    for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) break; } }
    return [s, src[i + 1] === ';' ? i + 2 : i + 1];
  }
  const e = src.indexOf('];', s);
  return e < 0 ? null : [s, e + 2];
}

function push(name, list, kind) {
  kind = kind || 'pairs';
  const r = bounds(name, kind);
  if (!r) { report.push('  ' + name.padEnd(20) + ' MISSING'); return; }
  const oldTxt = src.slice(r[0], r[1]).replace(/^const \w+ = /, '').replace(/;$/, '');
  let old = vm.runInNewContext('(' + oldTxt + ')');
  if (TAG.call(old) === '[object Set]') old = Array.from(old);
  let oldList = old;   /* 會正規化（純字串→配對），不能用 const */
  let fresh, merged, body, decl;
  if (kind === 'pairs') {
    /* 純字串自動轉成配對（舊格式相容）—— 否則程式取 x[0] 會拿到單一個字，在全文亂命中 */
    const norm = function (arr) { return arr.map(function (x) { return Array.isArray(x) ? x : [x, x + '特寫']; }); };
    list = norm(list); oldList = norm(oldList);
    /* 鍵可能是 RegExp（PLACE_TEX_BY_NAME）—— 用字串化比對，不然物件身分不同會去重失效 */
    const seen = new Set(oldList.map(function (x) { return String(x[0]); }));
    const inBatch = new Set();
    fresh = list.filter(function (x) {
      const k = String(x[0]);
      if (seen.has(k) || inBatch.has(k)) return false;   /* 批次內也要去重 */
      inBatch.add(k);
      return true;
    });
    if (!fresh.length) { skip(name); return; }
    merged = fresh.concat(oldList);
    /* 結果整體去重（新條目優先保留）—— 舊陣列自己可能有重複，
       只比對「新 vs 舊」會把舊的重複原封不動留下來 */
    const seenAll = new Set();
    merged = merged.filter(function (x) {
      const k = String(x[0]);
      if (seenAll.has(k)) return false;
      seenAll.add(k); return true;
    });
    merged.sort(function (a, b) { return b[0].length - a[0].length; });
    body = merged.map(function (x) { return '  ' + js(x); }).join(',\n');
    decl = 'const ' + name + ' = [\n' + body + '\n];';
  } else {
    const seen = new Set(oldList);
    fresh = list.filter(function (x) { return !seen.has(x); });
    if (!fresh.length) { skip(name); return; }
    merged = fresh.concat(oldList);
    body = merged.map(function (x) { return '  ' + js(x); }).join(',\n');
    decl = kind === 'set' ? 'const ' + name + ' = new Set([\n' + body + '\n]);'
      : 'const ' + name + ' = [\n' + body + '\n];';
  }
  src = src.slice(0, r[0]) + decl + src.slice(r[1]);
  report.push('  ' + name.padEnd(20) + ' +' + fresh.length + ' 新／' + (list.length - fresh.length) +
    ' 重複 → 共 ' + merged.length + ' 條');
}

function mergePool(name, add) {
  const r = bounds(name, 'obj');
  if (!r) { report.push('  ' + name.padEnd(20) + ' MISSING'); return; }
  const oldTxt = src.slice(r[0], r[1]).replace(/^const \w+ = /, '').replace(/;$/, '');
  const old = vm.runInNewContext('(' + oldTxt + ')');
  function mix(o, n) {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const out = {};
      Array.from(new Set(Object.keys(o).concat(Object.keys(n || {})))).forEach(function (k) {
        out[k] = (o[k] !== undefined && n && n[k] !== undefined) ? mix(o[k], n[k]) : (o[k] !== undefined ? o[k] : n[k]);
      });
      return out;
    }
    if (Array.isArray(o) && Array.isArray(n)) { const s = new Set(o); return o.concat(n.filter(function (x) { return !s.has(x); })); }
    return o !== undefined ? o : n;
  }
  const merged = mix(old, add);
  if (JSON.stringify(merged) === JSON.stringify(old)) { skip(name); return; }
  /* 葉節點可能是陣列（造型池）也可能是字串（別名表）—— 一律算 1 條，
     否則字串會拿 .length 去加，報告會變成「幾個字」而不是「幾條」。 */
  const cnt = function (d) { let c = 0; for (const k in d) c += (d[k] && typeof d[k] === 'object') ? cnt(d[k]) : 1; return c; };
  src = src.slice(0, r[0]) + 'const ' + name + ' = ' + js(merged) + ';' + src.slice(r[1]);
  report.push('  ' + name.padEnd(20) + cnt(old) + ' → ' + cnt(merged) + ' 項');
}

push('ROLE_WORDS', NEW.ROLE_WORDS || [], 'plain');   /* 核心裡是陣列不是 Set */
push('NAME_TITLES', NEW.NAME_TITLES || [], 'plain');
push('FULL_NAMES', NEW.FULL_NAMES || [], 'plain');   /* 文本中直接出現、但位置規則拿不到的完整人名 */
mergePool('NAME_ALIASES', NEW.NAME_ALIASES || {});    /* 別名 → 主要名稱 */
push('FAMILY_WORDS', Array.from(NEW.FAMILY_WORDS || []), 'set');
mergePool('HAIR', NEW.HAIR || {});
mergePool('OUTFITS', NEW.OUTFITS || {});
push('FACE_SHAPES', NEW.FACE_SHAPES || [], 'plain');
push('EYES', NEW.EYES || [], 'plain');
push('MARK_POOL', NEW.MARK_POOL || [], 'pairs');
push('PLACE_TEX_BY_NAME', NEW.PLACE_TEX_BY_NAME || [], 'pairs');
mergePool('SCENE_TEXTURE', NEW.SCENE_TEXTURE || {});
mergePool('SCENE_LIGHT', NEW.SCENE_LIGHT || {});
push('SCENE_SEASON', NEW.SCENE_SEASON || [], 'plain');
['ACTION_PHRASES','FACE_PHRASES','TRAIT_PHRASES','LIGHT_PHRASES','TIME_JUMP','NOUN_VISUALS'].forEach(function (v) {
  push(v, NEW[v] || [], 'pairs');
});
push('OBJ_CLOSEUP', NEW.OBJ_CLOSEUP || [], 'pairs');   /* 已是配對陣列（純字串會被自動補成配對） */

/* ROLE_OUTFIT_HINTS：核心本來就有一份寫死的表，所以多數情況是「併入」不是「新插」。
   舊版只在核心沒有這份表時才寫入 —— 詞庫檔寫了會被**靜默丟掉**（連報告行都沒有，
   實測加了黑衣騎士的服裝卻在核心找不到）。併入時只在陣列尾端追加，不重排既有
   條目，避免把人工排版的那一大行整份洗掉。
   順序有意義（先命中先贏），所以新條目排在最後＝不會搶走既有身份的服裝。 */
if (NEW.ROLE_OUTFIT_HINTS && NEW.ROLE_OUTFIT_HINTS.length) {
  const r = bounds('ROLE_OUTFIT_HINTS', 'plain');
  if (!r) {
    src = src.replace('/* ── 造型建議（髮型／臉型／服裝／辨識記憶點）──',
      '/* 身份 -> 固定服裝（資料驅動，比寫死的 regex 好維護） */\nconst ROLE_OUTFIT_HINTS = ' +
      js(NEW.ROLE_OUTFIT_HINTS) + ';\n\n/* ── 造型建議（髮型／臉型／服裝／辨識記憶點）──', 1);
    report.push('  ' + 'ROLE_OUTFIT_HINTS'.padEnd(20) + ' +' + NEW.ROLE_OUTFIT_HINTS.length + ' 條（新插）');
  } else {
    const oldTxt = src.slice(r[0], r[1]).replace(/^const \w+ = /, '').replace(/;$/, '');
    const old = vm.runInNewContext('(' + oldTxt + ')');
    const seen = new Set(old.map(function (e) { return String(e[0]); }));
    const fresh = NEW.ROLE_OUTFIT_HINTS.filter(function (e) { return !seen.has(String(e[0])); });
    if (!fresh.length) { skip('ROLE_OUTFIT_HINTS'); }
    else {
      const e = r[1] - 2;   /* 指向收尾的 ']' */
      src = src.slice(0, e) + ', ' + fresh.map(js).join(', ') + src.slice(e);
      report.push('  ' + 'ROLE_OUTFIT_HINTS'.padEnd(20) + ' +' + fresh.length +
        ' 新身份 → 共 ' + (old.length + fresh.length) + ' 條');
    }
  }
}

console.log(report.join('\n'));
const dry = process.argv.indexOf('--dry') >= 0;
const out = dry ? '/tmp/core-merged.js' : CORE;
fs.writeFileSync(out, src);
console.log('\n' + (dry ? '（dry run）' : 'OK 已寫入 ') + out + '，' + src.length + ' 字元');
