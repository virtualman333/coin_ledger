'use strict';
/**
 * 目录 JSON 双向逐字段比对（G1 零漂移的判定器）。
 *
 *   node tools/diff-catalog.js --a public/data --b /tmp/export
 *   node tools/diff-catalog.js --a DIR --b DIR --strict-key-order
 *   node tools/diff-catalog.js --a DIR            # b 缺省为 public/data
 *
 * 两种模式：
 *   · 深比较（默认）：类型与值都要一致（1 与 "1" 算不同，261.5 与 261.50 算相同）。
 *     这是**判定**依据。
 *   · 键序（--strict-key-order）：只提示、不判失败。原因：存量 coins.json 的 137 条
 *     里有 17 种不同的键顺序（size 有时在 seriesKeys 前、limit 有时在 set 前），
 *     任何固定投影顺序都不可能逐字复刻；而 JSON 对象的键序本来就没有语义。
 *
 * 允许的差异（docs 里也写了，属于**有意**差异）：
 *   coins.json 的 meta.count（存量写的是 135，实际 137）与 meta.generated（导出时间戳）
 *   series.json / images.json / gallery.json 的 updated（导出不改原样的日期戳）
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIR = path.join(__dirname, '..', 'public', 'data');

/** 参与比对的 6 个文件（顺序即报告顺序） */
const FILES = ['coins.json', 'descriptions.json', 'series.json', 'images.json', 'plan.json', 'gallery.json'];

/** 允许的差异（file + JSON Pointer 前缀） */
const ALLOWED = [
  { file: 'coins.json', pointer: '/meta/count', reason: '存量写成 135，实际 137（前端不读它）' },
  { file: 'coins.json', pointer: '/meta/generated', reason: '导出时间戳' },
  { file: 'series.json', pointer: '/updated', reason: '文档日期戳，导出保持原样' },
  { file: 'images.json', pointer: '/updated', reason: '文档日期戳，导出保持原样' },
  { file: 'gallery.json', pointer: '/updated', reason: '文档日期戳，导出保持原样' },
  { file: 'plan.json', pointer: '/updated', reason: '文档日期戳，导出保持原样' }
];

/**
 * 读 JSON 文件（不存在时返回 undefined）。
 *
 * @param {string} file 路径
 * @returns {unknown} 解析结果
 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw new Error('无法解析 ' + file + '：' + e.message);
  }
}

/**
 * 深比较两个值。
 *
 * @param {unknown} a 左侧
 * @param {unknown} b 右侧
 * @param {string} pointer JSON Pointer
 * @param {{diffs: object[], orderWarns: object[], strict: boolean}} acc 累加器
 * @returns {void}
 */
function deepCompare(a, b, pointer, acc) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      acc.diffs.push({ pointer: pointer, a: a, b: b });
      return;
    }
    if (a.length !== b.length) {
      acc.diffs.push({ pointer: pointer, a: 'length ' + a.length, b: 'length ' + b.length });
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) deepCompare(a[i], b[i], pointer + '/' + i, acc);
    return;
  }

  const aObj = a && typeof a === 'object';
  const bObj = b && typeof b === 'object';
  if (aObj && bObj) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    ak.forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(b, k)) {
        acc.diffs.push({ pointer: pointer + '/' + k, a: a[k], b: '<missing>' });
        return;
      }
      deepCompare(a[k], b[k], pointer + '/' + k, acc);
    });
    bk.forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(a, k)) {
        acc.diffs.push({ pointer: pointer + '/' + k, a: '<missing>', b: b[k] });
      }
    });
    if (acc.strict) {
      const sameOrder = ak.length === bk.length && ak.every((k, i) => k === bk[i]);
      if (!sameOrder) acc.orderWarns.push({ pointer: pointer, a: ak.join(','), b: bk.join(',') });
    }
    return;
  }

  if (aObj !== bObj) {
    acc.diffs.push({ pointer: pointer, a: a, b: b });
    return;
  }
  // 基本类型：类型也必须一致（1 与 "1" 是漂移）
  if (typeof a !== typeof b || !Object.is(a, b)) {
    acc.diffs.push({ pointer: pointer, a: a, b: b });
  }
}

