# -*- coding: utf-8 -*-
"""把 2000 年以前的普通纪念币并入 coins.json（插在最前，全量重编号 + 图片改名）"""
import json, os, shutil

# 年份, 名称, 系列, 面额, 发行量(万), 材质, 直径, 一套几枚, 参考市价
PRE = [
 (1984,'中华人民共和国成立三十五周年','EV',1,2041,'铜镍合金',30,3,420),
 (1985,'庆祝西藏自治区成立20周年','ZZ',1,261.2,'铜镍合金',30,1,360),
 (1985,'新疆维吾尔自治区成立30周年','ZZ',1,450,'铜镍合金',30,1,320),
 (1986,'国际和平年','ZT',1,2704.8,'铜镍合金',30,1,32),
 (1987,'内蒙古自治区成立四十周年','ZZ',1,905.4,'铜镍合金',30,1,110),
 (1987,'中华人民共和国第六届运动会','SP',0.1,351,'铜锌合金',20,3,520),
 (1988,'宁夏回族自治区成立三十周年','ZZ',1,156,'铜镍合金',30,1,760),
 (1988,'中国人民银行成立四十周年','EV',1,206.8,'铜镍合金',30,1,2900),
 (1988,'广西壮族自治区成立三十周年','ZZ',1,407.2,'铜镍合金',30,1,160),
 (1989,'中华人民共和国成立四十周年','EV',1,2100,'铜镍合金',30,1,48),
 (1990,'第十一届亚洲运动会','SP',1,1280.4,'钢芯镀镍',30,2,65),
 (1991,'全民义务植树运动十周年','ZT',1,1000,'钢芯镀镍',25,3,38),
 (1991,'中国共产党成立七十周年','EV',1,3000,'钢芯镀镍',25,3,45),
 (1991,'第一届世界女子足球锦标赛','SP',1,1000,'钢芯镀镍',25,2,55),
 (1992,'宪法颁布十周年','EV',1,1000,'钢芯镀镍',25,1,62),
 (1993,'宋庆龄诞辰100周年','PP',1,1044.8,'钢芯镀镍',25,1,48),
 (1993,'中国珍稀野生动物——大熊猫','DW',5,600,'紫铜合金',32,1,130),
 (1993,'毛泽东诞辰100周年','PP',1,2000,'钢芯镀镍',25,1,46),
 (1994,'“希望工程”实施5周年','ZT',1,2000,'钢芯镀镍',25,1,26),
 (1995,'第四十三届世界乒乓球锦标赛','SP',1,1000,'钢芯镀镍',25,1,28),
 (1995,'中国抗日战争和世界反法西斯战争胜利50周年','EV',1,1000,'钢芯镀镍',25,1,32),
 (1995,'联合国第四次世界妇女大会','EV',1,1000,'钢芯镀镍',25,1,30),
 (1995,'联合国成立五十周年','EV',1,1000,'钢芯镀镍',25,1,28),
 (1995,'中国珍稀野生动物——金丝猴','DW',5,600,'紫铜合金',32,1,95),
 (1996,'朱德诞辰110周年','PP',1,1000,'钢芯镀镍',25,1,38),
 (1996,'中国珍稀野生动物——白鳍豚','DW',5,600,'紫铜合金',32,1,92),
 (1996,'中国珍稀野生动物——华南虎','DW',5,600,'紫铜合金',32,1,98),
 (1997,'庆祝香港特别行政区成立','HG',10,2000,'双色铜合金',25,2,42),
 (1998,'周恩来诞辰100周年','PP',1,2000,'钢芯镀镍',25,1,42),
 (1998,'中国珍稀野生动物——朱鹮','DW',5,600,'紫铜合金',32,1,88),
 (1998,'中国珍稀野生动物——丹顶鹤','DW',5,600,'紫铜合金',32,1,88),
 (1998,'中国珍稀野生动物——褐马鸡','DW',5,600,'紫铜合金',32,1,88),
 (1998,'中国珍稀野生动物——扬子鳄','DW',5,600,'紫铜合金',32,1,88),
 (1998,'刘少奇诞辰100周年','PP',1,2000,'钢芯镀镍',25,1,38),
 (1999,'中国珍稀野生动物——中华鲟','DW',5,600,'紫铜合金',32,1,88),
 (1999,'中国珍稀野生动物——金斑喙凤蝶','DW',5,600,'紫铜合金',32,1,92),
 (1999,'中国人民政治协商会议成立五十周年','EV',1,1000,'钢芯镀镍',25,1,26),
 (1999,'中华人民共和国成立五十周年','EV',10,1000,'双色铜合金',25,1,46),
 (1999,'庆祝澳门特别行政区成立','HG',10,2000,'双色铜合金',25,2,42),
 (1999,'庆祝中华人民共和国成立50周年纪念钞','CN',50,5000,'纸质','—',1,280),
]

