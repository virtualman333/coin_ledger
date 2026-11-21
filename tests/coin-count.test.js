'use strict';
/**
 * 纯 JS 硬币计数算法测试：程序化生成模拟「桌上一堆币」图片，验证计数。
 * 不连库、不启服务、不联网。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const svc = require('../server/services/coin-count.service');

/** 生成深色桌面 + N 个金色实心圆（可指定位置半径），返回 PNG buffer */
function makeImage(circles, width, height, bg) {
  const W = width || 600, H = height || 400;
  const png = new PNG({ width: W, height: H });
  const B = bg || [40, 38, 35];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      png.data[i] = B[0]; png.data[i + 1] = B[1]; png.data[i + 2] = B[2]; png.data[i + 3] = 255;
    }
  }
  circles.forEach(function (c) {
    for (let y = Math.max(0, c.y - c.r); y <= Math.min(H - 1, c.y + c.r); y++) {
      for (let x = Math.max(0, c.x - c.r); x <= Math.min(W - 1, c.x + c.r); x++) {
        const dx = x - c.x, dy = y - c.y;
        if (dx * dx + dy * dy <= c.r * c.r) {
          const i = (y * W + x) * 4;
          png.data[i] = 215; png.data[i + 1] = 190; png.data[i + 2] = 130; png.data[i + 3] = 255;
        }
      }
    }
  });
  return PNG.sync.write(png);
}

function grid(n, cols, r, gap) {
  const out = [];
  const gx = gap || 20;
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    out.push({ x: 60 + col * (2 * r + gx), y: 60 + row * (2 * r + gx), r: r });
  }
  return out;
}

test('单枚币：数出 1', () => {
  const buf = makeImage([{ x: 300, y: 200, r: 40 }], 600, 400);
  const r = svc.count(buf);
  assert.equal(r.count, 1, '实际 ' + r.count);
});

test('规则排列 3x4=12 枚，全部数出', () => {
  const buf = makeImage(grid(12, 4, 22, 18), 600, 400);
  const r = svc.count(buf);
  assert.equal(r.count, 12, '实际 ' + r.count);
});

test('稀疏 7 枚，全部数出', () => {
  const buf = makeImage(grid(7, 3, 30, 40), 600, 500);
  const r = svc.count(buf);
  assert.equal(r.count, 7, '实际 ' + r.count);
});

test('大小不一（模拟不同面额），仍按种子数出', () => {
  const circles = [
    { x: 100, y: 100, r: 30 }, { x: 220, y: 110, r: 20 },
    { x: 340, y: 100, r: 26 }, { x: 480, y: 110, r: 18 },
    { x: 150, y: 240, r: 24 }, { x: 300, y: 250, r: 34 },
    { x: 450, y: 240, r: 22 }
  ];
  const r = svc.count(makeImage(circles, 600, 360));
  assert.equal(r.count, 7, '实际 ' + r.count);
});

test('暗币亮背景（反相）也能数', () => {
  const buf = makeImage(grid(6, 3, 25, 25), 500, 350, [230, 228, 222]);
  // 把圆画成暗色
  const png = PNG.sync.read(buf);
  // makeImage 用亮圆，这里改画暗圆重新生成
  const dark = makeImage(grid(6, 3, 25, 25), 500, 350, [230, 228, 222]);
  const p2 = PNG.sync.read(dark);
  for (let i = 0; i < p2.data.length; i += 4) {
    if (p2.data[i] === 215 && p2.data[i + 1] === 190) {
      p2.data[i] = 45; p2.data[i + 1] = 42; p2.data[i + 2] = 38;
    }
  }
  const r = svc.count(PNG.sync.write(p2));
  assert.equal(r.count, 6, '实际 ' + r.count);
});

test('空桌面数出 0', () => {
  const r = svc.count(makeImage([], 500, 300));
  assert.equal(r.count, 0, '实际 ' + r.count);
});

/**
 * 生成带币面纹理的模拟图：深色桌面 + 金色币，每枚币内部画若干
 * 暗色图案/阴影小块（会被 Otsu 判成背景，制造「亮岛」）和少量高光小块。
 * 用来回归「币内纹理被误当成硬币」的严重误检。
 */
