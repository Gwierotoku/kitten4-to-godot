#!/usr/bin/env node
/*! 找造型的缩放（scale）等"每造型外观属性"存在哪
 *   node _dev/probe_style_scale.js <bcm4> [名字片段]
 *
 * K4 的 custom 造型除 pivot（旋转中心）外还有 **scale（缩放）** 等属性
 * （在 K4 画板上可改）。这些属性是"角色 × 造型"级别的关联，不一定和
 * theatre.styles 里的公共定义放一起 —— 所以这里把两处都摊开看。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var raw = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
var 片段 = process.argv[3] || '头像';

console.log('==== theatre.styles 每条的全部字段（前 6 条）====');
var st = (raw.theatre && raw.theatre.styles) || {};
Object.keys(st).slice(0, 6).forEach(function (k) {
  var s = st[k] || {};
  var 复 = {};
  Object.keys(s).forEach(function (f) { 复[f] = (f === 'url' ? String(s[f]).slice(0, 30) + '…' : s[f]); });
  console.log('  ' + k + ' → ' + JSON.stringify(复).slice(0, 420));
});

console.log('\n==== name 含「' + 片段 + '」的造型 ====');
Object.keys(st).forEach(function (k) {
  var s = st[k] || {};
  if (String(s.name || '').indexOf(片段) < 0) return;
  console.log('  ' + k + ' → ' + JSON.stringify(s).slice(0, 500));
});

console.log('\n==== 角色/舞台：造型关联表（styleInfo / styles / costumes 的键）====');
function 看(容器, 谁) {
  ['styles', 'styleInfo', 'costumes', 'style_scale', 'style_scales'].forEach(function (f) {
    if (容器[f] === undefined) return;
    var v = 容器[f];
    if (Array.isArray(v)) {
      console.log('  [' + 谁 + '] .' + f + ' = Array[' + v.length + ']  首项: ' + JSON.stringify(v[0]).slice(0, 300));
    } else if (v && typeof v === 'object') {
      var ks = Object.keys(v);
      console.log('  [' + 谁 + '] .' + f + ' = Object{' + ks.length + '}  键: ' + ks.slice(0, 10).join(','));
      ks.slice(0, 4).forEach(function (kk) {
        console.log('        ' + kk + ' → ' + JSON.stringify(v[kk]).slice(0, 300));
      });
    } else {
      console.log('  [' + 谁 + '] .' + f + ' = ' + JSON.stringify(v).slice(0, 200));
    }
  });
}
Object.keys((raw.theatre && raw.theatre.scenes) || {}).forEach(function (k) {
  看(raw.theatre.scenes[k], '舞台:' + String((raw.theatre.scenes[k] || {}).name || k).slice(0, 12));
});
Object.keys((raw.theatre && raw.theatre.actors) || {}).forEach(function (k) {
  看(raw.theatre.actors[k], '角色:' + String((raw.theatre.actors[k] || {}).name || k));
});

console.log('\n==== 全树搜 "scale"（前 20 处，看它在哪些结构里）====');
var n = 0;
(function walk(o, p) {
  if (o === null || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(function (x, i) { walk(x, p + '[' + i + ']'); }); return; }
  Object.keys(o).forEach(function (k) {
    if (/scale/i.test(k)) { n++; if (n <= 20) console.log('  ' + p + '.' + k + ' = ' + JSON.stringify(o[k]).slice(0, 120)); }
    var v = o[k];
    if (v && typeof v === 'object') walk(v, p + '.' + k);
  });
})(raw, 'raw');
console.log('  合计 ' + n + ' 处');
