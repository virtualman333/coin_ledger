# -*- coding: utf-8 -*-
"""
从百度百科词条接口取每个品种的图片（用户授权使用第三方图源）。
对每个待补品种尝试多个检索词，校验「词条标题是否对得上」后才采用。

输出：_baike/<编号>.jpg + _baike/report.json
"""
import io, json, os, re, ssl, time, urllib.parse, urllib.request
from PIL import Image

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
OUT = '_baike'
os.makedirs(OUT, exist_ok=True)
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE


def get(url, timeout=15):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://baike.baidu.com/'})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()


def card(term):
    url = ('https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json'
           '&appid=379020&bk_key=%s&bk_length=600' % urllib.parse.quote(term))
    try:
        return json.loads(get(url).decode('utf-8', 'ignore'))
    except Exception:
        return {}


def core(name):
    """取用于校验的关键词：去掉系列前缀与括号注记"""
    n = re.sub(r'[（(].*?[)）]', '', name)
    if '·' in n:
        n = n.split('·')[-1]
    return n.strip()


def candidates(c):
    name, year = c['name'], str(c['year'])
    k = core(name)
    out = [
        name + '纪念币',
        k + '纪念币',
        k + '普通纪念币',
        name,
        k,
        name + '普通纪念币',
    ]
    # 生肖类补一条常见叫法
    m = re.match(r'^(\d{4})年贺岁（(.+?)）?', name)
    if m:
        out += [m.group(1) + '年贺岁普通纪念币', m.group(1) + '年贺岁纪念币']
        z = re.search(r'（(.+?)年?）', name)
    if '贺岁' in name:
        yy = re.search(r'（(\S+?)）', name)
        if yy:
            out.append(yy.group(1).replace('·', '') + '年纪念币')
    seen, res = set(), []
    for t in out:
        if t and t not in seen:
            seen.add(t); res.append(t)
    return res


def pick(c):
    k = core(c['name'])
    tokens = [t for t in re.split(r'[·、（）()\s]', c['name']) if len(t) >= 2]
    for term in candidates(c):
        j = card(term)
        title = (j.get('title') or '').strip()
        img = j.get('image') or ''
        if not title or not img:
            continue
        # 词条标题必须能和本品种对上，避免抓到同名不同物
        ok = (k and k in title) or any(t in title for t in tokens)
        if not ok:
            continue
        try:
            raw = get(img)
            im = Image.open(io.BytesIO(raw)); im.load()
            if im.width < 260 or im.height < 260:
                continue
            ratio = im.width / im.height
            if ratio < 0.55 or ratio > 1.85:
                continue
            path = '%s/%03d.jpg' % (OUT, c['i'] + 1)
            im.convert('RGB').save(path, 'JPEG', quality=92)
            return {'ok': True, 'term': term, 'title': title, 'file': path,
                    'w': im.width, 'h': im.height, 'src': img[:120]}
        except Exception:
            continue
    return {'ok': False}


def main():
    seed = json.load(open('public/data/coins.json', encoding='utf-8'))['coins']
    imgs = json.load(open('public/data/images.json', encoding='utf-8'))
    todo = [seed[n - 1] for n in imgs['mock']]
    print('待补 %d 个品种' % len(todo))

    report = {}
    got = 0
    for idx, c in enumerate(todo, 1):
        r = pick(c)
        report[str(c['i'] + 1)] = dict(r, name=c['name'], year=c['year'])
        if r['ok']:
            got += 1
            print('  [%2d/%d] ✓ %-28s ← %s' % (idx, len(todo), c['name'][:26], r['title'][:22]))
        else:
            print('  [%2d/%d] ✗ %s' % (idx, len(todo), c['name'][:30]))
        time.sleep(0.25)

    json.dump(report, open(OUT + '/report.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n成功 %d / %d' % (got, len(todo)))


if __name__ == '__main__':
    main()
