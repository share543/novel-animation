/* ═══════════ 匯入小說的 UI 串接 ═══════════ */
let novelRes = null;

function nfMsg(html, bad) {
  const el = $('#nf-msg');
  el.innerHTML = html
    ? '<div class="note"' + (bad ? ' style="border-left-color:var(--red);background:rgba(232,68,122,.10)"' : '') + '>' + html + '</div>'
    : '';
}

function nfStat(v, k) { return '<div class="stat"><b>' + v + '</b><span>' + k + '</span></div>'; }

function readOpt() {
  return {
    secPerShot: Math.max(2, Math.min(10, num($('#nf-sec').value, 4) || 4)),
    maxChars: Math.max(1, Math.min(20, num($('#nf-chars').value, 8) || 8)),
    maxScenes: Math.max(1, Math.min(12, num($('#nf-scenes').value, 6) || 6))
  };
}

function loadNovelFile(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  loadNovelFileObj(f);
}

/* 真正處理檔案的入口。抽出來是因為主選單的「匯入」按鈕也要用同一條路
   （.json 走專案備份，其餘文字格式當小說原稿）。 */
function loadNovelFileObj(f) {
  const low = f.name.toLowerCase();
  if (low.endsWith('.doc')) {
    nfMsg('舊版 <b>.doc</b> 是二進位格式，無法離線解析。請在文書軟體另存為 <b>.docx</b>，或把全文複製貼到下面的框。', true);
    return;
  }
  nfMsg('讀取中…');
  const rd = new FileReader();
  rd.onerror = () => nfMsg('讀取失敗。', true);
  rd.onload = () => {
    const done = (text, enc) => {
      if (!text || !text.trim()) {
        nfMsg('這個檔案讀不到文字（可能是掃描圖檔、加密文件，或內容為空）。', true);
        $('#nf-file').textContent = '';
        return;
      }
      $('#nf-text').value = text;
      $('#nf-file').textContent = f.name + '｜' + enc + '｜' + text.length + ' 字';
      runAnalyze();
    };
    try {
      if (low.endsWith('.docx')) {
        docxToXml(rd.result)
          .then(xml => done(docxXmlToText(xml), '.docx 內文'))
          .catch(err => nfMsg('讀取 .docx 失敗：' + esc(err.message), true));
      } else if (low.endsWith('.pdf')) {
        /* 純原生解析：逐字型套 ToUnicode CMap。掃描版／無對照表會明確回報，不假裝成功。 */
        pdfToText(rd.result)
          .then(r => {
            if (r.status === 'ok') {
              done(r.text, 'PDF｜' + r.pages + ' 頁／' + r.fonts + ' 字型（' + r.cmaps + ' 個有對照表）');
            } else {
              nfMsg('這個 PDF <b>抽不到可用文字</b>：' + esc(r.note) +
                '<br><br>替代做法：用 PDF 閱讀器<b>全選複製</b>後貼到下面的框，效果一樣。', true);
              $('#nf-file').textContent = '';
            }
          })
          .catch(err => nfMsg('讀取 PDF 失敗：' + esc(err.message), true));
      } else if (low.endsWith('.html') || low.endsWith('.htm')) {
        const d = decodeText(rd.result);
        done(htmlToText(d.text), d.enc + ' → 去 HTML 標籤');
      } else {
        const d = decodeText(rd.result);
        done(d.text, d.enc);
      }
    } catch (err) {
      nfMsg('解析失敗：' + esc(err.message), true);
    }
  };
  rd.readAsArrayBuffer(f);
}

function runAnalyze() {
  const raw = $('#nf-text').value;
  if (raw.trim().length < 50) {
    nfMsg('文字太少（至少 50 字）。請先選檔，或把小說內容貼到上面的框。', true);
    $('#nf-apply').style.display = 'none';
    novelRes = null;
    return;
  }
  let res;
  try { res = analyzeNovel(raw, readOpt()); }
  catch (err) { nfMsg('分析失敗：' + esc(err.message), true); return; }
  res.styleName = guessStyle(normalizeNovel(raw), $('#nf-style').value);
  res.sourceName = ($('#nf-file').textContent.split('｜')[0] || '').replace(/\.(txt|md|markdown|html|htm|docx|pdf)$/i, '');
  novelRes = res;
  renderNovelReport(res);
  $('#nf-apply').style.display = '';
  nfMsg('');
}

