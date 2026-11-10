# -*- coding: utf-8 -*-
"""从央行「货币金银局—发行公告」页面抓取「图案」附件（doc/wps/pdf），
二进制提取内嵌 JPEG，得到纪念币正反面真实图片。"""
import urllib.request, re, os, json, time, io
from PIL import Image

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
BASE = 'https://www.pbc.gov.cn'
OUT = '_raw2'
os.makedirs(OUT, exist_ok=True)

def get(url, timeout=45):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def strip_tags(h):
    h = re.sub(r'<script[\s\S]*?</script>', ' ', h, flags=re.I)
    h = re.sub(r'<style[\s\S]*?</style>', ' ', h, flags=re.I)
    h = re.sub(r'<[^>]+>', ' ', h)
    h = h.replace('&nbsp;', ' ')
    return re.sub(r'\s+', ' ', h).strip()

def extract_jpegs(blob):
    """用 PIL 解析器逐个解出内嵌 JPEG（比找 FFD9 更稳，兼容 OLE 分块存档）"""
    import re as _re
    out = []
    seen = set()
    for m in _re.finditer(b'\xff\xd8\xff', blob):
        s = m.start()
        try:
            f = io.BytesIO(blob[s:])
            im = Image.open(f)
            im.load()
            n = f.tell()
            if im.width < 300 or im.height < 300:
                continue
            key = hash(blob[s:s + n])
            if key in seen:
                continue
            seen.add(key)
            out.append((n, blob[s:s + n], im.size))
        except Exception:
            pass
    return out

def main():
    items = json.load(open('_list.json', encoding='utf-8'))
    cands = [x for x in items if '中国人民银行公告' in x['title']]
    print('announcements', len(cands))
    manifest = []
    for idx, it in enumerate(cands):
        try:
            html = get(it['url']).decode('utf-8', 'ignore')
        except Exception as e:
            print(idx, 'page fail', str(e)[:50]); continue
        body = strip_tags(html)
        if '纪念币' not in body:
            continue
        atts = re.findall(r'<a[^>]+href="([^"]+\.(?:doc|docx|wps|pdf))"[^>]*>([^<]{0,140})<', html)

        # 只认「普通纪念币 / 双色铜合金 / 纪念钞」图案，排除金银币图案
        def score(name):
            s = 0
            if '图案' in name: s += 100
            if '金银' in name: s -= 90
            if '普通纪念币' in name or '双色铜合金' in name: s += 45
            if '纪念钞' in name: s += 15
            return s

        target = None
        best = -999
        for u, name in atts:
            sc = score(name)
            if sc > best:
                best, target = sc, (u, name)
        if target and best < 100:
            target = None
        if not target:
            print(idx, 'no pattern att', it['title'][:30]); continue

        # 收集本公告所有「图案」附件（普通币 + 纪念钞可能分列）
        targets = []
        seen_u = set()
        for u, name in atts:
            if score(name) >= 100 and u not in seen_u:
                seen_u.add(u); targets.append((u, name))
        targets = targets[:3]

        saved_all = []
        for tid, (u, name) in enumerate(targets):
            url = u if u.startswith('http') else BASE + u
            try:
                blob = get(url)
            except Exception as e:
                print(idx, 'att fail', str(e)[:50]); continue
            imgs = extract_jpegs(blob)
            if not imgs:
                print(idx, 'no jpeg in', name[:30]); continue
            saved = []
            for k, (_, cand, size) in enumerate(imgs[:4]):
                fn = f'{OUT}/{idx:03d}_{tid}_{k}.jpg'
                open(fn, 'wb').write(cand)
                saved.append(fn)
            saved_all.append({'att': url, 'attname': name, 'imgs': saved})
            print(idx, 'OK', name[:40], len(saved))
            time.sleep(0.15)

        if not saved_all:
            continue
        manifest.append({'title': it['title'], 'page': it['url'],
                         'parts': saved_all, 'body': body[:600]})
        time.sleep(0.2)
    json.dump(manifest, open('_docs.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('saved announcements:', len(manifest))

if __name__ == '__main__':
    main()
