'use strict';
/**
 * 上传小程序代码（miniprogram-ci，不需要开开发者工具、不需要扫码）
 *
 * 前置：把小程序后台生成的上传私钥放到 .secrets/private.<appid>.key
 *   mp.weixin.qq.com → 管理 → 开发管理 → 开发设置 → 小程序代码上传 → 生成/下载密钥
 *
 * 用法：
 *   node tools/mp_upload.js                 # 版本号默认读 package.json 的 version
 *   node tools/mp_upload.js -v 1.2.1 -d "修复xx"
 *   node tools/mp_upload.js --robot 1       # 机器人编号，多分支并行时用
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const cfg = JSON.parse(fs.readFileSync(path.join(MP, 'project.config.json'), 'utf8'));
const APPID = cfg.appid;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// 版本以 miniprogram/app.js 为准（小程序「关于」里显示的也是它），
// 避免再维护一份独立版本文件导致上传成 1.2.0 这种旧号
let version = arg('-v', '');
if (!version) {
  const appJs = fs.readFileSync(path.join(MP, 'app.js'), 'utf8');
  const hit = appJs.match(/version:\s*'([^']+)'/);
  version = hit ? hit[1] : '';
}
if (!version) {
  const VER_FILE = path.join(__dirname, '_data', 'mp-version.txt');
  try { version = fs.readFileSync(VER_FILE, 'utf8').trim(); } catch (e) { version = '1.2.0'; }
}
const desc = arg('-d', `加入藏品支持指定数量（WEB 与小程序同步）`);
const robot = Number(arg('--robot', '1'));

const keyPath = path.join(ROOT, '.secrets', `private.${APPID}.key`);
if (!fs.existsSync(keyPath)) {
  console.error(`找不到上传私钥：${keyPath}`);
  console.error('');
  console.error('去 mp.weixin.qq.com → 管理 → 开发管理 → 开发设置 → 小程序代码上传，');
  console.error('点「生成」下载密钥，改名为 private.' + APPID + '.key 放进 .secrets/ 目录。');
  console.error('（.secrets 已在 .gitignore 里，不会进仓库）');
  process.exit(1);
}

(async () => {
  const ci = require('miniprogram-ci');
  const project = new ci.Project({
    appid: APPID,
    type: 'miniProgram',
    projectPath: MP,
    privateKeyPath: keyPath,
    ignores: ['node_modules/**/*', '.preview/**/*'],
  });

  console.log(`上传：${APPID} v${version}（robot ${robot}）`);
  console.log(`目录：${MP}`);

  const uploadResult = await ci.upload({
    project,
    version,
    desc,
    robot,
    setting: { es6: true, minify: true, autoPrefixWXSS: true },
    onProgressUpdate: (t) => {
      if (typeof t === 'string') process.stdout.write(`  ${t}\n`);
      else if (t && t._msg) process.stdout.write(`  ${t._msg}\n`);
    },
  });

  console.log('\n上传成功');
  console.log(JSON.stringify(uploadResult, null, 2));
})().catch((e) => {
  console.error('\n上传失败：', e && e.message ? e.message : e);
  if (e && e.errCode) console.error('errCode:', e.errCode);
  process.exit(1);
});
