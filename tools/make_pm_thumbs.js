'use strict';
/**
 * 把 .testdata/pmraw 里的原图做成 480/160 方形缩略图（居中留白，不裁币面）。
 *
 * 为什么要有 Node 版：原来的 tools/make_pm_thumbs.py 依赖 Pillow，
 * 本地和服务器都没有这个包，pip 也装不上；jpeg-js 本来就是依赖，直接用它做。
 *
 * 用法：
 *   node tools/make_pm_thumbs.js                     处理 pmraw 里全部还没生成 480 的图
 *   node tools/make_pm_thumbs.js --codes G20270201,G20270202
 *   node tools/make_pm_thumbs.js --force             连已存在的也重做
 */
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

/** 云集 CDN 有时回 PNG（虽然地址写着 jpg），按文件头判断，不能只看扩展名 */
function decode(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  return jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
}

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, '.testdata', 'pmraw');
const OUTS = [
  [480, path.join(ROOT, 'public', 'img', 'pm', '480')],
  [160, path.join(ROOT, 'public', 'img', 'pm', '160')],
];

const codeIdx = process.argv.indexOf('--codes');
const CODES = codeIdx > 0
  ? String(process.argv[codeIdx + 1] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  : [];
const FORCE = process.argv.indexOf('--force') >= 0;

/** 面积平均缩放 + 白底居中，输出 RGBA */
function square(raw, size) {
  const { width, height, data } = raw;
  const scale = Math.min(size / width, size / height);
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  const x0 = Math.floor((size - dw) / 2);
  const y0 = Math.floor((size - dh) / 2);
  const out = Buffer.alloc(size * size * 4, 255);

  for (let y = 0; y < dh; y += 1) {
    const sy0 = Math.floor((y * height) / dh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * height) / dh));
    for (let x = 0; x < dw; x += 1) {
      const sx0 = Math.floor((x * width) / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * width) / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const i = (sy * width + sx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
      }
      const o = ((y0 + y) * size + (x0 + x)) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

const files = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((f) => f.endsWith('.img')) : [];
const picked = files.filter((f) => {
  const code = f.replace(/\.img$/, '').toUpperCase();
  if (CODES.length && CODES.indexOf(code.replace(/-B$/, '')) < 0) return false;
  if (FORCE) return true;
  return !fs.existsSync(path.join(OUTS[0][1], code + '.jpg'));
});

if (!picked.length) {
  console.log('没有需要处理的图');
  process.exit(0);
}

OUTS.forEach(([, dir]) => fs.mkdirSync(dir, { recursive: true }));
let ok = 0;
for (const f of picked) {
  const code = f.replace(/\.img$/, '');
  try {
    const buf = fs.readFileSync(path.join(RAW, f));
    const raw = decode(buf);
    for (const [size, dir] of OUTS) {
      const rgba = square(raw, size);
      const enc = jpeg.encode({ data: rgba, width: size, height: size }, 87);
      fs.writeFileSync(path.join(dir, code + '.jpg'), enc.data);
    }
    ok += 1;
  } catch (e) {
    console.log('失败 ' + code + '：' + e.message);
  }
}
console.log('完成：' + ok + '/' + picked.length);
