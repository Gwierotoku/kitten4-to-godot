#!/usr/bin/env node
/*!
 * 单例化迁移 · 分析器
 *
 * 目标：把 runtime/模板/自带积木.gd（287 个方法、隐式成员访问）改造成
 *       "函数单例"那一层 —— 每个方法首参加 `角色: 角色变量`，方法体里所有
 *       "属于角色"的名字都显式写成 `角色.xxx`。
 *
 * 为什么先分析：模板里裸写的一大批名字（k4_x / 画布 / get_parent() / scale …）
 *   在单例化之后必须区分成三类 ——
 *     ① 角色的（要写 `角色.`）
 *     ② 单例自己的（保持裸写）
 *     ③ 全局的（内建函数 / autoload / 类型名，保持裸写）
 *   而 `get_parent()` / `name` / `get_tree()` 这类 Node 内建，在单例（extends Node）
 *   上**也存在**，写错了不会报错、只会静默用成单例自己的 —— 所以必须逐个人工分类，
 *   不能靠"编译器报错"来兜底。
 *
 * 用法：
 *   node _dev/迁移_单例化.js --分析           只打印需要人工分类的名字
 *   node _dev/迁移_单例化.js --分析 --明细     连"已分类"的也打印（复核用）
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var 模板路径 = path.join(ROOT, 'runtime', '模板', '自带积木.gd');
var 基类路径 = path.join(ROOT, 'runtime', '全局', '角色基类.gd');

/* ---------------- 净化：字符串 / 注释 → 等长占位（保长度、保换行） ---------------- */

