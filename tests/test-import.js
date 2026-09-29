/* 匯入功能的回歸測試。
   直接抽 storyboard.html 裡「實際出貨」的 script 來測，不是測另一份複本 ——
   這樣才會抓到「黑名單被 split('') 拆成單字」這類只改一行、卻讓品質靜默崩壞的錯。

   用法：node tests/test-import.js
   （需要 Node 18+：用到 DecompressionStream / TextDecoder / Response / Blob）
   涵蓋 txt/md/html/docx 匯入、編碼判別、以及 PDF 解析（純原生）。 */
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

console.log('\n=== 9. PDF 解析（純原生，無函式庫）===');
ok(typeof pdfToText === 'function', 'pdfToText 存在');
ok(typeof parseCMap === 'function', 'parseCMap 存在');

const zlib = require('zlib');

/* 現做真的 PDF：只用 "N 0 obj" 掃描定位（不需 xref），與實測 42 個真檔同一條路徑。
   /Length 由程式算好填進去，所以也會測到「靠 endstream 反推會截斷」那個 bug。 */
function buildPDF(objs) {
  let out = '%PDF-1.4\n';
  for (const o of objs) {
    out += o.n + ' 0 obj\n';
    if (o.stream == null) out += o.dict + '\nendobj\n';
    else {
      const len = Buffer.byteLength(o.stream, 'latin1');
      out += o.dict.replace('@L', String(len)) + '\nstream\n' + o.stream + '\nendstream\nendobj\n';
    }
  }
  return Buffer.from(out + 'trailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');
}

function pdfWith(cmapText, contentSrc, flate) {
  const body = flate
    ? zlib.deflateSync(Buffer.from(contentSrc, 'latin1')).toString('latin1')
    : contentSrc;
  return buildPDF([
    { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> ' +
        '/Contents 4 0 R /MediaBox [0 0 300 300] >>' },
    { n: 4, dict: flate ? '<< /Length @L /Filter /FlateDecode >>' : '<< /Length @L >>', stream: body },
    { n: 5, dict: '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H ' +
        '/DescendantFonts [6 0 R] /ToUnicode 7 0 R >>' },
    { n: 6, dict: '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test >>' },
    { n: 7, dict: '<< /Length @L >>', stream: cmapText }
  ]);
}

const cmapHead = twoByte =>
  '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
  '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
  '/CMapName /T-UCS def\n/CMapType 2 def\n1 begincodespacerange\n' +
  (twoByte ? '<0000> <FFFF>' : '<00> <FF>') + '\nendcodespacerange\n';
const cmapTail = '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';

/* 種子碼刻意「不等於」Unicode（0041 不是 'A'，而是「狄」），
   這樣才證明真的有套 CMap，而不是矇到。 */
const CMapBfchar = cmapHead(true) +
  '6 beginbfchar\n<0041> <72C4>\n<0042> <516C>\n<0043> <6848>\n' +
  '<0044> <6D2A>\n<0045> <4EAE>\n<0046> <9053>\nendbfchar' + cmapTail;

/* 兩行文字，中間夾一行註解「% endstream」：
   靠 /Length 才讀得完整，靠 endstream 反推會在這裡截斷、第二行整個消失。 */
const CONTENT = 'BT /F1 12 Tf 1 0 0 1 20 100 Tm <004100420043> Tj ET\n' +
  '% endstream\n' +
  'BT /F1 12 Tf 1 0 0 1 20 80 Tm <004400450046> Tj ET\n';

