// 探针：找出「比较块 + 文本影子」这一组合，看影子到底长什么样、我们读到的是什么
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));

const 文件 = process.argv[2];
const 目标文本 = process.argv[3] || '主界面';
const raw = JSON.parse(fs.readFileSync(文件, 'utf8'));

const 命中 = [];
function 走(o, 父) {
  if (Array.isArray(o)) return o.forEach(function (x) { 走(x, 父); });
  if (!o || typeof o !== 'object') return;
  const 有关 = JSON.stringify(o.shadows || {}).indexOf(目标文本) >= 0 ||
    (o.fields && JSON.stringify(o.fields).indexOf(目标文本) >= 0);
  if (有关 && o.type && !/^text$/i.test(o.type)) 命中.push(o);
  Object.keys(o).forEach(function (k) { 走(o[k], o); });
}
走(raw, null);

console.log('含「' + 目标文本 + '」的块 ' + 命中.length + ' 个');
const 类型计数 = {};
命中.forEach(function (b) { 类型计数[b.type] = (类型计数[b.type] || 0) + 1; });
console.log('类型分布: ' + JSON.stringify(类型计数));

命中.slice(0, 3).forEach(function (b, i) {
  console.log('\n--- #' + (i + 1) + ' type=' + b.type);
  console.log('  fields  = ' + JSON.stringify(b.fields || {}));
  console.log('  shadows = ' + JSON.stringify(b.shadows || {}).replace(/</g, '\n      <'));
  console.log('  inputs  = ' + JSON.stringify(b.inputs || {}));
});
