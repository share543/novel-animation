#!/bin/bash
# 年代滲漏掃描：現代作品不得出現古裝材質；古裝作品不得出現現代科技。
# 每篇都先驗「真的分析出東西」（漢字數與鏡數），分析失敗時要大聲說失敗，
# 不能因為輸出是空的就報「乾淨」——那是假綠燈。
cd ~/novel-animation || exit 1
ANCIENT='油燈|燭台|燭火|燭光|蠟燭|燈籠|火把|長衫|馬車|轎|古木|石階|青磚|茅屋|城牆|匾額|宣紙|太師椅|屏風|銅鏡|衙門|客棧|戲台|紙窗'
MODERN='手機|電腦|螢幕|霓虹|停車場|機車|汽車|電話|電視|冰箱|冷氣|報紙|電燈|日光燈|保險'
FILES=$(ls ~/.hermes/cache/scratch/corpus/0*.txt 2>/dev/null)
[ -z "$FILES" ] && { echo "✗ 找不到語料（~/.hermes/cache/scratch/corpus/）—— 掃描沒有真的跑"; exit 1; }

scan () {   # $1=檔案  $2=要抓的異物樣式
  local out han scenes hits
  out=$(node tools/run-on-novel.js "$1" 2>&1)
  han=$(printf '%s' "$out" | grep -oE '[0-9]+ 漢字' | grep -oE '^[0-9]+' | head -1)
  scenes=$(printf '%s' "$out" | grep -oE '→ [0-9]+ 鏡' | grep -oE '[0-9]+' | head -1)
  if [ -z "$han" ] || [ -z "$scenes" ] || [ "$han" -lt 100 ] || [ "$scenes" -lt 5 ]; then
    echo "✗ 分析失敗（漢字 ${han:-0}／鏡 ${scenes:-0}）—— 這不是乾淨，是沒跑出東西"
    return
  fi
  hits=$(printf '%s' "$out" | grep -oE "$2" | sort -u | tr '\n' ' ')
  printf '%s（%s 字／%s 鏡）\n' "${hits:-✓ 乾淨}" "$han" "$scenes"
}

echo "── 現代作品（應為空：不得出現古裝材質）"
for f in $FILES; do printf '  %-16s ' "$(basename "$f" .txt)"; scan "$f" "$ANCIENT"; done
echo "── 古裝作品（應只出現古裝詞：不得出現現代科技）"
for f in ~/.hermes/cache/scratch/digong.txt; do
  [ -f "$f" ] || { echo "  ✗ 找不到 digong.txt（古裝語料不在，古裝這一半沒驗到）"; continue; }
  printf '  %-16s ' "$(basename "$f" .txt)"; scan "$f" "$MODERN"
done
