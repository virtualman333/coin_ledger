'use strict';
/**
 * 回归测试：拍照数币页的分享能力
 * - 页面支持「转发给朋友」与「分享到朋友圈」，落地路径带 from=share&c=数量
 * - 结果图分享走 canvas 海报 + 微信「分享图片」面板，低版本降级存相册
 * - 好友点开分享卡片后，页面要有邀请条（不能白屏要求重拍）
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');
const js = fs.readFileSync(path.join(MP, 'pages', 'count', 'count.js'), 'utf8');
const wxml = fs.readFileSync(path.join(MP, 'pages', 'count', 'count.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(MP, 'pages', 'count', 'count.wxss'), 'utf8');

test('拍照数币页同时支持转发与朋友圈', () => {
  assert.match(js, /onShareAppMessage\s*\(/, '缺少 onShareAppMessage');
  assert.match(js, /onShareTimeline\s*\(/, '缺少 onShareTimeline');
});

test('分享标题带数量，落地路径带 from=share&c=', () => {
  assert.match(js, /我用拍照数币数出 /, '标题缺少数量文案');
  assert.match(js, /\/pages\/count\/count\?from=share&c=/, '落地路径缺少 from/c 参数');
  assert.match(js, /query:\s*n > 0 \? 'from=share&c=' \+ n : ''/, '朋友圈 query 不对');
});

test('结果图分享：canvas 2d 画海报 → 分享图片面板 → 降级存相册', () => {
  assert.match(wxml, /<canvas[^>]*type="2d"[^>]*id="poster"/, '缺少 canvas 2d 画布');
  assert.match(wxml, /bindtap="shareResult"/, '结果区缺少分享按钮');
  assert.match(js, /wx\.canvasToTempFilePath\s*\(/, '没有导出海报');
  assert.match(js, /wx\.showShareImageMenu\s*\(/, '没有调用分享图片面板');
  assert.match(js, /wx\.saveImageToPhotosAlbum\s*\(/, '缺少存相册兜底');
  // 远程标注图必须先落成本地路径，否则 canvas 画不上去；
  // 首选服务端缩略图接口（不依赖 downloadFile 域名），getImageInfo 只做兜底
  assert.match(js, /\/api\/coin-count\/preview\?f=/, '缺少缩略图接口调用');
  assert.match(js, /wx\.getFileSystemManager\(\)\.writeFile/, '缩略图没有写成本地文件');
  assert.match(js, /wx\.getImageInfo\s*\(/, '缺少图片本地化兜底');
});

test('画布在屏幕外但有布局尺寸（display:none 画不出来）', () => {
  assert.match(wxss, /\.poster-canvas\{[\s\S]*position:fixed/, '画布没有移出视口');
  assert.match(wxss, /\.poster-canvas\{[\s\S]*width:540rpx/, '画布缺少布局尺寸');
  assert.doesNotMatch(wxss, /\.poster-canvas\{[\s\S]{0,80}display:none/, '不能用 display:none 隐藏画布');
});

test('分享进来的落地页有邀请条，不要求先重拍', () => {
  assert.match(js, /from === 'share'/, 'onLoad 没解析 from');
  assert.match(wxml, /\{\{invited\}\}/, '缺少邀请条文案');
});

test('分享按钮是次级动作：描边胶囊，字号不低于 20rpx', () => {
  assert.match(wxss, /\.btn-share\{[\s\S]*?border:1rpx solid #d9c39a/, '按钮观感与主按钮冲突');
  const m = /\.btn-share\{[\s\S]*?font-size:(\d+)rpx/.exec(wxss);
  assert.ok(m && Number(m[1]) >= 20, '字号过小');
});
