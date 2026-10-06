// 探针：找出「K4 里是文本字面量，但生成物里找不到」的值。
// 用法： node _dev/probe_text.js
const fs = require('fs');
const path = require('path');

const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
// 不带参数就扫内置的 4 个用例；也可以 `node probe_text.js <工程名> <输出目录>`
const 样本 = process.argv[2]
  ? [[process.argv[2], process.argv[3] || path.join(__dirname, '..', '_out', process.argv[2])]]
  : [
    ['新的作品', path.join(__dirname, '..', '_out', '新作品')],
    ['pec2txt-phi谱面转换器', path.join(__dirname, '..', '_out', '音游谱面转换器')],
    ['游戏-空白作品', path.join(__dirname, '..', '_out', '空白作品')],
    ['Phigros模拟器v2.5(编程猫版)', path.join(__dirname, '..', '_out', 'Phigros')]
  ];

function 读生成物(dir) {
  let s = '';
  (function w(d) {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    es.forEach(function (e) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) w(p);
      else if (/\.(gd|tscn)$/.test(e.name)) s += fs.readFileSync(p, 'utf8');
    });
  })(dir);
  return s;
}

// 收集「值输入」里的文本字面量，并记下它挂在哪个块上（方便定位）
function 收集(raw) {
  const 命中 = {};   // 文本 -> [{块类型, 输入名, 次数}]
  function 记(v, 块类型, 输入名) {
    if (typeof v !== 'string' || v === '') return;
    命中[v] = 命中[v] || {};
    const k = 块类型 + '.' + 输入名;
    命中[v][k] = (命中[v][k] || 0) + 1;
  }
  function 走(o, 父类型) {
    if (Array.isArray(o)) return o.forEach(function (x) { 走(x, 父类型); });
    if (!o || typeof o !== 'object') return;
    const t = typeof o.type === 'string' ? o.type : 父类型;
    // 1) 独立 text 块
    if (typeof o.type === 'string' && /^text/i.test(o.type)) 记((o.fields || {}).TEXT, o.type, 'TEXT');
    // 2) shadows 里的 XML：<field name="TEXT">…</field>
    if (o.shadows && typeof o.shadows === 'object') {
      Object.keys(o.shadows).forEach(function (k) {
        const x = o.shadows[k];
        if (typeof x !== 'string') return;
        const m = /<field name="TEXT">([\s\S]*?)<\/field>/.exec(x);
        if (m) 记(m[1], t, 'shadows.' + k);
      });
    }
    Object.keys(o).forEach(function (k) { 走(o[k], t); });
  }
  走(raw, '?');
  return 命中;
}

let 总缺 = 0;
样本.forEach(function (pair) {
  const raw = JSON.parse(fs.readFileSync(
    /\.bcm4$/i.test(pair[0]) ? pair[0] : path.join(示例, pair[0] + '.bcm4'), 'utf8'));
  const 命中 = 收集(raw);
  const src = 读生成物(pair[1]);
  const keys = Object.keys(命中);
  const 缺 = keys.filter(function (v) { return src.indexOf(v) < 0; });
  总缺 += 缺.length;
  console.log('=== ' + pair[0] + '：文本取值 ' + keys.length + ' 个，生成物里找不到 ' + 缺.length + ' 个');
  缺.slice(0, 15).forEach(function (v) {
    const where = Object.keys(命中[v]).join(' ');
    console.log('    ' + JSON.stringify(v.slice(0, 40)) + '  ← ' + where);
  });
});
console.log('合计缺失 ' + 总缺);
