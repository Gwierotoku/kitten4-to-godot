#!/usr/bin/env node
/*!
 * 临时探针：dump 列表初值 / 造型位置与尺寸信息
 *   node _dev/probe_lists_styles.js <.bcm4>
 */
'use strict';
var fs = require('fs');
var path = require('path');
var C = require('../lib/k4/core.js');

var raw = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
var ir = C.projectToIR(raw);

console.log('==== 屏幕 ====');
console.log('  ' + (ir.scenes || []).map(function (s) { return s.name; }).join(' | '));

console.log('\n==== 变量（含列表）====');
(ir.project.variables || []).forEach(function (v) {
  var 值 = v.value;
  var 描述 = Array.isArray(值) ? ('[' + 值.length + ' 项] ' + JSON.stringify(值).slice(0, 160))
    : (JSON.stringify(值) === undefined ? 'undefined' : JSON.stringify(值));
  console.log('  ' + v.name + '  type=' + (v.type || '?') + '  global=' + v.is_global + '  value=' + 描述);
});

console.log('\n==== RAW 里 variables 的原始条目（前 6 个，看字段名）====');
(function () {
  var vs = (raw.theatre && raw.theatre.variables) || raw.variables || {};
  Object.keys(vs).slice(0, 6).forEach(function (k) {
    var v = vs[k] || {};
    console.log('  ' + k + ' 字段=' + Object.keys(v).join(',') + '  ' + JSON.stringify(v).slice(0, 220));
  });
})();

console.log('\n==== RAW theatre.styles 前 4 条的完整字段 ====');
(function () {
  var st = (raw.theatre && raw.theatre.styles) || {};
  Object.keys(st).slice(0, 4).forEach(function (k) {
    var s = st[k] || {};
    var 副本 = {};
    Object.keys(s).forEach(function (f) {
      if (f === 'url') { 副本.url = String(s[f]).slice(0, 40) + '…(' + String(s[f]).length + ' 字节)'; return; }
      副本[f] = s[f];
    });
    console.log('  ' + k + ' → ' + JSON.stringify(副本).slice(0, 400));
  });
})();

console.log('\n==== 抽取出的素材（前 6）====');
((ir.assets && ir.assets.styles) || []).slice(0, 6).forEach(function (a) {
  console.log('  ' + a.name + '  owner=' + a.owner + '  ext=' + a.ext + '  pivot=' + JSON.stringify(a.pivot) +
    '  size=' + a.size + '  bytes=' + a.bytes.length);
});

console.log('\n==== 各角色：造型表 / 位置 / 大小 / 当前造型 ====');
(ir.scenes || []).forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (e) {
    var si = e.styleInfo || {};
    if (!(si.names || []).length && !e.is_stage) return;
    console.log('  [' + sc.name + '] ' + e.name + '  x=' + e.x + ' y=' + e.y + ' scale=' + e.scale +
      ' 当前造型=' + e.current_style);
    console.log('      造型=' + JSON.stringify(si.names) + '  pivot=' + JSON.stringify(si.pivots));
    console.log('      文件=' + JSON.stringify(si.files));
  });
});
