'use strict';
/**
 * 纯 JS 图像硬币计数（无 AI、无原生依赖）。
 *
 * 原理：读像素 → 灰度 → 背景归一化阈值二值化 → chamfer 距离变换 →
 *       找距离局部极大值（每个亮圆内部一个种子）→ 半径/间距过滤 → 计数。
 *
 * 为什么用「距离局部极大」而不是连通域：一堆币常互相接触/轻微重叠，
 * 连通域会粘成一块；而每个圆内部各有一个「离背景最远」的中心点，
 * 用种子数统计对粘连更鲁棒。
 *
 * 不依赖图片内容识别（哪枚币），只数「圆形亮斑」的个数 —— 这是工具属性，
 * 不涉及 AI 生成/问答，规避个人主体小程序的深度合成类目红线。
 */
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const MAX_SIDE = 1000;        // 解码后缩放的最大边，控制计算量
const MIN_RADIUS = 8;         // 最小半径绝对下限（像素，缩放后）
const MIN_RADIUS_RATIO = 0.028; // 同时按短边取比例下限，避免小半径纹理被当成币
const MAX_RADIUS_RATIO = 0.25;  // 单个亮斑半径超过短边这个比例，当成大块背景丢弃
const RING_SAMPLES = 24;      // 环形边界验证的采样点数
const RING_INNER = 0.80;      // 内环采样半径系数（应落在前景内）
const RING_OUTER = 1.18;      // 外环采样半径系数（应落在背景里）
const RADIUS_KEEP_RATIO = 0.45; // 半径小于参考半径该比例的种子丢弃（内部纹理）
const NMS_FACTOR = 0.9;       // NMS 抑制距离系数（越大越严格合并近邻）

/** 解码 buffer 为 {width,height,data:Uint8Array RGBA}，超大图等比缩小 */
function decode(buf) {
  let img;
  // 先读头部判断格式，避免 jpeg-js 对 png 报错
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    img = PNG.sync.read(buf);
  } else {
    img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  }
  const maxSide = Math.max(img.width, img.height);
  if (maxSide <= MAX_SIDE) return { width: img.width, height: img.height, data: img.data };
  const scale = MAX_SIDE / maxSide;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const s = (sy * img.width + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2]; out[d + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** 灰度 + 直方图自动阈值（Otsu），亮币暗背景或暗币亮背景都能处理 */
function binarize(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const g = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    gray[i] = g; hist[g]++;
  }
  // Otsu
  let total = 0, sum = 0;
  for (let t = 0; t < 256; t++) { total += hist[t]; sum += t * hist[t]; }
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  // 判断币是亮还是暗：比较高于阈值/低于阈值两类的像素占比。
  // 桌面上的币通常比背景亮（金属反光），取亮的一极作为前景。
  let bright = 0;
  for (let i = 0; i < n; i++) if (gray[i] > thr) bright++;
  const brightRatio = bright / n;
  const fgIsBright = brightRatio <= 0.5; // 前景（币）占少数的一极
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const isBright = gray[i] > thr;
    bin[i] = (isBright === fgIsBright) ? 1 : 0;
  }
  return { bin, gray, thr, fgIsBright };
}

/** chamfer 距离变换（两遍扫描，3-4 近似欧氏），返回每个前景点到最近背景的距离 */
function distanceTransform(bin, w, h) {
  const n = w * h;
  const D = new Float32Array(n);
  const BIG = 1e9;
  for (let i = 0; i < n; i++) D[i] = bin[i] ? BIG : 0;
  const d1 = 1, d2 = 1.4142;
  // 左上 -> 右下
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bin[i]) continue;
      let v = D[i];
      if (x > 0) v = Math.min(v, D[i - 1] + d1);
      if (y > 0) {
        v = Math.min(v, D[i - w] + d1);
        if (x > 0) v = Math.min(v, D[i - w - 1] + d2);
        if (x < w - 1) v = Math.min(v, D[i - w + 1] + d2);
      }
      D[i] = v;
    }
  }
  // 右下 -> 左上
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!bin[i]) continue;
      let v = D[i];
      if (x < w - 1) v = Math.min(v, D[i + 1] + d1);
      if (y < h - 1) {
        v = Math.min(v, D[i + w] + d1);
        if (x > 0) v = Math.min(v, D[i + w - 1] + d2);
        if (x < w - 1) v = Math.min(v, D[i + w + 1] + d2);
      }
      D[i] = v;
    }
  }
  return D;
}

/**
 * 填充前景内部被误判为背景的封闭小洞。
 * 币面图案/阴影常比阈值暗，Otsu 会把它们切成背景，实心币变成「带洞亮岛」，
 * 距离变换会在每个残留小岛上产生局部极大（即大量内部纹理误检）。
 * 从图像四边的背景做 flood fill，未被触及的背景即为币内封闭洞，填回前景。
 * 不改变与图像边缘连通的真实背景，因此不会把相邻币粘在一起。
 */
