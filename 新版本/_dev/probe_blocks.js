#!/usr/bin/env node
/*!
 * probe_blocks.js —— 从 .bcm4 里统计积木类型、导出变量表、dump 指定类型的原始块
 *
 * 用法：
 *   node _dev/probe_blocks.js <工程.bcm4> [类型=xxx] [样例数=3]
 *
 * 为什么要区分「作品里真用的块」和「工具箱里的模板块」：
 *   bcm4 的 hidden_toolbox.blocks 里放着**所有**积木的空壳定义，
 *   直接全树统计会把它们算进去（例如 get_clone_index_property 本来一个没用也会出现）。
 */
'use strict';
var fs = require('fs');

var file = process.argv[2];
var want = process.argv[3] || '';
var limit = parseInt(process.argv[4] || '3', 10);
var raw = JSON.parse(fs.readFileSync(file, 'utf8'));

// hidden_toolbox 里的块对象引用集合 —— 统计时跳过
var toolbox = new Set();
(function mark(o) {
  if (o == null || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(mark); return; }
  toolbox.add(o);
  for (var k in o) mark(o[k]);
})((raw.hidden_toolbox || {}).blocks || {});

var count = {}, samples = {}, total = 0;
(function walk(o) {
  if (o == null || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(walk); return; }
  if (typeof o.type === 'string' && o.type && !(o instanceof Array) && !toolbox.has(o) &&
      (o.fields !== undefined || o.inputs !== undefined || o.next !== undefined || o.parent !== undefined)) {
    count[o.type] = (count[o.type] || 0) + 1;
    total++;
    if (want && o.type === want) {
      (samples[o.type] = samples[o.type] || []).push(o);
    }
  }
  for (var k in o) walk(o[k]);
})(raw.theatre || {});

console.log('=== 作品里实际用到的积木：' + Object.keys(count).length + ' 种 / ' + total + ' 块 ===');
Object.keys(count).sort().forEach(function (t) {
  console.log('   ' + String(count[t]).padStart(5) + '  ' + t);
});

console.log('\n=== 变量表 variables（UUID -> 名字）===');
Object.keys(raw.variables || {}).forEach(function (id) {
  var v = raw.variables[id];
  console.log('   ' + id + '  ' + (v && v.name !== undefined ? v.name : JSON.stringify(v)));
});
console.log('=== 云变量 cloud_variables ===');
Object.keys(raw.cloud_variables || {}).forEach(function (id) {
  var v = raw.cloud_variables[id];
  console.log('   ' + id + '  ' + (v && v.name !== undefined ? v.name : JSON.stringify(v)));
});

if (want) {
  var list = samples[want] || [];
  console.log('\n=== ' + want + ' 共 ' + list.length + ' 块，前 ' + limit + ' 个完整 JSON ===');
  list.slice(0, limit).forEach(function (b, i) {
    console.log('--- [' + i + '] ---');
    console.log(JSON.stringify(b, null, 1));
  });
}
