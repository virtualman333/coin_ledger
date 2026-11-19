'use strict';
/**
 * 把 tools/crawl-ecgci.js 抓到的全量贵金属目录生成 MySQL 导入 SQL。
 *
 * 用独立表 cl_ecgci_pm 存原始数据，不写 cl_coins / cl_pm_pieces ——
 * 那两张表直接驱动网站前台，2823 条一次性灌进去会改变站点形态。
 * 原始数据入库后，可以按项目需要再挑品种上架。
 *
 * 用法：node tools/import-ecgci-sql.js [--out <sql>]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'seeds', 'pm-ecgci-all.json');
const argIdx = process.argv.indexOf('--out');
const OUT = argIdx >= 0
  ? path.resolve(process.argv[argIdx + 1])
  : path.join(ROOT, '.testdata', 'import-ecgci.sql');

const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const items = doc.items || [];
if (!items.length) throw new Error('没有可导入的数据，请先跑 crawl-ecgci.js');

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\r?\n/g, ' ') + "'";
};

const lines = [];
lines.push('-- 金币云集贵金属目录全量导入（自动生成，勿手改）');
lines.push('-- 来源：' + doc.source + '  抓取时间：' + doc.crawledAt + '  条数：' + items.length);
lines.push('SET NAMES utf8mb4;');
lines.push(`CREATE TABLE IF NOT EXISTS cl_ecgci_pm (` +
  '  code VARCHAR(32) NOT NULL PRIMARY KEY,' +
  '  project_code VARCHAR(32) NULL,' +
  '  project_name VARCHAR(255) NULL,' +
  '  year VARCHAR(8) NULL,' +
  '  name VARCHAR(255) NULL,' +
  '  material VARCHAR(64) NULL,' +
  '  weight_g VARCHAR(64) NULL,' +
  '  face DECIMAL(14,2) NULL,' +
  '  fineness VARCHAR(32) NULL,' +
  '  max_mintage BIGINT NULL,' +
  '  quality VARCHAR(32) NULL,' +
  '  front_picture VARCHAR(512) NULL,' +
  '  back_picture VARCHAR(512) NULL,' +
  '  raw JSON NULL,' +
  '  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
  '  KEY idx_project (project_code), KEY idx_year (year), KEY idx_name (name(64))' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
lines.push('TRUNCATE TABLE cl_ecgci_pm;');

const COLS = '(`code`,`project_code`,`project_name`,`year`,`name`,`material`,`weight_g`,`face`,`fineness`,`max_mintage`,`quality`,`front_picture`,`back_picture`,`raw`)';

for (let i = 0; i < items.length; i += 50) {
  const chunk = items.slice(i, i + 50);
  const vals = chunk.map((it) => {
    const raw = JSON.stringify(it);
    return '(' + [
      q(it.code), q(it.projectCode), q(it.projectName), q(it.year || it.projectYear),
      q(it.name),
      q(Array.isArray(it.material) ? it.material.join('/') : it.material),
      q(Array.isArray(it.weight) ? it.weight.join('/') : it.weight),
      it.denomination === null || it.denomination === undefined ? 'NULL' : Number(it.denomination),
      q(it.fineness),
      it.circulation === null || it.circulation === undefined ? 'NULL' : Number(it.circulation),
      q(it.quality), q(it.frontPicture), q(it.backPicture), q(raw)
    ].join(',') + ')';
  }).join(',\n');
  lines.push('INSERT INTO cl_ecgci_pm ' + COLS + ' VALUES\n' + vals + ';');
}
lines.push('SELECT COUNT(*) AS imported FROM cl_ecgci_pm;');
lines.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`已生成 ${path.relative(ROOT, OUT)}：${items.length} 条，${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
