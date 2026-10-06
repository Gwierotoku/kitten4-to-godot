#!/usr/bin/env node
/*! 把 block_data_json 整个摊开：看它有哪些键、各键多大、连接存在哪
 *   node _dev/probe_blockdata.js <bcm4> [要搜的字符串]
 */
'use strict';
var fs = require('fs');
var path = require('path');
var raw = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
var 找 = process.argv[3] || '';

function 摘要(v) {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return 'Array[' + v.length + ']' + (v.length ? ' 首项:' + JSON.stringify(v[0]).slice(0, 120) : '');
  if (typeof v === 'object') { var k = Object.keys(v); return 'Object{' + k.length + '} 键:' + k.slice(0, 12).join(','); }
  return typeof v + ' = ' + String(v).slice(0, 100);
}

function 摊(谁, bdj) {
  if (!bdj) { console.log('  [' + 谁 + '] 没有 block_data_json'); return; }
  console.log('  [' + 谁 + '] block_data_json 的键：');
  Object.keys(bdj).forEach(function (k) {
    console.log('      .' + k + '  →  ' + 摘要(bdj[k]));
  });
}

var 场景 = raw.theatre.scenes || {};
var 角色 = raw.theatre.actors || {};
console.log('==== 舞台 theatre.scenes ====');
Object.keys(场景).forEach(function (sid) { 摊('舞台 ' + String((场景[sid] || {}).name || sid).slice(0, 16), (场景[sid] || {}).block_data_json); });
console.log('\n==== 角色 theatre.actors ====');
Object.keys(角色).forEach(function (aid) { 摊('角色 ' + String((角色[aid] || {}).name || aid), (角色[aid] || {}).block_data_json); });

console.log('\n==== 顶层其它可能放脚本的地方 ====');
['models', 'matrix', 'toolbox', 'broadcasts', 'painter'].forEach(function (k) {
  if (raw[k] !== undefined) console.log('  raw.' + k + ' → ' + 摘要(raw[k]));
});

if (找) {
  console.log('\n==== 全树搜 "' + 找 + '"（含所有键名与字符串值）====');
  var n = 0;
  (function walk(o, p) {
    if (o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(function (x, i) { walk(x, p + '[' + i + ']'); }); return; }
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (typeof v === 'string') {
        if (v.indexOf(找) >= 0) { n++; if (n <= 25) console.log('  ' + p + '.' + k + '  →  ' + v.slice(0, 200)); }
      } else walk(v, p + '.' + k);
    });
  })(raw, 'raw');
  console.log('  合计 ' + n + ' 处');
}
