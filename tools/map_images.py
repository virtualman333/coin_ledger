# -*- coding: utf-8 -*-
"""把抓到的官方图案裁边、缩放，按清单顺序命名为 public/img/001.jpg … 095.jpg"""
import re, os, json
from PIL import Image

os.makedirs('public/img', exist_ok=True)

# 品种名 -> 源图（来自央行公告附件提取结果，经人工核对为「币/钞的主题面」）
MAP = {
    '世界文化和自然遗产·泰山': '_raw2/015_0_1.jpg',
    '世界文化和自然遗产·武夷山': None,  # 2020 年公告未取得，保留示意图
    '第24届冬奥会·冰上运动': '_raw2/013_0_1.jpg',
    '第24届冬奥会·雪上运动': '_raw2/013_0_3.jpg',
    '第24届冬奥会纪念钞（对钞 2 张）': '_raw2/012_0_0.jpg',
    '2022年贺岁（虎）': '_raw2/011_0_1.jpg',
    '2023年贺岁（兔）': '_raw2/010_0_1.jpg',
    '世界文化和自然遗产·黄山': '_raw2/009_0_1.jpg',
    '世界文化和自然遗产·峨眉山-乐山大佛': '_raw2/009_0_3.jpg',
    '三江源国家公园': '_raw2/008_0_1.jpg',
    '大熊猫国家公园': '_raw2/008_0_3.jpg',
    '中国京剧艺术·生角': '_raw2/007_0_1.jpg',
    '东北虎豹国家公园': '_raw3/东北虎豹_1.jpg',
    '中国京剧艺术·旦角': '_raw2/006_0_1.jpg',
    '2025年贺岁（蛇）': '_raw2/005_0_1.jpg',
    '海南热带雨林国家公园': '_raw2/004_0_1.jpg',
    '抗战胜利80周年': '_raw2/003_0_1.jpg',
    '2025年贺岁纪念钞（蛇钞）': '_raw2/005_0_2.jpg',
    '2026年贺岁（马·二轮收官）': '_raw3/2026贺岁_1.jpg',
    '武夷山国家公园': '_raw2/002_0_1.jpg',
    '江泽民诞辰100周年': '_raw2/001_0_1.jpg',
    '2026年贺岁纪念钞（马钞）': '_raw3/2026贺岁_2.jpg',
}

def names_from_html():
    h = open('index.html', encoding='utf-8').read()
    block = re.search(r'var RAW = \[([\s\S]*?)\n\];', h).group(1)
    out = []
    for line in block.split('\n'):
        m = re.match(r"\[(\d{4}),'([^']+)'", line.strip())
        if m:
            out.append((int(m.group(1)), m.group(2)))
    return out

def trim(im):
    """裁掉四周白底"""
    rgb = im.convert('RGB')
    g = rgb.convert('L')
    mask = g.point(lambda v: 255 if v < 244 else 0)
    box = mask.getbbox()
    if not box:
        return rgb
    w, h = rgb.size
    pad_x = int((box[2] - box[0]) * 0.05)
    pad_y = int((box[3] - box[1]) * 0.05)
    box = (max(0, box[0] - pad_x), max(0, box[1] - pad_y),
           min(w, box[2] + pad_x), min(h, box[3] + pad_y))
    return rgb.crop(box)

def main():
    rows = names_from_html()
    made = []
    for i, (year, name) in enumerate(rows):
        src = MAP.get(name)
        if not src or not os.path.exists(src):
            continue
        im = trim(Image.open(src))
        ratio = im.width / im.height
        if ratio < 0.75:          # 竖版纪念钞
            newh = 520
            neww = max(1, int(newh * ratio))
        else:                      # 圆形纪念币
            side = 520
            neww = newh = side
        im = im.resize((neww, newh), Image.LANCZOS)
        # 统一贴到白底画布，避免透明/杂边
        canvas = Image.new('RGB', (neww, newh), (255, 255, 255))
        canvas.paste(im, (0, 0))
        fn = f'public/img/{i+1:03d}.jpg'
        canvas.save(fn, 'JPEG', quality=86, optimize=True)
        made.append((fn, name, canvas.size))
    for fn, name, size in made:
        print(fn, size, name)
    print('total', len(made))

if __name__ == '__main__':
    main()
