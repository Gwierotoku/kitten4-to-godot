#!/usr/bin/env node
/*! 全量对账：列出所有 lists_* 块（含所在 scene/actor、目标 uuid、解析出的名字）
 *   node _dev/probe_lists_blocks.js <bcm4>
 *
 * 背景：K4 的块**分两处存** ——
 *   theatre.scenes[<id>].block_data_json.blocks   （舞台）
 *   theatre.actors[<id>].block_data_json.blocks   （每个角色）
 * 只查一处会漏（曾经因此误判成"K4 导出丢目标"）。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var raw = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));

var vs = raw.variables || {};
function 名(uuid) {
  var u = String(uuid || '');
  if (!u) return '(空)';
  if (vs[u]) return String(vs[u].name) + (vs[u].type === 'list' ? '(列表)' : '(变量)');
  return u.slice(0, 12) + '…(表里没有)';
}
function 取VAR(xml) {
  var m = /name="VAR">([^<]*)</.exec(String(xml || ''));
  return m ? m[1] : '';
}

function 扫(容器, 谁) {
  var blocks = ((容器 || {}).block_data_json || {}).blocks || {};
  Object.keys(blocks).forEach(function (id) {
    var b = blocks[id] || {};
    var t = String(b.type || '');
    if (!/^lists_|^list_/.test(t)) return;
    var 行 = '  [' + 谁 + '] ' + t + '  id=' + id;
    var f = b.fields || {};
    if (f.VAR) 行 += '  fields.VAR=' + 名(f.VAR);
    if (f.TYPE) 行 += '  fields.TYPE=' + JSON.stringify(f.TYPE);
    var sh = b.shadows || {};
    if (sh.VALUE) 行 += '  VALUE→' + 名(取VAR(sh.VALUE));
    if (sh.TARGET) 行 += '  TARGET→' + 名(取VAR(sh.TARGET));
    if (sh.LIST) 行 += '  LIST→' + 名(取VAR(sh.LIST));
    console.log(行);
  });
}

var 场景 = raw.theatre.scenes || {};
var 角色 = raw.theatre.actors || {};
console.log('==== 舞台（theatre.scenes）里的 lists_* 块 ====');
Object.keys(场景).forEach(function (sid) { 扫(场景[sid], '舞台:' + String((场景[sid] || {}).name || sid).slice(0, 14)); });
console.log('\n==== 角色（theatre.actors）里的 lists_* 块 ====');
Object.keys(角色).forEach(function (aid) { 扫(角色[aid], '角色:' + String((角色[aid] || {}).name || aid)); });
