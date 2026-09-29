/* ═══════════ PDF 文字抽取（純原生，無任何函式庫）═══════════
   PDF 的內文常常不是 Unicode，而是字型子集的自訂碼（CID）。
   「抽出文字」= 解析內容流 → 追蹤當前字型 → 套用該字型的 ToUnicode CMap。

   實測踩到的四個關鍵：
   1. 每個字型子集各自使用同一段碼域（0x00–0xFF）指向不同字，混用 CMap 會得到亂碼
      → 必須逐字型切換，不能合併成一張表
   2. /Resources 可能是「行內字典」而非間接參照 → 要用括號配對抓，lazy regex 會提早收尾
   3. 設計工具／PowerPoint 匯出的 PDF 是絕對定位，內容流順序 ≠ 閱讀順序
      → 必須記下每個文字段的 (x, y) 再依座標排序（但雙欄要另外處理）
   4. 合約／信封類 PDF 把文字放在 Form XObject 裡（/Fm0 Do）
      → 不遞迴進去就會整段漏掉

   stream 資料長度要用 /Length，不能靠 endstream 反推再 strip 結尾換行 ——
   壓縮資料本身可能正好以 \n 結尾，會被剃掉導致解不開。

   做不到的情況會偵測並回報，不假裝成功：
   - 掃描版（純圖）→ 純原生沒有 OCR
   - 沒有 ToUnicode 的 CID 字型 → 只能得到亂碼 */

/* PDF 結構語法都是 Latin-1；用 charCode 一對一對應，才能對 bytes 跑 regex。 */
function toLatin1(u8) {
  const CH = 8192;
  let s = '';
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return s;
}

/* FlateDecode：PDF 用 zlib 流；少數檔案是 raw deflate，兩種都試。 */
async function inflate(u8) {
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream(fmt));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch (e) { /* 換下一種 */ }
  }
  return null;
}

function ascii85(u8) {
  const out = []; let n = 0, t = 0;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    if (c === 126) break;
    if (c <= 32) continue;
    if (c === 122 && n === 0) { out.push(0, 0, 0, 0); continue; }
    t = t * 85 + (c - 33);
    if (++n === 5) { out.push((t >>> 24) & 255, (t >>> 16) & 255, (t >>> 8) & 255, t & 255); n = 0; t = 0; }
  }
  if (n) { for (let k = n; k < 5; k++) t = t * 85 + 84; out.push((t >>> 24) & 255, (t >>> 16) & 255, (t >>> 8) & 255, t & 255); }
  return new Uint8Array(out.slice(0, out.length - (n ? 4 - n : 0)));
}

function asciiHex(u8) {
  const s = toLatin1(u8).split('>')[0].replace(/[^0-9A-Fa-f]/g, '');
  const out = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/* 沒有 ToUnicode 的簡單字型（Type1／TrueType）回退用的標準編碼。
   WinAnsiEncoding 是 PDF 檢視器的通用回退，pdftotext 也是這樣做。 */
const WINANSI = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰',
  0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ'
};
function stdChar(code) {
  if (code >= 0x20 && code <= 0x7E) return String.fromCharCode(code);
  if (WINANSI[code]) return WINANSI[code];
  if (code >= 0xA0 && code <= 0xFF) return String.fromCharCode(code);
  return undefined;
}

function matMul(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function numArr(s, n) {
  const v = String(s).trim().split(/\s+/).map(Number);
  return v.length === n && v.every(Number.isFinite) ? v : null;
}

/* ── 物件索引：直接掃 "N 0 obj"，不依賴 xref（xref 壞掉也能讀）── */
function indexObjects(lat) {
  const objs = new Map();
  const re = /(?<![0-9])(\d+)\s+(\d+)\s+obj\b/g;
  const hits = [];
  let m;
  while ((m = re.exec(lat))) hits.push({ num: +m[1], at: m.index, body: m.index + m[0].length });
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].at : lat.length;
    objs.set(hits[i].num, { body: lat.slice(hits[i].body, end) });
  }
  return objs;
}

