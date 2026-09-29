#!/usr/bin/env python3
"""把 storyboard.html 裡的「小說匯入」模組區塊，與 scratch 的核心檔重新同步。
   教訓：改了 scratch 的核心檔之後，一定要重新組裝，否則出貨的是舊版。"""
import sys, re, pathlib, subprocess

HTML = pathlib.Path('/home/arthur/novel-animation/storyboard.html')
CORE = pathlib.Path('/home/arthur/.hermes/cache/scratch/novel-import-core.js').read_text(encoding='utf-8').strip()
UI = pathlib.Path('/home/arthur/.hermes/cache/scratch/novel-import-ui.js').read_text(encoding='utf-8').strip()
PDF = pathlib.Path('/home/arthur/.hermes/cache/scratch/novel-import-pdf.js').read_text(encoding='utf-8').strip()

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
