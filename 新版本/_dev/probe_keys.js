#!/usr/bin/env node
/*!
 * K4 真值探针：把作品里所有「按键」相关的块 dump 出来，并给出"键 → 触发档位"对照表
 *   node _dev/probe_keys.js <bcm4>
 *
 * 用途：
 *   ① 确认 K4 的 `key` 字段存什么（十进制 keyCode / "any"）与 key_event_type（down|up）；
 *   ② 人工试按键功能时当对照表用（哪个键是"按下触发"、哪个是"松开触发"）。
 *
 * 注意：K4 的块在 `theatre.scenes.<sceneId>.block_data_json.blocks`，不在顶层 ——
 *       所以这里是**递归**找，不写死路径。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var C = require('../lib/k4/core.js');

var 文件 = path.resolve(process.argv[2]);
var raw = JSON.parse(fs.readFileSync(文件, 'utf8'));

var 块 = [];
(function walk(o, p) {
  if (o === null || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(function (x, i) { walk(x, p + '[' + i + ']'); }); return; }
  if (o.type && /^(on_keydown|check_key)$/.test(String(o.type))) {
    块.push({ type: String(o.type), fields: o.fields || {} });
  }
  Object.keys(o).forEach(function (k) { walk(o[k], p + '.' + k); });
})(raw, 'raw');

console.log('==== RAW 按键块（' + 块.length + ' 个）====');
块.forEach(function (b) {
  console.log('  ' + b.type + '  key=' + JSON.stringify(b.fields.key) +
    '  event=' + JSON.stringify(b.fields.key_event_type));
});

console.log('\n==== 键 → 触发档位对照表（帽子）====');
var ir = C.projectToIR(raw);
var 帽 = [];
(ir.scenes || []).forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (e) {
    (e.scripts || []).forEach(function (s) {
      var ev = s.event;
      if (ev && ev.kind === 'key') 帽.push({ 角色: e.name || sc.name, 键: ev.key, 原始: ev.keyRaw, 档: ev.keyEvent });
    });
  });
});
帽.sort(function (a, b) { return String(a.键).localeCompare(String(b.键)); });
帽.forEach(function (x) {
  console.log('  ' + String(x.键).padEnd(11) + (x.档 === 'up' ? '松开触发' : '按下触发') +
    '   (K4 keyCode=' + x.原始 + ', 角色=' + x.角色 + ')');
});
console.log('  共 ' + 帽.length + ' 个按键帽子');

console.log('\n==== 按档位汇总 ====');
var 按下档 = [], 松开档 = [];
帽.forEach(function (x) { (x.档 === 'up' ? 松开档 : 按下档).push(String(x.键)); });
console.log('  按下触发（' + 按下档.length + '）: ' + 按下档.join(' '));
console.log('  松开触发（' + 松开档.length + '）: ' + 松开档.join(' '));

var 侦测 = {};
块.forEach(function (b) { if (b.type === 'check_key') 侦测[b.fields.key_event_type] = (侦测[b.fields.key_event_type] || 0) + 1; });
console.log('\n  「按下/松开 <键> 吗」侦测积木: ' + JSON.stringify(侦测));