function 净化(src) {
  var out = src.split('');
  var n = src.length;
  var i = 0;
  function 抹(a, b) {
    for (var k = a; k < b; k++) { if (out[k] !== '\n') out[k] = '\u0001'; }
  }
  while (i < n) {
    var c = src[i];
    if (c === '#') {
      var j = src.indexOf('\n', i);
      if (j < 0) j = n;
      抹(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      if (src.substr(i, 3) === '"""') {
        var e = src.indexOf('"""', i + 3);
        e = (e < 0) ? n : e + 3;
        抹(i, e);
        i = e;
        continue;
      }
      var k2 = i + 1;
      while (k2 < n) {
        if (src[k2] === '\\') { k2 += 2; continue; }
        if (src[k2] === c) { k2++; break; }
        if (src[k2] === '\n') break;
        k2++;
      }
      抹(i, Math.min(k2, n));
      i = k2;
      continue;
    }
    i++;
  }
  return out.join('');
}

/* ---------------- 词法小工具 ---------------- */

var 标识符 = /[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*/g;

function 取标识符们(净) {
  var 出 = [];
  var m;
  标识符.lastIndex = 0;
  while ((m = 标识符.exec(净)) !== null) {
    出.push({ 名: m[0], 起: m.index, 止: m.index + m[0].length });
  }
  return 出;
}

/** 前一个非空白字符 */
function 前非空白(s, i) {
  for (var k = i - 1; k >= 0; k--) if (!/\s/.test(s[k])) return s[k];
  return '';
}

/** 后一个非空白字符的位置（找不到返回 -1） */
function 后非空白位(s, i) {
  for (var k = i; k < s.length; k++) if (!/\s/.test(s[k])) return k;
  return -1;
}

/* ---------------- 符号表提取 ---------------- */

var 关键字 = {};
('if elif else for while match when return await and or not in is as var func class class_name ' +
 'pass break continue static const signal enum extends self super true false null void preload load ' +
 'assert yield setget').split(' ').forEach(function (k) { 关键字[k] = 1; });

/** 提取 {方法名: [{行, 缩进}]} 与 {成员名: {static:bool, 行}} */
function 提取符号(源) {
  var 净 = 净化(源);
  var 行们 = 净.split('\n');
  var 原行们 = 源.split('\n');
  var 方法 = {};
  var 成员 = {};
  var 当前方法 = null;
  for (var i = 0; i < 行们.length; i++) {
    var 行 = 行们[i];
    var fm = /^([\t ]*)(static[\t ]+)?func[\t ]+([^\s(]+)[\t ]*\(/.exec(行);
    if (fm) {
      当前方法 = { 名: fm[3], 缩进: fm[1].length, 起行: i, 止行: i };
      (方法[fm[3]] = 方法[fm[3]] || []).push(当前方法);
      continue;
    }
    // ★只认**顶层**声明（行首无缩进）★ —— 函数体里的 `var 画布 := ...` 是局部变量，
    //   误当成成员会把局部声明从模板里删掉（实测踩过）。
    var vm = /^()(static[\t ]+)?(var|const)[\t ]+([^\s:=]+)/.exec(行);
    if (vm) {
      成员[vm[4]] = { static: !!vm[2], kind: vm[3], 行: i + 1, 原文: 原行们[i].trim() };
      continue;
    }
    if (当前方法) {
      if (/^[\t ]*$/.test(行)) { 当前方法.止行 = i; continue; }
      var 缩 = /^[\t ]*/.exec(行)[0].length;
      if (缩 <= 当前方法.缩进) { 当前方法 = null; continue; }
      当前方法.止行 = i;
    }
  }
  return { 方法: 方法, 成员: 成员, 净: 净, 行们: 行们 };
}

/* ---------------- 各函数内的局部名 ---------------- */

function 局部名集合(净, 起行, 止行, 参数行) {
  var 集 = {};
  // 参数
  var pm = /\(([\s\S]*?)\)/.exec(参数行);
  if (pm) {
    pm[1].split(',').forEach(function (p) {
      var m = /([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)\s*(?::|=|$)/.exec(p.trim());
      if (m) 集[m[1]] = 1;
    });
  }
  for (var i = 起行; i <= 止行 && i < 净.length; i++) {
    var 行 = 净[i];
    var m1 = /\bvar\s+([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)/g;
    var m;
    while ((m = m1.exec(行)) !== null) 集[m[1]] = 1;
    var m2 = /\bfor\s+([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)\s+in\b/g;
    while ((m = m2.exec(行)) !== null) 集[m[1]] = 1;
    var m3 = /\bfunc\s*\(([^)]*)\)/g;   // lambda 参数
    while ((m = m3.exec(行)) !== null) {
      m[1].split(',').forEach(function (p) {
        var q = /([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)/.exec(p.trim());
        if (q) 集[q[1]] = 1;
      });
    }
  }
  return 集;
}

/* ---------------- 主流程 ---------------- */

var 模板源 = fs.readFileSync(模板路径, 'utf8');
var 基类源 = fs.readFileSync(基类路径, 'utf8');
var T = 提取符号(模板源);
var B = 提取符号(基类源);

var 模板方法 = {}; Object.keys(T.方法).forEach(function (k) { 模板方法[k] = 1; });
var 基类方法 = {}; Object.keys(B.方法).forEach(function (k) { 基类方法[k] = 1; });
var 角色成员 = {};   // 需要写 `角色.` 的成员
Object.keys(B.成员).forEach(function (k) { 角色成员[k] = 1; });   // 基类的 var / const 都通过实例访问
Object.keys(T.成员).forEach(function (k) {
  // ★模板自己的 const / static 留在单例上，不加前缀★（它们是"单例的"）
  if (!T.成员[k].static && T.成员[k].kind === 'var') 角色成员[k] = 1;
});

// 全局 / 内建（保持裸写）
var 全局函数 = {};
('str int float bool abs absf absi min max minf maxi fmod fposmod pow sqrt sin cos tan asin acos atan atan2 ' +
 'floor ceil round roundf roundi floorf ceilf sign signf clamp clampf clampi lerp lerpf deg_to_rad rad_to_deg ' +
 'randf randi randf_range randi_range range print prints printerr push_warning push_error is_instance_valid ' +
 'is_zero_approx is_equal_approx is_nan is_inf linear_to_db db_to_linear log exp snappedf wrapf wrapi posmod ' +
 'type_exists preload load len typeof weakref var_to_str str_to_var maxf').split(' ')
  .forEach(function (k) { if (k) 全局函数[k] = 1; });

var 内建类型 = {};
('Variant Vector2 Vector2i Vector3 Color Rect2 Transform2D Basis Quaternion Dictionary Array String StringName ' +
 'NodePath PackedByteArray PackedVector2Array PackedInt32Array PackedStringArray PackedFloat32Array Callable Signal ' +
 'Node Node2D CanvasItem Control Label LineEdit Button Panel PanelContainer VBoxContainer HBoxContainer MarginContainer ' +
 'Texture2D Image ImageTexture Sprite2D AnimatedSprite2D CharacterBody2D Area2D CollisionShape2D CollisionPolygon2D ' +
 'RigidBody2D StaticBody2D AudioStreamPlayer AudioStreamPlayer2D AudioStream AudioEffectCapture AudioServer ' +
 'DisplayServer RenderingServer Engine Input OS Time JSON FileAccess DirAccess ProjectSettings Expression RegEx Tween ' +
 'SceneTree Viewport SubViewport ThemeDB ResourceLoader Theme Font MainLoop Window Timer Camera2D CanvasLayer ' +
 'WeakRef TextServer InputEvent InputEventKey InputEventMouseButton InputEventMouseMotion InputEventScreenTouch ' +
 '角色基类 角色变量 角色自带积木 角色自定义积木 函数单例 按键表 ' +
 'HORIZONTAL_ALIGNMENT_LEFT HORIZONTAL_ALIGNMENT_CENTER HORIZONTAL_ALIGNMENT_RIGHT').split(' ')
  .forEach(function (k) { if (k) 内建类型[k] = 1; });

var autoload = { K4Canvas: 1, K4Global: 1, K4Bus: 1, K4Text: 1, K4Timer: 1, K4Voice: 1, K4Func: 1 };

/** 未知项记录：{ 名: {n, 样:[...]} } —— 带上下文样本，方便人工分类 */
function 记(表, 名, 行号, 原文) {
  var e = 表[名] || (表[名] = { n: 0, 样: [] });
  e.n++;
  if (e.样.length < 3) e.样.push('L' + 行号 + '  ' + String(原文).trim());
}

// 角色基类的成员/方法里，哪些是"继承自 Node 的性质"，也需要人工确认
var 未知调用 = {};
var 未知标识 = {};
var 已分类 = { 模板方法: 0, 基类方法: 0, 角色成员: 0, 局部: 0, 全局: 0, 类型: 0, autoload: 0 };

var 行们 = T.行们;
var 净 = T.净;
var 原文行们 = 模板源.split('\n');

Object.keys(T.方法).forEach(function (方法名) {
  T.方法[方法名].forEach(function (fn) {
    // 签名行（可能跨行，这里用第一行到 ':' 之间）
    var 签名 = '';
    for (var i = fn.起行; i <= fn.止行; i++) {
      签名 += 行们[i] + '\n';
      if (/:\s*$/.test(行们[i])) break;
    }
    var 局部 = 局部名集合(行们, fn.起行, fn.止行, 签名);
    // 逐行扫描标识符
    for (var i = fn.起行; i <= fn.止行; i++) {
      var 行 = 行们[i];
      var 项 = 取标识符们(行);
      项.forEach(function (t) {
        var 名 = t.名;
        // 数字字面量里的尾巴（1e15 → e15）不是标识符
        if (t.起 > 0 && /[0-9]/.test(行[t.起 - 1])) return;
        if (关键字[名]) return;
        if (名 === '角色') return;
        if (局部[名]) { 已分类.局部++; return; }
        var 后 = 后非空白位(行, t.止);
        var 是调用 = (后 >= 0 && 行[后] === '(') && 前非空白(行, t.起) !== '.';
        var 前缀点 = 前非空白(行, t.起) === '.';
        if (模板方法[名]) {
          if (!前缀点 && 是调用) 已分类.模板方法++;
          else if (!前缀点) 记(未知标识, 名, i + 1, 原文行们[i]);
          return;
        }
        if (基类方法[名]) {
          if (!前缀点 && 是调用) 已分类.基类方法++;
          else if (!前缀点) 记(未知标识, 名, i + 1, 原文行们[i]);
          return;
        }
        if (角色成员[名]) {
          已分类.角色成员++;
          return;
        }
        if (autoload[名]) { 已分类.autoload++; return; }
        if (内建类型[名]) { 已分类.类型++; return; }
        if (全局函数[名]) { 已分类.全局++; return; }
        if (前缀点) return;                      // 别的对象的成员，不动
        if (是调用) 记(未知调用, 名, i + 1, 原文行们[i]);
        else 记(未知标识, 名, i + 1, 原文行们[i]);
      });
    }
  });
});

function 排序打印(表, 标题, 附注) {
  var 键 = Object.keys(表).sort(function (a, b) { return 表[b].n - 表[a].n; });
  console.log('\n== ' + 标题 + '（' + 键.length + ' 个）==');
  if (附注) console.log('   ' + 附注);
  键.forEach(function (k) {
    console.log('   ' + k + '  ×' + 表[k].n);
    表[k].样.forEach(function (s) { console.log('        ' + s); });
  });
}

console.log('模板：' + 模板路径);
console.log('  行数 ' + 模板源.split('\n').length + '，方法 ' + Object.keys(T.方法).length +
  '，成员 ' + Object.keys(T.成员).length +
  '（其中 static ' + Object.keys(T.成员).filter(function (k) { return T.成员[k].static; }).length + '）');
console.log('基类：' + 基类路径);
console.log('  行数 ' + 基类源.split('\n').length + '，方法 ' + Object.keys(B.方法).length +
  '，成员 ' + Object.keys(B.成员).length);
console.log('\n已分类计数：' + JSON.stringify(已分类));

排序打印(未知调用, '未知【调用】(裸调用且不在模板/基类方法表里)',
  '需要判定：角色的 Node 内建方法（→ `角色.`）/ 全局函数（保持）/ 别的');
排序打印(未知标识, '未知【标识符】(裸用且不在成员/局部/类型表里)',
  '需要判定：角色状态或 Node 内建属性（→ `角色.`）/ 单例自己的 / 全局常量');

if (process.argv.indexOf('--明细') >= 0) {
  console.log('\n== 模板里 per-instance 成员（要搬到 角色基类）==');
  Object.keys(T.成员).forEach(function (k) {
    if (!T.成员[k].static && T.成员[k].kind === 'var') console.log('   ' + k + '   (行 ' + T.成员[k].行 + ')   ' + T.成员[k].原文);
  });
  console.log('\n== 模板里的 static / const 成员（留在单例上）==');
  Object.keys(T.成员).forEach(function (k) {
    if (T.成员[k].static || T.成员[k].kind === 'const') console.log('   ' + k + '   (行 ' + T.成员[k].行 + ')   ' + T.成员[k].原文);
  });
}

/* ================================================================== */
/* 生成模式                                                            */
/* ================================================================== */
// 角色的 Node/Node2D 内建（裸用时都指"角色"）—— 由 --分析 逐个人工确认过
var 角色内建方法 = ['get_parent', 'get_tree', 'create_tween', 'get_viewport_rect', 'is_in_group',
  'add_child', 'set', 'get_viewport', 'get_node_or_null', 'remove_from_group', 'add_to_group',
  'get_index', 'get_process_delta_time', 'get'];
var 角色内建属性 = ['scale', 'rotation', 'modulate', 'z_index', 'position', 'visible', 'name', 'owner'];
var 内建方法表 = {}; 角色内建方法.forEach(function (m) { 内建方法表[m] = 1; });
var 内建属性表 = {}; 角色内建属性.forEach(function (m) { 内建属性表[m] = 1; });

function 生成(输出路径) {
  var 统计 = {
    签名: 0, 成员前缀: 0, 基类方法前缀: 0, 内建方法前缀: 0, 内建属性前缀: 0,
    模板调用插参: 0, self替换: 0, super替换: 0, 方法引用绑定: 0, 跨行插参: 0
  };
  var 每行操作 = {};
  var 删除行 = {};
  var 搬迁 = [];

  function 记操作(行号, 位置, 文本, 类型, 长度) {
    if (行号 === undefined || 行号 < 0 || 位置 === undefined || 位置 < 0) return;
    (每行操作[行号] || (每行操作[行号] = [])).push({ 位置: 位置, 文本: 文本, 类型: 类型, 长度: 长度 || 0 });
  }
  function 是静态方法(名) {
    var 定义 = T.方法[名];
    return !!(定义 && /^[\t ]*static[\t ]+func/.test(原文行们[定义[0].起行] || ''));
  }

  // ---- 1. per-instance 成员声明：从模板删掉（搬去 角色基类）----
  Object.keys(T.成员).forEach(function (名) {
    var m = T.成员[名];
    if (m.static || m.kind !== 'var') return;
    删除行[m.行 - 1] = true;
    var 条 = { 名: 名, 行: m.行, 原文: m.原文, 注释: [] };
    var k = m.行 - 2;
    while (k >= 0 && /^[\t ]*#/.test(原文行们[k])) { 删除行[k] = true; 条.注释.unshift(原文行们[k]); k--; }
    搬迁.push(条);
  });

  // ---- 2. 逐函数 ----
  Object.keys(T.方法).forEach(function (方法名) {
    T.方法[方法名].forEach(function (fn) {
      var 是static = 是静态方法(方法名);
      var 签名 = '';
      for (var i = fn.起行; i <= fn.止行; i++) { 签名 += 行们[i] + '\n'; if (/:\s*$/.test(行们[i])) break; }
      var 局部 = 局部名集合(行们, fn.起行, fn.止行, 签名);

      // 2a. 签名加首参（static 不加）
      //     ★幂等★：源模板如果已经是单例版（`(角色: 角色变量` 开头），不要再插一次 ——
      //     重复插入会变成 `func 名(角色, 角色: 角色变量…)`，Godot 报"参数名重复"，
      //     而且会顺着 class_name 链让**整批脚本**编译失败（实测踩过）。
      if (!是static) {
        var 净行 = 行们[fn.起行];
        var 已单例 = /\([\t ]*角色: 角色变量/.test(净行);
        var p = 净行.indexOf('(', 净行.indexOf('func'));
        if (p >= 0 && !已单例) {
          var 后 = 后非空白位(净行, p + 1);
          var 空格内 = (后 >= 0 && 净行[后] === ')');
          var 文本 = 空格内 ? '角色: 角色变量' : '角色: 角色变量, ';
          if (后 < 0) {
            统计.跨行插参++;
            var 下行 = 行们[fn.起行 + 1] || '';
            var q2 = 后非空白位(下行, 0);
            记操作(fn.起行 + 1, q2 < 0 ? 0 : q2, 文本, '签名');
          } else 记操作(fn.起行, p + 1, 文本, '签名');
          统计.签名++;
        }
      }

      // 2b. 函数体（★跳过签名第一行★：`func 名(` 里的名字后面也跟 `(`，
      //     不跳过会被当"模板方法调用"再插一次参数 → `func 名(角色, 角色: 角色变量…)`）
      for (var i = fn.起行 + 1; i <= fn.止行; i++) {
        if (删除行[i]) continue;
        var 行 = 行们[i];
        取标识符们(行).forEach(function (t) {
          var 名 = t.名;
          if (t.起 > 0 && /[0-9]/.test(行[t.起 - 1])) return;          // 1e15 的尾巴
          if (名 === 'self' || 名 === 'super') {
            记操作(i, t.起, '角色', '替换', 名.length);   // ★替换=插入+删掉原名★
            if (名 === 'self') 统计.self替换++; else 统计.super替换++;
            return;
          }
          if (关键字[名]) return;
          if (内建类型[名] || 全局函数[名] || autoload[名]) return;
          if (T.成员[名] && (T.成员[名].static || T.成员[名].kind === 'const')) return;   // 单例自己的
          if (名 === '角色') return;

          var 后 = 后非空白位(行, t.止);
          var 是调用 = (后 >= 0 && 行[后] === '(');
          if (!是调用 && 后 < 0) {                                    // 可能是多行调用
            var 下行 = 行们[i + 1] || '';
            var q = 后非空白位(下行, 0);
            if (q >= 0 && 下行[q] === '(') 是调用 = true;
          }

          // ★"别的角色节点上的积木方法"★：`他.包围盒()` / `兄弟.包围盒()`
          //   这些方法的实现在单例上，所以必须改写成 `K4Func.包围盒(他)`。
          //   判定：名字是模板方法 + 是调用 + 前面是 `.` + 接收者是个**普通标识符**
          //   （不是 autoload / 类型名 / 局部变量 / super）。
          if (前非空白(行, t.起) === '.') {
            if (是调用 && 模板方法[名] && 名 !== '_apply_transform' && 后 >= 0) {
              var 点 = t.起 - 1;
              while (点 >= 0 && /[\t ]/.test(行[点])) 点--;
              var r = 点 - 1;
              while (r >= 0 && /[\t ]/.test(行[r])) r--;
              var e = r + 1;
              while (r >= 0 && /[A-Za-z0-9_\u4e00-\u9fff]/.test(行[r])) r--;
              var 接收者 = 行.slice(r + 1, e);
              // ⚠ 排除项只有三类：
              //   autoload（K4Canvas 等）、类型名、以及**画布局部变量** `画布`
              //   （`画布.文字图章(...)` 调的是屏幕绘制，不是角色的积木）。
              //   注意**不能**排除一般的局部变量 —— `他.包围盒()` 里的 `他`
              //   恰恰是个局部（从 实体节点们 / 找 拿到的角色节点），那正是要改的。
              if (接收者 && !autoload[接收者] && !内建类型[接收者] && 接收者 !== 'super' && 接收者 !== '画布') {
                var qq = 后非空白位(行, 后 + 1);
                var 空内 = (qq >= 0 && 行[qq] === ')');
                记操作(i, r + 1, 'K4Func.' + 名, '替换', (t.止 - (r + 1)));
                记操作(i, 后 + 1, 空内 ? 接收者 : 接收者 + ', ', '插参');
                统计.跨角色改写 = (统计.跨角色改写 || 0) + 1;
              }
            }
            return;
          }

          // ★"局部名遮蔽方法名"的例外★
          //   模板里有这种写法：`func 抖动(角色, _秒): var 总 := _秒(_秒)` ——
          //   形参叫 `_秒`，同时还有个方法 `_秒()`。GDScript 里局部名**不能**当函数
          //   调用，所以这种位置一定是"调方法"，必须按方法处理（插 角色 首参）；
          //   当成局部跳过的话会生成 `_秒(_秒)` → 报"参数个数不够"（实测踩过）。
          if (局部[名] && !(是调用 && (模板方法[名] || 基类方法[名] || 内建方法表[名]))) return;

          if (是调用) {
            if (模板方法[名]) {
              if (是静态方法(名)) return;                              // static 不加参
              var p = (后 >= 0 && 行[后] === '(') ? 后 : -1;
              if (p >= 0) {
                var q = 后非空白位(行, p + 1);
                if (q >= 0 && 行.substr(q, 2) === '角色') return;       // 幂等
                var 空格内 = (q >= 0 && 行[q] === ')');
                记操作(i, p + 1, 空格内 ? '角色' : '角色, ', '插参');
              } else {
                统计.跨行插参++;
                var 下行2 = 行们[i + 1] || '';
                var q3 = 后非空白位(下行2, 0);
                记操作(i + 1, q3 < 0 ? 0 : q3, '角色, ', '插参');
              }
              统计.模板调用插参++;
              return;
            }
            if (基类方法[名] || 内建方法表[名]) {
              if (基类方法[名]) 统计.基类方法前缀++; else 统计.内建方法前缀++;
              记操作(i, t.起, '角色.', '前缀');
              return;
            }
            return;
          }

          // 非调用位置
          if (模板方法[名]) {                                          // 当 Callable 用 → 绑定 角色
            if (是静态方法(名)) return;
            记操作(i, t.止, '.bind(角色)', '绑定');
            统计.方法引用绑定++;
            return;
          }
          if (角色成员[名]) { 记操作(i, t.起, '角色.', '前缀'); 统计.成员前缀++; return; }
          if (内建属性表[名]) { 记操作(i, t.起, '角色.', '前缀'); 统计.内建属性前缀++; return; }
        });
      }
    });
  });

  // ---- 3. 应用（扫描式重建：同一位置时"纯插入"优先于"替换"）----
  var 出 = [];
  for (var i = 0; i < 原文行们.length; i++) {
    if (删除行[i]) continue;
    var 行 = 原文行们[i];
    var 操作 = 每行操作[i];
    if (操作 && 操作.length) {
      操作.sort(function (a, b) {
        if (a.位置 !== b.位置) return a.位置 - b.位置;
        return a.长度 - b.长度;          // 长度 0 的插入排在前
      });
      var 新行 = '';
      var 上 = 0;
      for (var k = 0; k < 操作.length; k++) {
        var op = 操作[k];
        if (op.位置 < 上) continue;                        // 与前一个操作重叠 → 丢掉（保序）
        新行 += 行.slice(上, op.位置) + op.文本;
        上 = op.位置 + op.长度;
      }
      新行 += 行.slice(上);
      行 = 新行;
    }
    出.push(行);
  }
  var 结果 = 出.join('\n');

  // ---- 4. 单例化的固定修正（每次生成都要做，别手工改生成物）----
  // ① 基类从 角色变量 换成 Node：这一层已经不在角色实例的继承链上，
  //    而是"函数单例"（autoload K4Func）那一侧的基类。
  结果 = 结果.replace('class_name 角色自带积木\nextends 角色变量',
                      'class_name 角色自带积木\nextends Node');
  // ② Godot 的生命周期回调不能带参数 → `_input(角色, …)` 必须改名，
  //    由 角色基类._input() 转发进来。
  结果 = 结果.replace('func _input(角色: 角色变量, _event: InputEvent) -> void:',
                      'func 拖拽输入(角色: 角色变量, _event: InputEvent) -> void:');
  // ③ 文件头的继承链说明跟着改（否则注释和代码说的不是一回事）
  结果 = 结果.replace(
    '# 继承链（不要改）：\n' +
    '#     角色基类（runtime · 库）\n' +
    '#       └─ 角色变量（数据：局部变量 / 列表成员声明 · 每次覆盖）\n' +
    '#            └─ 角色自带积木（★本文件★ · 每次覆盖）\n' +
    '#                 └─ 角色自定义积木（K4 自定义积木的真实现 · 每次覆盖）\n' +
    '#                      └─ 角色类（★你手写实现 · 永不覆盖）\n' +
    '#                           └─ <角色名>.gd\n',
    '# ★继承链（单例化之后 · 不要改）★\n' +
    '#   一、函数单例那一侧（autoload `K4Func`，全局唯一）：\n' +
    '#     角色自带积木（★本文件★ · 每次覆盖）      ← K4 内建积木的实现\n' +
    '#       └─ 角色自定义积木（每次覆盖）           ← K4 自定义积木的真实现\n' +
    '#            └─ 函数单例（★用户文件 · 永不覆盖）← 你在这里覆写 / 补实现\n' +
    '#   二、角色实例那一侧（每个角色一份）：\n' +
    '#     角色基类（runtime 库：状态 + 引擎胶水）\n' +
    '#       └─ 角色变量（数据：局部变量 / 列表成员声明 · 每次覆盖）\n' +
    '#            └─ <角色名>.gd（每次覆盖）\n' +
    '#\n' +
    '#   ★本文件所有方法的第一参数都是 `角色: 角色变量`★ —— 方法体里访问角色状态\n' +
    '#   一律写成 `角色.k4_x` 这种形式。调用点一律写 `K4Func.名(角色, 实参…)`。\n');

  if (输出路径) {
    var d = path.dirname(输出路径);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(输出路径, 结果, 'utf8');
  }
  return { 统计: 统计, 搬迁: 搬迁, 结果: 结果 };
}

if (process.argv.indexOf('--生成') >= 0) {
  var 输出 = path.join(ROOT, '_dev', 'out', '自带积木_单例版.gd');
  var 结果 = 生成(输出);
  console.log('\n===== 生成结果 =====');
  console.log('输出：' + 输出);
  console.log('改动统计：' + JSON.stringify(结果.统计));
  console.log('\n== 要搬到 角色基类.gd 的成员（' + 结果.搬迁.length + ' 个）==');
  结果.搬迁.forEach(function (m) {
    m.注释.forEach(function (c) { console.log(c); });
    console.log(m.原文);
  });
}
