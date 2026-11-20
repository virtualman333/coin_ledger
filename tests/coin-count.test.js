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
