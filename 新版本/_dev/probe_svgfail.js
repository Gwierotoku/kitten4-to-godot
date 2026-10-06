// 探针：列出某工程里「没有缓存 PNG」的 SVG（= 上轮光栅化失败的），并打印它们的尺寸
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const SVG = require(path.join(__dirname, '..', 'lib', 'k4', 'svg.js'));

const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 缓存 = path.join(__dirname, '..', '_cache', 'svg');
const 文件 = process.argv[2] || 'Phigros模拟器v2.5(编程猫版)';

const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(path.join(示例, 文件 + '.bcm4'), 'utf8')));
const styles = (ir.assets && ir.assets.styles) || [];
const 缺 = [];
const 全部 = [];
styles.forEach(function (s) {
  if (!/\.svg$/i.test(s.file || '')) return;
  const buf = Buffer.from(s.bytes);
  const 尺寸 = SVG.读尺寸(buf.toString('utf8'));
  if (!尺寸) { 缺.push({ 文件: s.file, 尺寸: '读不到', KB: Math.round(buf.length / 1024) }); return; }
  const 键 = SVG.缓存键(buf, 尺寸.w, 尺寸.h);
  const 有 = fs.existsSync(path.join(缓存, 键 + '.png'));
  const 面积 = 尺寸.w * 尺寸.h;
  全部.push({ 文件: s.file, w: 尺寸.w, h: 尺寸.h, 面积: 面积, KB: Math.round(buf.length / 1024), 有: 有 });
  if (!有) 缺.push({ 文件: s.file, 尺寸: 尺寸.w + 'x' + 尺寸.h, 面积: 面积, KB: Math.round(buf.length / 1024) });
});
console.log('=== ' + 文件 + '：SVG ' + 全部.length + ' 个，无缓存 ' + 缺.length + ' 个');
缺.sort(function (a, b) { return (b.面积 || 0) - (a.面积 || 0); });
缺.forEach(function (x) {
  console.log('   ' + String(x.文件).padEnd(24) + ' ' + String(x.尺寸).padEnd(14) +
    ' 面积=' + (x.面积 ? (x.面积 / 1000000).toFixed(2) + 'M' : '?') + '  ' + x.KB + 'KB');
});
console.log('=== 面积最大的 5 个（不管有没有缓存）');
全部.sort(function (a, b) { return b.面积 - a.面积; }).slice(0, 5).forEach(function (x) {
  console.log('   ' + String(x.文件).padEnd(24) + ' ' + (x.w + 'x' + x.h).padEnd(14) +
    ' 面积=' + (x.面积 / 1000000).toFixed(2) + 'M  ' + x.KB + 'KB  缓存=' + x.有);
});
