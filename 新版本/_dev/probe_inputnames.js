// 探针：跑一遍反编译，把 ir.warnings 里「值输入名对不上」的条目汇总出来。
// 用法： node _dev/probe_inputnames.js
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 样本 = ['新的作品', 'pec2txt-phi谱面转换器', '游戏-空白作品', 'Phigros模拟器v2.5(编程猫版)'];

样本.forEach(function (f) {
  const raw = JSON.parse(fs.readFileSync(path.join(示例, f + '.bcm4'), 'utf8'));
  const ir = CORE.projectToIR(raw);
  const 命中 = (ir.warnings || []).filter(function (w) { return w.indexOf('值输入名对不上') === 0; });
  console.log('=== ' + f + '：' + 命中.length + ' 条');
  命中.forEach(function (w) { console.log('    ' + w); });
});
