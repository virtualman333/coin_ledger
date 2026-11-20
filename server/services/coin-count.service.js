'use strict';
/**
 * 纯 JS 图像硬币计数（无 AI、无原生依赖）。
 *
 * 原理（v2，基于圆形边缘而非亮度）：
 *   灰度 → 高斯/均值模糊 → Sobel 梯度 → 按梯度方向做「圆形霍夫投票」得到圆心候选
 *   → 圆周梯度一致性打分（真币边界梯度沿径向，纹理/阴影不具备）→ NMS → 计数
 *
 * 为什么换掉旧的「Otsu 二值化 + 距离变换」：
 *   旧法假设「币与背景亮度不同且极性单一」。真实照片里白纸背景上银币几乎同亮、
 *   金币偏暗、还有彩色币与塑料圆盒，单一阈值根本分不出前景，会大量漏检
 *   （实测一张 21 枚的照片只报 4 枚）。圆形边缘是各类币唯一稳定的共同特征。
 *
 * 不识别币种、不生成内容，只数圆形个数 —— 工具属性，规避深度合成类目红线。
 */
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const MAX_SIDE = 1000;          // 解码后最长边，控制计算量
const BLUR_K = 5;               // 梯度前的均值模糊核
const VOTE_BLUR_K = 5;          // 霍夫累加图平滑核
const EDGE_PERCENTILE = 0.70;   // 参与投票的边缘点（梯度幅值分位）
const RIM_PERCENTILE = 0.62;    // 圆周证据的梯度幅值门槛（分位）
const R_MIN_RATIO = 0.055;      // 半径下限 / 短边
const R_MAX_RATIO = 0.115;      // 半径上限 / 短边
const R_MIN_ABS = 20;
const R_MAX_ABS = 130;
const R_STEP = 2;
const RING_SAMPLES = 48;        // 圆周打分采样点数
const ALIGN_MIN = 0.65;         // 梯度方向与径向夹角余弦下限
const PEAK_MIN = 6;             // 霍夫峰最低票数
const SCORE_MIN = 0.22;         // 圆周一致性得分下限
const NMS_FACTOR = 0.78;        // 中心距 < 该系数 ×(r1+r2) 视为同一枚
const R_REFINES = [-6, -3, 0, 3, 6];

/** 解码 buffer 为 {width,height,data:Uint8Array RGBA}，超大图等比缩小 */
function decode(buf) {
  let img;
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

/** RGBA → 灰度 Float32Array */
function toGray(img) {
  const n = img.width * img.height;
  const gray = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    gray[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) / 256;
  }
  return gray;
}

/**
 * 可分离均值模糊（边界 clamp），O(w*h) 而非 O(w*h*k²)。
 * 复用 tmp/dst 避免每轮分配大数组。
 */
function boxBlur(src, w, h, k, tmp, dst) {
  const r = k >> 1;
  const inv = 1 / k;
  // 横向滑动和
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let t = -r; t <= r; t++) {
      const x = t < 0 ? 0 : (t >= w ? w - 1 : t);
      sum += src[row + x];
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * inv;
      const outX = x - r < 0 ? 0 : x - r;
      const inX = x + r + 1 >= w ? w - 1 : x + r + 1;
      sum += src[row + inX] - src[row + outX];
    }
  }
  // 纵向滑动和
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let t = -r; t <= r; t++) {
      const y = t < 0 ? 0 : (t >= h ? h - 1 : t);
      sum += tmp[y * w + x];
    }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * inv;
      const outY = y - r < 0 ? 0 : y - r;
      const inY = y + r + 1 >= h ? h - 1 : y + r + 1;
      sum += tmp[inY * w + x] - tmp[outY * w + x];
    }
  }
  return dst;
}