/* 只取 stream 之前的字典部分，避免把二進位內文誤判成語法 */
function dictOf(o) {
  if (!o || typeof o.body !== 'string') return '';
  const i = o.body.indexOf('stream');
  return i < 0 ? o.body : o.body.slice(0, i);
}
function refOf(dict, key) {
  const m = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R').exec(dict);
  return m ? +m[1] : null;
}
function refsOf(dict, key) {
  const m = new RegExp('/' + key + '\\s*\\[(.*?)\\]', 's').exec(dict);
  return m ? (m[1].match(/(\d+)\s+\d+\s+R/g) || []).map(x => +x.match(/\d+/)[0]) : [];
}
/* 取 /Key 後面的行內字典「內容」（括號配對，不能用會提早收尾的 lazy regex） */
function subDict(text, key) {
  const i = new RegExp('/' + key + '\\s*<<').exec(text);
  if (!i) return null;
  const p = i.index + i[0].length - 2;
  let depth = 0;
  for (let k = p; k < text.length - 1; k++) {
    if (text[k] === '<' && text[k + 1] === '<') { depth++; k++; }
    else if (text[k] === '>' && text[k + 1] === '>') { depth--; k++; if (depth === 0) return text.slice(p + 2, k - 1); }
    else if (text[k] === 'e' && text.startsWith('endobj', k)) break;
  }
  return null;
}
function resOf(dict, objs) {
  const r = refOf(dict, 'Resources');
  if (r !== null && objs.has(r)) return dictOf(objs.get(r));
  return subDict(dict, 'Resources');
}

/* 解出物件的 stream（支援 Flate / ASCIIHex / ASCII85，可鏈結） */
async function streamBytes(objs, num) {
  const o = objs.get(num);
  if (!o) return null;
  const i = o.body.indexOf('stream');
  if (i < 0) return null;
  let s = i + 6;
  if (o.body[s] === '\r') s++;
  if (o.body[s] === '\n') s++;
  /* 優先用 /Length 決定資料長度（見檔頭說明） */
  let len = -1;
  const lm = /\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dictOf(o));
  if (lm) {
    if (lm[2] !== undefined) {
      const lo = objs.get(+lm[1]);
      const n2 = lo ? /^\s*(\d+)/.exec(dictOf(lo)) : null;
      if (n2) len = +n2[1];
    } else len = +lm[1];
  }
  let end;
  if (len > 0 && s + len <= o.body.length) end = s + len;
  else {
    end = o.body.indexOf('endstream', s);
    if (end < 0) end = o.body.length;
    if (o.body[end - 1] === '\n') end--;               /* 只去掉緊接的那一個換行 */
    if (o.body[end - 1] === '\r') end--;
  }
  const data = o.body.slice(s, end);
  let u8 = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) u8[k] = data.charCodeAt(k) & 255;
  const filt = dictOf(o).match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/);
  const names = filt ? (filt[1].match(/\/(\w+)/g) || []).map(x => x.slice(1)) : [];
  for (const f of names) {
    if (f === 'FlateDecode') u8 = await inflate(u8);
    else if (f === 'ASCIIHexDecode') u8 = asciiHex(u8);
    else if (f === 'ASCII85Decode') u8 = ascii85(u8);
    else return { unsupported: f };
    if (!u8) return null;
  }
  return { bytes: u8, text: toLatin1(u8) };
}

/* ── ToUnicode CMap（bfchar + bfrange，含陣列型目的；碼長依 codespacerange）── */
function parseCMap(txt) {
  const map = new Map();
  let twoByte = false;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(txt);
  if (cs) twoByte = /<[0-9A-Fa-f]{4}>/.test(cs[1]);
  const u = hex => { let s = ''; for (let i = 0; i + 3 < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16)); return s; };
  let blk;
  const reChar = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((blk = reChar.exec(txt))) {
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = pair.exec(blk[1]))) map.set(parseInt(p[1], 16), u(p[2]));
  }
  const reRange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((blk = reRange.exec(txt))) {
    const s = blk[1];
    const re3 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = re3.exec(s))) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16), d0 = parseInt(p[3], 16);
      for (let k = lo; k <= Math.min(hi, lo + 4095); k++) map.set(k, String.fromCharCode(d0 + (k - lo)));
    }
    const reArr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    while ((p = reArr.exec(s))) {
      const lo = parseInt(p[1], 16);
      (p[3].match(/<([0-9A-Fa-f]+)>/g) || []).forEach((d, i) => map.set(lo + i, u(d.slice(1, -1))));
    }
  }
  return { map: map, twoByte: twoByte };
}

