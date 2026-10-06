#!/usr/bin/env node
/*! 一次性定位：看「复制列表」三处块在 K4 数据里的完整内容（尤其 TARGET 影子）
 *   node _dev/probe_copy_target.js <bcm4> [块id...]
 */
'use strict';
var fs = require('fs');
var path = require('path');
var raw = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
var ids = process.argv.slice(3);
if (!ids.length) ids = ['R9GVQYpFIe2e4Q1Dr6Ut', 'n8YRpMzMUzY3eLsqvkPN', 'tVfQtLhBIHwosuBWeLyq'];

var 全部 = {};
(function walk(o) {
  if (o === null || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(walk); return; }
  if (o.id && o.type) 全部[o.id] = o;
  Object.keys(o).forEach(function (k) { walk(o[k]); });
})(raw);

ids.forEach(function (id) {
  var b = 全部[id];
  console.log('=== 块 ' + id + ' ===');
  if (!b) { console.log('  ★数据里找不到这个块★'); return; }
  console.log('  type   = ' + b.type);
  console.log('  ★所有键 = ' + Object.keys(b).join(', '));
  console.log('  fields = ' + JSON.stringify(b.fields || {}));
  console.log('  inputs = ' + JSON.stringify(Object.keys(b.inputs || {})));
  Object.keys(b.shadows || {}).forEach(function (k) {
    console.log('  shadow.' + k + ' = ' + String(b.shadows[k]).slice(0, 320));
  });
  Object.keys(b.inputs || {}).forEach(function (k) {
    console.log('  input.' + k + ' = ' + JSON.stringify(b.inputs[k]).slice(0, 200));
  });
});

// uuid -> 名字 对照（判断 uuid 到底指向哪个变量/列表）
var vs = raw.variables || {};
console.log('\n==== 关注的名字对应的 uuid ====');
Object.keys(vs).forEach(function (k) {
  var v = vs[k] || {};
  var n = String(v.name || '');
  if (/^(image_data|rect_|temp|局部列表|rect_quantity|次数)$/.test(n) || /^rect_/.test(n)) {
    console.log('  ' + n + '  uuid=' + k + '  type=' + v.type + '  global=' + v.is_global);
  }
});
