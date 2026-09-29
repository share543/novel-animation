#!/usr/bin/env python3
"""把 storyboard.html 的「小說匯入」模組區塊，與 repo 的 src/ 來源重新組裝。
   教訓：來源改了一定要重新組裝，否則出貨的是舊版。
   來源一律取 repo 的 src/（唯一真實來源）—— 先前讀 scratch 的複本，
   合併脚本卻寫 src/，兩邊不同步就會默默出貨舊版。"""
import sys, re, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / 'storyboard.html'
CORE = (ROOT / 'src' / 'novel-import-core.js').read_text(encoding='utf-8').strip()
UI = (ROOT / 'src' / 'novel-import-ui.js').read_text(encoding='utf-8').strip()
PDF = (ROOT / 'src' / 'novel-import-pdf.js').read_text(encoding='utf-8').strip()

START = '/* ═══════════ 小說匯入（純離線：讀檔 → 抽取 → 產生專案） ═══════════'
END = '/* ═══════════ tabs ═══════════ */'

src = HTML.read_text(encoding='utf-8')
i, j = src.find(START), src.find(END)
if i < 0 or j < 0 or j <= i:
    print(f'❌ 找不到區塊邊界（start={i}, end={j}）'); sys.exit(1)
old = src[i:j]
print(f'舊區塊 {len(old):,} 字元，新區塊 {len(CORE) + len(PDF) + len(UI) + 4:,} 字元')

new = CORE + '\n\n' + PDF + '\n\n' + UI + '\n\n'
src = src[:i] + new + src[j:]
HTML.write_text(src, encoding='utf-8')
print(f'✅ 已同步，storyboard.html 共 {len(src):,} 字元')

# 立即驗證
blocks = re.findall(r'<script[^>]*>(.*?)</script>', src, re.S)
for k, b in enumerate(blocks):
    p = f'/tmp/rsync{k}.js'
    pathlib.Path(p).write_text(b, encoding='utf-8')
    r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
    print(f'  script[{k}] 語法: ' + ('✅ 通過' if r.returncode == 0 else '❌ ' + r.stderr[:200]))
    if r.returncode: sys.exit(1)
for name in ['joinWrapped', 'NOT_NAME_START', 'hardSplit', 'analyzeNovel', 'applyNovel', 'decodeText', 'docxToXml', 'pdfToText', 'parseCMap', 'collectRuns']:
    print(f'  {name}: {"✅" if name in src else "❌ 缺少"}')
