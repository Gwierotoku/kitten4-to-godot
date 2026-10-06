// 打印真实 <image> 标签的开头，看清属性到底怎么写的
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(path.join(示例, 'Phigros模拟器v2.5(编程猫版).bcm4'), 'utf8')));
const s = (ir.assets.styles || [])
  .filter(function (x) { return /\.svg$/i.test(x.file || '') && /<image[\s>]/i.test(Buffer.from(x.bytes).toString('utf8')); })
  .sort(function (a, b) { return b.bytes.length - a.bytes.length; })[0];
console.log('选中的文件: ' + (s ? s.file + ' (' + Math.round(s.bytes.length / 1024) + 'KB)' : '没有'));
const t = s ? Buffer.from(s.bytes).toString('utf8') : '';
const i = t.search(/<image/i);
console.log('首个 <image 位置 = ' + i);
console.log('片段（前 300 字）:');
console.log(t.slice(i, i + 300).replace(/(base64,)[A-Za-z0-9+/=]{40,}/, '$1…'));
console.log('---');
['xlink:href', 'href=', 'data:image', 'base64,', '<use'].forEach(function (k) {
  console.log(k + ' 出现次数 = ' + (t.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length);
});
