#!/bin/bash
# 年代滲漏掃描：現代作品不得出現古裝材質；古裝作品不得出現現代科技。
cd ~/novel-animation || exit 1
ANCIENT='油燈|燭台|燭火|燭光|蠟燭|燈籠|火把|長衫|馬車|轎|古木|石階|青磚|茅屋|城牆|匾額|宣紙|太師椅|屏風|衙門|客棧|戲台|紙窗'
MODERN='手機|電腦|螢幕|霓虹|停車場|機車|汽車|電話|電視|冰箱|冷氣|報紙|電燈|日光燈|保險'
echo "── 現代作品（應為空：不得出現古裝材質）"
for f in ~/.hermes/cache/scratch/corpus/0*.txt; do
  n=$(basename "$f" .txt)
  hits=$(node tools/run-on-novel.js "$f" 2>/dev/null | grep -oE "$ANCIENT" | sort -u | tr '\n' ' ')
  printf '  %-16s %s\n' "$n" "${hits:-✓ 乾淨}"
done
echo "── 古裝作品（應只出現古裝詞：不得出現現代科技）"
for f in ~/.hermes/cache/scratch/digong.txt; do
  hits=$(node tools/run-on-novel.js "$f" 2>/dev/null | grep -oE "$MODERN" | sort -u | tr '\n' ' ')
  printf '  %-16s %s\n' "$(basename "$f" .txt)" "${hits:-✓ 乾淨}"
done
