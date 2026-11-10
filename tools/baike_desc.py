# -*- coding: utf-8 -*-
"""
用百度百科词条摘要补齐缺失的「发行信息」。
仅补 descriptions.json 里还没有的品种，并标注 source=baike。
"""
import json, re, ssl, time, urllib.parse, urllib.request

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

CN2NUM = {'三十五': '35', '四十': '40', '五十': '50', '三十': '30', '二十': '20',
          '七十': '70', '六十': '60', '八十': '80', '九十': '90', '十': '10'}


def card(term):
    u = ('https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json'
         '&appid=379020&bk_key=%s&bk_length=600' % urllib.parse.quote(term))
    try:
        req = urllib.request.Request(u, headers={'User-Agent': UA, 'Referer': 'https://baike.baidu.com/'})
        return json.loads(urllib.request.urlopen(req, timeout=15, context=ctx).read().decode('utf-8', 'ignore'))
    except Exception:
        return {}


def variants(name):
    base = name.replace('——', ' ').replace('“', '').replace('”', '').strip()
    out = [base + '纪念币', base]

    # 中文数字 → 阿拉伯数字 的写法
    ar = base
    for k, v in CN2NUM.items():
        ar = ar.replace(k, v)
    if ar != base:
        out += [ar + '纪念币', ar]

    # 去掉括号注释
    plain = re.sub(r'[（(].*?[)）]', '', base).strip()
    if plain and plain != base:
        out += [plain + '纪念币', plain]
    return [x for x in dict.fromkeys(out) if x]


def core(name):
    n = re.sub(r'[（(].*?[)）]', '', name)
    if '——' in n:
        return n.split('——')[-1].strip()
    if '·' in n:
        return n.split('·')[-1].strip()
    return n.strip()


def main():
    coins = json.load(open('public/data/coins.json', encoding='utf-8'))['coins']
    desc = json.load(open('public/data/descriptions.json', encoding='utf-8'))
    todo = [c for c in coins if str(c['i'] + 1) not in desc]
    print('待补 %d 个品种' % len(todo))

    added = 0
    for idx, c in enumerate(todo, 1):
        no = str(c['i'] + 1)
        key = core(c['name'])
        got = None
        for term in variants(c['name']):
            j = card(term)
            title = (j.get('title') or '').strip()
            abstract = (j.get('abstract') or '').strip()
            if not title or len(abstract) < 40:
                continue
            # 校验：标题或摘要里要能对上这个品种
            if key and (key in title or key in abstract):
                got = {
                    'title': title,
                    'url': j.get('url') or ('https://baike.baidu.com/item/' + urllib.parse.quote(title)),
                    'text': abstract,
                    'date': (re.search(r'(\d{4})年', abstract).group(0) if re.search(r'(\d{4})年', abstract) else ''),
                    'source': 'baike'
                }
                break
            time.sleep(0.2)
        if got:
            desc[no] = got
            added += 1
            print('  [%2d/%d] ✓ %-26s ← %s' % (idx, len(todo), c['name'][:24], got['title'][:18]))
        else:
            print('  [%2d/%d] ✗ %s' % (idx, len(todo), c['name'][:28]))
        time.sleep(0.2)

    json.dump(desc, open('public/data/descriptions.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    n_b = sum(1 for v in desc.values() if v.get('source') == 'baike')
    print('\n新增 %d 条；总计 %d 条（官方公告 %d / 百科 %d）'
          % (added, len(desc), len(desc) - n_b, n_b))


if __name__ == '__main__':
    main()
