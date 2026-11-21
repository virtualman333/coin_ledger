'use strict';
/**
 * 回归测试：二三四级页面的样式 / 触达 / 可读性修复。
 *
 * 覆盖这轮修掉的问题：
 * 1. 页面级 `.page` 用简写 padding 抹掉全局 env(safe-area-inset-bottom)
 * 2. 遮罩 catchtouchmove + 弹层 overflow-y:auto 组合导致弹层内滚不动
 * 3. 小于 20rpx 的字号（实际渲染不足 10px）
 * 4. 低对比度文字色回潮（浅灰压在浅底上）
 * 5. 深色 hero 上的文字误用深灰
 * 6. wxml 里用了但 wxss 没定义的类（.loading）
 * 7. px / rpx 混用
 * 8. 全部 wxml 标签闭合
 *
 * 运行：node --test tests/mp-style-audit.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

function walk(dir, ext, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'miniprogram_npm') continue;
      walk(p, ext, out);
    } else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

const WXSS = walk(MP, '.wxss');
const WXML = walk(MP, '.wxml');
const rel = (p) => path.relative(MP, p).replace(/\\/g, '/');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

/** WCAG 相对亮度 */
function lum(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = ch.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = lum(a);
  const lb = lum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------- 安全区
test('页面级 .page 简写 padding 不能抹掉安全区', () => {
  // 这些文件的 .page 是页面根容器，简写会覆盖 app.wxss 里的 env(safe-area-inset-bottom)
  const must = [
    'pages/pmdetail/pmdetail.wxss',
    'pages/colshare/colshare.wxss',
    'pages/count/count.wxss',
    'pages/myfeedback/myfeedback.wxss',
    'pages/plan/plan.wxss',
  ];
  for (const f of must) {
    const s = readFile(path.join(MP, f));
    const m = s.match(/^\.page\s*\{[^}]*\}/m);
    assert.ok(m, f + ' 缺少 .page 定义');
    assert.match(m[0], /env\(safe-area-inset-bottom\)/, f + ' 的 .page 丢了安全区');
  }
});

test('顶到屏幕底部的容器都要留安全区', () => {
  // 列表页根节点没有 .page，安全区得自己补
  const cases = [
    ['pages/list/list.wxss', /\.pm-full\s*\{[^}]*\}/],
    ['pages/index/index.wxss', /\.home\s*\{[^}]*\}/],
  ];
  for (const [f, re] of cases) {
    const s = readFile(path.join(MP, f));
    const m = s.match(re);
    assert.ok(m, f + ' 找不到对应规则');
    assert.match(m[0], /env\(safe-area-inset-bottom\)/, f + ' 底部没有安全区留白');
  }
});

// ---------------------------------------------------------- 弹层能否滚动
test('遮罩带 catchtouchmove 时，弹层主体必须是 scroll-view 而不是 overflow 的 view', () => {
  // 组合错误的表现：iOS 上弹层里滚不动，底部按钮永远按不到
  const cases = [
    {
      wxml: 'pages/holdings/holdings.wxml',
      scroll: 'sheet-scroll',
      wxss: 'pages/holdings/holdings.wxss',
      sheet: /\.sheet\s*\{[^}]*\}/,
    },
    {
      wxml: 'pages/detail/detail.wxml',
      scroll: 'peek-scroll',
      wxss: 'pages/detail/detail.wxss',
      sheet: /\.peek-sheet\s*\{[^}]*\}/,
    },
    {
      wxml: 'pages/plan/plan.wxml',
      scroll: 'pd-scroll',
      wxss: 'pages/plan/plan.wxss',
      sheet: /\.pd-sheet\s*\{[^}]*\}/,
    },
  ];
  for (const c of cases) {
    const wxml = readFile(path.join(MP, c.wxml));
    assert.match(wxml, new RegExp('<scroll-view class="' + c.scroll + '"'), c.wxml + ' 缺少 ' + c.scroll);

    const wxss = readFile(path.join(MP, c.wxss));
    const m = wxss.match(c.sheet);
    assert.ok(m, c.wxss + ' 找不到弹层容器规则');
    // 弹层本体不能再是滚动容器，否则和 catchtouchmove 打架
    assert.doesNotMatch(m[0], /overflow-y\s*:\s*auto/, c.wxss + ' 弹层本体不该自己滚');
    assert.match(m[0], /max-height/, c.wxss + ' 弹层缺少 max-height，长内容会顶出屏幕');
    assert.match(m[0], /flex-direction\s*:\s*column/, c.wxss + ' 弹层需要纵向 flex 才能把头部/按钮钉住');
    // 滚动区必须能收缩，否则 flex 里撑破
    const sc = wxss.match(new RegExp('\\.' + c.scroll + '\\s*\\{[^}]*\\}'));
    assert.ok(sc, c.wxss + ' 缺少 .' + c.scroll);
    assert.match(sc[0], /min-height\s*:\s*0/, c.wxss + ' 的 ' + c.scroll + ' 缺 min-height:0');
  }
});

