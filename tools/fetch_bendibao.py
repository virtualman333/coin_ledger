# -*- coding: utf-8 -*-
"""
从本地宝《普通纪念币大全目录》取「正面 + 背面」并排图。

页面结构很规整：<strong>N、品种名</strong> + 简介 + <img bigpicsrc="原图">。
bigpicsrc 是未压缩的 PNG，画面是正面(国徽)与背面并排，无水印。

用法：
    python312 tools/fetch_bendibao.py --dry      # 只做匹配、不下载
    python312 tools/fetch_bendibao.py            # 下载并写库
    python312 tools/fetch_bendibao.py --keep-extra   # 保留已有的 -b/-f 图

默认行为：把该品种的图库收敛成「主图 + 这张正反面图」，
并删掉之前从搜索引擎抓来的 -b / -f（那些经常标错甚至搜错品种）。
"""
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, 'public', 'img')
COINS = os.path.join(ROOT, 'public', 'data', 'coins.json')
GALLERY = os.path.join(ROOT, 'public', 'data', 'gallery.json')
CACHE = os.path.join(ROOT, '_scrape', 'bdb')
os.makedirs(CACHE, exist_ok=True)

URL = 'https://nc.bendibao.com/gouwu/202419/84518.shtm'
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
# 该站有滑块验证：桌面 UA 会被拦，移动 UA 可直出
UA_MOBILE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
             '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
UA_DL = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://nc.bendibao.com/'}
DOM = os.path.join(CACHE, 'page.html')


def log(*a):
    print(*a, flush=True)


def fetch_dom(force=False):
    if os.path.exists(DOM) and os.path.getsize(DOM) > 40000 and not force:
        return open(DOM, encoding='utf-8', errors='ignore').read()
    tmp = DOM + '.tmp'
    with open(tmp, 'wb') as f:
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
                        '--virtual-time-budget=12000', '--user-agent=' + UA_MOBILE,
                        '--window-size=390,900', '--dump-dom', URL],
                       stdout=f, stderr=subprocess.DEVNULL, timeout=60)
    os.replace(tmp, DOM)
    return open(DOM, encoding='utf-8', errors='ignore').read()


def parse(dom):
    """按 <strong>N、名称</strong> 切块，取块内第一张 bigpicsrc"""
    parts = re.split(r'<strong>\s*(\d+)[、.]\s*([^<]+?)\s*</strong>', dom)
    out = []
    for i in range(1, len(parts) - 2, 3):
        try:
            no = int(parts[i])
        except ValueError:
            continue
        name = re.sub(r'\s+', '', parts[i + 1])
        body = parts[i + 2]
        m = re.search(r'bigpicsrc="([^"]+)"', body) or re.search(r'data-echo="([^"]+)"', body)
        if m and name:
            out.append({'no': no, 'name': name, 'img': m.group(1)})
    return out


def norm(s):
    s = re.sub(r'[（(].*?[）)]', '', s)
    s = re.sub(r'[「」“”"\'·—\-·\s]', '', s)
    return s.replace('纪念币', '').replace('普通纪念币', '').replace('纪念钞', '钞')


# 目录与我们的命名差异，人工给别名
ALIAS = {
    '上海世界博览会': '中国2010年上海世博会',
    '抗日战争胜利70周年': '抗战胜利70周年',
    '迎接新世纪': '迎接新世纪（千禧年）',
    '2004贺岁': '2004年贺岁（猴）',
    '孙中山先生诞辰150周年': '孙中山诞辰150周年',
}
# 名称差异较大、用 norm 会撞车的，按页面原文精确对应
RAW_ALIAS = {
    '中国京剧艺术普通纪念币（生角）': '中国京剧艺术·生角',
    '中国京剧艺术普通纪念币（旦角）': '中国京剧艺术·旦角',
    '中国京剧艺术普通纪念币（净角）': '中国京剧艺术·净角',
    '2024年贺岁纪念币（龙）': '2024年贺岁（龙）',
    '2025年贺岁纪念币': '2025年贺岁（蛇）',
    '中国人民抗日战争暨世界反法西斯战争胜利80周年纪念币': '抗战胜利80周年',
}
# 页面按「组」给图（一组 3 枚），不能配给单枚，直接跳过
SKIP = ('第29届奥林匹克运动会', '第24届冬季奥林匹克运动会纪念币')


