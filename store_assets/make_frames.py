# -*- coding: utf-8 -*-
"""生成宣传视频的帧序列（交叉淡化），再用 ffmpeg 编码为 H.264 MP4。"""
import os
from PIL import Image

ROOT = r'C:\Users\15155\WorkBuddy\2026-11-08-13-06-21'
SHOTS = os.path.join(ROOT, 'store_assets', 'screenshots')
OUT = os.path.join(ROOT, 'store_assets', 'video', 'frames')
os.makedirs(OUT, exist_ok=True)

SEG = 3.0      # 每张停留
TRANS = 0.5    # 过渡时长
FPS = 30


def main():
    names = sorted(n for n in os.listdir(SHOTS) if n.lower().endswith('.png'))
    imgs = [Image.open(os.path.join(SHOTS, n)).convert('RGB') for n in names]
    n = len(imgs)
    total = n * SEG - (n - 1) * TRANS
    frames = int(round(total * FPS))
    print('images', n, 'duration', total, 'frames', frames)

    for f in range(frames):
        t = f / FPS
        idx = 0
        for i in range(n):
            if t >= i * (SEG - TRANS):
                idx = i
        start = idx * (SEG - TRANS)
        if idx + 1 < n and t - start < TRANS:
            a = (t - start) / TRANS
            frame = Image.blend(imgs[idx], imgs[idx + 1], a)
        else:
            frame = imgs[idx]
        frame.save(os.path.join(OUT, 'f_%04d.png' % f))
        if f % 90 == 0:
            print('frame', f)
    print('done', frames)


main()