function makeTexturedCoins(circles, width, height) {
  const W = width, H = height;
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      png.data[i] = 40; png.data[i + 1] = 38; png.data[i + 2] = 35; png.data[i + 3] = 255;
    }
  }
  const put = function (x, y, rgb) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2];
  };
  circles.forEach(function (c) {
    for (let y = c.y - c.r; y <= c.y + c.r; y++) {
      for (let x = c.x - c.r; x <= c.x + c.r; x++) {
        if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) <= c.r * c.r) put(x, y, [215, 190, 130]);
      }
    }
  });
  // 币内纹理：暗色图案块 + 高光块，位置固定以便复现
  const texture = [
    [-10, -8, 7], [9, -5, 8], [-4, 11, 6], [12, 10, 5],
    [0, 0, 4], [-14, 4, 5], [5, -14, 5]
  ];
  circles.forEach(function (c) {
    texture.forEach(function (t, k) {
      const dark = (k % 3 !== 0); // 大部分暗块，少数高光块
      const rgb = dark ? [55, 52, 48] : [250, 245, 230];
      for (let y = c.y + t[1] - t[2]; y <= c.y + t[1] + t[2]; y++) {
        for (let x = c.x + t[0] - t[2]; x <= c.x + t[0] + t[2]; x++) {
          // 只在币面内部画，不越过边缘
          if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) > (c.r - 2) * (c.r - 2)) continue;
          put(x, y, rgb);
        }
      }
    });
  });
  return PNG.sync.write(png);
}

test('币内高光/暗色纹理不再被误检（9 枚仍数出 9）', () => {
  const circles = grid(9, 3, 30, 22).map(function (c) {
    return { x: c.x + 40, y: c.y + 30, r: c.r };
  });
  const r = svc.count(makeTexturedCoins(circles, 700, 600));
  assert.equal(r.count, 9, '实际 ' + r.count);
  // 每个种子都应落在某枚币附近（中心距 < 半径），而不是纹理小块上
  circles.forEach(function (c) {
    const near = r.seeds.some(function (s) {
      return Math.hypot(s.x - c.x, s.y - c.y) < c.r;
    });
    assert.ok(near, '硬币(' + c.x + ',' + c.y + ')未被正确圈出');
  });
});

test('轻微接触的币带纹理时仍按种子计数，不退化成连通域', () => {
  const r0 = 26;
  const circles = [];
  for (let i = 0; i < 4; i++) circles.push({ x: 100 + i * (2 * r0 + 2), y: 150, r: r0 });
  const r = svc.count(makeTexturedCoins(circles, 700, 300));
  assert.equal(r.count, 4, '实际 ' + r.count);
});

/**
 * 回归：真实平铺照片的「混合亮度」场景。
 * 白纸背景上银币几乎与背景同亮、金币偏暗、还有彩色币与塑料圆盒边缘，
 * 旧的「Otsu 二值化 + 距离变换」因假设单一亮度极性会大量漏检
 * （实测 21 枚只报 4 枚）。新算法基于圆形边缘，必须全部数出。
 */
function makeMixedCoins(circles, W, H) {
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      png.data[i] = 238; png.data[i + 1] = 236; png.data[i + 2] = 231; png.data[i + 3] = 255;
    }
  }
  const put = function (x, y, c) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2];
  };
  const faces = [[224, 224, 222], [206, 176, 96], [150, 70, 78]];
  circles.forEach(function (c, idx) {
    const face = faces[idx % 3];
    for (let y = c.y - c.r - 3; y <= c.y + c.r + 3; y++) {
      for (let x = c.x - c.r - 3; x <= c.x + c.r + 3; x++) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d > c.r + 3) continue;
        if (d > c.r - 3) { put(x, y, [168, 166, 160]); continue; }
        const k = Math.sin((x - c.x) * 0.13 + (y - c.y) * 0.09) * 14
          + Math.sin((x - c.x) * 0.31) * 8;
        put(x, y, face.map(function (v) { return Math.max(0, Math.min(255, Math.round(v + k))); }));
      }
    }
  });
  return PNG.sync.write(png);
}

test('白纸背景 + 金银彩色混合币 20 枚全部数出（旧二值化算法会漏检）', () => {
  const W = 760, H = 660, circles = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      circles.push({ x: 90 + col * 145, y: 95 + row * 155, r: 48 });
    }
  }
  const r = svc.count(makeMixedCoins(circles, W, H));
  assert.equal(r.count, 20, '实际 ' + r.count);
  // 每个圈都应落在某枚币中心附近，而不是噪声上
  circles.forEach(function (c) {
    const near = r.seeds.some(function (s) { return Math.hypot(s.x - c.x, s.y - c.y) < c.r; });
    assert.ok(near, '混合亮度币(' + c.x + ',' + c.y + ')未被圈出');
  });
});

test('标注图带序号且为合法 PNG', () => {
  const buf = makeImage([{ x: 120, y: 120, r: 40 }, { x: 300, y: 120, r: 40 }], 440, 260);
  const r = svc.count(buf);
  const png = svc.annotate(r, buf);
  assert.ok(png.length > 0);
  assert.equal(png[0], 0x89); assert.equal(png[1], 0x50); // PNG 魔数
  const decoded = PNG.sync.read(png);
  assert.equal(decoded.width, r.width);
  assert.equal(decoded.height, r.height);
});

