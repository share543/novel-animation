#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""詞庫採礦 v2：用 jieba 詞性標註，從真實小說挖出「詞庫還沒有」的候選詞。

為什麼不用純 regex：中文沒有詞界，「高聲說道」的 regex 前綴會抓出「高聲」這種副詞。
jieba 的詞性標註（nr 人名／ns 地名／v 動詞／a 形容詞）能精準擋掉副詞與代名詞。

用法：env -u PYTHONPATH /usr/bin/python3 mine-lex.py 檔1.txt [檔2.txt ...] [--top 40]
輸出：候選清單（只產候選，不自動改詞庫）
"""
import json, re, sys, collections
import jieba, jieba.posseg as pseg

args = sys.argv[1:]
TOP = 40
files = []
i = 0
while i < len(args):
    if args[i] == '--top':
        TOP = int(args[i + 1]); i += 2; continue
    files.append(args[i]); i += 1
if not files:
    print('用法：mine-lex.py 檔1.txt [檔2.txt ...] [--top 40]'); sys.exit(2)

lex = json.load(open('/tmp/lex.json', encoding='utf-8'))
known_roles = set(lex['roles']) | set(lex['family']) | set(lex['titles'])
known_action = set(lex['pairs']['ACTION_PHRASES'])
known_face = set(lex['pairs']['FACE_PHRASES']) | set(lex['pairs']['TRAIT_PHRASES'])
known_light = set(lex['pairs']['LIGHT_PHRASES'])
known_noun = set(lex['pairs']['NOUN_VISUALS']) | set(lex['pairs']['OBJ_CLOSEUP'])
place_alts = []
for pat in lex['pairs']['PLACE_TEX_BY_NAME']:
    place_alts.extend([a for a in pat.strip('/').split('|') if len(a) > 1])
known_place = set(place_alts)

text = ''
for f in files:
    text += open(f, encoding='utf-8').read() + '\n'
han = len(re.findall(r'[\u4e00-\u9fff]', text))
print('語料：%d 篇 / %d 漢字\n' % (len(files), han))

# jieba 詞性標註（一次就好，後面重複使用）
tokens = [(p.word, p.flag) for p in pseg.cut(text) if re.search(r'[\u4e00-\u9fff]', p.word)]

SPEECH = {'說道','說','問','答','回答','喊道','叫道','笑道','喝道','回道','答道','問道','開口','接著說','插嘴'}
MOVE = {'走進','走出','推開','拿起','放下','低頭','抬頭','轉身','點頭','搖頭','坐下','站起','伸手','看著','望了'}
SKIP_FLAG = set('rdtcpumqeyozxf')       # 副詞/代名詞/時間/連詞/介詞/助詞/數詞/量詞…

def is_content(flag):
    return not (set(flag) & SKIP_FLAG)

def is_verb(flag):
    return flag.startswith('v') and flag != 'vn'

def is_adj(flag):
    return flag.startswith('a') and flag != 'an'

# 候選要附例句，人才判斷得出「這是不是畫面語言」
SENTS = [s for s in re.split(r'[。！？\n]', text) if len(s) > 4]
def example(w):
    for s in SENTS:
        i = s.find(w)
        if i >= 0:
            a = max(0, i - 12); b = min(len(s), i + len(w) + 12)
            return ('…' if a else '') + s[a:b] + ('…' if b < len(s) else '')
    return ''

role = collections.Counter()
place = collections.Counter()
act = collections.Counter()
face = collections.Counter()

for k in range(len(tokens) - 1):
    w, f = tokens[k]
    nxt = tokens[k + 1][0]
    # A 角色：出現在「說道／走進」等動詞前面的名詞（排除代名詞與副詞）
    if is_content(f) and ('n' in f or 'j' in f) and nxt in (SPEECH | MOVE) and 2 <= len(w) <= 4:
        role[w] += 1
    # B 場所：地名標籤，或「X裡／X上」X 為名詞
    if 'ns' in f and 2 <= len(w) <= 4:
        place[w] += 1
    elif is_content(f) and 'n' in f and 2 <= len(w) <= 4 and nxt in ('裡','裏','內','中','上','外','口','前','後','旁'):
        place[w] += 1
    # C 動作：純動詞（vn 是動名詞，像「運動／工作」不是畫面動作）
    if is_verb(f) and 2 <= len(w) <= 3:
        act[w] += 1
    # D 表情／氣質：純形容詞（an 是形容詞動名詞）
    if is_adj(f) and 2 <= len(w) <= 3:
        face[w] += 1
    if w in ('神情','臉色','表情','神色','面色') and 2 <= len(nxt) <= 3:
        face[nxt] += 1

def top(counter, known, minfreq, extra_filter=None):
    out = []
    for w, n in counter.most_common():
        if n < minfreq or w in known or len(w) < 2:
            continue
        if extra_filter and not extra_filter(w):
            continue
        out.append((w, n))
        if len(out) >= TOP:
            break
    return out

ROLE_SUFFIX = re.compile(r'(員|師|手|官|長|匠|販|醫|警|兵|賊|客|漢|婆|嫂|嬸|叔|伯|爺|姊|妹|哥|弟|夫|婦|生|士|倌|侍|童|佬|仔|頭|頭子|老闆|先生|太太|小姐|夫人)$')
new_role = top(role, known_roles, 2, lambda w: bool(ROLE_SUFFIX.search(w)) or len(w) <= 3)
new_place = top(place, known_place, 2)
new_act = top(act, known_action, 3)
new_face = top(face, known_face, 3)

def show(title, arr):
    print('## %s（%d 條）' % (title, len(arr)))
    for w, n in arr:
        print('   %-6s ×%-3d  %s' % (w, n, example(w)))
    print()

show('A. 角色／身份候選', new_role)
show('B. 場所候選', new_place)
show('C. 動作詞候選', new_act)
show('D. 表情／氣質候選', new_face)

json.dump({'role': new_role, 'place': new_place, 'act': new_act, 'face': new_face},
          open('/tmp/mine.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('候選 JSON：/tmp/mine.json')
