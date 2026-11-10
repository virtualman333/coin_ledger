# -*- coding: utf-8 -*-
"""
全量抓取中国人民银行历史公告里的币面图（内联 img_*.jpg）。
早年公告的图案不是附件，而是直接嵌在正文里，路径形如
/eportal/fileDir/history_file/images/img_16029_2.jpg

输出：
  _pbc/html/<hash>.html      原始页面
  _pbc/manifest.json         [{url,title,imgs:[...],text}]
"""
import json, os, re, ssl, sys, time
import urllib.request

BASE = 'https://www.pbc.gov.cn'
LIST = 'tools/_data/_list.json'
OUT = '_pbc'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

NOISE = ('预约', '兑换', '分配', '数量', '库存', '核查', '兑换进度')


def get(url, retry=2):
    for i in range(retry + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
                return r.read()
        except Exception:
            if i == retry:
                raise
            time.sleep(1.2 * (i + 1))


def main():
    os.makedirs(OUT + '/html', exist_ok=True)
    entries = json.load(open(LIST, encoding='utf-8'))

    cands = []
    for e in entries:
        t = e.get('title') or ''
        if any(n in t for n in NOISE):
            continue
        if '公告' not in t and '发行' not in t:
            continue
        cands.append(e)
    print('候选公告 %d 条（总 %d）' % (len(cands), len(entries)))

    manifest = []
    for idx, e in enumerate(cands, 1):
        url = e['url']
        try:
            raw = get(url)
        except Exception as ex:
            print('  [%d/%d] 拉取失败 %s' % (idx, len(cands), url))
            continue
        try:
            html = raw.decode('utf-8')
        except UnicodeDecodeError:
            html = raw.decode('gbk', 'ignore')

        # 正文里的内容图（排除站点模板、按钮、备案图标）
        imgs = re.findall(r'<img[^>]+src="([^"]+)"', html, re.I)
        keep = []
        for s in imgs:
            s = s.strip()
            if 'template/common' in s or '/uiFramework/' in s:
                continue
            if 'beian' in s.lower() or 'logo' in s.lower():
                continue
            if not re.search(r'\.(jpg|jpeg|png)$', s, re.I):
                continue
            if s.startswith('/'):
                s = BASE + s
            keep.append(s)
        # 去重保序
        seen = set()
        imgs = [x for x in keep if not (x in seen or seen.add(x))]
        if not imgs:
            continue

        body = re.sub(r'<script[\s\S]*?</script>', ' ', html, flags=re.I)
        body = re.sub(r'<style[\s\S]*?</style>', ' ', body, flags=re.I)
        text = re.sub(r'<[^>]+>', ' ', body)
        text = re.sub(r'\s+', ' ', text).strip()
        # 抓标题附近与发行相关的一句话，便于后续匹配品种
        m = re.search(r'(定于[^。]{0,80}发行[^。]{0,120}。)', text)
        snippet = m.group(1) if m else text[:220]

        manifest.append({'url': url, 'title': e['title'], 'imgs': imgs, 'text': snippet})
        print('  [%d/%d] %d 张 ← %s' % (idx, len(cands), len(imgs), e['title'][:44]))

    json.dump(manifest, open(OUT + '/manifest.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    total = sum(len(x['imgs']) for x in manifest)
    print('\n完成：%d 条公告含图，共 %d 张' % (len(manifest), total))


if __name__ == '__main__':
    main()