/* ------------------------------------------------------------------ *
 * 真实照片回归（tests/fixtures/count_*.jpg，尺寸与线上 MAX_SIDE=1000 对齐）
 *
 * 对应 2026-11-20 用户反馈的 5 张「数得不准」的照片：
 *   b_ring   带艺术字标题的环形币 → 旧版把标题/说明文字当成硬币，报 18 枚
 *   c_box    黑底展示盒           → 旧版把空圆孔/反光当成硬币，报 12 枚
 *   d_grid12 规整 4x3 网格       → 旧版漏掉一枚弱对比度币，报 11 枚
 *   e_grid16 五行网格 16 枚      → 必须保持不回归
 *   a_pile   严重重叠的一堆币     → 纯圆形检测只能数出可辨认的币面，不做精确断言
 * ------------------------------------------------------------------ */
const fs = require('node:fs');
const path = require('node:path');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'count_' + name + '.jpg'));
}

test('真实照片：艺术字标题/说明文字不再被当成硬币', () => {
  const r = svc.count(fixture('b_ring'));
  assert.ok(r.count >= 9 && r.count <= 12, '实际 ' + r.count);
  // 标题位于 y<250、底部声明位于 y>800，一个圈都不该落在文字区域
  r.seeds.forEach(function (s) {
    assert.ok(s.y >= 250 && s.y <= 800,
      '圈(' + s.x + ',' + s.y + ')落在了文字区域');
  });
});

test('真实照片：黑底展示盒 11 枚，空圆孔与反光不再误检', () => {
  const r = svc.count(fixture('c_box'));
  assert.equal(r.count, 11, '实际 ' + r.count);
});

test('真实照片：4x3 网格 12 枚全部数出（弱对比度币已补检）', () => {
  const r = svc.count(fixture('d_grid12'));
  assert.equal(r.count, 12, '实际 ' + r.count);
});

test('真实照片：五行网格 16 枚保持准确', () => {
  const r = svc.count(fixture('e_grid16'));
  assert.equal(r.count, 16, '实际 ' + r.count);
});

test('真实照片：严重重叠币堆结果保持在合理区间', () => {
  const r = svc.count(fixture('a_pile'));
  assert.ok(r.count >= 20 && r.count <= 30, '实际 ' + r.count);
});

test('强浮雕/纹理币即使圆内灰度方差很大也不被误杀', () => {
  const circles = grid(9, 3, 30, 22).map(function (c) {
    return { x: c.x + 40, y: c.y + 30, r: c.r };
  });
  const r = svc.count(makeTexturedCoins(circles, 700, 600));
  assert.equal(r.count, 9, '实际 ' + r.count);
  assert.ok(r.seeds.some(function (s) { return s.std > 70; }),
    '该场景本应出现高圆内方差的真币，强证据豁免逻辑可能失效');
});

/**
 * 回归（2026-11-21 用户照片：130 枚小币平铺，只数出 13）：
 *
 * 旧版霍夫半径下限是 max(20, 短边 × 0.055)。手机竖幅照片等比缩到最长边 1000 后
 * 短边 750 → 下限 41px，而 5 角/1 角币的半径只有 15~20px —— 真正该搜的尺度
 * 整个落在搜索区间之外，最后筛出来的只是「跨两枚币」的幽灵大圆（圈比币大一倍）。
 *
 * 新口径：半径下限只兜底小图（max(8, 短边 × 0.02)），再用「票数最高的候选」
 * 估参考半径做尺度筛，压掉小尺度的文字/花纹假圆与大尺度的幽灵圆。
 */
