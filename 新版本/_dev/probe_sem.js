// 统计某块类型的字段取值分布 + 每个输入影子当前的值
// （K4 的坑：shadows[输入名] 只是**创建时的默认 XML**，
//   用户真正填的值在 blocks[影子id].fields 里）
// 用法： node _dev/probe_sem.js <文件名.bcm4> <块类型> [最多样例]
const fs = require('fs');
const path = require('path');
const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 文件 = process.argv[2] || '游戏-空白作品.bcm4';
const 目标 = process.argv[3];
const 上限 = Number(process.argv[4] || 3);
if (!目标) { console.log('用法: node _dev/probe_sem.js <bcm4> <块类型> [样例数]'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(path.join(示例, 文件), 'utf8'));

// 1) 收集所有块（id -> 块）
const 块表 = {};
function 收集(o) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(收集); return; }
  if (typeof o.type === 'string' && o.id) 块表[o.id] = o;
  for (const k in o) 收集(o[k]);
}
收集(raw);

// 2) 找目标块
const 命中 = [];
(function 找(o) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(找); return; }
  if (o.type === 目标 && o.id && !o.is_shadow) 命中.push(o);
  for (const k in o) 找(o[k]);
})(raw);

console.log('====== ' + 目标 + '  共 ' + 命中.length + ' 个（' + 文件 + '） ======');
const 字段分布 = {};
命中.forEach(function (b) {
  Object.keys(b.fields || {}).forEach(function (k) {
    const v = JSON.stringify(b.fields[k]);
    const key = k + '=' + v;
    字段分布[key] = (字段分布[key] || 0) + 1;
  });
});
Object.keys(字段分布).sort().forEach(function (k) {
  console.log('  字段 ' + k.padEnd(40) + ' × ' + 字段分布[k]);
});

console.log('');
命中.slice(0, 上限).forEach(function (b, i) {
  console.log('--- 样例 ' + (i + 1) + '  id=' + b.id);
  Object.keys(b.shadows || {}).forEach(function (槽) {
    const xml = String(b.shadows[槽] || '');
    if (!xml) { console.log('    ' + 槽.padEnd(14) + ' (空)'); return; }
    const m = /id="([^"]+)"/.exec(xml);
    const 影子 = m ? 块表[m[1]] : null;
    if (!影子) {
      const t = /type="([^"]+)"/.exec(xml);
      console.log('    ' + 槽.padEnd(14) + ' 默认 XML type=' + (t ? t[1] : '?') + '（表里找不到该 id）');
      return;
    }
    const 非默认 = 影子.is_shadow === true ? '' : '  ★不是影子块★';
    console.log('    ' + 槽.padEnd(14) + ' id=' + 影子.id + ' type=' + 影子.type +
      ' is_shadow=' + 影子.is_shadow + ' fields=' + JSON.stringify(影子.fields) + 非默认);
  });
});
