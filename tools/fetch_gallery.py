# -*- coding: utf-8 -*-
"""
补图：为每个品种抓「正面 / 背面」两张图，与已有主图一起组成图库。

做法沿用此前验证过的路子：无头 Chrome 渲染百度图片搜索页（绕开接口反爬），
从 data-thumbnail-url 里取 img0.baidu.com 的代理图（稳定、可直接下载），
再用 Pillow 校验尺寸、去重（与已有主图做均值哈希比对），最后统一压到 720px 内。

只写 public/img/ 与 public/data/gallery.json，不动 coins.json。

    python312 tools/fetch_gallery.py --limit 5          # 试跑
    python312 tools/fetch_gallery.py --kind reverse     # 只补背面
    python312 tools/fetch_gallery.py --all              # 正反面都补
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from hashlib import md5

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, 'public', 'img')
GALLERY = os.path.join(ROOT, 'public', 'data', 'gallery.json')
COINS = os.path.join(ROOT, 'public', 'data', 'coins.json')
CACHE = os.path.join(ROOT, '_scrape', 'gallery')
os.makedirs(CACHE, exist_ok=True)

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
SEARCH = 'https://image.baidu.com/search/index?tn=baiduimage&word=%s'

SUFFIX = {'obverse': 'f', 'reverse': 'b', 'set': 's'}
KIND_QUERY = {
    'obverse': '正面',
    'reverse': '背面',
    'set': '整套',
}


def log(*a):
    print(*a, flush=True)


_local = threading.local()


def profile_dir():
    d = getattr(_local, 'prof', None)
    if not d:
        d = tempfile.mkdtemp(prefix='cr-prof-')
        _local.prof = d
    return d


def render(query, timeout=25):
    key = md5(query.encode('utf-8')).hexdigest()[:12]
    path = os.path.join(CACHE, key + '.html')
    if os.path.exists(path) and os.path.getsize(path) > 40000:
        return open(path, encoding='utf-8', errors='ignore').read()
    url = SEARCH % urllib.parse.quote(query)
    tmp = path + '.tmp'
    try:
        with open(tmp, 'wb') as f:
            subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
                            '--hide-scrollbars', '--virtual-time-budget=9000',
                            '--window-size=1440,1400',
                            '--user-data-dir=' + profile_dir(), '--dump-dom', url],
                           stdout=f, stderr=subprocess.DEVNULL, timeout=timeout)
    except subprocess.TimeoutExpired:
        return ''
    if not os.path.exists(tmp):
        return ''
    try:
        os.replace(tmp, path)
    except OSError:
        path = tmp
    return open(path, encoding='utf-8', errors='ignore').read()


def candidates(dom, limit=10):
    """取候选图 url：优先 img0 缩略图（稳），再退 objurl 原图"""
    import html as html_mod
    dom = html_mod.unescape(dom)
    thumbs = re.findall(r'data-thumbnail-url="(https?://[^"]+)"', dom)
    origs = re.findall(r'data-objurl="(https?://[^"]+)"', dom)
    out, seen = [], set()
    for u in thumbs + origs:
        if u in seen:
            continue
        if any(k in u for k in ('eshop', 'product-detail', 'logo', 'icon')):
            continue
        seen.add(u)
        out.append(u)
        if len(out) >= limit:
            break
    return out


def fetch(url, timeout=12):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://image.baidu.com/'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def ahash(im):
    g = im.convert('L').resize((8, 8))
    px = list(g.getdata())
    avg = sum(px) / 64.0
    return ''.join('1' if p >= avg else '0' for p in px)


def hamming(a, b):
    return sum(1 for x, y in zip(a, b) if x != y)


def norm(im, max_side=720):
    w, h = im.size
    scale = min(1.0, max_side / float(max(w, h)))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    return im.convert('RGB')



def grab(cid, name, kind, known_hashes):
    """抓一张图，成功返回 (fname, real_kind)"""
    dom = render('%s 纪念币 %s' % (name, KIND_QUERY[kind]))
    if not dom:
        return None, '搜索页没拿到'
    for url in candidates(dom):
        try:
            raw = fetch(url)
            im = Image.open(io.BytesIO(raw))
            im.load()
        except Exception:
            continue
        w, h = im.size
        if min(w, h) < 240:
            continue
        if not (0.55 <= w / float(h) <= 2.2):
            continue
        hh = ahash(im)
        if any(hamming(hh, b) <= 6 for b in known_hashes):
            continue
        im = norm(im)
        real_kind = 'set' if im.size[0] / float(im.size[1]) > 1.45 else kind
        fname = '%s-%s.jpg' % (cid.zfill(3), SUFFIX[real_kind])
        im.save(os.path.join(IMG_DIR, fname), 'JPEG', quality=82, optimize=True, progressive=True)
        return fname, real_kind
    return None, '没有合格候选'


def main():
    args = sys.argv[1:]
    kinds = ['reverse']
    if '--kind' in args:
        kinds = [args[args.index('--kind') + 1]]
    elif '--all' in args:
        kinds = ['obverse', 'reverse']
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else None
    workers = int(args[args.index('--workers') + 1]) if '--workers' in args else 4

    coins = json.load(open(COINS, encoding='utf-8'))['coins']
    gallery = json.load(open(GALLERY, encoding='utf-8'))
    gal = gallery.setdefault('coins', {})

    base_hashes = {}
    for cid, items in gal.items():
        for it in items:
            p = os.path.join(IMG_DIR, it['f'])
            if os.path.exists(p):
                try:
                    base_hashes.setdefault(cid, []).append(ahash(Image.open(p)))
                except Exception:
                    pass

    todo = []
    for c in coins:
        cid = str(c['i'] + 1)
        have = {it['k'] for it in gal.get(cid, [])}
        for k in kinds:
            if k in have or ('set' in have and k == 'reverse'):
                continue
            todo.append((cid, c['name'], k))
    if limit:
        todo = todo[:limit]
    log('待补 %d 张 · %d 线程 · 目标 %s' % (len(todo), workers, '/'.join(kinds)))

    ok = fail = 0
    done = 0
    lock = threading.Lock()

    def job(item):
        cid, name, kind = item
        try:
            return grab(cid, name, kind, list(base_hashes.get(cid, [])))
        except Exception as e:
            return None, '异常 %s' % e

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for (cid, name, kind), (fname, info) in zip(todo, pool.map(job, todo)):
            with lock:
                done += 1
                if fname:
                    gal.setdefault(cid, []).append({'f': fname, 'k': info})
                    try:
                        base_hashes.setdefault(cid, []).append(ahash(Image.open(os.path.join(IMG_DIR, fname))))
                    except Exception:
                        pass
                    ok += 1
                    log('[%d/%d] %s %s -> %s (%s)' % (done, len(todo), cid, name, fname, info))
                else:
                    fail += 1
                    log('[%d/%d] %s %s: %s' % (done, len(todo), cid, name, info))
                if done % 10 == 0:
                    gallery['updated'] = time.strftime('%Y-%m-%d')
                    json.dump(gallery, open(GALLERY, 'w', encoding='utf-8'), ensure_ascii=False)

    gallery['updated'] = time.strftime('%Y-%m-%d')
    json.dump(gallery, open(GALLERY, 'w', encoding='utf-8'), ensure_ascii=False)
    total = sum(len(v) for v in gal.values())
    log('完成：新增 %d，失败 %d，图库共 %d 张 / %d 个品种' % (ok, fail, total, len(gal)))


if __name__ == '__main__':
    main()
