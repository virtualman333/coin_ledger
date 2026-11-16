'use strict';
/**
 * 回归测试：右下角「小程序」按钮的二维码弹层必须能打开。
 *
 * 历史 bug：public/index.html 里 <script src="/app.js"> 写在 .mp-fab 之前且是
 * 同步脚本，app.js 执行到「小程序引导」IIFE 时 mpBtn 还没进 DOM，
 * `if (!btn || !panel) return;` 直接退出，click 事件从未绑定 → 点按钮没反应、
 * 二维码永远不显示。修复方式是等 DOMContentLoaded 再绑定。
 *
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const START = '/* ---------------- 小程序引导 ---------------- */';
const END = '/* ---------------- 手机端内联引导';
const startAt = appJs.indexOf(START);
const endAt = appJs.indexOf(END, startAt);
assert.ok(startAt >= 0 && endAt > startAt, '小程序引导代码片段应存在');
const snippet = appJs.slice(startAt, endAt);

function makeSandbox() {
  let domReady = null;
  let clickBound = 0;
  const els = {
    mpBtn: {
      addEventListener: (ev) => { if (ev === 'click') clickBound += 1; },
      setAttribute: () => {}
    },
    mpPanel: { hidden: true, querySelector: () => null, setAttribute: () => {} },
    mpClose: { addEventListener: () => {} }
  };
  const sandbox = {
    document: {
      readyState: 'loading',
      // 关键：脚本同步执行时，.mp-fab 还没被解析，元素取不到
      getElementById: () => null,
      addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') domReady = fn; },
      documentElement: { clientWidth: 1440 }
    },
    window: { innerWidth: 1440 },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: () => 0
  };
  return {
    sandbox,
    get domReady() { return domReady; },
    get clickBound() { return clickBound; },
    makeElementsAvailable() {
      sandbox.document.readyState = 'complete';
      sandbox.document.getElementById = (id) => els[id] || null;
    }
  };
}

test('DOM 未就绪时注册 DOMContentLoaded，而不是直接放弃绑定', () => {
  assert.ok(snippet.includes('DOMContentLoaded'), '修复后应等待 DOMContentLoaded');
  const ctx = makeSandbox();
  vm.runInNewContext(snippet, ctx.sandbox);
  assert.ok(ctx.domReady, 'DOM 未就绪时必须注册 DOMContentLoaded 回调');
});

test('DOM 就绪后 mpBtn 的 click 事件被绑定（二维码弹层可打开）', () => {
  const ctx = makeSandbox();
  vm.runInNewContext(snippet, ctx.sandbox);
  assert.ok(ctx.domReady);
  ctx.makeElementsAvailable();
  ctx.domReady();
  assert.equal(ctx.clickBound, 1, 'DOMContentLoaded 后应绑定一次 click');
});

test('DOM 已就绪时（如 defer/脚本后置）立即绑定，不依赖事件', () => {
  const ctx = makeSandbox();
  ctx.sandbox.document.readyState = 'complete';
  ctx.makeElementsAvailable();
  vm.runInNewContext(snippet, ctx.sandbox);
  assert.equal(ctx.clickBound, 1, 'readyState=complete 时应立即绑定');
});

test('手机端内联引导同样不再依赖脚本执行时机', () => {
  const inlineStart = appJs.indexOf(END);
  assert.ok(inlineStart >= 0);
  const inline = appJs.slice(inlineStart);
  assert.ok(inline.includes('DOMContentLoaded'));
});
