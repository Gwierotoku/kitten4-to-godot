#!/usr/bin/env node
/*! 看 block_data_json.connections：每个块的"输入槽 → 子块/影子"关系
 *   node _dev/probe_conn.js <bcm4> <blockId...>
 * 不给 id 时：列出所有 lists_copy 的 connection，以及所有 variables_get(image_data) 的 connection
 */
'use strict';
var fs = require('fs');
var path = require('path');
var raw = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
var 要看的 = process.argv.slice(3);

var vs = raw.variables || {};
function 名(u) { if (!u) return '(空)'; if (vs[u]) return String(vs[u].name); return String(u).slice(0, 10) + '…'; }

// 收集所有 (谁, blockId) -> {block, conn}
var 全部 = [];
function 收(容器, 谁) {
  var bdj = (容器 || {}).block_data_json || {};
  var blocks = bdj.blocks || {}, conns = bdj.connections || {};
  Object.keys(blocks).forEach(function (id) {
    全部.push({ 谁: 谁, id: id, block: blocks[id], conn: conns[id] });
  });
}
var 场景 = raw.theatre.scenes || {}, 角色 = raw.theatre.actors || {};
Object.keys(场景).forEach(function (k) { 收(场景[k], '舞台:' + String((场景[k] || {}).name || k).slice(0, 12)); });
Object.keys(角色).forEach(function (k) { 收(角色[k], '角色:' + String((角色[k] || {}).name || k)); });

var 索引 = {};
全部.forEach(function (x) { 索引[x.id] = x; });

// image_data 的 uuid
var imageUuid = '';
Object.keys(vs).forEach(function (k) { if (String((vs[k] || {}).name) === 'image_data') imageUuid = k; });

if (!要看的.length) {
  console.log('==== 所有 lists_copy 的 connection ====');
  全部.filter(function (x) { return x.block.type === 'lists_copy'; }).forEach(function (x) {
    console.log('  [' + x.谁 + '] ' + x.id);
    console.log('     conn = ' + JSON.stringify(x.conn));
  });
  console.log('\n==== 所有 variables_get(image_data) 的 connection（' + imageUuid + '）====');
  全部.filter(function (x) { return x.block.type === 'variables_get' && (x.block.fields || {}).VAR === imageUuid; })
    .forEach(function (x) {
      console.log('  [' + x.谁 + '] ' + x.id + '  conn = ' + JSON.stringify(x.conn));
    });
  console.log('\n==== 所有 variables_set(image_data) 的 connection ====');
  全部.filter(function (x) { return x.block.type === 'variables_set' && (x.block.fields || {}).VAR === imageUuid; })
    .forEach(function (x) { console.log('  [' + x.谁 + '] ' + x.id + '  conn = ' + JSON.stringify(x.conn)); });
} else {
  要看的.forEach(function (id) {
    var x = 索引[id];
    console.log('=== ' + id + ' ===');
    if (!x) { console.log('  ★找不到★'); return; }
    console.log('  所在 = [' + x.谁 + ']  type=' + x.block.type);
    console.log('  fields = ' + JSON.stringify(x.block.fields || {}));
    console.log('  conn = ' + JSON.stringify(x.conn, null, 1).slice(0, 900));
    var sh = x.block.shadows || {};
    Object.keys(sh).forEach(function (k) { console.log('  shadow.' + k + ' = ' + String(sh[k]).slice(0, 150)); });
  });
}