function chipsOf(arr, withType) {
  if (!arr.length) return '<span style="color:var(--dim)">沒有偵測到</span>';
  return arr.map(x =>
    '<span style="display:inline-block;background:var(--card2);border:1px solid var(--line);border-radius:999px;' +
    'padding:3px 10px;margin:0 5px 5px 0;font-size:.82rem">' + esc(x.name) +
    ' <b style="color:var(--gold)">×' + x.count + '</b>' +
    (withType && x.type ? ' <span style="color:var(--dim)">' + x.type + '</span>' : '') + '</span>').join('');
}

function renderNovelReport(r) {
  const s = r.stats;
  const mm = Math.floor(s.totalDur / 60) + ':' + String(Math.round(s.totalDur % 60)).padStart(2, '0');
  const actual = Math.round(s.totalChars / (s.totalDur / 60));
  const off = Math.abs(actual - r.wpm) / r.wpm;
  const html =
    '<h2 class="sec">分析結果</h2>' +
    '<div class="srow">' + nfStat(s.chars, '小說字數') + nfStat(s.shots, '建議鏡頭') +
    nfStat(mm, '預估總長') + nfStat(s.units, '15 分鐘單元') +
    nfStat(actual, '實際字/分') + nfStat(r.styleName, '建議畫風') + '</div>' +
    (off > 0.1
      ? '<div class="note">⚠ 實際節奏 <b>' + actual + ' 字/分</b>與專案設定的 <b>' + r.wpm +
      ' 字/分</b>差 ' + Math.round(off * 100) + '%。調整「每鏡秒數」，或到總覽改旁白語速。</div>'
      : '') +
    '<h2 class="sec">👤 人物（' + r.persons.length + '）</h2><div>' + chipsOf(r.persons) + '</div>' +
    '<h2 class="sec">🏠 場景（' + r.places.length + '）</h2><div>' + chipsOf(r.places, true) + '</div>' +
    '<h2 class="sec">🎬 鏡頭表預覽（前 6 / 共 ' + r.shots.length + '）</h2>' +
    r.shots.slice(0, 6).map((x, i) =>
      '<div style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:9px 12px;' +
      'margin-bottom:7px;font-size:.85rem">' +
      '<b style="color:var(--gold)">#' + (i + 1) + '</b> ' + x.size + '／' + x.move + '／' + x.dur + 's' +
      (x._who ? '　角色：<b>' + esc(x._who) + '</b>' + (x._whoFrom ? '（' + esc(x._whoFrom) + '）' : '') : '') +
      (x._scene ? '　場景：<b>' + esc(x._scene) + '</b>' : '') +
      '<div style="margin-top:3px">' + esc(x.narr.slice(0, 64)) + '…</div>' +
      '<div style="color:var(--dim);margin-top:2px;font-size:.78rem">第③段草稿：' + esc(x.lens) + '</div></div>'
    ).join('') +
    '<div class="note">自動抽取是<b>草稿</b>：請到 <b>①人物</b>／<b>②場景</b> 刪掉誤判的、補上漏掉的，' +
    '並填<b>描述字串</b>（那兩段是鎖臉／鎖場景的關鍵，整部片要一致；可先調整再用）。' +
    '鏡頭表的<b>第③段</b>才是每個鏡頭要微調的地方。</div>';
  $('#nf-report').innerHTML = html;
}

/* ═══════════ 角色卡（跨分段、跨專案沿用同一批造型） ═══════════
   造型一旦定了就不要再讓工具重算：重算會讓同一個角色在不同分段變成不同的臉，
   而「鎖臉」正是整套流程的目的。所以角色以**名字**為鍵，同名一律沿用原卡。 */
function findByName(list, name) {
  for (const x of list) if (x.name === name) return x;
  return null;
}

function castCards() {
  return S.chars.map(function (c) {
    return { name: c.name, role: c.role || '', desc: c.desc || '',
      ref: c.ref || '', face: c.face, body: c.body };
  });
}

/* 匯出角色卡：可以匯進另一個專案（同一個作者、同一個推理宇宙共用一批演員） */
function exportCast() {
  if (!S.chars.length) { alert('目前沒有角色可以匯出。'); return; }
  dl('cast-lib.json', JSON.stringify({
    type: 'cast-lib', version: 1,
    title: (S.meta && S.meta.title) || '',
    exported: new Date().toISOString().slice(0, 10),
    chars: castCards()
  }, null, 2), 'application/json');
}

