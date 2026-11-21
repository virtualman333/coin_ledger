#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成上架用的应用图标（HarmonyOS / AGC、应用商店都对这套规格）：
  · 正方形，216×216 或 1024×1024
  · PNG ≤ 3MB，或 WEBP ≤ 100KB
  · 不透明（平台自己切圆角，图标本身给满幅直角，避免二次圆角露白边）

图形沿用品牌印章（public/logo-square.svg 的同一套几何），
和 tools/make_brand_logos.py 共用 draw_seal()，保证和站内 logo 是同一个 logo。

用法："/d/Program Files/Python312/python.exe" tools/make_app_icon.py
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from make_brand_logos import draw_seal  # noqa: E402

OUT = os.path.join(ROOT, 'deliverables', 'app-icon')
SIZES = (1024, 216)


def main():
    os.makedirs(OUT, exist_ok=True)
    for n in SIZES:
        # 直角满幅 + 去掉 alpha 通道：AGC 明确要求图标不能带透明
        img = draw_seal(n, corner=0.0).convert('RGB')
        png = os.path.join(OUT, 'coinledger-icon-%d.png' % n)
        img.save(png, 'PNG', optimize=True)
        print('wrote %s (%d KB)' % (png, os.path.getsize(png) // 1024))

        # WEBP 限 100KB：先用 82 的质量，超了再往下降
        webp = os.path.join(OUT, 'coinledger-icon-%d.webp' % n)
        q = 82
        while q >= 40:
            img.save(webp, 'WEBP', quality=q, method=6)
            if os.path.getsize(webp) <= 100 * 1024:
                break
            q -= 6
        print('wrote %s (q=%d, %d KB)' % (webp, q, os.path.getsize(webp) // 1024))


if __name__ == '__main__':
    main()
