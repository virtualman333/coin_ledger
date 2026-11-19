'use strict';
/**
 * 语法门禁：`npm run check`
 *
 * 为什么不用 `node --check a.js && node --check b.js ...` 的长串：
 * 文件会一直增加（本次就新增了 13 个），手写清单必然遗漏；
 * 而 `for f in ...` 在 Windows 的 npm（cmd.exe）下不通用。
 * 这里用 Node 自己遍历 + spawnSync，跨平台且能一次报出所有坏文件。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** 需要校验的目录（递归取 .js）与零散文件 */
const DIRS = [
  'server',
  'tools',
  'tests'
];
const FILES = ['public/app.js'];

/** 第三方/产物目录不校验 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'dist', 'miniprogram_npm']);

/**
 * 递归收集 .js 文件。
 *
 * @param {string} dir 绝对路径
 * @param {string[]} out 输出数组
 * @returns {string[]} 文件列表
 */
function walk(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  entries.forEach((ent) => {
    if (ent.name.startsWith('.') && ent.isDirectory()) return;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) return;
      walk(full, out);
      return;
    }
    if (ent.name.endsWith('.js')) out.push(full);
  });
  return out;
}

const targets = [];
DIRS.forEach((d) => walk(path.join(ROOT, d), targets));
FILES.forEach((f) => {
  const full = path.join(ROOT, f);
  if (fs.existsSync(full)) targets.push(full);
});

const bad = [];
targets.forEach((file) => {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) bad.push({ file: path.relative(ROOT, file), out: (r.stderr || '') + (r.stdout || '') });
});

if (bad.length) {
  console.error('语法检查失败 ' + bad.length + ' 个文件：');
  bad.forEach((b) => console.error('\n--- ' + b.file + '\n' + b.out.trim()));
  process.exit(1);
}

console.log('语法检查通过：' + targets.length + ' 个 .js 文件');
