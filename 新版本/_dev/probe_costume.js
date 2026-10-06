#!/usr/bin/env node
/*!
 * 临时探针：dump「切换到造型」(set_costume) 块的原始结构
 *   node _dev/probe_costume.js <.bcm4>
 * 目的：看清"造型下拉框"与"嵌套表达式"两种形态在数据上怎么区分。
 */
'use strict';
var fs = require('fs');
var path = require('path');

var f = process.argv[2];
var raw = JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
var th = raw.theatre || {};

function 截(s, n) { s = String(s === undefined ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }

function 看实体(名, ent) {
  var data = ent.block_data_json || {};
  var blocks = data.blocks || {};
  var conns = data.connections || {};
  // 建立 parent -> 子 的索引（connections 是 [父][子]）
  var ids = Object.keys(blocks).filter(function (id) { return blocks[id].type === 'set_costume'; });
  if (!ids.length) return;
  console.log('\n======== 角色「' + 名 + '」：' + ids.length + ' 个 set_costume ========');
  ids.forEach(function (id, i) {
    var b = blocks[id];
    console.log('\n--- [' + i + '] 块 ' + id + ' ---');
    console.log('  fields     : ' + JSON.stringify(b.fields));
    var sh = b.shadows || {};
    Object.keys(sh).forEach(function (k) {
      console.log('  shadow.' + k + ' : ' + 截(sh[k], 200));
    });
    var 子 = conns[id] || {};
    Object.keys(子).forEach(function (cid) {
      var c = blocks[cid];
      console.log('  连接 ' + JSON.stringify(子[cid]) + ' → 子块 ' + cid +
        '  type=' + (c ? c.type : '?') + '  fields=' + JSON.stringify(c ? c.fields : null) +
        (c && c.is_shadow ? '  (is_shadow)' : ''));
    });
    // 影子 id 指向的真实块
    Object.keys(sh).forEach(function (k) {
      var m = /id\s*=\s*"([^"]*)"/.exec(sh[k] || '');
      if (m && blocks[m[1]]) {
        var rb = blocks[m[1]];
        console.log('  影子里的 id ' + m[1] + ' → 真实块 type=' + rb.type +
          '  fields=' + JSON.stringify(rb.fields) + '  parent_id=' + rb.parent_id);
      }
    });
    // parent_id 指向本块的（K4 在值输入上也会写 parent_id）
    Object.keys(blocks).forEach(function (bid) {
      var c = blocks[bid];
      if (c && c.parent_id === id) {
        console.log('  parent_id 反查 → ' + bid + '  type=' + c.type +
          '  fields=' + JSON.stringify(c.fields) + (c.is_shadow ? '  (is_shadow)' : ''));
      }
    });
  });
}

Object.keys(th.scenes || {}).forEach(function (k) { 看实体(th.scenes[k].name, th.scenes[k]); });
Object.keys(th.actors || {}).forEach(function (k) { 看实体(th.actors[k].name, th.actors[k]); });