def match(entries, coins):
    """只做名称匹配：全名相等 / 互相包含 / 用括号里的限定词（净角、马钞…）消歧。
       不做「按序号对位」兜底——序号一旦错位就会把别的品种的图配上去。"""
    pairs, missed, used = [], [], set()
    for e in entries:
        if any(k in e['name'] for k in SKIP):
            continue
        name = RAW_ALIAS.get(e['name']) or ALIAS.get(norm(e['name'])) or e['name']
        exact = [c for c in coins if c['name'] == name]
        if len(exact) == 1:
            pairs.append((e, exact[0]))
            used.add(exact[0]['i'] + 1)
            continue
        key = norm(name)
        qual = ''
        m = re.search(r'[（(](.+?)[）)]', e['name'])
        if m:
            qual = m.group(1).strip()
        cands = [c for c in coins if (c['i'] + 1) not in used and (
            norm(c['name']) == key or key in norm(c['name']) or norm(c['name']) in key)]
        if len(cands) > 1 and qual:
            narrowed = [c for c in cands if qual in c['name']]
            if len(narrowed) == 1:
                cands = narrowed
        if len(cands) == 1:
            pairs.append((e, cands[0]))
            used.add(cands[0]['i'] + 1)
        else:
            missed.append((e, len(cands)))
    return pairs, missed


def download(url, timeout=25):
    req = urllib.request.Request(url, headers=UA_DL)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def save_jpeg(raw, path, max_side=900):
    im = Image.open(io.BytesIO(raw))
    im.load()
    im = im.convert('RGB')
    w, h = im.size
    scale = min(1.0, max_side / float(max(w, h)))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    # 统一铺一点白边，避免深底图在浅色卡片里显脏
    im.save(path, 'JPEG', quality=88, optimize=True, progressive=True)
    return im.size


def main():
    dry = '--dry' in sys.argv
    keep_extra = '--keep-extra' in sys.argv

    dom = fetch_dom('--refresh' in sys.argv)
    entries = parse(dom)
    log('页面条目 %d 个' % len(entries))

    coins = json.load(open(COINS, encoding='utf-8'))['coins']
    pairs, missed = match(entries, coins)
    log('匹配到 %d 个品种，未匹配 %d 条' % (len(pairs), len(missed)))
    for e, n in missed[:12]:
        log('  未匹配（候选 %d）：%s、%s' % (n, e['no'], e['name']))

    gallery = json.load(open(GALLERY, encoding='utf-8'))
    gal = gallery.setdefault('coins', {})
    if '--reset' in sys.argv:
        for cid in list(gal.keys()):
            gal[cid] = [it for it in gal[cid] if it['k'] == 'main']
            if not gal[cid]:
                del gal[cid]
        log('已重置：只保留主图')

    if dry:
        for e, c in pairs[:8]:
            log('  %s → #%d %s' % (e['name'][:16], c['i'] + 1, c['name'][:16]))
        return

    ok = fail = 0
    orphans = []
    for n, (e, c) in enumerate(pairs, 1):
        cid = c['i'] + 1
        fname = '%03d-s.jpg' % cid
        dst = os.path.join(IMG_DIR, fname)
        try:
            raw = download(e['img'])
            size = save_jpeg(raw, dst)
        except Exception as ex:
            fail += 1
            log('[%d/%d] #%d %s 失败：%s' % (n, len(pairs), cid, c['name'][:16], ex))
            continue

        old = gal.get(str(cid), [])
        keep = [it for it in old if it['k'] == 'main']
        if keep_extra:
            keep += [it for it in old if it['k'] in ('obverse', 'reverse')]
        keep.append({'f': fname, 'k': 'set'})
        gal[str(cid)] = keep

        # 不再引用的搜索图只登记、不删（批量删文件有风险，也让动作可回滚）
        used = {it['f'] for it in keep}
        for it in old:
            if it['f'] not in used and it['k'] in ('obverse', 'reverse', 'set'):
                orphans.append(it['f'])
        ok += 1
        log('[%d/%d] #%d %s → %s %dx%d' % (n, len(pairs), cid, c['name'][:16], fname, size[0], size[1]))
        time.sleep(0.35)

    gallery['updated'] = time.strftime('%Y-%m-%d')
    json.dump(gallery, open(GALLERY, 'w', encoding='utf-8'), ensure_ascii=False)
    if orphans:
        pathlib_file = os.path.join(CACHE, 'orphans.txt')
        with open(pathlib_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(sorted(set(orphans))))
        log('不再引用的旧图 %d 张，清单写到 %s（未删除）' % (len(set(orphans)), pathlib_file))
    total = sum(len(v) for v in gal.values())
    log('完成：新增/替换 %d，失败 %d；图库共 %d 张 / %d 个品种' % (ok, fail, total, len(gal)))


if __name__ == '__main__':
    main()
