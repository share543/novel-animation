#!/bin/bash
# 單檔離線工具的硬性稽核（README 記載的驗收方式）
cd /home/arthur/novel-animation || exit 1
echo "--- 硬性離線稽核（應全部為 0）---"
for p in 'https\?://' '<link' '@import' 'fetch(' 'XMLHttpRequest' 'type="module"' '<iframe' 'importScripts' 'WebSocket' 'sendBeacon' 'require(' 'cdn'; do
  printf '%-18s %s\n' "$p" "$(grep -c "$p" storyboard.html)"
done
echo "--- CSS url()（應為 0；排除 createObjectURL）---"
grep -oP '(?<![A-Za-z])url\(' storyboard.html | wc -l
echo "--- 外部資源屬性 ---"
grep -oE '(src|href)="[^"]*"' storyboard.html | sort -u
echo "--- 檔案大小 / script / style 區塊 ---"
wc -c storyboard.html
printf 'script 區塊: %s\n' "$(grep -c '<script' storyboard.html)"
printf 'style  區塊: %s\n' "$(grep -c '<style' storyboard.html)"
echo "--- JS 語法 ---"
python3 - <<'PY'
import re, pathlib, subprocess, sys
src = pathlib.Path('/home/arthur/novel-animation/storyboard.html').read_text(encoding='utf-8')
blocks = re.findall(r'<script[^>]*>(.*?)</script>', src, re.S)
ok = True
for i, b in enumerate(blocks):
    pathlib.Path(f'/tmp/chk{i}.js').write_text(b, encoding='utf-8')
    r = subprocess.run(['node', '--check', f'/tmp/chk{i}.js'], capture_output=True, text=True)
    print(f'  script[{i}]: ' + ('✅ 通過' if r.returncode == 0 else '❌ ' + r.stderr[:200]))
    ok = ok and r.returncode == 0
sys.exit(0 if ok else 1)
PY
