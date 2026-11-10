# -*- coding: utf-8 -*-
"""第二阶段：抓公告详情页 -> 定位「图案」PDF -> 提取正反面高清图。"""
import urllib.request, re, os, json, time, io, sys
import pymupdf

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
BASE = 'https://www.pbc.gov.cn'
OUT = '_raw'
os.makedirs(OUT, exist_ok=True)

def get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def strip_tags(h):
    h = re.sub(r'<script[\s\S]*?</script>', ' ', h, flags=re.I)
    h = re.sub(r'<style[\s\S]*?</style>', ' ', h, flags=re.I)
    h = re.sub(r'<[^>]+>', ' ', h)
    h = h.replace('&nbsp;', ' ').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', h).strip()

def main():
    items = json.load(open('_list.json', encoding='utf-8'))
    cands = [x for x in items if '公告' in x['title'] and ('第' in x['title'] or '号' in x['title'])]
    print('candidates', len(cands))

    manifest = []
    for idx, it in enumerate(cands):
        try:
            html = get(it['url']).decode('utf-8', 'ignore')
        except Exception as e:
            print(idx, 'page fail', e); continue
        body = strip_tags(html)
        if '纪念币' not in body:
            continue
        pdfs = re.findall(r'href="([^"]*attachDir[^"]*?\.pdf)"', html)
        if not pdfs:
            continue
        got = None
        for p in pdfs[:3]:
            purl = p if p.startswith('http') else BASE + p
            try:
                data = get(purl)
                doc = pymupdf.open(stream=data, filetype='pdf')
                txt = doc[0].get_text()
                if '正面图案' in txt and '背面图案' in txt:
                    imgs = doc[0].get_images(full=True)
                    if len(imgs) >= 2:
                        saved = []
                        for k, im in enumerate(imgs[:2]):
                            pix = doc.extract_image(im[0])
                            fn = f'{OUT}/{idx:03d}_{k}.{pix["ext"]}'
                            open(fn, 'wb').write(pix['image'])
                            saved.append(fn)
                        got = {'pdf': purl, 'imgs': saved, 'ptext': txt[:120]}
                        break
            except Exception as e:
                print(idx, 'pdf fail', str(e)[:60])
        if got:
            m = dict(it); m.update(got); m['body'] = body[:400]
            manifest.append(m)
            print(idx, 'OK', it['title'][:44], len(got['imgs']))
        time.sleep(0.2)

    json.dump(manifest, open('_manifest.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done, matched files:', len(manifest))

if __name__ == '__main__':
    main()
