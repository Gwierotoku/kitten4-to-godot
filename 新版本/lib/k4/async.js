/*! 新版本 - 协程（await）静态判定
 *
 * 为什么需要它：
 *   生成代码以前对**所有**积木方法调用无脑写 `await`。后果有三：
 *     ① 语义错：K4 里"不等待"的积木（发送广播、移动、设置变量…）被变成协程调用，
 *        调用点会被挂起一帧去等一个本来同步完成的东西；
 *     ② 传染：函数体里只要有 await，**这个函数自己就变成协程**，再往上逼着
 *        调用者也 await，一路污染到帽子体；
 *     ③ 噪声：`await 同步函数` 在 Godot 里是 REDUNDANT_AWAIT 警告。
 *
 * 判定方式（保守优先，宁可多 await 不可漏）：
 *   ① 扫 runtime 下全部 .gd，按缩进切出每个 `func` 的函数体；
 *   ② 体里出现 `await` → 该函数**直接是协程**；
 *   ③ 体里调用了某个协程函数 → 该函数**也是协程**（传染闭包，迭代到不动点）；
 *   ④ 方法表里标了 `await: true` 的名字**一律算协程**（那是给用户实现留的契约：
 *      用户可能在 角色类.gd 里把它改成协程，生成代码必须等）；
 *   ⑤ 名字合并是**全局按名**的：同名函数只要有一处是协程，就按协程处理。
 *      （保守方向：多写 await 只会多一次"立即返回"的 await，不会报错。）
 */
'use strict';

var fs = require('fs');
var path = require('path');

var RUNTIME = path.join(__dirname, '..', '..', 'runtime');

/** GDScript 语言关键字（不是函数名，收集调用时排除） */
var 关键字 = {
  if: 1, elif: 1, else: 1, for: 1, while: 1, match: 1, when: 1, return: 1, await: 1,
  and: 1, or: 1, not: 1, in: 1, is: 1, as: 1, var: 1, func: 1, class: 1, class_name: 1,
  pass: 1, break: 1, continue: 1, static: 1, const: 1, signal: 1, enum: 1, extends: 1,
  self: 1, super: 1, true: 1, false: 1, null: 1, void: 1, preload: 1, load: 1, assert: 1,
};

/** 按缩进把源码切成函数：返回 [{名, 体}]。内部类里的函数同样能切出来。
 *  注释行不入体（否则注释里出现的 `await` / `函数名(` 会污染判定）。 */
function 切函数(源码) {
  var 行们 = String(源码).split(/\r?\n/);
  var 出 = [];
  var 当前 = null;
  for (var i = 0; i < 行们.length; i++) {
    var 行 = 行们[i];
    var fm = /^([\t ]*)(?:static[\t ]+)?func[\t ]+([^\s(]+)[\t ]*\(/.exec(行);
    if (fm) {
      当前 = { 名: fm[2], 缩进: fm[1].length, 行: [] };
      出.push(当前);
      continue;
    }
    if (当前 === null) continue;
    if (/^[\t ]*$/.test(行)) { 当前.行.push(''); continue; }
    if (/^[\t ]*#/.test(行)) continue;                 // 整行注释：丢掉
    var 缩 = /^[\t ]*/.exec(行)[0].length;
    if (缩 <= 当前.缩进) { 当前 = null; continue; }   // 函数结束（回到同级或更外层）
    当前.行.push(行);
  }
  return 出;
}

/** 去掉字符串字面量与行注释 —— 判定只看**真代码**。
 *  顺序必须是"先字符串、后注释"：否则字符串里的 `#` 会被当注释起点。 */
function 净化(文本) {
  return String(文本)
    .replace(/"""(?:[\s\S]*?)"""/g, '""')            // 多行字符串
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')           // 双引号字符串
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")           // 单引号字符串
    .replace(/#[^\n]*/g, '');                        // 行尾注释
}

/** 收集一段代码里出现的「函数调用」名字（保守：不过滤内建函数） */
function 收集调用(文本) {
  var 名 = {};
  var re = /([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)[\t ]*\(/g;
  var m;
  while ((m = re.exec(文本)) !== null) {
    if (!关键字[m[1]]) 名[m[1]] = 1;
  }
  return 名;
}

function 列gd(目录, 出) {
  出 = 出 || [];
  var 项;
  try { 项 = fs.readdirSync(目录, { withFileTypes: true }); } catch (e) { return 出; }
  项.forEach(function (e) {
    var 全 = path.join(目录, e.name);
    if (e.isDirectory()) 列gd(全, 出);
    else if (/\.gd$/i.test(e.name)) 出.push(全);
  });
  return 出;
}

/**
 * 扫 runtime/ 得出协程方法集合。
 * @param {string} [根] 默认 runtime/
 * @returns {{协程:Object, 直接:Object, 表:Object, 文件数:number}}
 */
function 分析(根) {
  var 根目录 = 根 || RUNTIME;
  var 文件们 = 列gd(根目录);
  var 表 = {};
  var 直接 = {};
  文件们.forEach(function (f) {
    var 源码;
    try { 源码 = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    切函数(源码).forEach(function (fn) {
      var 体 = 净化(fn.行.join('\n'));
      var e = 表[fn.名] || (表[fn.名] = { 直接: false, 调用: {} });
      if (/\bawait\b/.test(体)) { e.直接 = true; 直接[fn.名] = 1; }
      var 调 = 收集调用(体);
      Object.keys(调).forEach(function (n) { e.调用[n] = 1; });
    });
  });
  // 传染闭包
  var 协程 = {};
  Object.keys(直接).forEach(function (n) { 协程[n] = 1; });
  var 变 = true;
  while (变) {
    变 = false;
    Object.keys(表).forEach(function (n) {
      if (协程[n]) return;
      var 调 = 表[n].调用;
      for (var c in 调) {
        if (协程[c]) { 协程[n] = 1; 变 = true; break; }
      }
    });
  }
  return { 协程: 协程, 直接: 直接, 表: 表, 文件数: 文件们.length };
}

var _缓存 = null;
/** 进程内缓存（多次转换共用一次扫描） */
function 协程方法集合() {
  if (_缓存 === null) _缓存 = 分析();
  return _缓存.协程;
}

/** 清缓存（开发/测试用） */
function 清缓存() { _缓存 = null; }

module.exports = { 分析: 分析, 协程方法集合: 协程方法集合, 清缓存: 清缓存, 切函数: 切函数, RUNTIME: RUNTIME };
