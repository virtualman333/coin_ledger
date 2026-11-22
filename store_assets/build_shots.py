# -*- coding: utf-8 -*-
"""把真机截图合成为华为应用市场 1080x1920 应用介绍截图。"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = r'C:\Users\15155\WorkBuddy\2026-11-08-13-06-21'
RAW = os.path.join(ROOT, 'store_assets', 'raw')
OUT = os.path.join(ROOT, 'store_assets', 'screenshots')
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1920
BOLD = r'C:\Windows\Fonts\msyhbd.ttc'
REG = r'C:\Windows\Fonts\msyh.ttc'

GOLD = (154, 107, 31)
GOLD_DEEP = (122, 84, 26)
INK = (28, 28, 30)
MUTED = (110, 110, 115)

ITEMS = [
    ('01_home.jpeg', '137 个品种，一屏看懂家底', '账本自动算市值，发行计划不错过'),
    ('02_plan.jpeg', '央行公告同步的发行计划', '待发行、预约时间、增发一目了然'),
    ('03_list.jpeg', '按年份 · 系列 · 面额查', '发行量、图案说明、推理价都在一页'),
    ('04_detail.jpeg', '每枚币的完整档案', '参数、正反面图案、AI 参考价'),
    ('05_mine.jpeg', '登录即同步', '换手机、用网页版都能接着记'),
]


def vertical_gradient(size, top, bottom):
    img = Image.new('RGB', size, top)
    d = ImageDraw.Draw(img)
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (size[0], y)], fill=c)
    return img


def add_glow(img):
    """左上一枚暖金光晕，柔和不刺眼。"""
    glow = Image.new('L', img.size, 0)
    gd = ImageDraw.Draw(glow)
    cx, cy, r = 170, 120, 620
    gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    warm = Image.new('RGB', img.size, (247, 233, 206))
    return Image.composite(warm, img, glow)


def rounded_mask(size, radius):
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def paste_screen(canvas, shot_path, box_w, box_h, top_y, radius=38, border=7):
    shot = Image.open(shot_path).convert('RGB')
    # 等比缩放到目标宽高（1276x2848 与目标比例一致，直接拉满）
    shot = shot.resize((box_w, box_h), Image.LANCZOS)
    shot.putalpha(rounded_mask((box_w, box_h), radius))

    cx = (W - box_w) // 2
    # 投影
    shadow = Image.new('RGBA', (box_w + 80, box_h + 80), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([40, 40, 40 + box_w, 40 + box_h], radius=radius, fill=(90, 70, 40, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas.paste(shadow, (cx - 40, top_y - 40 + 18), shadow)

    # 白色描边（模拟机身）
    frame = Image.new('RGBA', (box_w + border * 2, box_h + border * 2), (255, 255, 255, 255))
    frame.putalpha(rounded_mask((box_w + border * 2, box_h + border * 2), radius + border))
    canvas.paste(frame, (cx - border, top_y - border), frame)
    canvas.paste(shot, (cx, top_y), shot)


def draw_centered(draw, text, font, y, fill):
    w = draw.textlength(text, font=font)
    draw.text(((W - w) / 2, y), text, font=font, fill=fill)


def build(idx, raw_name, title, sub):
    canvas = vertical_gradient((W, H), (253, 251, 247), (241, 232, 216)).convert('RGB')
    canvas = add_glow(canvas)
    d = ImageDraw.Draw(canvas)

    # 品牌行
    f_brand = ImageFont.truetype(BOLD, 26)
    draw_centered(d, '藏币录  ·  中国纪念币图鉴', f_brand, 84, GOLD)

    # 标题（过长自动换行到两行）
    f_title = ImageFont.truetype(BOLD, 54)
    lines = [title] if d.textlength(title, font=f_title) < W - 140 else []
    if not lines:
        # 简单二分，按标点切开
        for sep in ['，', '。']:
            if sep in title:
                a, b = title.split(sep, 1)
                lines = [a + sep, b]
                break
    y = 150
    for line in lines:
        draw_centered(d, line, f_title, y, INK)
        y += 74

    f_sub = ImageFont.truetype(REG, 30)
    draw_centered(d, sub, f_sub, y + 6, MUTED)

    # 手机
    box_w = 626
    box_h = round(box_w * 2848 / 1276)  # 保持截图比例
    top_y = 1780 - box_h
    paste_screen(canvas, os.path.join(RAW, raw_name), box_w, box_h, top_y)

    # 底部
    f_foot = ImageFont.truetype(REG, 24)
    draw_centered(d, 'coin.virtualman.top', f_foot, 1808, (150, 140, 125))
    d.line([(W / 2 - 40, 1772), (W / 2 + 40, 1772)], fill=(206, 186, 150), width=3)

    path = os.path.join(OUT, f'{idx:02d}.png')
    canvas.save(path, 'PNG', optimize=True)
    print('saved', path, canvas.size)


for i, (raw, title, sub) in enumerate(ITEMS, start=1):
    build(i, raw, title, sub)
