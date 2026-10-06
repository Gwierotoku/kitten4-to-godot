// 综合定位：那个 60+ 个 0 的 text 影子，到底被谁引用、为什么没进生成物
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));

const 文件 = process.argv[2];
const raw = JSON.parse(fs.readFileSync(文件, 'utf8'));

// 1) 原始变量表里有没有「存档」
console.log('=== 原始 variables 里名字含「存档」的 ===');
Object.keys(raw.variables || {}).forEach(function (k) {
  const v = raw.variables[k];
  if (v && String(v.name).indexOf('存档') >= 0) {
    console.log('  ' + JSON.stringify(v.name) + '  type=' + v.type + ' is_global=' + v.is_global +
      ' entity=' + (v.current_entity || '-') + ' value=' + JSON.stringify(v.value).slice(0, 60));
  }
});

// 2) 找到那个 text 影子块，看谁引用它
const 靶 = Object.keys(findText(raw))[0];
function findText(o, out) {
  out = out || {};
  if (Array.isArray(o)) { o.forEach(function (x) { findText(x, out); }); return out; }
  if (!o || typeof o !== 'object') return out;
  if (o.type === 'text' && o.is_shadow === true && o.fields && String(o.fields.TEXT || '').length > 20) out[o.id] = o;
  Object.keys(o).forEach(function (k) { findText(o[k], out); });
  return out;
}
console.log('\n=== 那个长 text 影子被谁引用 ===');
(function 扫(o, 实体名) {
  if (Array.isArray(o)) return o.forEach(function (x) { 扫(x, 实体名); });
  if (!o || typeof o !== 'object') return;
  if (o.name && o.block_data_json) 实体名 = o.name;
  const bd = o.block_data_json;
  if (bd && bd.connections) {
    Object.keys(bd.connections).forEach(function (from) {
      const row = bd.connections[from] || {};
      Object.keys(row).forEach(function (to) {
        if (to === 靶) {
          const 父 = bd.blocks[from] || {};
          console.log('  实体「' + 实体名 + '」: ' + 父.type + '.' + (row[to] || {}).input_name + '  -> text 影子');
          // 再往上找一层
          Object.keys(bd.connections).forEach(function (g) {
            const r2 = bd.connections[g] || {};
            Object.keys(r2).forEach(function (t2) {
              if (t2 === from) {
                const 祖 = bd.blocks[g] || {};
                console.log('        上的块: ' + 祖.type + '.' + (r2[t2] || {}).input_name);
              }
            });
          });
        }
      });
    });
  }
  Object.keys(o).forEach(function (k) { 扫(o[k], 实体名); });
})(raw, '?');

// 3) IR 里有没有这个串
const ir = CORE.projectToIR(raw);
let 命中IR = 0;
(function 走(n) {
  if (Array.isArray(n)) return n.forEach(走);
  if (!n || typeof n !== 'object') return;
  if (n.k === 'lit' && typeof n.v === 'string' && n.v.length > 20) {
    命中IR++;
    if (命中IR <= 3) console.log('\nIR 里有长字符串: 长度=' + n.v.length + ' 前 20=' + JSON.stringify(n.v.slice(0, 20)));
  }
  Object.keys(n).forEach(function (k) { 走(n[k]); });
})(ir.scenes);
console.log('\nIR 里长字符串共 ' + 命中IR + ' 个');