/** Sobel 梯度：返回 gx/gy/mag（Float32Array） */
function sobel(gray, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  const at = (x, y) => gray[(y < 0 ? 0 : (y >= h ? h - 1 : y)) * w + (x < 0 ? 0 : (x >= w ? w - 1 : x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // 3x3 Sobel（边界由 at 做 clamp）
      const tl = at(x - 1, y - 1), tc = at(x, y - 1), tr = at(x + 1, y - 1);
      const ml = at(x - 1, y), mr = at(x + 1, y);
      const bl = at(x - 1, y + 1), bc = at(x, y + 1), br = at(x + 1, y + 1);
      const sx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const sy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      gx[i] = sx; gy[i] = sy;
      mag[i] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return { gx, gy, mag };
}

/** 直方图近似分位数（避免对百万级浮点数组排序） */
function percentile(arr, p, bins) {
  const B = bins || 2048;
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (max <= 0) return 0;
  const hist = new Uint32Array(B + 1);
  const scale = B / max;
  for (let i = 0; i < arr.length; i++) {
    let b = (arr[i] * scale) | 0;
    if (b > B) b = B;
    hist[b]++;
  }
  const target = arr.length * p;
  let acc = 0;
  for (let b = 0; b <= B; b++) {
    acc += hist[b];
    if (acc >= target) return b / scale;
  }
  return max;
}

/** 圆周梯度一致性得分：真圆边界的梯度方向应沿半径方向 */
function ringScore(gx, gy, mag, w, h, cx, cy, r, rimThr, ca, sa) {
  let total = 0;
  for (let k = 0; k < RING_SAMPLES; k++) {
    const px = Math.round(cx + r * ca[k]);
    const py = Math.round(cy + r * sa[k]);
    if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue;
    // 3x3 邻域取梯度最强的点（容忍 1~2px 的半径误差）
    let mv = 0, bx = px, by = py;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const v = mag[(py + dy) * w + px + dx];
        if (v > mv) { mv = v; bx = px + dx; by = py + dy; }
      }
    }
    if (mv < rimThr) continue;
    const align = Math.abs(gx[by * w + bx] * ca[k] + gy[by * w + bx] * sa[k]) / (mv + 1e-6);
    if (align > ALIGN_MIN) total += align;
  }
  return total / RING_SAMPLES;
}

/**
 * 统计硬币。
 * @param {Buffer} buf 图片 buffer（jpeg/png）
 * @param {object} opt { minRadius, maxRadius, overlapFactor } 可选覆盖
 * @returns {object} { ok, count, seeds, width, height, ms }
 */
function count(buf, opt) {
  const t0 = Date.now();
  const o = opt || {};
  const img = decode(buf);
  const w = img.width, h = img.height, n = w * h;
  const short = Math.min(w, h);

  const gray = toGray(img);
  const tmp = new Float32Array(n);
  const smooth = new Float32Array(n);
  boxBlur(gray, w, h, BLUR_K, tmp, smooth);
  const { gx, gy, mag } = sobel(smooth, w, h);

  const loThr = percentile(mag, EDGE_PERCENTILE);
  const rimThr = percentile(mag, RIM_PERCENTILE);
  // 收集边缘点：坐标 + 单位梯度方向
  const xs = [], ys = [], ux = [], uy = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < loThr || m <= 0) continue;
      xs.push(x); ys.push(y);
      ux.push(gx[i] / m); uy.push(gy[i] / m);
    }
  }
  const edgeN = xs.length;

  const rmin = Math.max(R_MIN_ABS, Math.round(short * (o.minRadius ? 0 : R_MIN_RATIO)));
  const rmax = Math.min(R_MAX_ABS, Math.round(short * R_MAX_RATIO));
  const radii = [];
  for (let r = (o.minRadius || rmin); r <= (o.maxRadius || rmax); r += R_STEP) radii.push(r);
  if (!radii.length) radii.push(Math.round((rmin + rmax) / 2));

  // 圆形霍夫投票：每个边缘点沿 ±梯度方向在各半径处给圆心投票
  const acc = new Float32Array(n);
  const accSmooth = new Float32Array(n);
  const best = new Float32Array(n);
  const bestR = new Float32Array(n);
  for (const r of radii) {
    acc.fill(0);
    for (let e = 0; e < edgeN; e++) {
      let cx = Math.round(xs[e] + r * ux[e]);
      let cy = Math.round(ys[e] + r * uy[e]);
      if (cx >= 0 && cy >= 0 && cx < w && cy < h) acc[cy * w + cx] += 1;
      cx = Math.round(xs[e] - r * ux[e]);
      cy = Math.round(ys[e] - r * uy[e]);
      if (cx >= 0 && cy >= 0 && cx < w && cy < h) acc[cy * w + cx] += 1;
    }
    boxBlur(acc, w, h, VOTE_BLUR_K, tmp, accSmooth);
    for (let i = 0; i < n; i++) {
      if (accSmooth[i] > best[i]) { best[i] = accSmooth[i]; bestR[i] = r; }
    }
  }

  // 候选：8 邻域局部极大（>= 让平台只保留一个方向不至于全丢）
  const cand = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = best[i];
      if (v <= PEAK_MIN) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (best[i + dy * w + dx] > v) { isMax = false; break; }
        }
      }
      if (isMax) cand.push({ x, y, r: bestR[i], votes: v });
    }
  }

  const ca = new Float32Array(RING_SAMPLES), sa = new Float32Array(RING_SAMPLES);
  for (let k = 0; k < RING_SAMPLES; k++) {
    const a = k * 2 * Math.PI / RING_SAMPLES;
    ca[k] = Math.cos(a); sa[k] = Math.sin(a);
  }
  // 每个候选在 ±6px 内精修半径，取圆周一致性最高分
  const scored = cand.map((c) => {
    let bs = 0, br = c.r;
    for (const dr of R_REFINES) {
      const r = c.r + dr;
      if (r < 8) continue;
      const sc = ringScore(gx, gy, mag, w, h, c.x, c.y, r, rimThr, ca, sa);
      if (sc > bs) { bs = sc; br = r; }
    }
    return { x: c.x, y: c.y, r: br, score: bs };
  });
  scored.sort((a, b) => b.score - a.score);

  const seeds = [];
  const overlap = o.overlapFactor || 1;
  for (const c of scored) {
    if (c.score < SCORE_MIN) continue;
    let dup = false;
    for (const s of seeds) {
      const dx = c.x - s.x, dy = c.y - s.y;
      if (Math.sqrt(dx * dx + dy * dy) < NMS_FACTOR * (c.r + s.r) * overlap) { dup = true; break; }
    }
    if (!dup) seeds.push(c);
  }

  return {
    ok: true,
    count: seeds.length,
    seeds: seeds.slice(0, 500),
    width: w, height: h,
    ms: Date.now() - t0,
  };
}

