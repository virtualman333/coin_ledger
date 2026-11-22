'use strict';
/**
 * 小程序页面视觉预览：把 WXML + WXSS 按真实页面数据渲成 HTML，供无头浏览器截图。
 * 用途是「看得见」地排查布局问题，不是替代真机。
 *
 *   node tools/mp_preview.js           # 生成 public/brand/.preview/*.html
 */
const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');
const OUT = path.join(__dirname, '..', '.preview');   // 只在本机看，不进 public

/* ---------------- WXML 解析 ---------------- */
const VOID_TAGS = new Set(['image', 'input', 'icon', 'progress', 'switch', 'slider']);

function parseAttrs(str) {
  const attrs = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*(?:=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(str))) {
    attrs[m[1]] = m[2] === undefined ? true : m[2];
  }
  return attrs;
}

// 找标签结束的 '>'，跳过引号内的内容（属性值里可能有 a > b 这种表达式）
function findTagEnd(src, start) {
  let quote = null;
  for (let k = start; k < src.length; k += 1) {
    const ch = src[k];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') return k;
  }
  return -1;
}

function parseWxml(src) {
  const root = { tag: 'root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const text = src.slice(i);
      if (text.trim()) stack[stack.length - 1].children.push({ text });
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim()) stack[stack.length - 1].children.push({ text });
    }
    const gt = findTagEnd(src, lt + 1);
    if (gt < 0) break;
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('!--')) continue;
    if (raw.startsWith('/')) {
      const closeTag = raw.slice(1).trim();
      // 空元素写成 <image></image> 时，闭合标签不能弹栈
      if (VOID_TAGS.has(closeTag)) continue;
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const sp = body.search(/\s/);
    const tag = (sp < 0 ? body : body.slice(0, sp)).trim();
    const attrs = sp < 0 ? {} : parseAttrs(body.slice(sp));
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(node);
  }
  return root;
}

/* ---------------- 表达式求值 ---------------- */
const fnCache = new Map();
function evalExpr(expr, scope) {
  const code = String(expr).trim();
  if (!code) return '';
  if (!fnCache.has(code)) {
    try {
      fnCache.set(code, new Function('$s', 'with($s){ return (' + code + '); }'));
    } catch (e) {
      fnCache.set(code, () => '');
    }
  }
  try {
    const v = fnCache.get(code)(scope);
    return v === undefined || v === null ? '' : v;
  } catch (e) {
    return '';
  }
}

function interpolate(str, scope) {
  if (typeof str !== 'string') return str;
  // 整串只有一个表达式时才返回原始值（用负向断言，避免 {{a}} 年 {{b}} 被整串吞掉）
  const trimmed = str.trim();
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}') && trimmed.indexOf('}}') === trimmed.length - 2) {
    return evalExpr(trimmed.slice(2, -2), scope);
  }
  return str.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => String(evalExpr(e, scope)));
}