function importCast(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  const rd = new FileReader();
  rd.onerror = function () { alert('讀取角色卡失敗。'); };
  rd.onload = function () {
    let lib;
    try { lib = JSON.parse(rd.result); }
    catch (e) { alert('這個檔案不是角色卡（JSON 解析失敗）。'); return; }
    const cards = (lib && lib.chars) || (Array.isArray(lib) ? lib : null);
    if (!cards || !cards.length) { alert('角色卡裡沒有資料。'); return; }
    let upd = 0, add = 0;
    cards.forEach(function (card) {
      if (!card || !card.name) return;
      const old = findByName(S.chars, card.name);
      if (old) {
        /* 角色卡優先：卡上寫的造型就是要沿用的造型（含參考圖與強度） */
        old.role = card.role || old.role;
        old.desc = card.desc || old.desc;
        old.ref = card.ref || old.ref;
        if (card.face != null) old.face = card.face;
        if (card.body != null) old.body = card.body;
        upd++;
      } else {
        S.chars.push({ id: uid('c'), name: card.name, role: card.role || '', desc: card.desc || '',
          ref: card.ref || '', face: card.face != null ? card.face : .85,
          body: card.body != null ? card.body : .5 });
        add++;
      }
    });
    renderChars(); renderShots(); renderAll(); save();
    alert('角色卡匯入完成：沿用／更新 ' + upd + ' 個，新增 ' + add + ' 個。');
  };
  rd.readAsText(f, 'utf-8');
}

/* 分段名稱：用原始檔名（去掉 doc_<hash>_ 前綴與副檔名），方便對照是哪一份原稿 */
function unitLabelOf(r) {
  let n = (r.sourceName || '').replace(/^doc_[0-9a-f]{6,}_/i, '').replace(/_(OCR|ocr)$/, '');
  n = n.trim();
  if (!n) n = '原稿' + (unitList().length + 1);
  return n;
}

function applyNovel() {
  if (!novelRes) return;
  const r = novelRes;
  const label = unitLabelOf(r);
  const oldShots = S.shots.filter(function (s) { return (s.unit || '') === label; });
  if (oldShots.length && !confirm('分段「' + label + '」已經存在（' + oldShots.length +
    ' 個鏡頭，可能含你的手動修改）。\n\n要以這次的分析結果取代它嗎？\n' +
    '（同名角色仍會沿用原本的造型；其他分段完全不受影響）')) return;

  const cid = {}, sid = {}, added = [];

  /* ①人物：同名沿用角色卡，只對新角色產生建議 */
  r.persons.forEach(function (p) {
    const old = findByName(S.chars, p.name);
    if (old) { cid[p.name] = old.id; return; }
    const c = { id: uid('c'), name: p.name, role: p.role || '', desc: p.descDraft || '',
      ref: '', face: .85, body: .5 };
    S.chars.push(c); cid[p.name] = c.id; added.push(p.name);
  });

  /* ②場景：同名沿用 */
  r.places.forEach(function (p) {
    const old = findByName(S.scenes, p.name);
    if (old) { sid[p.name] = old.id; return; }
    const s = { id: uid('s'), name: p.name, type: p.type, desc: p.descDraft || '', ref: '', body: .65 };
    S.scenes.push(s); sid[p.name] = s.id;
  });

  /* ③鏡頭：只換掉同名分段的鏡頭，其他分段原封不動 */
  const keep = S.shots.filter(function (s) { return (s.unit || '') !== label; });
  const fresh = r.shots.map(function (x) {
    return { unit: label, narr: x.narr, size: x.size, move: x.move, dur: x.dur,
      charId: cid[x._who] || '', sceneId: sid[x._scene] || '', lens: x.lens, st: '🔄' };
  });
  S.shots = keep.concat(fresh);
  S.shots.forEach(function (s, i) { s.id = 'S' + String(i + 1).padStart(3, '0'); });

  /* 畫風只在第一段決定 —— 續接的分段要沿用同一個風格，不然整部片會花掉 */
  if (!keep.length) S.style = STYLE_PRESETS[r.styleName] || DEF_STYLE;
  if (S.meta.title === '我的小說動畫計畫' && r.sourceName) S.meta.title = r.sourceName;

  syncForm(); renderAll(); renderChars(); renderScenes(); renderSizes();
  save();
  const t = document.querySelector('nav.tabs button[data-p="shot"]');
  if (t) t.click();
  nfMsg('已套用分段「<b>' + esc(label) + '</b>」：<b>' + fresh.length + '</b> 個鏡頭。' +
    '專案目前共 <b>' + unitList().length + '</b> 段／<b>' + S.shots.length + '</b> 鏡、<b>' +
    S.chars.length + '</b> 個角色' +
    (added.length ? '（新增角色：<b>' + esc(added.join('、')) + '</b>）' : '（角色全部沿用原有造型）') +
    '。已跳到③鏡頭表。');
}
