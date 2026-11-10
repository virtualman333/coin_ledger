# -*- coding: utf-8 -*-
"""针对第一轮失败的品种，用更精准的词条名重试"""
import io, json, os, ssl, time, urllib.parse, urllib.request
from PIL import Image

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
os.makedirs('_baike', exist_ok=True)

TERMS = {
 '2009年贺岁（牛）': ['2009年贺岁普通纪念币', '己丑年贺岁普通纪念币'],
 '2010年贺岁（虎）': ['2010年贺岁普通纪念币', '庚寅年贺岁普通纪念币'],
 '2011年贺岁（兔）': ['2011年贺岁普通纪念币', '辛卯年贺岁普通纪念币'],
 '2012年贺岁（龙）': ['2012年贺岁普通纪念币', '壬辰年贺岁普通纪念币'],
 '中国2010年上海世博会': ['中国2010年上海世界博览会纪念币', '上海世博会纪念币'],
 '抗战胜利70周年': ['中国人民抗日战争暨世界反法西斯战争胜利70周年纪念币'],
 '孙中山诞辰150周年': ['孙中山诞辰150周年纪念币', '孙中山诞辰150周年普通纪念币'],
 '中国共产党成立90周年': ['中国共产党成立90周年纪念币'],
 '2024年贺岁纪念钞（龙钞）': ['2024年贺岁纪念钞', '龙年贺岁纪念钞'],
 '第29届奥运会纪念钞（奥运钞）': ['第29届奥林匹克运动会纪念钞', '奥运纪念钞'],
 '中国京剧艺术·净角': ['中国京剧艺术净角纪念币', '京剧艺术净角纪念币'],
 '邓小平诞辰100周年': ['邓小平诞辰100周年纪念币', '邓小平诞辰100周年普通纪念币'],
 '世界文化遗产·万里长城': ['万里长城纪念币', '世界文化遗产万里长城纪念币'],
 '世界文化遗产·秦始皇陵及兵马俑坑': ['秦始皇陵及兵马俑坑纪念币'],
 '世界文化遗产·曲阜孔庙孔林孔府': ['曲阜孔庙孔林孔府纪念币'],
 '世界文化遗产·明清故宫': ['明清故宫纪念币'],
 '世界文化遗产·苏州古典园林': ['苏州古典园林纪念币'],
 '世界文化遗产·周口店北京人遗址': ['周口店北京人遗址纪念币'],
 '世界文化遗产·丽江古城': ['丽江古城纪念币'],
 '世界文化遗产·青城山与都江堰': ['青城山与都江堰纪念币'],
 '世界文化遗产·龙门石窟': ['龙门石窟纪念币'],
 '世界文化遗产·颐和园': ['颐和园纪念币'],
 '中国宝岛台湾·朝天宫': ['朝天宫纪念币', '宝岛台湾朝天宫纪念币'],
 '中国宝岛台湾·赤嵌楼': ['赤嵌楼纪念币'],
 '中国宝岛台湾·鹅銮鼻': ['鹅銮鼻纪念币'],
 '中国宝岛台湾·日月潭': ['日月潭纪念币'],
 '中国宝岛台湾·敬字亭': ['敬字亭纪念币'],
 '"和"字书法·篆书': ['和字书法篆书纪念币', '篆书和字纪念币'],
 '"和"字书法·隶书': ['和字书法隶书纪念币', '隶书和字纪念币'],
 '环境保护·关注': ['环境保护关注纪念币', '环境保护普通纪念币'],
 '环境保护·参与': ['环境保护参与纪念币', '环境保护普通纪念币'],
 '敦煌藏经洞发现100周年': ['敦煌藏经洞发现100周年纪念币', '敦煌藏经洞纪念币'],
 '人民代表大会成立50周年': ['人民代表大会成立50周年纪念币'],
 '中华人民共和国成立70周年': ['中华人民共和国成立70周年纪念币'],
 '改革开放40周年': ['庆祝改革开放40周年纪念币'],
 '中国人民解放军建军90周年': ['中国人民解放军建军90周年纪念币'],
 '中国共产党成立100周年': ['中国共产党成立100周年纪念币'],
}

def get(u, ref='https://baike.baidu.com/'):
    req = urllib.request.Request(u, headers={'User-Agent': UA, 'Referer': ref})
    with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
        return r.read()

def card(term):
    u = ('https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json'
         '&appid=379020&bk_key=%s&bk_length=600' % urllib.parse.quote(term))
    try:
        return json.loads(get(u).decode('utf-8', 'ignore'))
    except Exception:
        return {}

seed = json.load(open('public/data/coins.json', encoding='utf-8'))['coins']
imgs = json.load(open('public/data/images.json', encoding='utf-8'))
good = json.load(open('_baike/good.json', encoding='utf-8'))
need = [seed[n-1] for n in imgs['mock'] if str(n) not in good]

report = {}
for i, c in enumerate(need, 1):
    terms = TERMS.get(c['name'], [c['name'] + '纪念币', c['name']])
    got = None
    for t in terms:
        j = card(t)
        title, img = (j.get('title') or '').strip(), j.get('image') or ''
        if not title or not img:
            continue
        try:
            raw = get(img, 'https://baike.baidu.com/')
            im = Image.open(io.BytesIO(raw)); im.load()
            if im.width < 260 or im.height < 260:
                continue
            r = im.width / im.height
            if r < 0.55 or r > 1.85:
                continue
            p = '_baike/%03d.jpg' % (c['i'] + 1)
            im.convert('RGB').save(p, 'JPEG', quality=92)
            got = {'ok': True, 'term': t, 'title': title, 'file': p}
            break
        except Exception:
            continue
    report[str(c['i'] + 1)] = got or {'ok': False, 'name': c['name'], 'tried': terms[:3]}
    print('  [%2d/%d] %s %-26s %s' % (i, len(need), '✓' if got else '✗', c['name'][:24],
                                      (got or {}).get('title', '')[:20]))
    time.sleep(0.2)

json.dump(report, open('_baike/retry.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n本轮成功 %d / %d' % (sum(1 for v in report.values() if v.get('ok')), len(need)))