function makeRealisticScene(cols, rows, r, gap, W, H, top) {
  const png = new PNG({ width: W, height: H });
  let seed = 7;
  const rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const grain = Math.sin(x * 0.31 + Math.sin(y * 0.07) * 3) * 6
        + Math.sin(y * 0.9) * 2 + (rnd() - 0.5) * 10;
      png.data[i] = Math.max(0, Math.min(255, 48 + grain));
      png.data[i + 1] = Math.max(0, Math.min(255, 36 + grain));
      png.data[i + 2] = Math.max(0, Math.min(255, 28 + grain));
      png.data[i + 3] = 255;
    }
  }
  const put = function (x, y, c) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2];
  };
  const coins = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = 80 + col * (2 * r + gap);
      const cy = top + row * (2 * r + gap);
      const face = row >= rows - 3 ? [176, 150, 96] : [158, 160, 162];
      coins.push({ x: cx, y: cy, r: r });
      for (let y = Math.round(cy - r - 2); y <= cy + r + 2; y++) {
        for (let x = Math.round(cx - r - 2); x <= cx + r + 2; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > r) continue;
          if (d > r - 2.5) { put(x, y, [226, 224, 216]); continue; }   // 边郭高光
          const grad = -14 + 12 * (d / r);                              // 中心亮、边缘暗
          const relief = (Math.abs(x - cx) < r * 0.12 && Math.abs(y - cy) < r * 0.55) ? 22 : 0;
          const ring2 = Math.abs(d - r * 0.62) < 1.5 ? 16 : 0;
          const spec = Math.max(0, 1 - Math.hypot(x - cx + r * 0.4, y - cy + r * 0.4) / (r * 0.5)) * 30;
          put(x, y, face.map(function (q) {
            return Math.max(0, Math.min(255, Math.round(q + grad + relief + ring2 + spec)));
          }));
        }
      }
    }
  }
  return { buf: PNG.sync.write(png), coins: coins };
}

test('竖幅密铺小币：16x10=160 枚（半径 19）全部数出', () => {
  const sc = makeRealisticScene(16, 10, 19, 2, 750, 1000, 200);
  const r = svc.count(sc.buf);
  assert.equal(r.count, 160, '实际 ' + r.count);
  const missed = sc.coins.filter(function (c) {
    return !r.seeds.some(function (s) { return Math.hypot(s.x - c.x, s.y - c.y) < c.r * 0.7; });
  });
  assert.equal(missed.length, 0, '漏检 ' + missed.length + ' 枚，首枚在 (' + (missed[0] || {}).x + ',' + (missed[0] || {}).y + ')');
});

test('密铺更小币：20x14=280 枚（半径 14）全部数出', () => {
  const sc = makeRealisticScene(20, 14, 14, 2, 750, 1000, 150);
  const r = svc.count(sc.buf);
  assert.equal(r.count, 280, '实际 ' + r.count);
});

test('半径不随画幅膨胀：同一批小币在横图与竖图里结果一致', () => {
  const wide = svc.count(makeRealisticScene(16, 10, 19, 2, 700, 520, 70).buf);
  const tall = svc.count(makeRealisticScene(16, 10, 19, 2, 750, 1000, 200).buf);
  assert.equal(wide.count, 160, '横图实际 ' + wide.count);
  assert.equal(tall.count, 160, '竖图实际 ' + tall.count);
});

test('空桌面（木纹 + 噪点）不会被小半径搜索带出假圆', () => {
  const sc = makeRealisticScene(0, 0, 20, 0, 700, 1000, 0);
  const r = svc.count(sc.buf);
  assert.equal(r.count, 0, '实际 ' + r.count);
});

/**
 * 标注图编号必须按「阅读顺序」：从上到下、每行从左到右。
 * 检测内部是按得分/票数排序的，拿来直接编号会 1 在右下、2 在左上，用户没法核对。
 */
test('标注图编号按行优先排序（上→下、左→右）', () => {
  // 3 行 × 3 列，故意打乱输入顺序
  const seeds = [
    { x: 300, y: 210, r: 20 }, { x: 100, y: 100, r: 20 }, { x: 200, y: 105, r: 20 },
    { x: 300, y: 100, r: 20 }, { x: 100, y: 205, r: 20 }, { x: 200, y: 200, r: 20 },
    { x: 100, y: 300, r: 20 }, { x: 300, y: 305, r: 20 }, { x: 200, y: 300, r: 20 }
  ];
  const ordered = svc.readingOrder(seeds);
  assert.deepEqual(ordered.map(function (s) { return [s.x, s.y]; }), [
    [100, 100], [200, 105], [300, 100],
    [100, 205], [200, 200], [300, 210],
    [100, 300], [200, 300], [300, 305]
  ]);
});

test('轻微歪斜的平铺照片不会把一个币判到隔壁行', () => {
  // 同一行内的 y 抖动 ±6px（币半径 30，容差 21px），仍应保持行内顺序
  const seeds = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      seeds.push({ x: 100 + col * 100, y: 100 + row * 100 + (col % 2 ? 6 : -6), r: 30 });
    }
  }
  seeds.reverse();
  const ordered = svc.readingOrder(seeds);
  for (let i = 0; i < ordered.length; i++) {
    assert.equal(ordered[i].y >= 100 + Math.floor(i / 4) * 100 - 10, true, '第 ' + i + ' 个跨行了');
  }
  const rowIdx = ordered.map(function (s) { return Math.round(s.y / 100); });
  assert.deepEqual(rowIdx, [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
});