test('管理端每个带弹层的页面各自用 page-style 锁页面滚动', () => {
  const cases = {
    'admin-params': 'editing',
    'admin-series': 'editingSeries',
    'admin-feedback': 'fbDetail',
    'admin-visitors': 'vsDetail',
  };
  for (const slug of Object.keys(cases)) {
    const s = readFile(path.join(MP, 'pages', slug, slug + '.wxml'));
    const meta = s.match(/<page-meta[^>]*page-style="\{\{([^}]*)\}\}"/);
    assert.ok(meta, slug + ' 缺 page-meta 滚动锁');
    assert.ok(meta[1].includes(cases[slug]), slug + ' 的锁定条件里没有 ' + cases[slug]);
  }
});

// -------------------------------------------------------------- 字号下限
test('没有小于 20rpx 的字号', () => {
  const bad = [];
  for (const f of WXSS) {
    const s = readFile(f);
    const re = /font-size\s*:\s*(\d+)rpx/g;
    let m;
    while ((m = re.exec(s))) {
      if (Number(m[1]) < 20) bad.push(rel(f) + ' → ' + m[1] + 'rpx');
    }
  }
  assert.deepEqual(bad, [], '存在过小字号：\n' + bad.join('\n'));
});

// ------------------------------------------------------------ 颜色可读性
test('浅色底上的文字色不低于 4.5:1', () => {
  // 只检查这些色值；深色底用 rgba(255,255,255,x) / 暖米色，不在名单内
  const forbidden = {
    '#b3aa9b': 1,
    '#a39c8e': 1,
    '#b2aca0': 1,
    '#9a948a': 1,
    '#c3bbad': 0, // 允许作为 placeholder，但作为正文不行
    '#b8ae9c': 1,
    '#b8b1a3': 1,
    '#c0b9ab': 1,
    '#a0998a': 1,
    '#a0998c': 1,
    '#a89e8c': 1,
    '#9a9a9a': 1,
    '#7d766b': 1,
  };
  const bad = [];
  for (const f of WXSS) {
    const lines = readFile(f).split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/(?<![-\w])color\s*:\s*(#[0-9a-fA-F]{6})\b/);
      if (!m) return;
      const c = m[1].toLowerCase();
      if (forbidden[c]) bad.push(rel(f) + ':' + (i + 1) + ' ' + c + ' ' + contrast(c, '#ffffff').toFixed(2) + ':1');
    });
  }
  assert.deepEqual(bad, [], '浅底深灰回潮：\n' + bad.join('\n'));
});

