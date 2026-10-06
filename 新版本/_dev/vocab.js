#!/usr/bin/env node
/*!
 * 新版本 - 开发工具：反编译器词表提取 + 实际用量统计
 *
 * 目的：methodtable.js 的行集必须以**反编译器真正吐出的 k / op 词汇**为准，
 *       不是 blocks.js 那张目录表（两者的命名有大量细节差异）。
 *
 * 用法：
 *   node _dev/vocab.js                 # 只看源码词表
 *   node _dev/vocab.js --scan <目录>   # 额外扫描该目录下所有 .bcm4，给出实际词表 + 每个 k 的字段签名
 *   node _dev/vocab.js --scan <目录> --check   # 再对照 methodtable.js 报缺口
 */
'use strict';

var fs = require('fs');
var path = require('path');
var CORE = require('../lib/k4/core.js');

var ROOT = path.join(__dirname, '..');

/* ---------------- 1. 从 core.js 源码抽词表 ---------------- */

function extractFromSource() {
  var src = fs.readFileSync(path.join(ROOT, 'lib/k4/core.js'), 'utf8');
  function uniq(re) {
    var s = {}, out = [], m;
    while ((m = re.exec(src))) { if (!s[m[1]]) { s[m[1]] = 1; out.push(m[1]); } }
    return out.sort();
  }
  // 字面量：k: 'xxx' / op('xxx'
  var litK = uniq(/\bk:\s*'([A-Za-z_0-9]+)'/g);
  var litOp = uniq(/\bop\(\s*'([A-Za-z_0-9]+)'/g);
  // 拼接式（动态族）：k: 'x_' + ... / op('y_' + ...
  var famK = uniq(/\bk:\s*'([A-Za-z_0-9]+_)'\s*\+/g);
  var famOp = uniq(/\bop\(\s*'([A-Za-z_0-9]+_)'(?:\s*\+|\s*,)/g);
  // op('math_' + os.toLowerCase(), ...) 这种
  var dynOp = uniq(/\bop\(\s*'([A-Za-z_0-9]+_)'\s*\+/g);
  return { k: litK, op: litOp, famK: famK, famOp: famOp.concat(dynOp) };
}

/* ---------------- 2. 扫描真实工程，收集实际词汇与字段签名 ---------------- */

var EXPR_KINDS = { lit: 1, ref: 1, listref: 1, op: 1, args: 1, emptybool: 1, nop: 1, unknown: 1 };

function isExpr(v) { return v && typeof v === 'object' && typeof v.k === 'string'; }

/** 递归遍历一个语句/表达式节点 */
function walk(node, onNode) {
  if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walk(node[i], onNode); return; }
  if (!node || typeof node !== 'object') return;
  if (typeof node.k === 'string') onNode(node);
  var keys = Object.keys(node);
  for (var j = 0; j < keys.length; j++) {
    if (keys[j] === 'k') continue;
    var v = node[keys[j]];
    if (v && typeof v === 'object') walk(v, onNode);
  }
}

function scanProjects(dir) {
  var files = [];
  (function rec(d) {
    var ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (var i = 0; i < ents.length; i++) {
      var p = path.join(d, ents[i].name);
      if (ents[i].isDirectory()) rec(p);
      else if (/\.bcm4$/i.test(ents[i].name)) files.push(p);
    }
  })(dir);
  files.sort();

  var kUse = {}, opUse = {}, sig = {}, errs = [];
  files.forEach(function (f) {
    var ir;
    try { ir = CORE.projectToIR(JSON.parse(fs.readFileSync(f, 'utf8'))); }
    catch (e) { errs.push(f + ': ' + (e && e.message)); return; }
    var scenes = ir.scenes || [];
    for (var i = 0; i < scenes.length; i++) {
      var ents = [scenes[i]].concat(scenes[i].actors || []);
      for (var j = 0; j < ents.length; j++) {
        var scripts = ents[j].scripts || [];
        for (var s = 0; s < scripts.length; s++) {
          walk(scripts[s].body, function (n) {
            var key = n.k;
            if (key === 'op') {
              opUse[n.op] = (opUse[n.op] || 0) + 1;
              key = 'op:' + n.op;
            } else {
              kUse[n.k] = (kUse[n.k] || 0) + 1;
            }
            var rec = sig[key] || (sig[key] = { inputs: {}, fields: {}, n: 0, sample: null });
            rec.n++;
            Object.keys(n).forEach(function (kk) {
              if (kk === 'k') return;
              var v = n[kk];
              if (isExpr(v) || Array.isArray(v)) rec.inputs[kk] = (rec.inputs[kk] || 0) + 1;
              else rec.fields[kk] = (rec.fields[kk] || 0) + 1;
            });
            if (!rec.sample) rec.sample = n;
          });
        }
      }
    }
  });
  return { files: files, kUse: kUse, opUse: opUse, sig: sig, errs: errs };
}

/* ---------------- 3. 主流程 ---------------- */

function main() {
  var argv = process.argv.slice(2);
  var scanDir = null, check = false;
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--scan') scanDir = argv[++i];
    else if (argv[i] === '--check') check = true;
  }

  var src = extractFromSource();
  console.log('=== 反编译器源码词表 ===');
  console.log('k 字面量 (' + src.k.length + '): ' + src.k.join(' '));
  console.log('');
  console.log('op 字面量 (' + src.op.length + '): ' + src.op.join(' '));
  console.log('');
  console.log('k 动态族: ' + (src.famK.join(' ') || '(无)'));
  console.log('op 动态族: ' + (src.famOp.join(' ') || '(无)'));

  if (!scanDir) { console.log('\n（加 --scan <目录> 可统计真实工程用量与字段签名）'); return; }

  var r = scanProjects(path.resolve(scanDir));
  console.log('\n=== 实际用量 (扫描 ' + r.files.length + ' 个工程) ===');
  if (r.errs.length) console.log('解析失败: ' + r.errs.join(' | '));

  var kKeys = Object.keys(r.kUse).sort();
  var opKeys = Object.keys(r.opUse).sort();
  console.log('\n-- 语句 k (' + kKeys.length + ') --');
  kKeys.forEach(function (k) { console.log('  ' + k + '  ×' + r.kUse[k]); });
  console.log('\n-- 取值 op (' + opKeys.length + ') --');
  opKeys.forEach(function (k) { console.log('  ' + k + '  ×' + r.opUse[k]); });

  console.log('\n=== 每个节点的字段签名（inputs = 含子表达式，fields = 标量）===');
  Object.keys(r.sig).sort().forEach(function (key) {
    var rec = r.sig[key];
    console.log('  ' + key + ':' +
      ' in[' + Object.keys(rec.inputs).join(',') + ']' +
      ' fl[' + Object.keys(rec.fields).join(',') + ']');
  });

  if (check) {
    var mt;
    try { mt = require('../lib/k4/methodtable.js'); }
    catch (e) { console.log('\n[check] 无法加载 methodtable.js: ' + (e && e.message)); return; }
    var have = {};
    Object.keys(mt.IR_METHODS || {}).forEach(function (k) { have[k] = 1; });
    Object.keys(mt.OP_METHODS || {}).forEach(function (k) { have[k] = 1; });
    Object.keys(mt.TYPE_METHODS || {}).forEach(function (k) { have[k] = 1; });
    var inline = {};
    (mt.INLINE_IR || []).forEach(function (k) { inline[k] = 1; });
    var miss = [];
    kKeys.forEach(function (k) { if (!have[k] && !inline[k] && !EXPR_KINDS[k]) miss.push(k); });
    opKeys.forEach(function (k) { if (!have[k] && !have['op:' + k] && !inline[k]) miss.push('op:' + k); });
    console.log('\n[check] methodtable 缺口 (' + miss.length + '): ' + (miss.join(' ') || '无'));
  }
}

main();
