# -*- coding: utf-8 -*-
"""
统一缩略图：把每枚币的实拍图「裁掉自带白边 → 补成正方形 → 缩放」，
输出到 public/img/th/<编号>.jpg。

背景：首页/我的收藏的卡片是固定尺寸方形图区（aspectFill），
但源图里币占画布的比例差别很大（有的四周留白 30%），
导致同一个框里图看起来大小不一。裁掉背景再补方，才能让视觉大小一致。

    python312 tools/make_thumbs.py            # 全量
    python312 tools/make_thumbs.py --only 120 # 单张
"""
import os
import statistics
import sys

from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, 'public', 'img')
OUT_DIR = os.path.join(IMG_DIR, 'th')
SMALL_DIR = os.path.join(OUT_DIR, 's')   # 列表缩略，160px（约为原图 1/4 体积）
SIZE = 480
SMALL = 160
MARGIN = 0.04          # 裁完四周留一点白
BG_TOL = 20            # 与背景色的差异阈值


def content_bbox(im):
    """用四角颜色当背景色，找内容边界；失败返回 None"""
    w, h = im.size
    pts = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]
    corners = [im.getpixel(p) for p in pts]
    if isinstance(corners[0], int):
        bg = (int(statistics.median(corners)),) * 3
    else:
        bg = tuple(int(statistics.median([c[i] for c in corners])) for i in range(3))
    diff = ImageChops.difference(im, Image.new('RGB', im.size, bg))
    mask = diff.convert('L').point(lambda v: 255 if v > BG_TOL else 0)
    bbox = mask.getbbox()
    if not bbox:
        return None
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if bw < w * 0.25 or bh < h * 0.25:      # 框太小，多半是误判
        return None
    return bbox


def build(src, dst, small_dst):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    bbox = content_bbox(im)
    if bbox:
        im = im.crop(bbox)
    cw, ch = im.size
    side = int(max(cw, ch) * (1 + MARGIN * 2))
    canvas = Image.new('RGB', (side, side), (255, 255, 255))
    canvas.paste(im, ((side - cw) // 2, (side - ch) // 2))
    full = canvas
    if side > SIZE:
        full = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    full.save(dst, 'JPEG', quality=86, optimize=True, progressive=True)
    small = full.resize((SMALL, SMALL), Image.LANCZOS)
    small.save(small_dst, 'JPEG', quality=78, optimize=True, progressive=True)
    return (side > SIZE and SIZE or side), bool(bbox)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(SMALL_DIR, exist_ok=True)
    only = None
    if '--only' in sys.argv:
        only = int(sys.argv[sys.argv.index('--only') + 1])

    files = sorted(f for f in os.listdir(IMG_DIR) if f.endswith('.jpg') and f[:3].isdigit() and len(f) == 7)
    done = cropped = 0
    for f in files:
        num = int(f[:3])
        if only and num != only:
            continue
        src = os.path.join(IMG_DIR, f)
        dst = os.path.join(OUT_DIR, '%03d.jpg' % num)
        small_dst = os.path.join(SMALL_DIR, '%03d.jpg' % num)
        try:
            _size, did_crop = build(src, dst, small_dst)
        except Exception as ex:
            print('跳过 %s：%s' % (f, ex))
            continue
        done += 1
        cropped += 1 if did_crop else 0
    print('缩略图完成：%d 张，其中裁掉白边 %d 张 → %s' % (done, cropped, OUT_DIR))


if __name__ == '__main__':
    main()
