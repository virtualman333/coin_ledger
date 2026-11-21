/**
 * 生成自定义 tabBar 的图标样式（custom-tab-bar/icons.wxss）
 *
 * 为什么不用 png：鸿蒙风的底栏要求图标细描边、颜色随选中态精确变化，
 * png 只能靠两套 40px 位图，放到 40rpx 会发虚且粗细不统一。
 * 为什么用 base64 而不是本地 svg 路径：微信 WXSS 不允许 background-image
 * 引用本地资源，只能走 base64 或网络图。
 *
 * 改色/改粗细只改这里，然后 `node tools/gen-tabbar-icons.js` 重新生成。
 */
const fs = require('fs');
const path = require('path');

const ICONS = {
  home: '<path d="M3.7 10.4 12 3.7l8.3 6.7V18.9a1.7 1.7 0 0 1-1.7 1.7h-3.7v-5.6H9.1v5.6H5.4a1.7 1.7 0 0 1-1.7-1.7z"/>',
  plan: '<rect x="3.7" y="5.3" width="16.6" height="15" rx="3.4"/><path d="M8.3 3.4v3.5M15.7 3.4v3.5M3.7 9.7h16.6"/><path d="M8.5 13.6h2M13.5 13.6h2M8.5 17.1h2M13.5 17.1h2"/>',
  list: '<rect x="3.8" y="3.8" width="7.1" height="7.1" rx="2.3"/><rect x="13.1" y="3.8" width="7.1" height="7.1" rx="2.3"/><rect x="3.8" y="13.1" width="7.1" height="7.1" rx="2.3"/><rect x="13.1" y="13.1" width="7.1" height="7.1" rx="2.3"/>',
  mine: '<circle cx="12" cy="7.9" r="3.9"/><path d="M4.9 20.3c1-3.7 3.8-5.7 7.1-5.7s6.1 2 7.1 5.7"/>',
};

const VARIANTS = {
  off: { color: '#8a8276', width: 1.7 },
  on: { color: '#9a6b1f', width: 1.9 },
};

function svg(body, { color, width }) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
    + `stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">`
    + body
    + '</svg>';
}

function dataUri(str) {
  return 'data:image/svg+xml;base64,' + Buffer.from(str, 'utf8').toString('base64');
}

const lines = [
  '/* 自动生成，请勿手改：node tools/gen-tabbar-icons.js */',
  '',
];

Object.keys(ICONS).forEach((name) => {
  lines.push(`.ico-${name} { background-image: url("${dataUri(svg(ICONS[name], VARIANTS.off))}"); }`);
  lines.push(`.tb-item.on .ico-${name} { background-image: url("${dataUri(svg(ICONS[name], VARIANTS.on))}"); }`);
  lines.push('');
});

const out = path.join(__dirname, '..', 'components', 'tabbar', 'icons.wxss');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('written', out);
