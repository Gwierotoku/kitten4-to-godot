// 探针：① K4 造型的 pivot(锚点) 是什么量纲、和图片尺寸什么关系
//       ② "全黑" 的那些 SVG 里到底有什么 Godot(ThorVG) 不认的东西
// 用法： node _dev/probe_pivot.js
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 样本 = ['新的作品', 'pec2txt-phi谱面转换器', '游戏-空白作品', 'Phigros模拟器v2.5(编程猫版)'];

console.log('======== ① pivot ========');
样本.forEach(function (f) {
  const raw = JSON.parse(fs.readFileSync(path.join(示例, f + '.bcm4'), 'utf8'));
  const ir = CORE.projectToIR(raw);
  const styles = (ir.assets && ir.assets.styles) || [];
  let 非零 = 0, 总 = 0;
  const 例 = [];
  styles.forEach(function (s) {
    总++;
    const p = s.pivot || {};
    const px = Number(p.x) || 0, py = Number(p.y) || 0;
    if (Math.abs(px) > 1e-6 || Math.abs(py) > 1e-6) {
      非零++;
      if (例.length < 3) 例.push({ 文件: s.file, pivot: p, 尺寸: s.size, mime: s.mime });
    }
  });
  console.log('  ' + f + '：造型 ' + 总 + ' 个，pivot 非零 ' + 非零 + ' 个');
  例.forEach(function (e) {
    console.log('      ' + JSON.stringify(e.文件) + ' pivot=' + JSON.stringify(e.pivot) +
      ' bytes=' + e.尺寸 + ' ' + e.mime);
  });
});

console.log('');
console.log('======== ② SVG 里 ThorVG 可能不认的东西 ========');
样本.forEach(function (f) {
  const raw = JSON.parse(fs.readFileSync(path.join(示例, f + '.bcm4'), 'utf8'));
  const ir = CORE.projectToIR(raw);
  const styles = (ir.assets && ir.assets.styles) || [];
  const 统计 = { svg: 0, text: 0, image: 0, dataURI: 0, filter: 0, mask: 0, clipPath: 0, use: 0, pattern: 0, gradient: 0 };
  const 大图 = [];
  styles.forEach(function (s) {
    if (!/\.svg$/i.test(s.file || '')) return;
    统计.svg++;
    const c = Buffer.from(s.bytes).toString('utf8');
    if (/<text[\s>]/i.test(c)) 统计.text++;
    if (/<image[\s>]/i.test(c)) { 统计.image++; if (/data:image\//i.test(c)) 统计.dataURI++; }
    if (/<filter[\s>]/i.test(c)) 统计.filter++;
    if (/<mask[\s>]/i.test(c)) 统计.mask++;
    if (/<clipPath[\s>]/i.test(c)) 统计.clipPath++;
    if (/<use[\s>]/i.test(c)) 统计.use++;
    if (/<pattern[\s>]/i.test(c)) 统计.pattern++;
    if (/<(linear|radial)Gradient[\s>]/i.test(c)) 统计.gradient++;
    if (s.bytes.length > 100000) 大图.push(s.file + '(' + Math.round(s.bytes.length / 1024) + 'KB)');
  });
  console.log('  ' + f + '  ' + JSON.stringify(统计));
  if (大图.length) console.log('      大文件: ' + 大图.join(' '));
});
