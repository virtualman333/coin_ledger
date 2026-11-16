'use strict';
/**
 * 回归测试：右下角「小程序」二维码必须默认常驻显示，且交互可靠。
 *
 * 历史 bug 1：public/index.html 里 <script src="/app.js"> 写在 .mp-fab 之前且是
 * 同步脚本，app.js 执行到「小程序引导」时 mpBtn 还没进 DOM，
 * `if (!btn || !panel) return;` 直接退出，click 事件从未绑定 → 点按钮没反应、
 * 二维码永远不显示。修复：等 DOMContentLoaded 再绑定。
 *
 * 需求变更：二维码改为默认一直显示（不用点开，也不因点页面别处而自动收起），
 * 用户仍可用 ✕ / 按钮 / Esc 主动收起。
 *
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const START = '/* ---------------- 小程序引导 ---------------- */';
const END = '/* ---------------- 手机端内联引导';
const startAt = appJs.indexOf(START);
const endAt = appJs.indexOf(END, startAt);
assert.ok(startAt >= 0 && endAt > startAt, '小程序引导代码片段应存在');
const snippet = appJs.slice(startAt, endAt);

function makeSandbox() {
  let domReady = null;
  let clickBound = 0;
  const docHandlers = {};
  const els = {
    mpBtn: {
      _click: null,
      addEventListener: (ev, fn) => { if (ev === 'click') { clickBound += 1; els.mpBtn._click = fn; } },
      setAttribute: () => {}
    },
    // 对应 HTML 默认展开：面板初始就是可见的
    mpPanel: { hidden: false, querySelector: () => null, setAttribute: () => {} },
    mpClose: {
      _click: null,
      addEventListener: (ev, fn) => { if (ev === 'click') els.mpClose._click = fn; }
    }
  };
  const sandbox = {
    document: {
      readyState: 'loading',
      // 关键：脚本同步执行时，.mp-fab 还没被解析，元素取不到
      getElementById: () => null,
      addEventListener: (ev, fn) => {
        docHandlers[ev] = fn;
        if (ev === 'DOMContentLoaded') domReady = fn;
      },
      documentElement: { clientWidth: 1440 }
    },
    window: { innerWidth: 1440 },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: () => 0
  };
  return {
    sandbox, els, docHandlers,
    get domReady() { return domReady; },
    get clickBound() { return clickBound; },
    makeElementsAvailable() {
      sandbox.document.readyState = 'complete';
      sandbox.document.getElementById = (id) => els[id] || null;
    }
  };
}

/* ---------- 绑定时机（防止二维码又点不开） ---------- */

test('DOM 未就绪时注册 DOMContentLoaded，而不是直接放弃绑定', () => {
  assert.ok(snippet.includes('DOMContentLoaded'), '修复后应等待 DOMContentLoaded');
  const ctx = makeSandbox();
  vm.runInNewContext(snippet, ctx.sandbox);
  assert.ok(ctx.domReady, 'DOM 未就绪时必须注册 DOMContentLoaded 回调');
});

test('DOM 就绪后 mpBtn 的 click 事件被绑定', () => {
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
  assert.ok(appJs.slice(inlineStart).includes('DOMContentLoaded'));
});

/* ---------- 默认常驻（新需求） ---------- */

test('HTML 中二维码面板默认展开，按钮标记 expanded', () => {
  const m = html.match(/<div class="mp-panel" id="mpPanel"([^>]*)>/);
  assert.ok(m, 'mpPanel 应存在');
  assert.ok(!/\bhidden\b/.test(m[1]), '默认不应带 hidden 属性');
  assert.ok(/id="mpBtn"[^>]*aria-expanded="true"/.test(html), '按钮应标记展开态');
});

test('不再注册「点击页面其它位置自动收起」', () => {
  assert.ok(!snippet.includes("e.target.closest('#mpFab')"), '不应保留外部点击自动收起逻辑');
  const ctx = makeSandbox();
  vm.runInNewContext(snippet, ctx.sandbox);
  ctx.makeElementsAvailable();
  ctx.domReady();
  assert.equal(ctx.docHandlers.click, undefined, 'document 上不应有 click 自动收起监听');
});

test('点击页面其它位置后二维码仍然可见', () => {
  const ctx = makeSandbox();
  vm.runInNewContext(snippet, ctx.sandbox);
  ctx.makeElementsAvailable();
  ctx.domReady();
  assert.equal(ctx.els.mpPanel.hidden, false, '初始应为展开');
  const outside = ctx.docHandlers.click;
  if (outside) outside({ target: { closest: () => null }, stopPropagation() {} });
  assert.equal(ctx.els.mpPanel.hidden, false, '外部点击不应收起面板');
});

test('默认常驻，但用户仍可用 ✕ / 按钮主动收起与展开', () => {
  const ctx = makeSandbox();
  vm.runInNewContext(snippet, ctx.sandbox);
  ctx.makeElementsAvailable();
  ctx.domReady();
  assert.equal(ctx.els.mpPanel.hidden, false);
  ctx.els.mpClose._click({ stopPropagation() {} });
  assert.equal(ctx.els.mpPanel.hidden, true, '✕ 应能收起');
  ctx.els.mpBtn._click({ stopPropagation() {} });
  assert.equal(ctx.els.mpPanel.hidden, false, '按钮应能再次展开');
  ctx.docHandlers.keydown({ key: 'Escape' });
  assert.equal(ctx.els.mpPanel.hidden, true, 'Esc 应能收起');
});