# 一套 N 枚 → setId（仅用于多枚发行）
SETS = {'中华人民共和国成立三十五周年':'jg35','中华人民共和国第六届运动会':'lh6',
        '第十一届亚洲运动会':'yz11','全民义务植树运动十周年':'zs10',
        '中国共产党成立七十周年':'jd70','第一届世界女子足球锦标赛':'nzf',
        '庆祝香港特别行政区成立':'hk97','庆祝澳门特别行政区成立':'mo99'}
SET_NAMES = {'jg35':'建国三十五周年','lh6':'第六届全运会','yz11':'第十一届亚运会',
             'zs10':'全民义务植树十周年','jd70':'建党七十周年','nzf':'第一届女足世锦赛',
             'hk97':'香港回归','mo99':'澳门回归','dw':'中国珍稀野生动物'}

p = 'public/data/coins.json'
d = json.load(open(p, encoding='utf-8'))
old = d['coins']
shift = len(PRE)

# 1) 图片文件整体后移，给新币腾出编号
img_dir = 'public/img'
files = sorted(os.listdir(img_dir))
for f in reversed(files):
    n = int(f[:3])
    shutil.move(os.path.join(img_dir, f), os.path.join(img_dir, '%03d.jpg' % (n + shift)))

# 2) 组装新清单
coins = []
for k, (y, name, ser, face, mint, mat, dia, pieces, est) in enumerate(PRE):
    c = {'i': k, 'year': y, 'name': name, 'series': ser, 'face': face,
         'mintage': mint, 'material': mat, 'dia': dia, 'kind': 'note' if '纪念钞' in name else 'coin',
         'est': est, 'set': 'single', 'pieces': pieces}
    sid = SETS.get(name)
    if sid: c['set'] = sid
    if ser == 'DW': c['set'] = 'dw'
    coins.append(c)

for j, c in enumerate(old):
    c = dict(c)
    c['i'] = shift + j
    c.setdefault('pieces', 1)
    coins.append(c)

# 3) 套系定义（旧的成员数量不变，新增多枚发行的套）
sets = d['sets']
members = {}
for c in coins:
    if c['set'] != 'single':
        members.setdefault(c['set'], []).append(c)
for sid, arr in members.items():
    if sid in sets:
        sets[sid]['total'] = max(sets[sid]['total'], len(arr))
        sets[sid]['members'] = len(arr)
    else:
        sets[sid] = {'name': SET_NAMES.get(sid, sid), 'unit': '枚', 'total': len(arr), 'members': len(arr)}

# 4) 系列中文名
series = d['series']
series.update({'ZZ': '自治区成立', 'HG': '回归纪念', 'DW': '珍稀野生动物'})

d['coins'] = coins
d['sets'] = sets
d['series'] = series
d['meta'] = {'count': len(coins), 'generated': d.get('meta', {}).get('generated', '')}
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# 5) 索引文件跟着改
im = json.load(open('public/data/images.json', encoding='utf-8'))
im['real'] = [n + shift for n in im['real']] + list(range(1, shift + 1))
im['mock'] = [n + shift for n in im['mock']]
json.dump(im, open('public/data/images.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

dp = 'public/data/descriptions.json'
de = json.load(open(dp, encoding='utf-8'))
de = {str(int(k) + shift): v for k, v in de.items()}
json.dump(de, open(dp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

print('新增 %d 个品种，总数 %d' % (shift, len(coins)))
print('套系:', ', '.join('%s(%d)' % (v['name'], v['total']) for k, v in sets.items()))
