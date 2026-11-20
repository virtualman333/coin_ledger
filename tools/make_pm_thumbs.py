"""把下载到的贵金属原图做成 480/160 方形缩略图（居中留白，不裁币面）。"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, '.testdata', 'pmraw')
OUTS = [(480, os.path.join(ROOT, 'public', 'img', 'pm', '480')),
        (160, os.path.join(ROOT, 'public', 'img', 'pm', '160'))]

def square(im, size):
    im = im.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGB', (size, size), (255, 255, 255))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas

SUFFIX = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].isdigit() else ''
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else (int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 0)
files = [f for f in os.listdir(RAW) if f.endswith('.img') and (not SUFFIX or f.endswith(SUFFIX + '.img'))]
if LIMIT:
    files = files[:LIMIT]
for d in OUTS:
    os.makedirs(d[1], exist_ok=True)
ok = 0
for f in files:
    code = f[:-4]
    try:
        im = Image.open(os.path.join(RAW, f)).convert('RGB')
        for size, folder in OUTS:
            square(im, size).save(os.path.join(folder, code + '.jpg'), quality=87, optimize=True)
        ok += 1
    except Exception as e:
        print('FAIL', code, e)
print(f'已生成 {ok}/{len(files)} 张 480/160 缩略图')
