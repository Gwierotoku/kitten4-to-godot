#!/usr/bin/env node
/*!
 * 临时探针：dump 一个 .bcm4 的 IR 概要（重点看广播与帽子）
 *   node _dev/probe_broadcast.js <文件.bcm4>
 */
'use strict';
var fs = require('fs');
var path = require('path');
var CORE = require('../lib/k4/core.js');

var f = process.argv[2];
if (!f) { console.log('用法: node _dev/probe_broadcast.js <文件.bcm4>'); process.exit(1); }
var raw = JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
var ir = CORE.projectToIR(raw);

function 简述(节点, 深) {
  if (节点 === null || 节点 === undefined) return String(节点);
  if (Array.isArray(节点)) return '[' + 节点.map(function (x) { return 简述(x, 深); }).join(', ') + ']';
  if (typeof 节点 !== 'object') return JSON.stringify(节点);
  if (节点.k === 'lit') return JSON.stringify(节点.v);
  if (节点.k === 'ref' || 节点.k === 'listref') return 节点.name;
  if (节点.k === 'op') {
    if (深 > 2) return 节点.op + '(...)';
    return 节点.op + '(' + (节点.args || []).map(function (x) { return 简述(x, 深 + 1); }).join(', ') + ')';
  }
  if (节点.k === 'stub') return 'stub:' + 节点.type;
  var o = { k: 节点.k };
  ['name', 'value', 'cond', 'times', 'message', 'target', 'axis', 'option', 'dir', 'delta', 'x', 'y', 'seconds', 'sound', 'type', 'item', 'obj'].forEach(function (key) {
    if (节点[key] !== undefined) o[key] = (typeof 节点[key] === 'object' && 节点[key] !== null) ? 简述(节点[key], 深 + 1) : 节点[key];
  });
  return JSON.stringify(o);
}

console.log('工程: ' + ir.project.name + '  版本: ' + ir.project.version + '  尺寸: ' + ir.project.size.width + 'x' + ir.project.size.height);
console.log('屏幕数: ' + (ir.scenes || []).length + '   变量: ' + ir.project.variables.length + '   列表: ' + ir.project.lists.length + '   警告: ' + (ir.warnings || []).length);

(ir.scenes || []).forEach(function (sc) {
  console.log('\n==== 屏幕 ' + sc.name + ' (' + (sc.is_stage ? '舞台' : '?') + ') ====');
  console.log('  舞台自带脚本 ' + (sc.scripts || []).length + ' 个');
  [sc].concat(sc.actors || []).forEach(function (ent) {
    if (ent !== sc) {
      console.log('  ├ 角色 ' + ent.name + '  初始(' + ent.x + ',' + ent.y + ') 造型=' + ent.current_style + ' 组=' + JSON.stringify(ent.groups || []));
    }
    (ent.scripts || []).forEach(function (s, i) {
      var ev = s.event || {};
      console.log('  │  [' + i + '] 帽子 kind=' + ev.kind + ' label=' + ev.label +
        (ev.message ? ' 消息="' + ev.message + '"' : '') +
        (ev.key ? ' 键=' + ev.key + '/' + ev.keyEvent : '') +
        '  体 ' + (s.body || []).length + ' 条');
      (s.body || []).forEach(function (st, j) {
        var line = '  │      ' + j + ' ' + (st.k || '?');
        if (st.type) line += ' type=' + st.type;
        if (st.k === 'broadcast_body' || st.k === 'broadcast_body_wait' || st.k === 'broadcast' || st.k === 'broadcast_wait') {
          line += '  ★消息=' + 简述(st.message, 0) + '  自带体=' + ((st.body || []).length);
        }
        console.log(line);
        if (st.cond !== undefined || st.value !== undefined || st.times !== undefined) console.log('  │         ' + 简述(st, 1));
        if ((st.k === 'broadcast_body' || st.k === 'broadcast_body_wait') && (st.body || []).length) {
          st.body.forEach(function (sub, q) { console.log('  │         └ ' + q + ' ' + 简述(sub, 0)); });
        }
      });
    });
  });
});

// 术语统计
var counts = {};
(function walk(n) {
  if (Array.isArray(n)) return n.forEach(walk);
  if (!n || typeof n !== 'object') return;
  if (n.k === 'op') { counts[n.op] = (counts[n.op] || 0) + 1; return (n.args || []).forEach(walk); }
  if (n.k === 'stub') { counts['stub:' + n.type] = (counts['stub:' + n.type] || 0) + 1; return; }
  Object.keys(n).forEach(function (key) { walk(n[key]); });
})(ir.scenes);
console.log('\n==== IR op 词表 ====');
Object.keys(counts).sort().forEach(function (k) { console.log('  ' + k + ' × ' + counts[k]); });