/* ── 由某個資源字典建立「字型名 → CMap」對照 ＋ XObject 對照 ── */
async function buildCmaps(resText, objs) {
  const out = { cmaps: {}, xobjs: {}, fonts: 0, cmapsCount: 0, simpleFonts: 0 };
  let fdictText = '';
  const fref = refOf(resText, 'Font');
  if (fref !== null && objs.has(fref)) fdictText = dictOf(objs.get(fref));
  else {
    const m = subDict(resText, 'Font');
    fdictText = m !== null ? m : (/\/Font\s*<<([\s\S]*?)>>/.exec(resText) || [, ''])[1];
  }
  const reF = /\/([A-Za-z0-9#]+)\s+(\d+)\s+\d+\s+R/g;
  let fm;
  while ((fm = reF.exec(fdictText))) {
    const name = fm[1].replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const fo = objs.get(+fm[2]);
    out.fonts++;
    if (!fo) continue;
    const d = dictOf(fo);
    const isCID = /\/Subtype\s*\/(Type0|CIDFontType0|CIDFontType2)/.test(d);
    let tu = refOf(d, 'ToUnicode');
    if (tu === null) {
      for (const x of refsOf(d, 'DescendantFonts')) {
        const t2 = refOf(dictOf(objs.get(x)), 'ToUnicode');
        if (t2 !== null) { tu = t2; break; }
      }
    }
    /* 沒有 ToUnicode 時的可靠度判斷：
       真正的拉丁文字型 FirstChar 一定 >= 32；若落在控制字元區（老舊中文產生器
       把 CJK 子集偽裝成 Type1 就是這樣），拿 WinAnsi 回退只會得到亂碼，
       必須把這些字標成 suspect，而不是當成正常輸出。 */
    const fc = /\/FirstChar\s+(\d+)/.exec(d);
    const reliable = fc ? +fc[1] >= 32 : true;
    if (tu === null) {
      /* 沒有 ToUnicode：CID 字型無解；簡單字型用標準編碼回退 */
      out.cmaps[name] = { map: new Map(), twoByte: false, simple: !isCID, reliable: reliable && !isCID };
      if (!isCID) out.simpleFonts++;
      continue;
    }
    const st = await streamBytes(objs, tu);
    const cm = st && st.text ? parseCMap(st.text) : { map: new Map(), twoByte: false };
    if (cm.map.size) { out.cmapsCount++; out.cmaps[name] = cm; }
    else out.cmaps[name] = { map: new Map(), twoByte: false, simple: !isCID };
  }
  /* XObject 資源（Form 表單） */
  const xref = refOf(resText, 'XObject');
  if (xref !== null && objs.has(xref)) fdictText = dictOf(objs.get(xref));
  else fdictText = subDict(resText, 'XObject') || '';
  const reX = /\/([A-Za-z0-9#]+)\s+(\d+)\s+\d+\s+R/g;
  while ((fm = reX.exec(fdictText))) {
    const name = fm[1].replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const xo = objs.get(+fm[2]);
    if (xo && /\/Subtype\s*\/Form/.test(dictOf(xo))) out.xobjs[name] = +fm[2];
  }
  return out;
}

/* ── 內容流：產出「有座標的文字段」，之後才能依視覺順序重排。
      遞迴處理 Form XObject（/Fm0 Do）—— 合約、信封類 PDF 常把文字放在表單物件裡。 ── */
async function collectRuns(txt, opt) {
  const cmaps = opt.cmaps, objs = opt.objs, xobjs = opt.xobjs || {};
  const base = opt.base || [1, 0, 0, 1, 0, 0];
  const depth = opt.depth || 0;
  const runs = [];
  let font = null, tm = [1, 0, 0, 1, 0, 0], ctm = [1, 0, 0, 1, 0, 0], leading = 0;
  let cur = '', cx = null, cy = null, mapped = 0, unmapped = 0, suspect = 0;
  const stack = [];
  const flush = () => {
    if (cur.trim() && cx !== null) runs.push({ x: cx, y: cy, text: cur });
    cur = ''; cx = null;
  };
  /* 文字段的位置只用 tm（＋ Form 的 Matrix 位移），刻意「不」套 CTM：
     設計工具匯出常用 cm 做 y 翻轉（1 0 0 -1 …），套上去會讓 y 排序整個上下顛倒，
     反而把閱讀順序弄壞（實測：某表格檔 82% → 35%）。 */
  const start = () => { if (cx === null) { const p = matMul(tm, base); cx = p[4]; cy = p[5]; } };
  const put = ch => { start(); cur += ch; };
  const cm = () => cmaps[font] || { map: new Map(), twoByte: false, simple: true };
  /* 回退路徑（字型沒有 ToUnicode）產生的字另外計數：
     可靠字型的回退沒問題（正常英文 PDF 就是這樣），
     不可靠字型的回退是亂碼，不能算成「成功對照」。 */
  const emit = (code, c) => {
    if (c.simple) {
      const ch = stdChar(code);
      if (ch === undefined) { unmapped++; return; }
      if (c.reliable === false) suspect++; else mapped++;
      put(ch);
      return;
    }
    let ch = c.map.get(code);
    if (ch === undefined) {
      ch = stdChar(code);
      if (ch === undefined) { unmapped++; return; }
      suspect++; put(ch); return;
    }
    mapped++; put(ch);
  };
  const showHex = h => {
    const c = cm(), step = c.twoByte ? 4 : 2;
    for (let i = 0; i + step - 1 < h.length; i += step) emit(parseInt(h.substr(i, step), 16), c);
  };
  const showLit = lit => {
    const s = lit.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) =>
      c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c === 'b' ? '\b' : c === 'f' ? '\f'
        : /^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c);
    const c = cm();
    for (let i = 0; i < s.length; i++) emit(s.charCodeAt(i), c);
  };

  const N = '(-?[\\d.]+)\\s+';
  const re = new RegExp(
    '(\\/[A-Za-z0-9#]+)\\s+([\\d.]+)\\s+Tf' +          /* 1,2 字型 */
    '|' + N + N + '(Td|TD)' +                          /* 3,4,5 相對位移 */
    '|' + N.repeat(6) + '(Tm|cm)' +                    /* 6..11,12 文字矩陣／CTM */
    '|\\[((?:[^\\[\\]\\\\]|\\\\.)*)\\]\\s*TJ' +        /* 13 TJ */
    '|<([0-9A-Fa-f\\s]*)>\\s*Tj' +                     /* 14 十六進位字串 */
    '|\\(((?:\\\\.|[^)\\\\])*)\\)\\s*Tj' +             /* 15 字面字串 */
    '|' + N + 'TL' +                                   /* 16 leading */
    '|(\\/[A-Za-z0-9#]+)\\s+Do' +                      /* 17 XObject */
    "|(?<![\\w\\/])(q|Q|T\\*|'|BT|ET)(?![\\w])"        /* 18 其他：需邊界守衛，否則字串內容裡的 Q 會誤命中 */
    , 'g');
  let m;
  while ((m = re.exec(txt))) {
    if (m[1]) {
      flush();
      font = m[1].slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    } else if (m[5]) { flush(); tm = matMul([1, 0, 0, 1, +m[3], +m[4]], tm); }
    else if (m[12] === 'Tm') { flush(); const v = numArr(txt.slice(m.index, m.index + m[0].length).replace(/Tm/, ''), 6); tm = v || tm; }
    else if (m[12] === 'cm') { flush(); const v = numArr(txt.slice(m.index, m.index + m[0].length).replace(/cm/, ''), 6); if (v) ctm = matMul(v, ctm); }
    else if (m[13] !== undefined) {
      const re2 = /<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^)\\])*)\)|(-?[\d.]+)/g;
      let p, pend = null;
      while ((p = re2.exec(m[13]))) {
        if (p[1] !== undefined) { if (pend !== null && pend < -180) put(' '); showHex(p[1].replace(/\s+/g, '')); }
        else if (p[2] !== undefined) showLit(p[2]);
        else pend = parseFloat(p[3]);
      }
    }
    else if (m[14] !== undefined) showHex(m[14].replace(/\s+/g, ''));
    else if (m[15] !== undefined) showLit(m[15]);
    else if (m[16] !== undefined) leading = +m[16];
    else if (m[17] !== undefined) {                     /* /Name Do → 進入 Form 表單 */
      flush();
      if (depth < 6) {
        const xn = m[17].slice(1).replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        const xref = xobjs[xn];
        if (xref !== undefined && objs.has(xref)) {
          const xd = dictOf(objs.get(xref));
          const st = await streamBytes(objs, xref);
          if (st && st.text) {
            const mx = numArr((/\/Matrix\s*\[([^\]]+)\]/.exec(xd) || [, ''])[1], 6) || [1, 0, 0, 1, 0, 0];
            const sub = { cmaps: cmaps, objs: objs, xobjs: {}, base: matMul(mx, base), depth: depth + 1 };
            const xres = resOf(xd, objs);
            if (xres !== null) {
              const b = await buildCmaps(xres, objs);
              if (Object.keys(b.cmaps).length) sub.cmaps = b.cmaps;
              sub.xobjs = b.xobjs;
            }
            const r2 = await collectRuns(st.text, sub);
            for (const r of r2.runs) runs.push(r);
            mapped += r2.mapped; unmapped += r2.unmapped; suspect += r2.suspect || 0;
          }
        }
      }
    }
    else if (m[18]) {
      if (m[18] === 'q') stack.push(ctm.slice());
      else if (m[18] === 'Q') ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (m[18] === 'BT') { flush(); tm = [1, 0, 0, 1, 0, 0]; }
      else if (m[18] === 'T*' || m[18] === "'") { flush(); tm = matMul([1, 0, 0, 1, 0, -leading], tm); }
    }
  }
  flush();
  return { runs: runs, mapped: mapped, unmapped: unmapped, suspect: suspect };
}

