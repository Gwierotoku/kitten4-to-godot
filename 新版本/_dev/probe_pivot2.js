// 探针：验证 pivot 是「相对图片中心的像素偏移」（x 右、y 下）
// 判据：若 pivot ≈ (W/2, H/2) 则是"角点"，若 |pivot| << W/2 则是"轻微偏心"
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const SVG = require(path.join(__dirname, '..', 'lib', 'k4', 'svg.js'));

const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
['游戏-空白作品', 'Phigros模拟器v2.5(编程猫版)'].forEach(function (f) {
  const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(path.join(示例, f + '.bcm4'), 'utf8')));
  const styles = (ir.assets && ir.assets.styles) || [];
  console.log('==== ' + f);
  styles.forEach(function (s) {
    const p = s.pivot || {};
    const px = Number(p.x) || 0, py = Number(p.y) || 0;
    if (Math.abs(px) < 1e-6 && Math.abs(py) < 1e-6) return;
    const 尺寸 = SVG.读尺寸(Buffer.from(s.bytes).toString('utf8'));
    const 半宽 = 尺寸 ? 尺寸.w / 2 : NaN, 半高 = 尺寸 ? 尺寸.h / 2 : NaN;
    console.log('  ' + String(s.file).padEnd(22) +
      ' pivot=(' + px.toFixed(2) + ',' + py.toFixed(2) + ')' +
      ' 图=' + (尺寸 ? 尺寸.w + 'x' + 尺寸.h : '?') +
      ' 半=' + (isFinite(半宽) ? 半宽.toFixed(1) + 'x' + 半高.toFixed(1) : '?') +
      ' 比值=(' + (isFinite(半宽) && 半宽 ? (px / 半宽).toFixed(2) : '?') + ',' +
      (isFinite(半高) && 半高 ? (py / 半高).toFixed(2) : '?') + ')');
  });
});
