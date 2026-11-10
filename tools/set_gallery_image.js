'use strict';
/**
 * 手工替换/追加某个品种的图片。
 *
 * 图库是 public/data/gallery.json，结构：{ coins: { "编号": [{f,k}] } }
 * k 取值：main（主图）| obverse（正面）| reverse（背面）| set（整套/正反面并排）
 *
 *   node tools/set_gallery_image.js --id 2 --kind reverse --file D:/图/西藏背面.png
 *   node tools/set_gallery_image.js --id 2 --remove reverse
 *   node tools/set_gallery_image.js --list 2
 *
 * 会把图片压到 900px 内、写成 public/img/<编号>-<后缀>.jpg，并更新 gallery.json。
 * 之后重新打包小程序数据：node tools/build_mp_data.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'public', 'img');
const GALLERY = path.join(ROOT, 'public', 'data', 'gallery.json');
const PY = process.env.PY312 || 'D:/Program Files/Python312/python.exe';

const KIND = { main: { suffix: '', label: '主图' }, obverse: { suffix: '-f', label: '正面' }, reverse: { suffix: '-b', label: '背面' }, set: { suffix: '-s', label: '整套' } };

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.indexOf('--' + name) > 0;

const gallery = JSON.parse(fs.readFileSync(GALLERY, 'utf8'));
gallery.coins = gallery.coins || {};

const id = arg('id');
if (!id) {
  console.error('用法：node tools/set_gallery_image.js --id 2 --kind reverse --file 图片路径');
  process.exit(1);
}
const cid = String(Number(id));
const items = gallery.coins[cid] || [];

if (has('list')) {
  console.log(`品种 ${cid} 的图：`);
  items.forEach((it) => console.log(`  ${it.k.padEnd(8)} ${it.f}  (${(KIND[it.k] || {}).label || it.k})`));
  process.exit(0);
}

if (has('remove')) {
  const kind = arg('remove');
  const idx = items.findIndex((it) => it.k === kind);
  if (idx < 0) {
    console.log(`没有 ${kind}，无需删除`);
    process.exit(0);
  }
  const gone = items.splice(idx, 1)[0];
  const file = path.join(IMG_DIR, gone.f);
  if (fs.existsSync(file) && gone.k !== 'main') fs.unlinkSync(file);
  gallery.coins[cid] = items;
  fs.writeFileSync(GALLERY, JSON.stringify(gallery, null, 0) + '\n', 'utf8');
  console.log(`已移除 ${gone.f}`);
  process.exit(0);
}

const kind = arg('kind', 'reverse');
const file = arg('file');
if (!KIND[kind] || !file) {
  console.error('需要 --kind（main/obverse/reverse/set）与 --file');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('找不到文件：' + file);
  process.exit(1);
}

const fname = cid.padStart(3, '0') + KIND[kind].suffix + '.jpg';
const out = path.join(IMG_DIR, fname);
// 用 Pillow 统一转 JPEG 并限制尺寸（本机有 Python312 + Pillow）
execFileSync(PY, ['-c', [
  'import sys',
  'from PIL import Image',
  'im = Image.open(sys.argv[1]).convert("RGB")',
  'w,h = im.size',
  's = min(1.0, 900.0/max(w,h))',
  'im = im.resize((max(1,int(w*s)), max(1,int(h*s))), Image.LANCZOS) if s < 1 else im',
  'im.save(sys.argv[2], "JPEG", quality=86, optimize=True, progressive=True)',
  'print(im.size)',
].join('\n'), file, out], { stdio: 'inherit' });

const idx = items.findIndex((it) => it.k === kind);
if (idx >= 0) items[idx].f = fname;
else items.push({ f: fname, k: kind });
gallery.coins[cid] = items;
gallery.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(GALLERY, JSON.stringify(gallery, null, 0) + '\n', 'utf8');

console.log(`已写入 public/img/${fname}（${KIND[kind].label}）`);
console.log('记得重新打包小程序数据：node tools/build_mp_data.js');