/* 兜底檢查：抽出來的東西像不像正常文字。
   判據用「WinAnsi 特殊字元區的密度」，這是實測出來的乾淨分界：
   正常檔（中文／英文論文／ER 圖）皆為 0.000；被硬解的中文 PDF 是 0.13 以上。
   這種字元只有在把 CJK 碼硬套 WinAnsi 對照時才會冒出來。
   另外要求字母比例偏低，避免法德文之類帶重音的正常文件被誤判。 */
function looksGarbled(t) {
  const s = t.replace(/\s+/g, '');
  if (s.length < 200) return false;
  const n = s.length;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length / n;
  if (cjk > 0.1) return false;                       /* 有中文 → 正常 */
  const odd = (s.match(/[\u201a\u0192\u201e\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178\u00a0-\u00ff]/g) || []).length / n;
  const letters = (s.match(/[A-Za-z]/g) || []).length / n;
  return odd > 0.05 && letters < 0.6;
}

/* 依視覺順序把文字段接成行。
   設計工具匯出的 PDF 內容流順序常常不是閱讀順序，一定要重排；
   但雙欄論文單純依 y 排會把兩欄交錯，所以要先偵測欄界。 */
function runsToText(runs) {
  if (!runs.length) return '';
  /* 去重：有些 PDF 用「同位置緊接著重畫一次」模擬粗體，不去重會變成「富富昇昇」。
     只比對「相鄰」的段落 —— 用全域 Set 會把表格裡合法重複的字砍掉（實測某表覆蓋率 100%→56%）。 */
  const uniq = [];
  for (const r of runs) {
    const p = uniq[uniq.length - 1];
    if (p && p.text === r.text && Math.abs(p.x - r.x) < 1 && Math.abs(p.y - r.y) < 1) continue;
    uniq.push(r);
  }
  runs = uniq;
  const tol = 2.4;
  const sorted = runs.slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const groups = [];
  let cur = null;
  for (const r of sorted) {
    if (!cur || Math.abs(r.y - cur.y) > tol) {
      if (cur) groups.push(cur);
      cur = { y: r.y, parts: [r] };
    } else cur.parts.push(r);
  }
  if (cur) groups.push(cur);
  for (const g of groups) g.parts.sort((a, b) => a.x - b.x);

  const textOf = parts => parts.map(p => p.text).join('').replace(/\s+$/, '');
  /* 偵測欄界：空隙必須相對於頁面寬度「夠大」才算分欄。
     用固定門檻會被單欄文本的詞間距騙到（實測：單欄小說被誤判成雙欄）。 */
  const xs = runs.map(r => r.x);
  const width = Math.max(...xs) - Math.min(...xs);
  const gapMin = Math.max(30, width * 0.18);
  const tally = {};
  for (const g of groups) {
    for (let i = 1; i < g.parts.length; i++) {
      const gap = g.parts[i].x - g.parts[i - 1].x;
      if (gap > gapMin) {
        const k = Math.round(g.parts[i].x / 40) * 40;
        tally[k] = (tally[k] || 0) + 1;
      }
    }
  }
  let cut = null, best = 0;
  for (const k in tally) if (tally[k] > best) { best = tally[k]; cut = +k; }
  const twoCol = cut !== null && best >= Math.max(4, groups.length * 0.35);
  if (!twoCol) return groups.map(g => textOf(g.parts)).join('\n');

  /* 每一行依欄界切成左右兩段，再「左欄全部」後「右欄全部」 */
  const left = [], right = [];
  for (const g of groups) {
    const l = g.parts.filter(p => p.x < cut - 20), r = g.parts.filter(p => p.x >= cut - 20);
    if (l.length) left.push(textOf(l));
    if (r.length) right.push(textOf(r));
  }
  if (left.length < 3 || right.length < 3) return groups.map(g => textOf(g.parts)).join('\n');
  return left.concat(right).join('\n');
}

