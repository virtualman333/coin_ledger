'use strict';
/**
 * 清洗 public/data/descriptions.json：
 * 早期从央行页面抓取时把页脚（法律声明 / 网站地图 / script 标签）也带了进来，
 * 会在详情页正文末尾露出 `法律声明 | 联系我们 … <script …>` 这类垃圾。
 *
 *   node tools/clean_desc.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'data', 'descriptions.json');
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const CUTS = [
  /法律声明\s*\|/,          // 页脚起点
  /<script/i,
  /<\/?[a-zA-Z][^>]*>/,     // 任何残留标签
];

let changed = 0;
Object.keys(doc).forEach((key) => {
  const entry = doc[key];
  if (!entry || typeof entry.text !== 'string') return;
  const before = entry.text;
  let text = before;

  CUTS.forEach((re) => {
    const m = re.exec(text);
    if (m && m.index > 40) text = text.slice(0, m.index);
  });

  text = text
    .replace(/\s+/g, ' ')
    .replace(/[\s|｜·]+$/g, '')
    .trim();

  if (text !== before) {
    entry.text = text;
    changed += 1;
    console.log(`清理 [${key}] ${before.length} → ${text.length} 字`);
  }
});

if (changed) {
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 0) + '\n', 'utf8');
}
console.log(`共清理 ${changed} 条`);

/* 复查：不应再出现尖括号或页脚痕迹 */
const left = Object.keys(doc).filter((k) => /[<>]|法律声明|联系我们/.test(doc[k].text || ''));
console.log(left.length ? '仍有异常：' + left.join(',') : '复查通过：正文无残留标签');
