# -*- coding: utf-8 -*-
"""补充抓取：指定公告页 -> 图案附件 -> 内嵌 JPEG"""
import urllib.request, re, os, json, time, io
from PIL import Image

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
BASE = 'https://www.pbc.gov.cn'
OUT = '_raw3'
os.makedirs(OUT, exist_ok=True)

PAGES = [
    ('2026贺岁', 'https://www.pbc.gov.cn/huobijinyinju/147948/147966/2025121919422289540/index.html'),
    ('东北虎豹', 'https://www.pbc.gov.cn/huobijinyinju/147948/2991918/2025111717110448486/index.html'),
]

def get(url, timeout=45):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def extract_jpegs(blob):
    out = []
    for m in re.finditer(b'\xff\xd8\xff', blob):
        s = m.start(); e = blob.find(b'\xff\xd9', s)
        if e < 0: continue
        cand = blob[s:e+2]
        if len(cand) < 8000: continue
        try:
            im = Image.open(io.BytesIO(cand)); im.load()
            if im.width >= 300 and im.height >= 300:
                out.append((len(cand), cand, im.size))
        except Exception:
            pass
    return out

def score(name):
    s = 0
    if '图案' in name: s += 100
    if '金银' in name: s -= 90
    if '普通纪念币' in name or '双色铜合金' in name: s += 45
    if '纪念钞' in name: s += 15
    return s

man = []
for tag, page in PAGES:
    html = get(page).decode('utf-8', 'ignore')
    atts = re.findall(r'<a[^>]+href="([^"]+\.(?:doc|docx|wps|pdf))"[^>]*>([^<]{0,140})<', html)
    picks = []
    seen = set()
    for u, name in atts:
        if score(name) >= 100 and u not in seen:
            seen.add(u); picks.append((u, name))
    print(tag, 'attachments:', [n for _, n in picks])
    for tid, (u, name) in enumerate(picks[:2]):
        url = u if u.startswith('http') else BASE + u
        blob = get(url)
        imgs = extract_jpegs(blob)
        saved = []
        for k, (_, cand, size) in enumerate(imgs[:4]):
            fn = f'{OUT}/{tag}_{k}.jpg'
            open(fn, 'wb').write(cand)
            saved.append(fn)
            print('   ', fn, size)
        man.append({'tag': tag, 'attname': name, 'imgs': saved})
json.dump(man, open('_extra.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done')
