'use strict';
/**
 * 兼容适配器（T03）
 *
 * 页面渲染的实际实现已**原样**搬到 server/services/seo.js。这里保留旧路径，
 * 让 legacy/api-handler.js 里原有的 setData 调用继续工作，
 * 且不会因为两份实现并存而漂移 —— 永远只有 seo.js 一份代码。
 */
module.exports = require('../services/seo');
