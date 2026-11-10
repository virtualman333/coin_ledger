# -*- coding: utf-8 -*-
"""
下载央行公告里的币面图，并按公告正文自动匹配到发行清单的品种。

输出：
  _pbc/img/<md5>.jpg         图片
  _pbc/matched.json          [{coin_name, coin_i, ann_title, files:[...]}]
  _pbc/unmatched.json        未能自动匹配的公告（含图片尺寸，供人工复核）
"""
import hashlib, io, json, os, re, ssl, urllib.request
from PIL import Image

BASE = 'https://www.pbc.gov.cn'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

os.makedirs('_pbc/img', exist_ok=True)

manifest = json.load(open('_pbc/manifest.json', encoding='utf-8'))
seed = json.load(open('public/data/coins.json', encoding='utf-8'))
coins = seed['coins']


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': BASE})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return r.read()


def core_name(name):
    """'世界文化遗产·万里长城' -> '万里长城'；取最长片段用于正文匹配"""
    parts = [p for p in re.split(r'[·（）()]', name) if len(p) >= 2]
    return max(parts, key=len) if parts else name


def download(url):
    try:
        raw = get(url)
        im = Image.open(io.BytesIO(raw))
        im.load()
        if im.width < 300 or im.height < 300:
            return None
        ratio = im.width / im.height
        if ratio < 0.55 or ratio > 1.8:      # 太扁/太长的多半是横幅或版式图
            return None
        key = hashlib.md5(raw).hexdigest()[:16]
        path = '_pbc/img/%s.jpg' % key
        if not os.path.exists(path):
            im.convert('RGB').save(path, 'JPEG', quality=92)
        return {'file': path, 'w': im.width, 'h': im.height, 'url': url}
    except Exception:
        return None


matched, unmatched = [], []
for idx, ann in enumerate(manifest, 1):
    imgs = []
    for u in ann['imgs'][:12]:
        r = download(u)
        if r:
            imgs.append(r)
    if not imgs:
        continue

    text = (ann['title'] + ' ' + ann['text']).replace(' ', '')
    year_m = re.search(r'(20\d{2})', ann['title'])
    year = year_m.group(1) if year_m else ''

    # 排除纯金银币公告（除非同时提到普通纪念币）
    if '金银' in text and '普通纪念币' not in text:
        unmatched.append({'title': ann['title'], 'why': '金银币公告', 'imgs': len(imgs)})
        continue

    hits = []
    for c in coins:
        cn = core_name(c['name'])
        if len(cn) < 2:
            continue
        if cn in text:
            # 年份差的越多越不可信（公告年与发行年一般同年或差 1）
            if year and abs(int(year) - int(c['year'])) > 1:
                continue
            hits.append(c)

    if len(hits) == 1:
        matched.append({'coin_i': hits[0]['i'], 'coin_name': hits[0]['name'],
                        'ann': ann['title'], 'imgs': imgs})
    else:
        unmatched.append({'title': ann['title'], 'why': '%d 个候选' % len(hits),
                          'cands': [h['name'] for h in hits][:6],
                          'imgs': len(imgs), 'sample': imgs[:4]})
    if idx % 10 == 0:
        print('  ...%d/%d' % (idx, len(manifest)))

json.dump(matched, open('_pbc/matched.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump(unmatched, open('_pbc/unmatched.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

covered = {m['coin_i'] for m in matched}
print('\n自动匹配成功：%d 个公告 / %d 个品种' % (len(matched), len(covered)))
print('待复核公告：%d 条' % len(unmatched))
print('仍未覆盖的品种：%d 个' % (len(coins) - len(covered)))
