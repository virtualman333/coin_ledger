# -*- coding: utf-8 -*-
"""
用本地 Chrome 渲染百度图片搜索页（绕开接口反爬），抓每个品种的候选图。

思路：无头 Chrome --dump-dom 拿到渲染后的 DOM，结果图在
  <img data-thumbnail-url="..." data-objurl="...">
里；缩略图走 img0.baidu.com 代理，下载稳定。

输出：_scrape/<编号>_<序号>.jpg  + _scrape/cands.json
"""
import hashlib, html, io, json, os, re, ssl, subprocess, sys, time, urllib.parse, urllib.request
from PIL import Image

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
OUT = '_scrape'
os.makedirs(OUT, exist_ok=True)
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

SEARCH = 'https://image.baidu.com/search/index?tn=baiduimage&word=%s'


def render(query, timeout=40):
    url = SEARCH % urllib.parse.quote(query)
    cache = os.path.join(OUT, 'dom_%s.html' % hashlib.md5(query.encode()).hexdigest()[:12])
    if os.path.exists(cache) and os.path.getsize(cache) > 60000:
        return open(cache, encoding='utf-8', errors='ignore').read()
    tmp = cache + '.tmp'
    try:
        with open(tmp, 'wb') as f:
            subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
                            '--virtual-time-budget=10000', '--window-size=1440,1200',
                            '--dump-dom', url], stdout=f, stderr=subprocess.DEVNULL, timeout=timeout)
    except subprocess.TimeoutExpired:
        # 偶发卡死：当作没拿到，交给上层跳过
        return ''
    if os.path.exists(tmp):
        time.sleep(0.4)
        try:
            os.replace(tmp, cache)
        except PermissionError:
            # Chrome 子进程仍持有句柄时无法改名，直接读临时文件即可
            cache = tmp
        return open(cache, encoding='utf-8', errors='ignore').read()
    return ''


def candidates(dom, limit=8):
    """优先取原图 objurl，退回 thumbnail（都在 data-* 属性里，且被 HTML 转义）"""
    dom = html.unescape(dom)
    thumbs = re.findall(r'data-thumbnail-url="(https?://[^"]+)"', dom)
    origs = re.findall(r'data-objurl="(https?://[^"]+)"', dom)
    out, seen = [], set()

    def push(u):
        if not u or u in seen:
            return
        if any(k in u for k in ('eshop', 'product-detail', 'baidu.com/img/')):
            return
        seen.add(u); out.append(u)

    for i in range(max(len(origs), len(thumbs))):
        if i < len(thumbs):
            push(thumbs[i])       # 缩略图优先：尺寸稳定、下载成功率高
        if i < len(origs):
            push(origs[i])
        if len(out) >= limit:
            break
    return out[:limit]


def download(url, path):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://image.baidu.com/'})
        raw = urllib.request.urlopen(req, timeout=15, context=ctx).read()
        im = Image.open(io.BytesIO(raw)); im.load()
        if im.width < 200 or im.height < 200:
            return None
        r = im.width / im.height
        if r < 0.5 or r > 2.0:
            return None
        im.convert('RGB').save(path, 'JPEG', quality=92)
        return {'path': path, 'w': im.width, 'h': im.height}
    except Exception:
        return None


def main():
    seed = json.load(open('public/data/coins.json', encoding='utf-8'))['coins']
    imgs = json.load(open('public/data/images.json', encoding='utf-8'))
    todo = imgs['mock']
    print('待补 %d 个品种' % len(todo))

    result = {}
    for idx, no in enumerate(todo, 1):
        c = seed[no - 1]
        name = c['name']
        q = re.sub(r'[（）()]', ' ', name).strip()
        q = re.sub(r'\s+', ' ', q)
        if '贺岁' in name and re.match(r'^\d{4}', name):
            q = name[:4] + '年贺岁普通纪念币'
        else:
            q = q.replace('·', ' ') + ' 纪念币'

        dom = render(q)
        urls = candidates(dom)
        got = []
        for k, u in enumerate(urls):
            p = '%s/%03d_%d.jpg' % (OUT, no, k)
            r = download(u, p)
            if r:
                r['src'] = u
                got.append(r)
            if len(got) >= 4:
                break
        result[str(no)] = {'name': name, 'query': q, 'cands': got}
        print('  [%2d/%d] %-28s 候选 %d' % (idx, len(todo), name[:26], len(got)))
        time.sleep(0.4)

    json.dump(result, open(OUT + '/cands.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    ok = sum(1 for v in result.values() if v['cands'])
    print('\n有候选的品种 %d / %d' % (ok, len(todo)))


if __name__ == '__main__':
    main()