/**
 * 判断某条差异是否在允许清单里。
 *
 * @param {string} file 文件名
 * @param {string} pointer JSON Pointer
 * @returns {{file:string,pointer:string,reason:string}|null} 命中的允许项
 */
function allowedOf(file, pointer) {
  for (const rule of ALLOWED) {
    if (rule.file !== file) continue;
    if (pointer === rule.pointer || pointer.indexOf(rule.pointer + '/') === 0) return rule;
  }
  return null;
}

/**
 * 比对两个目录。
 *
 * @param {string} dirA 左侧目录（通常是导出产物）
 * @param {string} dirB 右侧目录（通常是基线 public/data）
 * @param {{strictKeyOrder?: boolean, files?: string[]}} [opts] 选项
 * @returns {{ok:boolean, checked:string[], diffs:object[], allowed:object[], orderWarns:object[], missing:string[]}} 结果
 */
function diffDirs(dirA, dirB, opts) {
  const options = opts || {};
  const files = Array.isArray(options.files) ? options.files : FILES;
  const acc = { diffs: [], orderWarns: [], strict: !!options.strictKeyOrder };
  const allowed = [];
  const missing = [];

  files.forEach((file) => {
    const a = readJson(path.join(dirA, file));
    const b = readJson(path.join(dirB, file));
    if (a === undefined || b === undefined) {
      missing.push(file + (a === undefined ? '（A 缺失）' : '') + (b === undefined ? '（B 缺失）' : ''));
      return;
    }
    const local = { diffs: [], orderWarns: [], strict: acc.strict };
    deepCompare(a, b, '', local);
    local.diffs.forEach((d) => {
      const rule = allowedOf(file, d.pointer);
      if (rule) allowed.push({ file: file, pointer: d.pointer, reason: rule.reason, a: d.a, b: d.b });
      else acc.diffs.push(Object.assign({ file: file }, d));
    });
    local.orderWarns.forEach((w) => acc.orderWarns.push(Object.assign({ file: file }, w)));
  });

  return {
    ok: acc.diffs.length === 0 && missing.length === 0,
    checked: files,
    diffs: acc.diffs,
    allowed: allowed,
    orderWarns: acc.orderWarns,
    missing: missing
  };
}

/** 尽量把差异值打印得短一点 */
function brief(v) {
  if (v === undefined) return 'undefined';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

function main(argv) {
  const args = argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  const dirA = get('--a', '');
  const dirB = get('--b', DEFAULT_DIR);
  if (!dirA) {
    console.log('用法：node tools/diff-catalog.js --a <导出目录> [--b public/data] [--strict-key-order]');
    process.exit(2);
  }
  const result = diffDirs(dirA, dirB, { strictKeyOrder: args.indexOf('--strict-key-order') >= 0 });

  console.log('比对目录 A=' + dirA + '  B=' + dirB);
  console.log('  文件 ' + result.checked.length + ' 个：' + result.checked.join(', '));
  if (result.allowed.length) {
    console.log('  允许的差异 ' + result.allowed.length + ' 项：');
    result.allowed.slice(0, 10).forEach((a) => console.log('    · ' + a.file + a.pointer + '（' + a.reason + '）'));
  }
  if (result.orderWarns.length) {
    console.log('  键序提示 ' + result.orderWarns.length + ' 处（不影响判定，JSON 键序无语义）');
    result.orderWarns.slice(0, 5).forEach((w) => console.log('    ~ ' + w.file + (w.pointer || '/') + '：' + w.a + ' ≠ ' + w.b));
  }
  if (result.missing.length) {
    console.error('  缺少文件：' + result.missing.join('；'));
  }
  if (result.diffs.length) {
    console.error('  实质差异 ' + result.diffs.length + ' 处：');
    result.diffs.slice(0, 60).forEach((d) => {
      console.error('    × ' + d.file + (d.pointer || '/') + '：A=' + brief(d.a) + '  B=' + brief(d.b));
    });
    if (result.diffs.length > 60) console.error('    … 其余 ' + (result.diffs.length - 60) + ' 处省略');
    process.exit(1);
  }
  console.log('结论：结构一致，实质差异 0 处');
}

module.exports = {
  FILES: FILES,
  ALLOWED: ALLOWED,
  diffDirs: diffDirs,
  readJson: readJson,
  deepCompare: deepCompare
};

if (require.main === module) main(process.argv);
