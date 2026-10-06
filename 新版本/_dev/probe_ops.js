'use strict';
/* 统计一个 bcm4 的 IR 里出现的所有 op（积木类型）次数，按次数降序 */
var fs = require('fs');
var path = require('path');
var CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
var ir = CORE.projectToIR(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));

var 计数 = {}, 语句计数 = {};
function 走(n) {
  if (Array.isArray(n)) { n.forEach(走); return; }
  if (!n || typeof n !== 'object') return;
  if (n.k === 'op') 计数[n.op] = (计数[n.op] || 0) + 1;
  else if (typeof n.k === 'string') 语句计数[n.k] = (语句计数[n.k] || 0) + 1;
  Object.keys(n).forEach(function (k) { if (k !== 'k') { var v = n[k]; if (v && typeof v === 'object') 走(v); } });
}
(ir.scenes || []).forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (e) {
    (e.procs || []).forEach(function (p) { 走(p.body); });
    (e.scripts || []).forEach(function (s) { 走(s.body); });
  });
});

function 排(o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).map(function (k) { return k + '×' + o[k]; }).join('  '); }
console.log('=== 取值类 op ===');
console.log(排(计数));
console.log('');
console.log('=== 语句类 k ===');
console.log(排(语句计数));
