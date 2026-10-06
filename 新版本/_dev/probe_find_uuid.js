#!/usr/bin/env node
/*! 在整个 .bcm4 JSON 里搜一个字符串（uuid / 列表名）出现的所有位置
 *   node _dev/probe_find_uuid.js <bcm4> <要找的字符串>
 */
'use strict';
var fs = require('fs');
var path = require('path');
var raw = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
var 目标 = String(process.argv[3] || '');
if (!目标) { console.log('用法: node _dev/probe_find_uuid.js <bcm4> <字符串>'); process.exit(1); }

var 命中 = [];
(function walk(o, p) {
  if (o === null || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(function (x, i) { walk(x, p + '[' + i + ']'); }); return; }
  Object.keys(o).forEach(function (k) {
    var v = o[k];
    if (typeof v === 'string') {
      if (v.indexOf(目标) >= 0) 命中.push(p + '.' + k + '  →  ' + v.slice(0, 260));
    } else {
      walk(v, p + '.' + k);
    }
  });
})(raw, 'raw');

console.log('==== 含 "' + 目标 + '" 的位置（' + 命中.length + ' 处）====');
命中.slice(0, 40).forEach(function (s) { console.log('  ' + s); });
if (命中.length > 40) console.log('  …还有 ' + (命中.length - 40) + ' 处');
