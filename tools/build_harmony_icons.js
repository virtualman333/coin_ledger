'use strict';
/**
 * 生成鸿蒙应用图标（上架要求 1024×1024 PNG、无透明背景）。
 * 源图用站点图标 public/icons/icon-512.png，等比放大并补暖白底。
 *
 *   node tools/build_harmony_icons.js
 */
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'icons', 'icon-512.png');
const OUT_ICON = path.join(ROOT, 'harmony', 'AppScope', 'resources', 'base', 'media', 'app_icon.png');
const OUT_START = path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'base', 'media', 'startIcon.png');
const BG = 0xf6f4ef; // 暖白底，与应用主色一致

async function main() {
  const src = await Jimp.read(SRC);
  // 有透明像素时先铺一层暖白底，避免上架审核因透明背景被拒
  const flat = await Jimp.read(SRC);
  flat.scan(0, 0, flat.bitmap.width, flat.bitmap.height, function (x, y, idx) {
    const a = this.bitmap.data[idx + 3];
    if (a < 255) {
      const r = this.bitmap.data[idx];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      const alpha = a / 255;
      const bgR = (BG >> 16) & 0xff;
      const bgG = (BG >> 8) & 0xff;
      const bgB = BG & 0xff;
      this.bitmap.data[idx] = Math.round(r * alpha + bgR * (1 - alpha));
      this.bitmap.data[idx + 1] = Math.round(g * alpha + bgG * (1 - alpha));
      this.bitmap.data[idx + 2] = Math.round(b * alpha + bgB * (1 - alpha));
      this.bitmap.data[idx + 3] = 255;
    }
  });

  const icon = flat.clone().resize(1024, 1024, Jimp.RESIZE_BICUBIC);
  await icon.writeAsync(OUT_ICON);
  const start = flat.clone().resize(512, 512, Jimp.RESIZE_BICUBIC);
  await start.writeAsync(OUT_START);
  console.log('  · 应用图标 1024×1024 → ' + path.relative(ROOT, OUT_ICON));
  console.log('  · 启动图标 512×512 → ' + path.relative(ROOT, OUT_START));
  if (src.bitmap.width !== 1024) {
    console.log('  ! 源图为 ' + src.bitmap.width + 'px，已放大；正式上架建议换成设计源文件导出的 1024 图标');
  }
}

main().catch((e) => {
  console.error('生成图标失败：' + e.message);
  process.exit(1);
});