/* ---------------- 渲染成 HTML ---------------- */
const TAG_MAP = {
  view: 'div',
  text: 'span',
  block: null,
  image: 'img',
  input: 'input',
  button: 'button',
  'scroll-view': 'div',
  swiper: 'div',
  'swiper-item': 'div',
  navigator: 'div',
  form: 'div',
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderNodes(nodes, scope) {
  let out = '';
  let lastCond = null;
  for (const node of nodes) {
    if (node.text !== undefined) {
      out += esc(String(interpolate(node.text, scope)));
      continue;
    }
    const a = node.attrs;

    /* 条件渲染链 */
    if ('wx:if' in a) {
      lastCond = !!interpolate(a['wx:if'], scope);
      if (!lastCond) continue;
    } else if ('wx:elif' in a) {
      if (lastCond !== false) continue;
      lastCond = !!interpolate(a['wx:elif'], scope);
      if (!lastCond) continue;
    } else if ('wx:else' in a) {
      if (lastCond !== false) continue;
      lastCond = null;
    }

    /* 列表渲染 */
    if ('wx:for' in a) {
      const list = interpolate(a['wx:for'], scope) || [];
      const itemName = a['wx:for-item'] || 'item';
      const idxName = a['wx:for-index'] || 'index';
      const arr = Array.isArray(list) ? list : [];
      for (let k = 0; k < arr.length; k += 1) {
        const child = Object.create(scope);
        child[itemName] = arr[k];
        child[idxName] = k;
        out += renderNode(node, child);
      }
      continue;
    }
    out += renderNode(node, scope);
  }
  return out;
}

function renderNode(node, scope) {
  const a = node.attrs;
  const tag = TAG_MAP[node.tag] === undefined ? 'div' : TAG_MAP[node.tag];
  const inner = renderNodes(node.children, scope);
  if (tag === null) return inner;

  if (node.tag === 'swiper') {
    // 预览不实现手势，只显示 current 那一页
    const cur = Number(interpolate(a.current, scope)) || 0;
    const kids = (node.children || []).filter((c) => c.tag === 'swiper-item');
    const pick = kids[cur] || kids[0];
    const cls = ((a.class || '') + ' wx-swiper').trim();
    const st = interpolate(a.style, scope);
    // 预览只渲染当前页，并把 gal[cur] 作为 item 注入，保证 {{item.url}} 能取到
    const childScope = Object.create(scope);
    const galList = scope.gal || [];
    childScope.item = galList[cur] || galList[0];
    childScope.index = cur;
    return '<div class="' + esc(cls) + '"' + (st ? ' style="' + esc(st) + '"' : '') + '>' +
      (pick ? renderNodes(pick.children || [], childScope) : '') + '</div>';
  }

  if (node.tag === 'swiper-item') {
    return renderNodes(node.children || [], scope);
  }

  if (node.tag === 'image') {
    let src = String(interpolate(a.src, scope) || '');
    // 小程序里以 / 开头的路径是包内绝对路径，预览时映射到 miniprogram 目录
    if (/^\/images\//.test(src)) src = '../miniprogram' + src;
    const cls = String(interpolate(a.class, scope) || '');
    const mode = a.mode || 'scaleToFill';
    const fit = mode === 'aspectFit' ? 'contain' : mode === 'aspectFill' ? 'cover' : 'fill';
    return `<img class="${esc(cls)}" src="${esc(src)}" style="object-fit:${fit}" />`;
  }
  if (node.tag === 'textarea') {
    const cls = String(interpolate(a.class, scope) || '');
    const val = esc(String(interpolate(a.value, scope) || ''));
    const ph = esc(String(interpolate(a.placeholder, scope) || ''));
    return `<textarea class="${esc(cls)}" placeholder="${ph}">${val}</textarea>`;
  }
  if (node.tag === 'input') {
    const cls = String(interpolate(a.class, scope) || '');
    const val = esc(String(interpolate(a.value, scope) || ''));
    const ph = esc(String(interpolate(a.placeholder, scope) || ''));
    const type = a.password ? 'password' : 'text';
    return `<input class="${esc(cls)}" value="${val}" placeholder="${ph}" type="${type}" />`;
  }

  const cls = interpolate(a.class, scope);
  const style = interpolate(a.style, scope);
  const attrs = [];
  if (cls) attrs.push(`class="${esc(cls)}"`);
  if (style) attrs.push(`style="${esc(style)}"`);
  return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${tag}>`;
}

/* ---------------- 样式 ---------------- */
function toCss(file, base) {
  const unit = (base || 750) / 750;          // 1rpx 对应多少 px
  let css = fs.readFileSync(file, 'utf8');
  css = css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (Number(n) * unit).toFixed(3) + 'px');
  // 只替换独立的 page 选择器，别把 .page 类名一并改掉
  css = css.replace(/(^|[\s,}])page(?=\s*[,{])/g, '$1body');
  return css;
}

/* ---------------- 组装 ---------------- */
function buildPage({ name, wxml, wxss, data, height, width }) {
  const w = width || 375;
  const html = renderNodes(parseWxml(fs.readFileSync(path.join(MP, wxml), 'utf8')).children, data);
  const css = toCss(path.join(MP, 'app.wxss'), w) + '\n' + toCss(path.join(MP, wxss), w);
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;}
/* 贴近微信 button 的默认样式：line-height 2.55555556、左右 14px 内边距，
   用来暴露「靠行高撑居中」这类问题（app.wxss 的规则会覆盖它） */
button{display:block;width:100%;margin:0;padding:0 14px;line-height:2.55555556;
  font-size:18px;cursor:pointer;overflow:hidden;}
input{border:none;outline:none;background:transparent;font-family:inherit;}
html,body{margin:0;padding:0;}
body{width:${w}px;}
${css}
/* 模拟微信 tabBar，仅用于看内容区高度 */
.tabbar-sim{position:fixed;left:0;right:0;bottom:0;height:50px;display:flex;background:#fff;
  border-top:1px solid #ece9e2;font:10px/50px -apple-system,sans-serif;color:#8a8378;text-align:center;}
.tabbar-sim span{flex:1;}
.tabbar-sim .on{color:#9a6b1f;}
</style></head><body>${html}${height ? `<div class="tabbar-sim"><span>首页</span><span>全套清单</span><span>我的收藏</span></div>` : ''}</body></html>`;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name + '.html');
  fs.writeFileSync(file, doc, 'utf8');
  return file;
}

module.exports = { buildPage, OUT };
