'use strict';
/* 扫 bcm4 原始 JSON，列出所有 self_set_effect / self_change_effect 块的字段值
   （用来确定 K4 的「特效」scope 到底是 0/1/2 还是名字） */
var fs = require('fs');
var raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

var 计数 = {};
function 看块(b) {
  var t = b && b.type;
  if (!t) return;
  if (/effect/i.test(t)) {
    var f = b.fields || {};
    var 摘要 = t + '  fields=' + JSON.stringify(Object.keys(f).map(function (k) {
      var v = f[k];
      return k + '=' + ((v && typeof v === 'object') ? (v.value !== undefined ? v.value : JSON.stringify(v)) : v);
    }));
    计数[摘要] = (计数[摘要] || 0) + 1;
  }
}
function 走(n) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach(走); return; }
  if (n.blocks && typeof n.blocks === 'object') {
    Object.keys(n.blocks).forEach(function (k) { 看块(n.blocks[k]); });
  }
  Object.keys(n).forEach(function (k) { var v = n[k]; if (v && typeof v === 'object') 走(v); });
}
走(raw);
var 键 = Object.keys(计数);
if (!键.length) console.log('（这个工程没有 effect 积木）');
键.sort().forEach(function (k) { console.log(计数[k] + '×  ' + k); });
