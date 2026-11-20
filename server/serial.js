'use strict';
/**
 * 号码分析服务的服务端入口。
 * 规则实现只有一份：public/serial.js（UMD，浏览器与 Node 共用）。
 * 后端 re-export 它，确保前后端识别结果零漂移。
 */
module.exports = require('../public/serial.js');
