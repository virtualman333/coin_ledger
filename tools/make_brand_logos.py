# -*- coding: utf-8 -*-
"""
按 public/logo.svg 的红色印章几何，重新生成 public/brand/ 下所有 PNG。
根因：public/brand/*.png 是 Initial commit 遗留的旧金色铜钱预览素材，
      而线上真正使用的 logo（public/logo.svg + logo-seal.png）早在 11-09
      已换成红底 #B23A2C + 米白 #F6E7C6 的扁平印章版，两者长期不一致。
本脚本以 logo.svg 为唯一真源，4x 超采样精确重绘，保持文件名与尺寸不变。

依赖：Pillow（D:/Program Files/Python312/python.exe 环境）
用法："/d/Program Files/Python312/python.exe" tools/make_brand_logos.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "public", "brand")

# —— 与 logo.svg 完全一致的几何 / 色值 ——
RED = (178, 58, 44)       # #B23A2C 印章红底
CREAM = (246, 231, 198)   # #F6E7C6 米白线条
GRAY = (139, 148, 163)    # #8B94A3 COIN LEDGER 灰蓝（沿用网站 muted）

# SVG viewBox="51 51 922 922"：印章本体是 922×922，圆点 (461,461) 为中心。
ART = 922.0
R_CORNER = 120.0          # 圆角方块 rx
R_RING = 290.5            # 外圆环半径
W_RING = 58.0             # 圆环描边
SQ = 222.0                # 方孔边长
SQ_X0 = 401.0 - 51.0      # 350：方孔左上（相对印章本体）
SQ_RX = 30.0              # 方孔圆角
SS = 4                    # 超采样倍数


def draw_seal(size, fit="contain", corner=R_CORNER):
    """绘制一枚红色印章，输出 size×size 的 RGBA。
    fit='contain'：印章完整显示在画布内（四角透明，等同 logo.svg 渲染）。
    corner：外框圆角半径（相对 922 画布）。传 0 = 直角满幅方图（App/小程序
            头像自带圆角裁切时用，避免出现「双重圆角」）。
    """
    S = size * SS
    scale = S / ART
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 红底（corner=0 时是满幅直角方块）
    pad = 0
    d.rounded_rectangle(
        [pad, pad, S - 1 - pad, S - 1 - pad],
        radius=corner * scale, fill=RED + (255,),
    )
    # 外圆环（画粗圆即可，SVG 里 fill=none stroke=58）
    cx = cy = S / 2.0
    r_out = (R_RING + W_RING / 2) * scale
    r_in = (R_RING - W_RING / 2) * scale
    d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=CREAM + (255,))
    d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=RED + (255,))
    # 中心圆角方孔：米白描边环（外方米白，内方透出红底）
    x0 = SQ_X0 * scale
    x1 = (SQ_X0 + SQ) * scale
    half_w = W_RING / 2 * scale
    d.rounded_rectangle(
        [x0 - half_w, x0 - half_w, x1 + half_w, x1 + half_w],
        radius=(SQ_RX + W_RING / 2) * scale, fill=CREAM + (255,),
    )
    d.rounded_rectangle(
        [x0 + half_w, x0 + half_w, x1 - half_w, x1 - half_w],
        radius=max(SQ_RX - W_RING / 2, 1) * scale, fill=RED + (255,),
    )
    return img.resize((size, size), Image.LANCZOS)


def first_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def make_lockup(size=(1320, 360)):
    """横版组合：左侧红色印章 + 右侧宋体「藏币录」+ 灰蓝 COIN LEDGER。
    透明底，排版沿用旧版 lockup 的左图右文结构。"""
    W, H = size
    S = 4
    W4, H4 = W * S, H * S
    img = Image.new("RGBA", (W4, H4), (0, 0, 0, 0))

    # 印章：高度贴近画布，左侧留一点边距
    seal_h = int(H4 * 0.94)
    seal = draw_seal(seal_h, SS).resize((seal_h, seal_h), Image.LANCZOS)
    img.alpha_composite(seal, (int(H4 * 0.02), (H4 - seal_h) // 2))

    d = ImageDraw.Draw(img)
    text_x = int(H4 * 1.06)

    # 中文品牌名：宋体（Noto Serif SC / Source Han Serif）
    cn_font = first_font([
        r"C:\Windows\Fonts\NotoSerifSC-VF.ttf",
        r"C:\Windows\Fonts\Source Han Serif SC Heavy (TrueType).ttf",
        r"C:\Windows\Fonts\STSONG.TTF",
        r"C:\Windows\Fonts\simsun.ttc",
    ], int(H4 * 0.46))
    # 用 textbbox 精确放置，避免字体 ascent 导致字块下压与英文重叠
    cn = "藏币录"
    cn_box = d.textbbox((text_x, 0), cn, font=cn_font)
    cn_y = int(H4 * 0.16) - cn_box[1]
    d.text((text_x, cn_y), cn, font=cn_font, fill=RED + (255,))

    # 英文副标：等宽字距的 COIN LEDGER
    en_font = first_font([
        r"C:\Windows\Fonts\Deng.ttf",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\arial.ttf",
    ], int(H4 * 0.135))
    en = "C O I N   L E D G E R"
    en_x = text_x + int(H4 * 0.04)
    en_box = d.textbbox((en_x, 0), en, font=en_font)
    en_y = int(H4 * 0.72) - en_box[1]
    d.text((en_x, en_y), en, font=en_font, fill=GRAY + (255,))

    return img.resize((W, H), Image.LANCZOS)


def main():
    os.makedirs(BRAND, exist_ok=True)
    # 主标：红底印章，四角透明（等同 logo.svg）
    for n in (1024, 512, 256):
        p = os.path.join(BRAND, "logo-%d.png" % n)
        draw_seal(n).save(p)
        print("wrote", p)

    # 头像：正方形红底印章（去掉旧深色底）
    for n in (512, 144):
        p = os.path.join(BRAND, "logo-avatar-%d.png" % n)
        draw_seal(n).save(p)
        print("wrote", p)

    # 直角版：满幅方图、四角不切（平台自己会切圆角时用）
    for n in (1024, 512, 256, 144):
        p = os.path.join(BRAND, "logo-square-%d.png" % n)
        draw_seal(n, corner=0.0).save(p)
        print("wrote", p)

    # 横版 lockup
    p = os.path.join(BRAND, "logo-lockup-1320.png")
    make_lockup((1320, 360)).save(p)
    print("wrote", p)

    # —— 站点 / PWA 图标：必须满幅直角 ——
    # 旧图四角透明（圆角切掉了底色），iOS/Android 桌面图标自己会再切一次圆角，
    # 结果出现「双圆角 + 白边」。平台图标一律给直角满幅，圆角交给系统。
    icons = os.path.join(ROOT, "public", "icons")
    os.makedirs(icons, exist_ok=True)
    for name, n in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        p = os.path.join(icons, name)
        draw_seal(n, corner=0.0).convert("RGB").save(p)
        print("wrote", p)


if __name__ == "__main__":
    main()
