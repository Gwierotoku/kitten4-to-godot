// 只重跑「没缓存」的那些 SVG，验证失败是不是并发抢跑导致的
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const SVG = require(path.join(__dirname, '..', 'lib', 'k4', 'svg.js'));

const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 缓存 = path.join(__dirname, '..', '_cache', 'svg');
const 文件 = process.argv[2] || 'Phigros模拟器v2.5(编程猫版)';

const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(path.join(示例, 文件 + '.bcm4'), 'utf8')));
const 任务 = [];
(ir.assets.styles || []).forEach(function (s, i) {
  if (!/\.svg$/i.test(s.file || '')) return;
  const buf = Buffer.from(s.bytes);
  const 尺寸 = SVG.读尺寸(buf.toString('utf8'));
  if (!尺寸) return;
  if (fs.existsSync(path.join(缓存, SVG.缓存键(buf, 尺寸.w, 尺寸.h) + '.png'))) return;
  任务.push({ id: i, svgBuf: buf, w: 尺寸.w, h: 尺寸.h, 名: s.file });
});
console.log('缺 ' + 任务.length + ' 个，开始重跑…');
const t0 = Date.now();
const 结果 = SVG.批量光栅化(任务, 缓存);
console.log('光栅化回来 ' + Object.keys(结果).length + ' 个，用时 ' + Math.round((Date.now() - t0) / 1000) + ' 秒');
任务.forEach(function (t) {
  console.log('   ' + (结果[t.id] ? 'OK  ' : 'FAIL') + ' ' + String(t.名).padEnd(22) + t.w + 'x' + t.h);
});
