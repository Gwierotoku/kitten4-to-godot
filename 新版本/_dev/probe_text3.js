// 探针：直接把文本类积木的原始 JSON（fields / inputs / shadows / connections）打出来。
// 用法： node _dev/probe_text3.js <bcm4> [块类型正则]
const fs = require('fs');

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const 正则 = new RegExp(process.argv[3] || 'text_split|text_contain|text_length|str_');
const 已见 = {};
const 样本 = {};

function 走(o) {
  if (Array.isArray(o)) return o.forEach(走);
  if (!o || typeof o !== 'object') return;
  if (typeof o.type === 'string' && 正则.test(o.type)) {
    已见[o.type] = (已见[o.type] || 0) + 1;
    if (!样本[o.type]) 样本[o.type] = o;
  }
  Object.keys(o).forEach(function (k) { 走(o[k]); });
}
走(raw);

Object.keys(已见).sort().forEach(function (t) {
  const b = 样本[t];
  console.log('=== ' + t + '  (' + 已见[t] + ' 个)');
  console.log('    fields   = ' + JSON.stringify(b.fields || {}));
  console.log('    inputs   = ' + JSON.stringify(b.inputs || {}));
  console.log('    shadows  = ' + JSON.stringify(b.shadows || {}).slice(0, 600));
  console.log('    mutation = ' + JSON.stringify(b.mutation || '').slice(0, 200));
  console.log('');
});
