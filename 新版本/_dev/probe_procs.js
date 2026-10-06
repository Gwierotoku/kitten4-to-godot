'use strict';
/* dump 一个 bcm4 里**全部自定义积木定义**的完整 body（判断题：返回值 / 递归 / 循环） */
var fs = require('fs');
var path = require('path');
var CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
var ir = CORE.projectToIR(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
var 只挑 = process.argv[3] || '';

function 短(v) {
  return JSON.stringify(v, function (k, x) {
    if (typeof x === 'string' && x.length > 80) return x.slice(0, 40) + '…(len=' + x.length + ')';
    return x;
  }, 1);
}

var 总数 = 0;
(ir.scenes || []).forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (e) {
    (e.procs || []).forEach(function (p) {
      总数++;
      if (只挑 && String(p.name).indexOf(只挑) < 0) return;
      console.log('=== [' + e.name + '] ' + p.name + '  params=' + JSON.stringify(p.params || []) + ' kind=' + p.kind);
      console.log(短(p.body));
      console.log('');
    });
  });
});
console.log('共 ' + 总数 + ' 个自定义积木定义');
