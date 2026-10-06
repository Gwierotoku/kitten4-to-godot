// 单个 SVG 单独渲染，带完整输出，用来诊断 Edge 到底卡在哪
// 用法： node _dev/probe_svgone.js <工程名> <造型文件名>
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const SVG = require(path.join(__dirname, '..', 'lib', 'k4', 'svg.js'));

const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 工程 = process.argv[2] || 'Phigros模拟器v2.5(编程猫版)';
const 目标 = process.argv[3] || '新角色(28).svg';

const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(path.join(示例, 工程 + '.bcm4'), 'utf8')));
const s = (ir.assets.styles || []).find(function (x) { return x.file === 目标; });
if (!s) { console.log('找不到 ' + 目标); process.exit(1); }
const buf = Buffer.from(s.bytes);
const 文本 = buf.toString('utf8');
console.log('文件 ' + 目标 + '  ' + buf.length + ' bytes');
console.log('首 300 字: ' + 文本.slice(0, 300));
console.log('尺寸: ' + JSON.stringify(SVG.读尺寸(文本)));

const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), 'k4one-'));
const 源 = path.join(临时, 'in.svg');
const 出 = path.join(临时, 'out.png');
fs.writeFileSync(源, buf);
const 尺寸 = SVG.读尺寸(文本) || { w: 100, h: 100 };

[1, 2].forEach(function (倍) {
  const w = 尺寸.w * 倍, h = 尺寸.h * 倍;
  const png = path.join(临时, 'o' + 倍 + '.png');
  const 参数 = ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--hide-scrollbars', '--default-background-color=00000000',
    '--user-data-dir=' + path.join(临时, 'p'),
    '--window-size=' + w + ',' + h, '--screenshot=' + png,
    'file:///' + 源.replace(/\\/g, '/')];
  const t0 = Date.now();
  const r = cp.spawnSync(SVG.找浏览器(), 参数, { timeout: 90000, windowsHide: true, encoding: 'utf8' });
  const 好 = fs.existsSync(png) && fs.statSync(png).size > 8;
  console.log('  window=' + w + 'x' + h + '  status=' + r.status + ' signal=' + r.signal +
    '  用时=' + Math.round((Date.now() - t0) / 1000) + 's  出图=' + 好 +
    (好 ? (' ' + fs.statSync(png).size + 'B') : '') +
    (r.stderr ? ('  stderr=' + String(r.stderr).slice(0, 200)) : ''));
});
