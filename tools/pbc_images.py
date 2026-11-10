# -*- coding: utf-8 -*-
"""
并发下载央行公告里的币面图，然后按公告正文匹配到发行清单品种。

图片命名形态不统一（图片1.jpg / 图案1.jpg / img_16029_2.jpg / W020200108...），
所以这里先按「排除站点装饰 + 命中内容特征」筛选，再用尺寸与长宽比兜一遍。
"""
import hashlib, io, json, os, re, ssl, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

BASE = 'https://www.pbc.gov.cn'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
os.makedirs('_pbc/img', exist_ok=True)

JUNK = ('zhifujiesuansi', 'img_pc_site', 'template/common', 'uiFramework',
        '/images/dh_', 'beian', 'pbcimage', 'logo', 'banner', 'footer', 'header')
# 金银/铂钯纪念币不是本站收录范围（本站只收普通纪念币与纪念钞）
PRECIOUS = ('金质', '银质', '铂质', '钯质', '双色金', '精制', '公斤', '克圆形', '克长方形')
GOOD = re.compile(r'(图片|图案|img_\d+|W0\d{12,}|附件|正面|背面|纪念币|纪念钞)', re.I)
EXT = re.compile(r'\.(jpg|jpeg|png)$', re.I)


def norm(u):
    return BASE + u if u.startswith('/') else u


def fetch(url):
    try:
        # 文件名多为中文，必须 percent-encoding，否则 urllib 直接抛 UnicodeEncodeError
        target = urllib.parse.quote(url, safe=':/?=&%')
        req = urllib.request.Request(target, headers={'User-Agent': UA, 'Referer': BASE + '/'})
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            raw = r.read()
        if len(raw) < 8000:
            return None
        im = Image.open(io.BytesIO(raw)); im.load()
        if im.width < 300 or im.height < 260:
            return None
        ratio = im.width / im.height
        if ratio < 0.5 or ratio > 1.9:
            return None
        key = hashlib.md5(raw).hexdigest()[:16]
        path = '_pbc/img/%s.jpg' % key
        if not os.path.exists(path):
            im.convert('RGB').save(path, 'JPEG', quality=92)
        return {'file': path, 'w': im.width, 'h': im.height, 'url': url}
    except Exception:
        return None


def main():
    manifest = json.load(open('_pbc/manifest.json', encoding='utf-8'))
    # 收集候选 URL
    jobs = []
    for ai, ann in enumerate(manifest):
        for u in ann['imgs']:
            if any(j in u for j in JUNK):
                continue
            fname = urllib.parse.unquote(u.split('/')[-1])
            if any(k in fname for k in PRECIOUS):
                continue
            if not EXT.search(u):
                continue
            if not GOOD.search(u):
                continue
            jobs.append((ai, norm(u)))
    uniq = {}
    for ai, u in jobs:
        uniq.setdefault(u, []).append(ai)
    print('待下载图片 %d 张（去重后）' % len(uniq))

    results = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs = {ex.submit(fetch, u): u for u in uniq}
        done = 0
        for f in as_completed(futs):
            done += 1
            u = futs[f]
            r = f.result()
            if r:
                results[u] = r
            if done % 25 == 0:
                print('  ...%d/%d 成功 %d' % (done, len(uniq), len(results)))

    print('下载成功 %d 张' % len(results))

    seed = json.load(open('public/data/coins.json', encoding='utf-8'))
    coins = seed['coins']

    def core(name):
        parts = [p for p in re.split(r'[·（）()\-]', name) if len(p) >= 2]
        return max(parts, key=len) if parts else name

    matched, unmatched = [], []
    for ann in manifest:
        imgs = [results[norm(u)] for u in ann['imgs'] if norm(u) in results]
        if not imgs:
            continue
        text = (ann['title'] + ' ' + ann['text']).replace(' ', '')
        ym = re.search(r'(20\d{2})', ann['title'])
        year = ym.group(1) if ym else ''

        if '金银' in text and '普通纪念币' not in text:
            unmatched.append({'title': ann['title'], 'why': '金银币公告', 'n': len(imgs)})
            continue

        # 先用文件名直接匹配（央行图片命名很规整，如「2016年贺岁普通纪念币图案1.jpg」）
        fnames = ' '.join(urllib.parse.unquote(i['url'].split('/')[-1]) for i in imgs)
        hits, by_name = [], []
        for c in coins:
            cn = core(c['name'])
            if len(cn) < 2:
                continue
            if cn in fnames and (not year or abs(int(year) - int(c['year'])) <= 1):
                by_name.append(c)
            elif cn in text and (not year or abs(int(year) - int(c['year'])) <= 1):
                hits.append(c)
        if len(by_name) == 1:
            hits = by_name

        if len(hits) == 1:
            matched.append({'coin_i': hits[0]['i'], 'coin_name': hits[0]['name'],
                            'ann': ann['title'], 'imgs': imgs})
        else:
            unmatched.append({'title': ann['title'], 'why': '%d 个候选' % len(hits),
                              'cands': [h['name'] for h in hits][:6],
                              'imgs': imgs[:6]})

    json.dump(matched, open('_pbc/matched.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(unmatched, open('_pbc/unmatched.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    covered = {m['coin_i'] for m in matched}
    print('自动匹配：%d 条公告 → %d 个品种' % (len(matched), len(covered)))
    print('待复核：%d 条；仍未覆盖品种：%d 个' % (len(unmatched), len(seed['coins']) - len(covered)))


if __name__ == '__main__':
    main()