function fillHoles(bin, w, h) {
  const n = w * h;
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = function (i) {
    if (i < 0 || i >= n || bin[i] || visited[i]) return;
    visited[i] = 1; stack[sp++] = i;
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  const out = new Uint8Array(bin);
  for (let i = 0; i < n; i++) if (!bin[i] && !visited[i]) out[i] = 1;
  return out;
}

/**
 * 环形边界验证：真币中心的内环应落在前景里、外环应落到背景里。
 * 币内纹理/噪点虽是距离局部极大，但其外环仍在币面内部（前景），据此剔除。
 * 轻微接触的双币在外环方向可能仍见前景，阈值留有冗余以保留真币。
 */
function hasCircularBoundary(bin, w, h, x, y, r) {
  let inner = 0, outer = 0, total = 0;
  for (let k = 0; k < RING_SAMPLES; k++) {
    const a = (k * 2 * Math.PI) / RING_SAMPLES;
    const cos = Math.cos(a), sin = Math.sin(a);
    const ix = Math.round(x + r * RING_INNER * cos);
    const iy = Math.round(y + r * RING_INNER * sin);
    const ox = Math.round(x + r * RING_OUTER * cos);
    const oy = Math.round(y + r * RING_OUTER * sin);
    total++;
    // 越界按背景处理（相当于离开图像，不构成前景延续）
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
    if (bin[iy * w + ix]) inner++;
    if (ox >= 0 && oy >= 0 && ox < w && oy < h && !bin[oy * w + ox]) outer++;
  }
  return inner / total >= 0.6 && outer / total >= 0.45;
}

/**
 * 统计硬币：找距离局部极大种子，按半径与最小间距过滤。
 * @param {Buffer} buf 图片 buffer（jpeg/png）
 * @param {object} opt { minRadius, maxRadius, minDistance }
 * @returns {object} { ok, count, seeds, width, height, threshold, ms }
 */
function count(buf, opt) {
  const t0 = Date.now();
  const o = opt || {};
  const img = decode(buf);
  const raw = binarize(img).bin;
  const w = img.width, h = img.height;
  // 先填平币内被误判为背景的暗色图案/阴影，恢复实心圆，避免纹理岛假种子
  const bin = fillHoles(raw, w, h);
  const D = distanceTransform(bin, w, h);
  const shortSide = Math.min(w, h);
  // 半径下限：用户指定值与「绝对下限 / 短边比例下限」取最大
  const minR = Math.max(o.minRadius || MIN_RADIUS, MIN_RADIUS, Math.round(shortSide * MIN_RADIUS_RATIO));
  const maxR = o.maxRadius || Math.round(shortSide * MAX_RADIUS_RATIO);

  // 候选：距离 >= minR 的前景点，且在 3x3 邻域内是局部极大（含平台去重）
  const cand = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const d = D[i];
      if (d < minR || d > maxR) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nd = D[i + dy * w + dx];
          if (nd > d || (nd === d && (dy < 0 || (dy === 0 && dx < 0)))) { isMax = false; break; }
        }
      }
      if (isMax && hasCircularBoundary(bin, w, h, x, y, d)) cand.push({ x, y, r: d });
    }
  }
  // 半径一致性：真实币半径彼此接近，远小于参考半径的多为残留内部纹理
  cand.sort((a, b) => b.r - a.r);
  const refR = cand.length ? cand[Math.floor(cand.length * 0.25)].r : 0;
  const kept = cand.filter(function (c) { return c.r >= refR * RADIUS_KEEP_RATIO; });
  // 非极大抑制：按半径降序，去掉中心距 < 0.9*(r1+r2) 的近邻（粘连圆的双种子）
  const seeds = [];
  for (const c of kept) {
    let dup = false;
    for (const s of seeds) {
      const dx = c.x - s.x, dy = c.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const thresholdDist = NMS_FACTOR * (c.r + s.r) * (o.overlapFactor || 1);
      if (dist < thresholdDist) { dup = true; break; }
    }
    if (!dup) seeds.push(c);
  }
  return {
    ok: true,
    count: seeds.length,
    seeds: seeds.slice(0, 500),
    width: w, height: h,
    ms: Date.now() - t0
  };
}

/**
 * 在结果上画圈生成标注图（PNG buffer），方便用户核对/手动改数量。
 * @param {object} r count() 的返回
 * @param {Buffer} buf 原图
 */
function annotate(r, buf) {
  const img = decode(buf);
  const png = new PNG({ width: img.width, height: img.height });
  // 原图（缩放到与 seeds 同坐标系）
  for (let i = 0; i < png.data.length; i++) png.data[i] = img.data[i];
  r.seeds.forEach(function (s) {
    const rr = Math.max(4, Math.round(s.r * 1.15));
    for (let a = 0; a < 360; a += 3) {
      const rad = a * Math.PI / 180;
      for (let t = -1; t <= 1; t++) {
        const x = Math.round(s.x + (rr + t) * Math.cos(rad));
        const y = Math.round(s.y + (rr + t) * Math.sin(rad));
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        const i = (y * img.width + x) * 4;
        png.data[i] = 255; png.data[i + 1] = 60; png.data[i + 2] = 60; png.data[i + 3] = 255;
      }
    }
  });
  return PNG.sync.write(png);
}

module.exports = { count, decode, binarize, distanceTransform, annotate, MAX_SIDE };
