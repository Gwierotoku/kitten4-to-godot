// 诊断「直接抽取内嵌位图」为什么没命中
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const SVG = require(path.join(__dirname, '..', 'lib', 'k4', 'svg.js'));
const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(path.join(示例, 'Phigros模拟器v2.5(编程猫版).bcm4'), 'utf8')));

let 命中 = 0, 多图 = 0, 有矢量 = 0, 拿不到 = 0;
const 例 = [];
(ir.assets.styles || []).forEach(function (s) {
  if (!/\.svg$/i.test(s.file || '')) return;
  const t = Buffer.from(s.bytes).toString('utf8');
  const 抽 = SVG.抽取内嵌位图(t);
  if (抽) { 命中++; return; }
  if (!/<image[\s>]/i.test(t)) return;
  const 图 = t.match(/<image\b[^>]*?xlink:href\s*=\s*"data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+"/gi);
  if (!图 || 图.length !== 1) { 多图++; if (例.length < 3) 例.push([s.file, '图数=' + (图 ? 图.length : 0)]); return; }
  const 去掉 = t.replace(/<image\b[\s\S]*?(\/>|<\/image>)/gi, '');
  const 标签 = 去掉.match(/<(path|text|rect|circle|ellipse|polygon|polyline|line)\b/gi) || [];
  有矢量++;
  if (例.length < 6) 例.push([s.file, '剩矢量=' + 标签.length + ' [' + 标签.slice(0, 4).join(',') + ']']);
});
console.log('命中 ' + 命中 + ' / 多图 ' + 多图 + ' / 有矢量 ' + 有矢量);
例.forEach(function (e) { console.log('   ' + e[0] + '  ' + e[1]); });
