// 探针：看「内嵌位图」的 SVG 是不是其实只是包了一层 <image data:...> 的外壳
// 如果是，就可以直接 base64 解出来当 PNG 用 —— 不用起浏览器，快几个数量级
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));

const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 工程 = process.argv[2] || 'Phigros模拟器v2.5(编程猫版)';
const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(path.join(示例, 工程 + '.bcm4'), 'utf8')));

const 矢量标签 = /<(path|text|rect|circle|ellipse|polygon|polyline|line|g\s[^>]*fill="(?!none)[^"]*")/gi;

let 内嵌 = 0, 纯外壳 = 0, 混合 = 0, 多个图 = 0;
const 例 = [];
(ir.assets.styles || []).forEach(function (s) {
  if (!/\.svg$/i.test(s.file || '')) return;
  const c = Buffer.from(s.bytes).toString('utf8');
  if (!/<image[\s>]/i.test(c)) return;
  内嵌++;
  const 图 = [...c.matchAll(/<image[^>]*?xlink:href="data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)"/gi)];
  const 图数 = 图.length;
  if (图数 > 1) { 多个图++; if (例.length < 6) 例.push({ 文件: s.file, 图数: 图数, 标签: '多个图', KB: Math.round(s.bytes.length / 1024) }); return; }
  // 去掉 <image> 之后还剩多少绘制元素？
  const 去掉图 = c.replace(/<image[\s\S]*?\/>|<image[\s\S]*?<\/image>/gi, '');
  const 剩矢量 = (去掉图.match(/<(path|text|rect|circle|ellipse|polygon|polyline|line)\b/gi) || []).length;
  if (剩矢量 === 0) 纯外壳++;
  else { 混合++; if (例.length < 6) 例.push({ 文件: s.file, 图数: 图数, 标签: '混合(剩矢量' + 剩矢量 + ')', KB: Math.round(s.bytes.length / 1024) }); }
});
console.log(工程 + '：含 <image> 的 SVG ' + 内嵌 + ' 个 → 纯外壳 ' + 纯外壳 + ' / 混合 ' + 混合 + ' / 多图 ' + 多个图);
例.forEach(function (e) { console.log('   ' + String(e.文件).padEnd(22) + ' ' + e.标签.padEnd(18) + e.KB + 'KB'); });

// 抽一个最大的看看外壳长什么样
const 大 = (ir.assets.styles || []).filter(function (s) { return /\.svg$/i.test(s.file || '') && /<image[\s>]/i.test(Buffer.from(s.bytes).toString('utf8')); })
  .sort(function (a, b) { return b.bytes.length - a.bytes.length; })[0];
if (大) {
  const c = Buffer.from(大.bytes).toString('utf8');
  const 去图 = c.replace(/(base64,)[A-Za-z0-9+/=]{80,}/g, '$1…省略…');
  console.log('\n最大的内嵌位图 SVG：' + 大.file + '（' + Math.round(大.bytes.length / 1024) + 'KB）');
  console.log(去图.slice(0, 700));
}
