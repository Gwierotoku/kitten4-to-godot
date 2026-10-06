'use strict';
/* dump 指定 block type 的**完整原始块**（含 fields / inputs / mutation），
   用来确认 K4 把「目标角色」这类选择器存在哪个字段里。
   用法： node probe_block_raw.js <bcm4> <blockType> */
var fs = require('fs');
var raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
var 要 = process.argv[3];

var 命中 = 0;
function 看块(id, b) {
  if (b && b.type === 要 && 命中 < 3) {
    命中++;
    console.log('--- block ' + id);
    console.log(JSON.stringify(b, null, 1).slice(0, 1600));
    console.log('');
  }
}
function 走(n) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach(走); return; }
  if (n.blocks && typeof n.blocks === 'object') {
    Object.keys(n.blocks).forEach(function (k) { 看块(k, n.blocks[k]); });
  }
  Object.keys(n).forEach(function (k) { var v = n[k]; if (v && typeof v === 'object') 走(v); });
}
走(raw);
if (!命中) console.log('没找到 block type: ' + 要);