/* ── 主流程 ── */
async function pdfToText(buf) {
  const u8 = new Uint8Array(buf);
  if (toLatin1(u8.subarray(0, 5)) !== '%PDF-') return { status: 'not-pdf', text: '' };
  const objs = indexObjects(toLatin1(u8));
  await expandObjStm(objs);

  let pageNums = [];
  const cat = findFirst(objs, /\/Type\s*\/Catalog/);
  const root = cat ? refOf(dictOf(cat), 'Pages') : null;
  if (root) pageNums = collectPages(objs, root, 0);
  if (!pageNums.length) {
    for (const [n, o] of objs) if (/\/Type\s*\/Page[^s]/.test(dictOf(o))) pageNums.push(n);
    pageNums.sort((a, b) => a - b);
  }

  const allPages = [];
  let mapped = 0, unmapped = 0, suspect = 0, fontCount = 0, cmapCount = 0, simpleFonts = 0, unsupported = null;

  for (const pn of pageNums) {
    const pdict = dictOf(objs.get(pn));
    /* /Resources 可能是間接參照或行內字典；真的都沒有才往 /Parent 找（屬性可繼承） */
    let resText = resOf(pdict, objs);
    if (resText === null) {
      let d = pdict, guard = 0;
      while (guard++ < 16) {
        const par = refOf(d, 'Parent');
        if (!par || !objs.has(par)) break;
        d = dictOf(objs.get(par));
        const r2 = resOf(d, objs);
        if (r2 !== null) { resText = r2; break; }
      }
    }
    if (resText === null) resText = pdict;             /* 保底 */

    const built = await buildCmaps(resText, objs);
    fontCount += built.fonts; cmapCount += built.cmapsCount; simpleFonts += built.simpleFonts;

    const cs = refOf(pdict, 'Contents');
    const sources = cs !== null ? [cs] : refsOf(pdict, 'Contents');
    const runs = [];
    for (const c of sources) {
      const st = await streamBytes(objs, c);
      if (!st) continue;
      if (st.unsupported) { unsupported = st.unsupported; continue; }
      const r = await collectRuns(st.text, { cmaps: built.cmaps, objs: objs, xobjs: built.xobjs });
      mapped += r.mapped; unmapped += r.unmapped; suspect += r.suspect || 0;
      runs.push(...r.runs);
    }
    const t = runsToText(runs);
    if (t.trim()) allPages.push(t);
  }

  const text = allPages.join('\n\n');
  let status = 'ok', note = '';
  if (unsupported) {
    status = 'unsupported';
    note = '這個 PDF 的內文用了 ' + unsupported + ' 壓縮，離線版無法解開。';
  } else if (suspect > 30 && suspect > mapped * 0.25) {
    /* 字型沒有 Unicode 對照表，靠標準編碼硬解 → 出來是亂碼。
       這種 PDF（老舊中文產生器把 CJK 子集偽裝成 Type1）連 pdftotext 都抽不出來。 */
    status = 'garbled';
    note = '這個 PDF 的文字層是壞的：內文用了沒有 Unicode 對照表的字型，硬解只會得到亂碼。' +
      '好消息是頁面本身通常很清楚 —— 用 OCR，或在閱讀器全選複製。';
  } else if (looksGarbled(text)) {
    status = 'garbled';
    note = '抽出來的內容不像正常文字（可能是字型對照表損壞）。' +
      '建議用 OCR，或在閱讀器全選複製後貼上來。';
  } else if (unmapped > 200 && mapped < unmapped * 0.35) {
    status = 'no-unicode';
    note = '這個 PDF 的字型沒有 ToUnicode 對照表，抽出來會是亂碼（老舊中文產生器常見）。';
  } else if (!text.trim()) {
    status = 'scanned';
    note = '抽不到任何文字 —— 這應該是掃描版（整頁是圖片），需要 OCR 才辦得到。';
  }
  return {
    status: status, note: note, text: status === 'ok' ? text : '', sample: text.slice(0, 300),
    pages: pageNums.length, fonts: fontCount,
    cmaps: cmapCount, simpleFonts: simpleFonts, mapped: mapped, unmapped: unmapped, suspect: suspect
  };

  function findFirst(objs, re) {
    for (const [, o] of objs) if (re.test(dictOf(o))) return o;
    return null;
  }
  function collectPages(objs, num, depth) {
    if (depth > 40) return [];
    const o = objs.get(num);
    if (!o) return [];
    const d = dictOf(o);
    if (/\/Type\s*\/Page[^s]/.test(d)) return [num];
    const kids = refsOf(d, 'Kids');
    if (!kids.length) return [];
    let out = [];
    for (const k of kids) out = out.concat(collectPages(objs, k, depth + 1));
    return out;
  }
  async function expandObjStm(objs) {
    const targets = [];
    for (const [n, o] of objs) if (/\/Type\s*\/ObjStm/.test(dictOf(o))) targets.push(n);
    for (const n of targets) {
      const st = await streamBytes(objs, n);
      if (!st || !st.text) continue;
      const d = dictOf(objs.get(n));
      const N = +(/(?:^|[^0-9])N\s+(\d+)/.exec(d) || [, 0])[1];
      const First = +(/(?:^|[^0-9])First\s+(\d+)/.exec(d) || [, 0])[1];
      if (!N || !First) continue;
      const nums = st.text.slice(0, First).trim().split(/\s+/).map(Number);
      for (let i = 0; i < N; i++) {
        const onum = nums[i * 2], off = nums[i * 2 + 1];
        if (onum === undefined) break;
        if (objs.has(onum)) continue;
        const start = First + off;
        const next = i + 1 < N ? First + nums[(i + 1) * 2 + 1] : st.text.length;
        objs.set(onum, { body: st.text.slice(start, next) });
      }
    }
  }
}
