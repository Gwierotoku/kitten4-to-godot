// 统计样本里出现过的块类型 + 字段/输入名（用来定 K4 的真实语义）
// 用法： node _dev/probe_blocktypes.js [文件名.bcm4] [正则]
const fs = require('fs');
const path = require('path');
const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 文件 = process.argv[2] || '游戏-空白作品.bcm4';
const 过滤 = new RegExp(process.argv[3] || '^(lists_|text_|operator_|data_|sensing_|self_)');

const raw = JSON.parse(fs.readFileSync(path.join(示例, 文件), 'utf8'));
const 计数 = {}, 样例 = {}, 影子计数 = {};
function walk(o) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(walk); return; }
  if (typeof o.type === 'string' && o.fields !== undefined) {
    const t = o.type;
    if (o.is_shadow === true) 影子计数[t] = (影子计数[t] || 0) + 1;
    else {
      计数[t] = (计数[t] || 0) + 1;
      if (!样例[t]) 样例[t] = { fields: o.fields, inputs: Object.keys(o.inputs || {}) };
    }
  }
  for (const k in o) walk(o[k]);
}
walk(raw);

console.log('====== 非影子块 ' + 文件 + ' ======');
Object.keys(计数).filter(t => 过滤.test(t)).sort().forEach(t => {
  console.log(t.padEnd(30) + String(计数[t]).padStart(6) +
    '  fields=' + JSON.stringify(样例[t].fields) +
    '  inputs=' + JSON.stringify(样例[t].inputs));
});
console.log('');
console.log('====== 影子类型 ======');
Object.keys(影子计数).sort().forEach(t => {
  console.log(t.padEnd(30) + String(影子计数[t]).padStart(6));
});