/** 3x5 点阵数字，用于在标注图上标序号 */
const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

function drawNumber(data, w, h, num, cx, cy, scale) {
  const s = String(num);
  const cellW = 3 * scale, cellH = 5 * scale, gap = scale;
  const totalW = s.length * cellW + (s.length - 1) * gap;
  const x0 = Math.round(cx - totalW / 2);
  const y0 = Math.round(cy - cellH / 2);
  for (let si = 0; si < s.length; si++) {
    const rows = DIGITS[s[si]];
    if (!rows) continue;
    for (let ry = 0; ry < 5; ry++) {
      for (let rx = 0; rx < 3; rx++) {
        if (rows[ry][rx] !== '1') continue;
        const bx = x0 + si * (cellW + gap) + rx * scale;
        const by = y0 + ry * scale;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = bx + dx, py = by + dy;
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            const i = (py * w + px) * 4;
            data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
          }
        }
      }
    }
  }
}

/** 在结果上画圈 + 序号生成标注图（PNG buffer），方便用户逐枚核对 */
function annotate(r, buf) {
  const img = decode(buf);
  const w = img.width, h = img.height;
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i++) png.data[i] = img.data[i];
  const C = [255, 60, 60];
  r.seeds.forEach(function (s, idx) {
    const rr = Math.max(4, Math.round(s.r));
    // 红色圆环
    for (let a = 0; a < 360; a += 2) {
      const rad = a * Math.PI / 180;
      for (let t = -1; t <= 1; t++) {
        const x = Math.round(s.x + (rr + t) * Math.cos(rad));
        const y = Math.round(s.y + (rr + t) * Math.sin(rad));
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        png.data[i] = C[0]; png.data[i + 1] = C[1]; png.data[i + 2] = C[2]; png.data[i + 3] = 255;
      }
    }
    // 中心序号底盘 + 白色数字
    const badge = 13;
    for (let dy = -badge; dy <= badge; dy++) {
      for (let dx = -badge; dx <= badge; dx++) {
        if (dx * dx + dy * dy > badge * badge) continue;
        const x = s.x + dx, y = s.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        png.data[i] = 190; png.data[i + 1] = 45; png.data[i + 2] = 45; png.data[i + 3] = 255;
      }
    }
    drawNumber(png.data, w, h, idx + 1, s.x, s.y, 3);
  });
  return PNG.sync.write(png);
}

/* 兼容导出：旧版二值化/距离变换工具，count() 已不再使用，保留供外部脚本引用 */
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
  let total = 0, sum = 0;
  for (let t = 0; t < 256; t++) { total += hist[t]; sum += t * hist[t]; }
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  let bright = 0;
  for (let i = 0; i < n; i++) if (gray[i] > thr) bright++;
  const fgIsBright = bright / n <= 0.5;
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = ((gray[i] > thr) === fgIsBright) ? 1 : 0;
  return { bin, gray, thr, fgIsBright };
}

function distanceTransform(bin, w, h) {
  const n = w * h;
  const D = new Float32Array(n);
  const BIG = 1e9;
  for (let i = 0; i < n; i++) D[i] = bin[i] ? BIG : 0;
  const d1 = 1, d2 = 1.4142;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!bin[i]) continue;
    let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + d1);
    if (y > 0) {
      v = Math.min(v, D[i - w] + d1);
      if (x > 0) v = Math.min(v, D[i - w - 1] + d2);
      if (x < w - 1) v = Math.min(v, D[i - w + 1] + d2);
    }
    D[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!bin[i]) continue;
    let v = D[i];
    if (x < w - 1) v = Math.min(v, D[i + 1] + d1);
    if (y < h - 1) {
      v = Math.min(v, D[i + w] + d1);
      if (x > 0) v = Math.min(v, D[i + w - 1] + d2);
      if (x < w - 1) v = Math.min(v, D[i + w + 1] + d2);
    }
    D[i] = v;
  }
  return D;
}

module.exports = { count, decode, binarize, distanceTransform, annotate, MAX_SIDE };
