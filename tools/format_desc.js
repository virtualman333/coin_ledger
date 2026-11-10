'use strict';
/**
 * 把 descriptions.json 里「一整段百科摘录」整理成适合阅读的分段文本。
 *
 * 背景：127 条发行信息大多是从百科摘下的连续长段（300–600 字，中间没有换行），
 * 详情页里渲染成一堵墙，手机上几乎没法读。
 *
 * 做法（不引入重量级 markdown 库，只生成最克制的标记）：
 *   1. 按句号/分号切句
 *   2. 「正面图案 / 背面图案 / 规格 / 发行」这类结构句另起一段，并把它们的引子加粗
 *   3. 剩下的按 2 句一段合并，过短的段落并回上一段
 *   4. 段落之间用空行分隔，写进新字段 textMd（原 text 原样保留，可随时回滚）
 *
 *   node tools/format_desc.js          # 预演，打印若干样例
 *   node tools/format_desc.js --write  # 写回 descriptions.json
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'data', 'descriptions.json');
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));

/* 句子里出现这些词就另起一段，并把词本身加粗。
   注意不能要求出现在句首 —— 原文常写成「中华人民共和国成立35周年纪念币正面图案均为…」，
   币名在前面，关键词在句中。 */
const MARKS = [
  ['正面图案', '正面主景'],
  ['背面图案', '背面主景'],
  ['面额为', '面值', '直径为', '发行数量为', '发行量为', '最大发行量'],
];

function findMark(s) {
  for (let i = 0; i < MARKS.length; i++) {
    for (let j = 0; j < MARKS[i].length; j++) {
      const w = MARKS[i][j];
      const idx = s.indexOf(w);
      if (idx >= 0 && s.indexOf('**' + w + '**') < 0) return w;
    }
  }
  return '';
}

/** 句末标点后切句；保留标点 */
function splitSentences(text) {
  const out = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if ('。！？'.indexOf(ch) >= 0) {
      // 后面紧跟引号的情况（…成立。”）也一并收进来
      let j = i + 1;
      while (j < text.length && '”"』」'.indexOf(text[j]) >= 0) { buf += text[j]; j++; i = j - 1; }
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

function formatOne(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const sents = splitSentences(raw);
  if (sents.length <= 2) return raw;   // 本来就短，不用折腾

  const paras = [];
  let cur = [];

  const flush = () => { if (cur.length) { paras.push(cur.join('')); cur = []; } };

  sents.forEach((s) => {
    const mark = findMark(s);
    if (mark) {
      if (cur.length) flush();         // 图案 / 规格句自成一段
      cur.push(s.replace(mark, '**' + mark + '**'));
      flush();
      return;
    }
    cur.push(s);
    if (cur.length >= 2) flush();      // 普通叙述两句一段
  });
  flush();

  // 过短的尾段并回上一段
  for (let i = paras.length - 1; i > 0; i--) {
    if (paras[i].length < 24) {
      paras[i - 1] += paras[i];
      paras.splice(i, 1);
    }
  }
  return paras.join('\n\n');
}

let changed = 0;
const samples = [];
Object.keys(doc).forEach((k) => {
  const item = doc[k];
  if (!item || !item.text) return;
  const md = formatOne(item.text);
  if (md !== item.text) changed++;
  item.textMd = md;
  if (samples.length < 3) samples.push({ k, before: item.text, after: md });
});

if (process.argv.includes('--write')) {
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n');
  console.log(`已写回 textMd：${changed} 条有变化（共 ${Object.keys(doc).length} 条）`);
} else {
  console.log(`预演：${changed} 条会被格式化（共 ${Object.keys(doc).length} 条）\n`);
  samples.forEach((s) => {
    console.log('--- #' + s.k + ' 原文 ---');
    console.log(s.before.slice(0, 120) + '…');
    console.log('--- 格式化后 ---');
    console.log(s.after);
    console.log('');
  });
}