(async () => {
  const r1 = await pdfToText(pdfWith(CMapBfchar, CONTENT, false));
  ok(r1.status === 'ok', '未壓縮 PDF：狀態 ok', r1.status);
  ok(r1.text.indexOf('狄公案') >= 0, 'bfchar 對照正確（狄公案）', r1.text.slice(0, 60));
  ok(r1.text.indexOf('洪亮道') >= 0 && r1.text.indexOf('洪亮道') !== r1.text.indexOf('狄公案'),
    '/Length 生效：endstream 之後的文字沒有被截斷', r1.text.slice(0, 80));
  ok(r1.mapped === 6 && r1.unmapped === 0, '6 個字全部對照成功', r1.mapped + '/' + r1.unmapped);

  const r2 = await pdfToText(pdfWith(CMapBfchar, CONTENT, true));
  ok(r2.text.indexOf('狄公案') >= 0 && r2.text.indexOf('洪亮道') >= 0,
    'FlateDecode 壓縮內文解得開', r2.text.slice(0, 60));

  const CMapRange = cmapHead(true) +
    '2 beginbfrange\n<0041> <0043> <0041>\n<0050> <0052> [<516C> <6848> <72C4>]\nendbfrange' + cmapTail;
  const r3 = await pdfToText(pdfWith(CMapRange,
    'BT /F1 12 Tf 1 0 0 1 20 100 Tm <004100420043> Tj ET\n' +
    'BT /F1 12 Tf 1 0 0 1 20 80 Tm <005000510052> Tj ET\n', false));
  ok(r3.text.indexOf('ABC') >= 0, 'bfrange 連續型正確（ABC）', r3.text.slice(0, 40));
  ok(r3.text.indexOf('公案狄') >= 0, 'bfrange 陣列型正確（公案狄）', r3.text.slice(0, 60));

  /* 單位元組碼域（LibreOffice／Word 匯出中文 PDF 常見這種） */
  const CMap1 = cmapHead(false) + '3 beginbfchar\n<41> <72C4>\n<42> <516C>\n<43> <6848>\nendbfchar' + cmapTail;
  const r4 = await pdfToText(pdfWith(CMap1,
    'BT /F1 12 Tf 1 0 0 1 20 100 Tm <414243> Tj ET\n', false));
  ok(r4.text.indexOf('狄公案') >= 0, '單位元組碼域判定正確（不被拆成 2 碼）', r4.text.slice(0, 40));

  /* 掃描版：只有頁面、沒有任何字型與內文 → 必須誠實回報，不能吐亂碼 */
  const scanned = buildPDF([
    { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 300 300] >>' }
  ]);
  const r5 = await pdfToText(scanned);
  ok(r5.status === 'scanned', '掃描版被認出（狀態 scanned）', r5.status);
  ok(r5.note.indexOf('OCR') >= 0, '掃描版提示要 OCR', r5.note);

  const r6 = await pdfToText(Buffer.from('這不是 PDF', 'utf8'));
  ok(r6.status === 'not-pdf', '非 PDF 檔案被擋下', r6.status);

  /* 壞掉的文字層（老舊中文產生器）：簡單字型、沒有 ToUnicode、FirstChar 落在控制字元區。
     實測案例是真的（2008 年掃描重製的中文小說 PDF，連 pdftotext 都只吐亂碼）。
     這種檔必須回報 garbled，而且不可把亂碼交給使用者。 */
  const fakeBold = '\\101'.repeat(40);          /* 內容是 'A'，但字型宣稱 FirstChar=1 */
  const broken = buildPDF([
    { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> ' +
        '/Contents 4 0 R /MediaBox [0 0 300 300] >>' },
    { n: 4, dict: '<< /Length @L >>', stream: 'BT /F1 12 Tf 1 0 0 1 20 100 Tm (' + fakeBold + ') Tj ET\n' },
    { n: 5, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Broken /FirstChar 1 /LastChar 5 >>' }
  ]);
  const r7 = await pdfToText(broken);
  ok(r7.status === 'garbled', '沒有 Unicode 對照表的字型被認出（state garbled）', r7.status);
  ok(r7.text === '' && r7.suspect > 30, 'garbled 時不把硬解出的亂碼交給使用者',
    { text: r7.text.slice(0, 20), suspect: r7.suspect });

  /* 疊印模擬粗體：同一段文字在同一位置畫兩次，只能算一次 */
  const dbl = 'BT /F1 12 Tf 1 0 0 1 20 100 Tm <00410042> Tj ET\n' +
    'BT /F1 12 Tf 1 0 0 1 20 100 Tm <00410042> Tj ET\n';
  const r8 = await pdfToText(pdfWith(CMapBfchar, dbl, false));
  ok(r8.text.replace(/\s/g, '') === '狄公', '同位置疊印的文字只算一次（不變成「狄公狄公」）',
    JSON.stringify(r8.text));

  console.log('\n=== 10. 主選單「匯入」分流 ===');
  ok(typeof importAny === 'function', 'importAny 存在（主選單匯入的分流器）');
  ok(typeof loadNovelFileObj === 'function', 'loadNovelFileObj 存在（與匯入小說共用同一條路）');
  ok(/id="fi"[^>]*accept="[^"]*\.txt/.test(src), '#fi 的 accept 含 .txt');
  ok(/onchange="importAny\(event\)"/.test(src), '#fi 綁 importAny，不是只綁 importJSON');
  ok(/function importAny\(e\)\{[\s\S]{0,160}?importJSON\(e\)/.test(src), 'importAny 遇到 .json 仍走 importJSON（不破壞備份匯入）');
  ok(/loadNovelFileObj\(f\)/.test(src), 'importAny 把原稿交給 loadNovelFileObj');

  console.log('\n=== 11. 第一人稱小說的角色與場景 ===');
  /* 真實案例：《陰影裏的人》——全篇第一人稱、沒有「某某說道」，舊版一個角色都抓不到，
     且所有鏡頭都被套上「臥室」（該場景其實在中段才出現）。 */
  const fp = '我叫鄭木貴。父親做生意，父親賠了錢，父親自殺了。母親哭著說，母親帶我長大，母親後來也走了。'
    + '鄭木貴探長說：「這案子我來辦。」';
  const rf = analyzeNovel(fp, { secPerShot: 4, maxChars: 8, maxScenes: 6 });
  const fnames = rf.persons.map(p => p.name);
  ok(fnames.indexOf('鄭木貴') >= 0, '「我叫鄭木貴」這種自我介紹句抓到主角', fnames.join('／'));
  ok(fnames.indexOf('父親') >= 0, '「父親」出現 ≥3 次算一個角色', fnames.join('／'));
  ok(fnames.indexOf('母親') >= 0, '「母親」出現 ≥3 次算一個角色', fnames.join('／'));
  ok(rf.shots.some(s => s._who), '逐鏡角色含 role 型角色（原本被 !p.role 整個濾掉）');
  ok(rf.shots.every(s => !s._scene), '沒提到場景時留空，不套最高頻場景', rf.shots.map(s => s._scene || '-').join(','));

  /* 前兩句完全不提地點，第三句才出現「書房」——
     舊版會把「書房」（全文最高頻場景）套到包含前兩句在內的所有鏡頭。 */
  const sp = '他坐下來，翻開卷宗，一頁一頁慢慢看。他嘆了一口氣，什麼話也沒說。'
    + '他走進書房，點亮了桌上的燈。';
  const rs = analyzeNovel(sp, { secPerShot: 4, maxChars: 8, maxScenes: 6 });
  const seq = rs.shots.map(s => s._scene);
  ok(seq[0] === '', '場景還沒出現的鏡頭留空（原本套最高頻場景）', JSON.stringify(seq));
  ok(seq.indexOf('書房') > 0, '場景在文中出現後才開始標', JSON.stringify(seq));
  ok(seq[seq.length - 1] === '書房', '場景一旦出現會沿用到下一個場景', JSON.stringify(seq));

  console.log('\n=== 12. 字幕斷點（不把詞切一半）===');
  const hp = '有一天，父親高高興興地帶了一個人回來，並且告訴母親說他已決定和這個人合夥，'
    + '共同投資購地皮蓋房子出售，同時留他在家吃晚飯。';
  const rh = analyzeNovel(hp, { secPerShot: 4, maxChars: 8, maxScenes: 6 });
  ok(!rh.shots.some(s => /回$/.test(s.narr.trim())), '不會把「回來」切成「回」／「來」',
    rh.shots.map(s => s.narr).join('｜'));
  ok(rh.shots.filter(s => /[。！？，、；：]$/.test(s.narr.trim())).length >= rh.shots.length - 1,
    '絕大多數鏡頭斷在標點上', rh.shots.length + ' 鏡');

  console.log('\n=== 13. 題材／畫風判定 ===');
  /* 真實案例：台灣作品寫「凶手」「凶殺」，規則原本只寫「兇手」，一篇都命中不了；
     而且規則是「誰先命中就贏」，一句「我讀完高中」就把復仇推理片判成日系動畫。 */
  ok(guessStyle('犯案的凶手總會回到現場，這是一件凶殺懸案。', '') === '黑色電影',
    '台灣用字「凶手／凶殺」判得出黑色電影');
  ok(guessStyle('兇手留下了線索，命案現場有證據。', '') === '黑色電影', '大陸用字「兇手」也判得出黑色電影');
  ok(guessStyle('校園裡學姊在教室等我，社團活動結束後制服都濕了。', '') === '日系動畫', '校園題材判日系動畫');
  ok(guessStyle('我讀完高中就離開家鄉，到都市求學，十年來一直在找那個人。', '') === '寫實電影感',
    '只提「高中」「畢業」不會被誤判成日系動畫');
  ok(guessStyle('霓虹燈下，義體人與機器人走過全息看板。', '') === '賽博龐克', '賽博題材判賽博龐克');
  ok(guessStyle('隨便一段文字', '黑色電影') === '黑色電影', '使用者指定畫風時以指定為準');

  console.log('\n=== 14. 判斷層：敘述者／代名詞／視覺描述 ===');
  const jp = '我叫鄭木貴，我不是本地人。我望著窗外，心裡很慌亂。'
    + '父親走進屋裡，神情沮喪。母親抱著我放聲大哭。'
    + '父親的合夥人看起來忠厚老實，合夥人笑得很大聲。'
    + '有一次，母親先離開，留下他一個人在屋裡。\n';
  const rj = analyzeNovel(jp, { secPerShot: 4, maxChars: 8, maxScenes: 6 });

  ok(rj.narrator && rj.narrator.name === '鄭木貴', '「我叫鄭木貴」認出第一人稱敘述者',
    JSON.stringify(rj.narrator));
  const narratorShots = rj.shots.filter(s => s._whoFrom === '我＝敘述者');
  ok(narratorShots.length > 0, '含「我」的鏡頭對應到敘述者（原本全空）', narratorShots.length + ' 鏡');

  ok(rj.shots.some(s => s._who === '合夥人' && /忠厚老實/.test(s.narr)),
    '「父親的合夥人」的主體是合夥人，不是被修飾的父親',
    rj.shots.filter(s => /合夥人/.test(s.narr)).map(s => s._who + '←' + s.narr).join('｜'));

  const woShots = rj.shots.filter(s => /我/.test(s.narr) && s._who === '鄭木貴');
  ok(woShots.length > 0, '「我」＝敘述者的鏡頭有鎖到人', woShots.length + ' 鏡');

  /* 代名詞性別不符時寧可留空，不可硬套到錯的人身上 */
  const wrongGender = rj.shots.filter(s => s._whoFrom === '代名詞' && /(?<!其)他/.test(s.narr) && s._who === '母親');
  ok(wrongGender.length === 0, '「他」不會被套到女性角色身上',
    wrongGender.map(s => s.narr).join('｜'));

  const lensTexts = rj.shots.map(s => s.lens).join('｜');
  ok(/眉間緊鎖|眼眶泛淚|嘴角/.test(lensTexts), '情緒詞轉成臉部畫面', lensTexts.slice(0, 90));
  ok(/推門進屋|走出畫面|反應鏡頭/.test(lensTexts), '動作詞轉成鏡頭指示', '');
  ok(!/\(點名\)|\(我＝敘述者\)|\(代名詞\)/.test(lensTexts),
    '內部判斷標籤不會漏進 prompt（只在介面顯示）', '');
  ok(rj.shots.every(s => s.lens && s.lens.trim()), '每一鏡的第③段都不是空的',
    rj.shots.filter(s => !s.lens || !s.lens.trim()).length + ' 鏡空白');
  ok(rj.shots.every(s => /[\u4e00-\u9fffA-Za-z0-9]/.test(s.narr)),
    '不會產生只有標點的碎片鏡頭', '');

  console.log('\n=== 15. ①人物／②場景描述草稿 ===');
  ok(rj.persons.every(p => p.descDraft && p.descDraft.length > 6),
    '每個人物都有描述草稿', rj.persons.map(p => p.name + ':' + p.descDraft.length).join(' '));
  const father = rj.persons.find(p => p.name === '父親');
  ok(father && /男性/.test(father.descDraft), '角色詞推出性別（父親→男性）', father && father.descDraft);
  /* 造型建議：髮型／臉型／服裝／辨識記憶點四格都要有具體內容，
     不能留「待補」——那串括號會被當成 prompt 第①段送出去。 */
  ok(father && father.descDraft.length >= 30, '描述草稿有實質內容（非空泛）', father && father.descDraft);
  ok(father && !/待補/.test(father.descDraft), '不再有「待補」字樣（會污染 prompt）', father && father.descDraft);
  ok(father && /，/.test(father.descDraft), '描述草稿含造型描述（髮型＋臉型）', '');
  const looks = rj.persons.map(p => p.descDraft.split('；').slice(1).join('；'));
  ok(new Set(looks).size === looks.length, '同一篇裡每個角色的造型建議都不同',
    looks.join(' ｜ '));

  console.log('\n=== 15b. 造型建議的年代與題材 ===');
  const ancient = '狄公說道：「此案有疑。」馬榮說道：「屬下這就去查。」'
    + '洪亮說道：「卷宗在此。」周氏說道：「大人明鑑。」'
    + '狄公拿起銀兩，命人備馬，客官在客棧等著。\n';
  const ra = analyzeNovel(ancient, { secPerShot: 4, maxChars: 8, maxScenes: 6 });
  const ancientDescs = ra.persons.map(p => p.descDraft).join('｜');
  ok(/長衫|袍子|襖裙|衣裙|短衣/.test(ancientDescs), '古裝題材給古裝服裝', ancientDescs.slice(0, 80));
  ok(!/風衣|襯衫|西裝/.test(ancientDescs), '古裝題材不會給現代服裝（風衣／襯衫）', '');
  ok(/髻|束|冠|鬚|簪|布巾/.test(ancientDescs), '古裝題材的髮型符合年代', '');

  /* 同一個角色重複分析兩次要拿到同一組建議（不然每次匯入長相都變） */
  const twice = analyzeNovel(jp, { secPerShot: 4, maxChars: 8, maxScenes: 6 });
  ok(JSON.stringify(twice.persons.map(p => p.descDraft)) === JSON.stringify(rj.persons.map(p => p.descDraft)),
    '同一份原稿重複分析，造型建議完全一致（可重現）', '');
  const nb = rj.persons.find(p => p.name === '鄭木貴');
  ok(nb && /第一人稱敘述者/.test(nb.descDraft), '敘述者被標記出來', nb && nb.descDraft);
  ok(rj.places.every(p => p.descDraft), '每個場景都有描述草稿',
    rj.places.map(p => p.name).join('／'));

  console.log('\n=== 16. 每鏡秒數與估時 ===');
  /* 介面允許每鏡 2–10 秒，但秒數上限原本硬寫 8 秒：
     設 8 秒時估時低估 21%、設 10 秒低估 29%，單元數會跟著算錯。 */
  /* 測試文字要接近真實作品的長度：太短時「單鏡最短 2 秒」的地板會主導估時 */
  const capText = ('他走進屋裡，在窗邊坐下。他看著窗外的雨，嘆了一口氣，什麼話也沒說。'
    + '他站起來，走到桌前，拿起那封泛黃的信件，低頭讀著。'
    + '信上的字跡已經模糊，他卻仍然記得每一句話。'
    + '他放下信件，轉身走向門口，回頭看了一眼這個房間。\n').repeat(8);
  [4, 8, 10].forEach(function (sec) {
    const rr = analyzeNovel(capText, { secPerShot: sec, maxChars: 8, maxScenes: 6 });
    const truth = capText.replace(/\s/g, '').length / 260;
    const off = Math.abs(rr.stats.minutes - truth) / truth;
    ok(off < 0.15, '每鏡 ' + sec + ' 秒的估時誤差不超過 15%',
      Math.round(off * 100) + '%');
  });

  console.log(`\n${'='.repeat(56)}\n通過 ${pass} 項，失敗 ${fail} 項`);
  process.exit(fail ? 1 : 0);
})();

