'use strict';
/* 扫全部 bcm4（含大型项目，只读），列出画笔相关块的 fields 取值分布。
   用法： node _dev/probe_pen_fields.js */
var fs = require('fs');
var path = require('path');
var 目录 = path.join(__dirname, '..', '..', 'kitten示例项目');

var 目标 = {
  self_set_pen_color_property: 1,
  self_change_pen_color_property: 1,
  self_change_pen_color_property_2: 1,
  set_fill_style: 1,
  set_pen_path: 1,
  self_change_pen_color: 1,
  self_change_pen_shade: 1,
  self_set_pen_color: 1,
  self_set_pen_size: 1,
  self_change_pen_size: 1,
  self_change_pen_size_2: 1
};

var 计数 = {};

function 收集(文件) {
  var raw;
  try { raw = JSON.parse(fs.readFileSync(文件, 'utf8')); } catch (e) { return; }
  function 走(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(走); return; }
    if (typeof o.type === 'string' && 目标[o.type] && o.fields !== undefined) {
      var f = o.fields || {};
      var 摘要 = Object.keys(f).map(function (k) {
        var v = f[k];
        var s = (v && typeof v === 'object' && v.value !== undefined) ? v.value : v;
        return k + '=' + s;
      }).join(',');
      var 输入 = Object.keys(o.inputs || {}).join('/');
      var 键 = o.type + '   { ' + 摘要 + ' }   inputs=[' + 输入 + ']';
      计数[键] = (计数[键] || 0) + 1;
    }
    for (var k in o) 走(o[k]);
  }
  走(raw);
}

function 递(p) {
  var st = [p];
  while (st.length) {
    var d = st.pop();
    var 列;
    try { 列 = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    列.forEach(function (e) {
      var q = path.join(d, e.name);
      if (e.isDirectory()) st.push(q);
      else if (/\.bcm4$/.test(e.name)) 收集(q);
    });
  }
}
递(目录);

var 键 = Object.keys(计数).sort();
if (!键.length) console.log('（一个都没扫到）');
键.forEach(function (k) { console.log(String(计数[k]).padStart(4) + '×  ' + k); });
