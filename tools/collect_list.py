# -*- coding: utf-8 -*-
"""从中国人民银行官网发行公告附件 PDF 中提取纪念币正反面真实图案。
仅用于个人收藏工具展示，图片版权归中国人民银行所有。
"""
import urllib.request, re, os, json, time, sys

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
BASE = 'https://www.pbc.gov.cn'
COLL = '/huobijinyinju/147948/147964'

def get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def gett(url):
    return get(url).decode('utf-8', 'ignore')

def collect():
    rows = []
    for p in range(1, 32):
        url = f'{BASE}{COLL}/index.html' if p == 1 else f'{BASE}{COLL}/22786-{p}.html'
        try:
            h = gett(url)
        except Exception as e:
            print('  stop page', p, e); break
        if len(h) < 3000:
            print('  end at page', p); break
        found = re.findall(r'href="(/huobijinyinju/[^"]*?/index\.html)"[^>]*>([^<]{4,140})<', h)
        for u, t in found:
            rows.append({'title': t.strip(), 'url': BASE + u})
        time.sleep(0.25)
    seen, out = set(), []
    for r in rows:
        if r['url'] in seen: continue
        seen.add(r['url']); out.append(r)
    json.dump(out, open('_list.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('collected', len(out))

if __name__ == '__main__':
    collect()
