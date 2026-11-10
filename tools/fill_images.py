# -*- coding: utf-8 -*-
"""
补齐图片：
  1) 把新抓到的央行官方图写入 public/img/NNN.jpg
  2) 其余品种生成统一风格的「示意图」（圆币 + 面额 + 年份 + 品种名，明确标注"示意图"）
  3) 输出 public/data/images.json，标记哪些是实拍、哪些是示意
"""
import json, os, textwrap
from PIL import Image, ImageDraw, ImageFont

SIZE = 520
IMG_DIR = 'public/img'
FONT = r'C:\Windows\Fonts\msyh.ttc'
FONT_B = r'C:\Windows\Fonts\msyhbd.ttc'

SERIES_COLOR = {
    'NP': (58, 140, 100), 'WH': (176, 132, 48), 'SX': (176, 62, 40),
    'CN': (52, 96, 150), 'SP': (104, 70, 156), 'WC': (150, 110, 40),
    'TW': (60, 120, 140), 'HZ': (150, 96, 40), 'JJ': (150, 60, 90),
    'PP': (110, 110, 120), 'EV': (130, 100, 60), 'TC': (70, 110, 130),
    'ZT': (140, 110, 60),
}


def font(size, bold=False):
    for p in ([FONT_B, FONT] if bold else [FONT, FONT_B]):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def center_text(d, cx, y, text, f, fill):
    w = d.textbbox((0, 0), text, font=f)[2]
    d.text((cx - w / 2, y), text, font=f, fill=fill)


def make_mock(coin):
    """生成一枚示意币：外圈系列色、中央面额、下方品种名"""
    W = H = SIZE
    im = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(im)
    cx = cy = W // 2
    R = 236
    base = SERIES_COLOR.get(coin['series'], (150, 120, 60))

    # 外圈阴影
    for i in range(14, 0, -1):
        a = 18 - i
        d.ellipse([cx - R - i, cy - R - i + 4, cx + R + i, cy + R + i + 4],
                  outline=(base[0], base[1], base[2]), width=1)
    # 币体：由外到内的渐变环
    # 竖向渐变铺底，再裁成圆
    grad = Image.new('RGB', (W, H))
    gd = ImageDraw.Draw(grad)
    for y in range(H):
        t = y / H
        gd.line([(0, y), (W, y)], fill=(
            int(246 - 34 * t), int(241 - 34 * t), int(222 - 36 * t)))
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)
    im.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(im)

    # 描边与齿边
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=base, width=4)
    for ang in range(0, 360, 4):
        import math
        a = math.radians(ang)
        x1 = cx + (R - 3) * math.cos(a); y1 = cy + (R - 3) * math.sin(a)
        x2 = cx + (R - 12) * math.cos(a); y2 = cy + (R - 12) * math.sin(a)
        d.line([x1, y1, x2, y2], fill=base, width=2)
    d.ellipse([cx - R + 22, cy - R + 22, cx + R - 22, cy + R - 22], outline=base, width=3)
    d.ellipse([cx - R + 30, cy - R + 30, cx + R - 30, cy + R - 30],
              outline=(base[0], base[1], base[2]), width=1)

    # 顶部小字
    center_text(d, cx, cy - 156, '普通纪念币' if coin['kind'] != 'note' else '纪念钞', font(21), (128, 116, 94))

    # 面额
    face = str(coin['face'])
    f_big = font(124 if len(face) <= 2 else 94, True)
    f_unit = font(40, True)
    bw = d.textbbox((0, 0), face, font=f_big)[2]
    uw = d.textbbox((0, 0), '元', font=f_unit)[2]
    total = bw + uw + 8
    x0 = cx - total / 2
    d.text((x0, cy - 74), face, font=f_big, fill=(92, 70, 28))
    d.text((x0 + bw + 8, cy + 26), '元', font=f_unit, fill=(92, 70, 28))

    # 品种名（最多两行）
    name = coin['name']
    if len(name) > 14:
        name = textwrap.fill(name, 9)
    lines = name.split('\n')[:2]
    yy = cy + 96
    for ln in lines:
        center_text(d, cx, yy, ln, font(25), (86, 74, 52))
        yy += 32

    # 年份
    center_text(d, cx, yy + 4, str(coin['year']), font(22), (140, 126, 100))

    # 示意图标记（放底部，避免与主体文字打架）
    center_text(d, cx, yy + 36, '示 意 图', font(18), (152, 136, 106))
    return im


def main():
    coins = json.load(open('public/data/coins.json', encoding='utf-8'))['coins']
    plan = json.load(open('_pbc/plan.json', encoding='utf-8'))

    os.makedirs(IMG_DIR, exist_ok=True)
    real, mock = [], []

    for c in coins:
        no = c['i'] + 1
        out = '%s/%03d.jpg' % (IMG_DIR, no)
        srcs = plan.get(str(c['i']))

        # 已有官方图（早期抓的 21 张）保持不动
        if os.path.exists(out) and not srcs:
            real.append(no)
            continue
        if srcs:
            try:
                im = Image.open(srcs[0]).convert('RGB')
                side = min(im.size)
                im = im.crop(((im.width - side) // 2, (im.height - side) // 2,
                              (im.width + side) // 2, (im.height + side) // 2))
                im = im.resize((SIZE, SIZE), Image.LANCZOS)
                im.save(out, 'JPEG', quality=90, optimize=True)
                real.append(no)
                print('  实拍 → %s  %s' % (os.path.basename(out), c['name']))
                continue
            except Exception as e:
                print('  转换失败，改用示意图：', c['name'], e)

        make_mock(c).save(out, 'JPEG', quality=88, optimize=True)
        mock.append(no)

    manifest = {'real': sorted(real), 'mock': sorted(mock),
                'updated': __import__('datetime').date.today().isoformat()}
    json.dump(manifest, open('public/data/images.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('\n实拍 %d 个，示意图 %d 个，合计 %d' % (len(real), len(mock), len(real) + len(mock)))


if __name__ == '__main__':
    main()