test('深色 hero 上的文字不能是深灰', () => {
  const s = readFile(path.join(MP, 'pages/index/index.wxss'));
  const m = s.match(/\.hero-tag\s*\{[^}]*\}/);
  assert.ok(m, '找不到 .hero-tag');
  const c = m[0].match(/color\s*:\s*(#[0-9a-fA-F]{6})/);
  if (c) {
    // hero 背景是 #221a12→#5d4726，深灰上去直接看不见
    const r = contrast(c[1], '#221a12');
    assert.ok(r >= 4.5, '.hero-tag 在深色 hero 上只有 ' + r.toFixed(2) + ':1');
  } else {
    assert.match(m[0], /rgba\(243,\s*227,\s*192/, '.hero-tag 应使用暖米色系浅色');
  }
});

// ------------------------------------------------------- wxml/wxss 一致性
test('admin 用到的 .loading 有样式定义', () => {
  const wxml = readFile(path.join(MP, 'pages/admin-visitors/admin-visitors.wxml'));
  assert.match(wxml, /class="loading"/);
  const common = readFile(path.join(MP, 'pages/admin/admin-common.wxss'));
  const app = readFile(path.join(MP, 'app.wxss'));
  assert.ok(/\.loading\s*\{/.test(common) || /\.loading\s*\{/.test(app), '访客页用了 .loading 但没有任何样式定义');
});

test('不出现 px 单位的尺寸（除 constant 兼容兜底）', () => {
  const bad = [];
  for (const f of WXSS) {
    const lines = readFile(f).split('\n');
    lines.forEach((line, i) => {
      if (/(^|[^-\w])(padding|margin|width|height|top|left|right|bottom|font-size)\s*:\s*[^;]*?-?\d+px/.test(line)) {
        bad.push(rel(f) + ':' + (i + 1));
      }
    });
  }
  assert.deepEqual(bad, [], 'px/rpx 混用：\n' + bad.join('\n'));
});

test('全部 wxml 标签闭合', () => {
  const bad = [];
  for (const f of WXML) {
    let s = readFile(f);
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/\{\{[\s\S]*?\}\}/g, 'X');
    const stack = [];
    let broken = false;
    const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    let m;
    while ((m = re.exec(s))) {
      const [, close, rawName, , selfClose] = m;
      const name = rawName.toLowerCase();
      if (close) {
        if (!stack.length || stack[stack.length - 1] !== name) {
          bad.push(rel(f) + ' 多余的 </' + name + '>');
          broken = true;
          break;
        }
        stack.pop();
      } else if (!selfClose) {
        stack.push(name);
      }
    }
    if (!broken && stack.length) bad.push(rel(f) + ' 未闭合：' + stack.join(','));
  }
  assert.deepEqual(bad, [], '标签不平衡：\n' + bad.join('\n'));
});

// ------------------------------------------------------------- 小热区兜底
test('小于 88rpx 的圆形按钮用伪元素扩展热区', () => {
  const cases = [
    ['pages/list/list.wxss', '.search-clear'],
    ['pages/detail/detail.wxss', '.ai-q'],
  ];
  for (const [f, cls] of cases) {
    const s = readFile(path.join(MP, f));
    assert.ok(
      new RegExp('\\' + cls + '::after\\s*\\{[^}]*width\\s*:\\s*88rpx').test(s),
      f + ' 的 ' + cls + ' 没有把热区扩到 88rpx'
    );
  }
});

test('扩热区不许改视觉尺寸（只允许伪元素 / padding+负 margin）', () => {
  // 这些控件本身很小（34~56rpx），一旦用 min-width/min-height 撑到 88rpx，
  // 勾选框变大方块、步进器圆变大一圈、删除角标盖住缩略图 —— 整页就是错版的。
  const cases = [
    ['pages/holdings/holdings.wxss', '.hc', '88rpx'],
    ['pages/holdings/holdings.wxss', '.step', '88rpx'],
    ['pages/holdings/holdings.wxss', '.sr-seg', '88rpx'],
    ['pages/holdings/holdings.wxss', '.sr-img-x', '64rpx'],
    ['pages/account/account.wxss', '.ck', '88rpx'],
    ['pages/account/account.wxss', '.pwd-eye', '88rpx'],
  ];
  for (const [f, cls, size] of cases) {
    const s = readFile(path.join(MP, f));
    const own = s.match(new RegExp('^\\' + cls + '\\s*\\{[^}]*\\}', 'm'));
    assert.ok(own, f + ' 找不到 ' + cls + ' 的规则');
    assert.doesNotMatch(
      own[0],
      /min-(width|height)\s*:/,
      f + ' 的 ' + cls + ' 用 min-width/min-height 撑热区，会改变视觉尺寸'
    );
    const after = s.match(new RegExp('\\' + cls + '::after\\s*\\{[^}]*\\}'));
    assert.ok(after, f + ' 的 ' + cls + ' 缺 ::after 热区');
    assert.match(after[0], new RegExp('(width|height)\\s*:\\s*' + size), cls + ' 的伪元素热区不是 ' + size);
  }
});

test('关闭按钮（✕）用伪元素扩热区，不靠放大盒子', () => {
  const cases = [
    ['pages/holdings/holdings.wxss', '.sheet-x'],
    ['pages/detail/detail.wxss', '.peek-x'],
    ['pages/detail/detail.wxss', '.ai-formula-x'],
    ['pages/plan/plan.wxss', '.pd-x'],
    ['pages/admin/admin-common.wxss', '.sheet-x'],
    ['pages/admin/admin-common.wxss', '.vdd-x'],
    ['pages/account/account.wxss', '.policy-close'],
  ];
  for (const [f, cls] of cases) {
    const s = readFile(path.join(MP, f));
    const own = s.match(new RegExp('^\\' + cls + '\\s*\\{[^}]*\\}', 'm'));
    assert.ok(own, f + ' 找不到 ' + cls);
    // 88rpx 的盒子 + 负 margin 会把 ✕ 顶到贴边、还挤掉标题宽度
    assert.doesNotMatch(own[0], /width\s*:\s*88rpx/, f + ' 的 ' + cls + ' 靠 88rpx 盒子扩热区，会挤偏布局');
    assert.ok(
      new RegExp('\\' + cls + '::after\\s*\\{[^}]*88rpx').test(s),
      f + ' 的 ' + cls + ' 缺伪元素热区'
    );
  }
});

test('底部固定操作栏不会盖住最后一张卡片', () => {
  const wxss = readFile(path.join(MP, 'pages/holdings/holdings.wxss'));
  assert.match(wxss, /\.pick-spacer\s*\{[^}]*height\s*:/, '缺 .pick-spacer 占位');
  const wxml = readFile(path.join(MP, 'pages/holdings/holdings.wxml'));
  assert.match(wxml, /class="pick-spacer"/, 'wxml 里没放占位元素');
});
