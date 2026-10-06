// 严谨版：只统计**从实体脚本能走到**的文本值，看有没有真的丢
// 走法：每个 block_data_json 里，从「没有 parent_id 的块」出发，沿 connections 走完整张图
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));

const 文件 = process.argv[2];
const 输出 = process.argv[3];
const raw = JSON.parse(fs.readFileSync(文件, 'utf8'));
const HAT = CORE.HAT_TYPES || {};

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

const 可达文本 = {};
const 归属 = {};          // 文本 -> 挂在哪个块上
let 当前实体 = '';
function 处理实体(名, e) {
  当前实体 = 名;
  let bd = e.block_data_json;
  if (typeof bd === 'string') { try { bd = JSON.parse(bd); } catch (err) { return; } }
  if (!bd || !bd.blocks) return;
  const B = bd.blocks;
  const C = bd.connections || {};
  // ★只有「帽子块」才是脚本入口★
  // K4 的游离块（工具箱/样例块）同样没有 parent_id，用 parent_id 判断会把它们
  // 也当成根，导致 "123"/"abc"/"Hello" 这些默认影子一直被误报成"丢失"。
  const 起点 = Object.keys(B).filter(function (k) { return B[k] && HAT[B[k].type]; });
  const 见过 = {};
  const 栈 = 起点.slice();
  while (栈.length) {
    const id = 栈.pop();
    if (!id || 见过[id]) continue;
    见过[id] = 1;
    const b = B[id];
    if (!b) continue;
    // 自己的文本值
    if (typeof b.type === 'string' && /^text$/i.test(b.type) && b.fields && typeof b.fields.TEXT === 'string') {
      可达文本[b.fields.TEXT] = (可达文本[b.fields.TEXT] || 0) + 1;
      // 往上找挂在哪：parent_id 链 + 连接它的那个块与输入名
      let 父 = b.parent_id;
      let 父型 = 父 && B[父] ? B[父].type : '?';
      let 输入名 = '?';
      Object.keys(B).forEach(function (k) {
        const cc = C[k];
        if (!cc) return;
        Object.keys(cc).forEach(function (n) {
          if (n === id) { 父 = k; 父型 = B[k] ? B[k].type : '?'; 输入名 = (cc[n] || {}).input_name || '?'; }
        });
      });
      归属[b.fields.TEXT] = 当前实体 + ' / text 块 ← ' + 父型 + '.' + 输入名;
    }
    // 影子：**被真实连接覆盖的影子不算**（那时它只是没被用到的默认值）
    // 不排掉的话 "123" / "abc" / "Hello" / "1,2,3,4" 这些 K4 自带默认值会一直误报。
    const 本块连接 = C[id] || {};
    const 被覆盖 = {};
    Object.keys(本块连接).forEach(function (n) {
      const info = 本块连接[n] || {};
      if (info.type !== 'next' && info.input_name) 被覆盖[info.input_name] = 1;
    });
    if (b.shadows) {
      Object.keys(b.shadows).forEach(function (k) {
        if (被覆盖[k]) return;
        const x = b.shadows[k];
        if (typeof x !== 'string') return;
        const m = /<field name="TEXT">([\s\S]*?)<\/field>/.exec(x);
        if (m && m[1] !== '') { 可达文本[m[1]] = (可达文本[m[1]] || 0) + 1; 归属[m[1]] = b.type + '.shadows.' + k; }
      });
    }
    // 邻居：连接目标一定要走；parent_id 的「子块」要跳过 is_shadow ——
    // 影子块也带 parent_id，但被真实积木覆盖时它根本没被使用
    // （只按 parent_id 走会把 "175\n bp…" 这类默认影子误报成丢失）
    const own = C[id];
    if (own) Object.keys(own).forEach(function (n) { 栈.push(n); });
    Object.keys(B).forEach(function (k) {
      if (B[k] && B[k].parent_id === id && B[k].is_shadow !== true) 栈.push(k);
    });
  }
}
(function 走(o) {
  if (Array.isArray(o)) return o.forEach(走);
  if (!o || typeof o !== 'object') return;
  if (o.block_data_json) 处理实体(o.name || '?', o);
  Object.keys(o).forEach(function (k) { 走(o[k]); });
})(raw.theatre || {});

const src = 读生成物(输出);
const 键 = Object.keys(可达文本);
const 缺 = 键.filter(function (v) { return src.indexOf(v) < 0; });
console.log('可达文本值 ' + 键.length + ' 个，生成物里找不到 ' + 缺.length + ' 个');
缺.forEach(function (v) { console.log('   ' + JSON.stringify(v.slice(0, 60)) + '  x' + 可达文本[v] + '   ← ' + (归属[v] || '?')); });
