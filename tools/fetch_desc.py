# -*- coding: utf-8 -*-
"""
为每个品种抓取央行「发行公告」的官方介绍文字。

做法：并发拉取所有非噪音公告页 → 抽正文 → 用正文里是否出现品种关键名
来匹配 → 每个品种取最匹配的一页，截取前若干段作为「官方介绍」。

输出：public/data/descriptions.json
  { "68": {"title","url","date","text"} }
"""
import json, re, ssl, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

NOISE = ('预约', '兑换', '分配', '库存', '核查', '进度', '招标', '中标', '装帧', '销售',
         '防伪', '鉴别', '图样', '真伪')
DROP = ('English', '我的位置', '京ICP', '网站标识码', '京公网安备', '网站主办单位',
        '打印本页', '关闭窗口', '上一篇', '下一篇', '相关稿件', '附件下载')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://www.pbc.gov.cn/'})
    with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
        raw = r.read()
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('gbk', 'ignore')


def page_text(url):
    h = get(url)
    i = h.find('class="zoom"')
    seg = h[i:] if i > 0 else h
    seg = seg[:24000]
    seg = re.sub(r'<script[\s\S]*?</script>', ' ', seg, flags=re.I)
    seg = re.sub(r'<style[\s\S]*?</style>', ' ', seg, flags=re.I)
    seg = re.sub(r'<br\s*/?>', '\n', seg, flags=re.I)
    seg = re.sub(r'</p>', '\n', seg, flags=re.I)
    seg = re.sub(r'<[^>]+>', ' ', seg)
    lines = [re.sub(r'\s+', ' ', x).strip() for x in seg.split('\n')]
    out = []
    for ln in lines:
        if len(ln) < 10:
            continue
        if any(d in ln for d in DROP):
            continue
        out.append(ln)
    return '\n'.join(out)


def core_name(n):
    head = str(n).split('（')[0]
    if '·' in head:
        return head.split('·')[-1].strip()
    return head.strip()


def main():
    seed = json.load(open('public/data/coins.json', encoding='utf-8'))
    coins = seed['coins']
    lst = json.load(open('tools/_data/_list.json', encoding='utf-8'))

    cands = []
    seen = set()
    for x in lst:
        t = x.get('title') or ''
        if any(n in t for n in NOISE):
            continue
        if '发行计划' in t:
            continue
        if not ('公告' in t or '发行' in t):
            continue
        if x['url'] in seen:
            continue
        seen.add(x['url'])
        cands.append(x)
    print('候选公告 %d 条' % len(cands))

    pages = []

    def work(x):
        try:
            txt = page_text(x['url'])
            if len(txt) < 80:
                return None
            return {'title': x['title'], 'url': x['url'], 'text': txt}
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, r in enumerate(ex.map(work, cands), 1):
            if r:
                pages.append(r)
            if i % 20 == 0:
                print('  ...%d/%d 有效 %d' % (i, len(cands), len(pages)))
    print('成功抓取 %d 页' % len(pages))

    out = {}
    for c in coins:
        cn = core_name(c['name'])
        tokens = [t for t in re.split(r'[·、（）()\s]', c['name']) if len(t) >= 2]
        if cn and cn not in tokens:
            tokens.insert(0, cn)

        best, best_score = None, -1
        for p in pages:
            txt = p['text']
            if '发行计划' in p['title'] or '发行计划' in txt[:40]:
                continue
            if cn and cn not in txt:
                continue
            score = 0
            if cn in p['title']:
                score += 8
            if '定于' in txt:                    # 正式发行公告的典型句式
                score += 6
            if '正面图案' in txt or '背面图案' in txt:
                score += 4
            if str(c['year']) in txt:
                score += 1
            if any(t in txt for t in tokens):
                score += 1
            if len(txt) < 150:
                score -= 5
            if score > best_score:
                best, best_score = p, score
        if best_score < 6:                       # 匹配太弱就不要，宁缺毋滥
            best = None

        if not best:
            continue

        # 按句筛选：优先普通纪念币的发行与图案描述，剔除金银币段落
        raw = re.sub(r'\s+', ' ', best['text'])
        sents = [x.strip() for x in re.split(r'(?<=。)', raw) if len(x.strip()) >= 10]
        keep = []
        for x in sents:
            if any(k in x for k in ('金质', '银质', '金银纪念币', '铂质', '精制', '克圆形', '克梅花')):
                continue
            if any(k in x for k in ('定于', '发行', '普通纪念币', '纪念钞', '面额', '图案', '规格',
                                    '发行量', '材质', '直径', '双色铜合金', '黄铜合金', '钢芯镀镍')):
                keep.append(x)
        blob = ''.join(keep) if keep else raw
        blob = re.sub(r'\s+', ' ', blob).strip()
        # 去掉页面头部的公告编号与发布时间
        blob = re.sub(r'中国人民银行公告[〔（(]\s*\d{4}\s*[〕）)]\s*第\s*\d+\s*号\s*', '', blob)
        blob = re.sub(r'\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}:\d{2}\s*', '', blob)
        blob = re.sub(r'^[\s　]+', '', blob)
        if len(blob) > 460:
            blob = blob[:460].rsplit('。', 1)[0] + '。'

        m = re.search(r'(20\d{2}-\d{2}-\d{2})', best['text'])
        out[str(c['i'] + 1)] = {
            'title': best['title'],
            'url': best['url'],
            'text': blob,
            'date': m.group(1) if m else ''
        }

    json.dump(out, open('public/data/descriptions.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('\n有官方介绍的品种：%d / %d' % (len(out), len(coins)))
    missing = [coins[int(k) - 1]['name'] for k in range(1, len(coins) + 1) if str(k) not in out]
    if missing:
        print('缺介绍：', '、'.join(missing[:12]), '…' if len(missing) > 12 else '')


if __name__ == '__main__':
    main()
