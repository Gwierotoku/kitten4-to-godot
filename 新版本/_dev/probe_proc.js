'use strict';
/* 看自定义积木的 IR：参数怎么引用、有没有返回值、body 长什么样 */
var fs = require('fs');
var CORE = require('../lib/k4/core.js');
var ir = CORE.projectToIR(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));

var seen = 0, kinds = {}, paramSamples = [], retSamples = [], procInfo = [];
function walk(n, cb) {
  if (Array.isArray(n)) { n.forEach(function (x) { walk(x, cb); }); return; }
  if (!n || typeof n !== 'object') return;
  if (typeof n.k === 'string') cb(n);
  Object.keys(n).forEach(function (k) { if (k !== 'k') { var v = n[k]; if (v && typeof v === 'object') walk(v, cb); } });
}

(ir.scenes || []).forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (ent) {
    (ent.procs || []).forEach(function (p) {
      if (seen >= 4) return;
      procInfo.push({ ent: ent.name, name: p.name, kind: p.kind, params: p.params, bodyLen: (p.body || []).length });
      walk(p.body, function (n) {
        kinds[n.k] = (kinds[n.k] || 0) + 1;
        if (n.k === 'param' && paramSamples.length < 3) paramSamples.push(n);
        if (n.k === 'return' && retSamples.length < 3) retSamples.push(JSON.stringify(n).slice(0, 200));
      });
      seen++;
    });
  });
});
console.log('=== 过程定义（前 4 个）===');
procInfo.forEach(function (p) { console.log('  ' + JSON.stringify(p)); });
console.log('\n=== body 里出现的 k ===');
console.log('  ' + JSON.stringify(kinds));
console.log('\n=== param 节点样例 ===');
paramSamples.forEach(function (p) { console.log('  ' + JSON.stringify(p)); });
console.log('\n=== return 节点样例 ===');
retSamples.forEach(function (r) { console.log('  ' + r); });

// 顺带看一个具体过程的完整 body（挑带参数的）
var shown = null;
(ir.scenes || []).forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (ent) {
    (ent.procs || []).forEach(function (p) {
      if (!shown && (p.params || []).length && (p.body || []).length) shown = { ent: ent.name, p: p };
    });
  });
});
if (shown) {
  console.log('\n=== 完整例子: ' + shown.ent + ' / ' + shown.p.name + '  params=' + JSON.stringify(shown.p.params));
  console.log(JSON.stringify(shown.p.body).slice(0, 1500));
}
