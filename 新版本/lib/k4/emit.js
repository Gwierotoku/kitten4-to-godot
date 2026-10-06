/*!
 * 新版本 - 生成器
 *
 * 架构（见《全意义转换-设计规范》）：
 *   积木 = 角色类方法（中文名）   控制流 = 生成代码   事件 = 帽子节点
 *
 * 生成物：
 *   project.godot
 *   全局/角色自带积木.gd    自带积木的方法签名 + 桩（每次覆盖）
 *   全局/角色自定义积木.gd  K4 自定义积木的真实现（每次覆盖）
 *   全局/全局变量.gd        按工程声明真实成员（每次覆盖）
 *   全局/积木映射.json       调试反查表
 *   屏幕X/屏幕X.tscn/.gd
 *   屏幕X/屏幕绘制.gd
 *   屏幕X/角色custom/<角色>/<custom>.png
 *   屏幕X/<角色>/<角色>.tscn/.gd
 *   屏幕X/<角色>/<帽子名>_N.gd  (+ .tscn 仅点击帽子)
 *
 * 运行时库（角色基类 / 帽子基类 / 帽子_* / 广播总线 / 画布调度 / 屏幕绘制 /
 * 角色类模板）由 runtime/ 目录提供，convert.js 负责拷贝，本文件不生成。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var MT = require('./methodtable.js');
var ASYNC = require('./async.js');

/* ★协程方法集合★（lib/k4/async.js 扫 runtime/*.gd 得出：函数体含 await，或调用了含 await 的函数）
   生成代码只对**集合里**的方法写 await —— 这是"不无脑 await"的唯一依据。
   GDScript 判定协程性看的就是**实现里有没有 await**，所以以实现在准。 */
var _协程缓存 = null;
function 取协程方法集合() {
  if (_协程缓存 === null) _协程缓存 = ASYNC.协程方法集合();
  return _协程缓存;
}

/* 「角色自带积木」那一层的模板文件。
   有它的时候生成器不写桩，而是**以模板为底**、只把模板里缺的方法补成桩 ——
   这样用户开箱就有全部自带积木的可用实现，而映射表新增积木时也不会漏
   （新方法最差是个 pass，符合"转换器永不失败"）。 */
var 自带积木模板路径 = path.join(__dirname, '..', '..', 'runtime', '模板', '自带积木.gd');

function 读自带积木模板() {
  try {
    return fs.readFileSync(自带积木模板路径, 'utf8');
  } catch (e) {
    return null;
  }
}

/* ================================================================== */
/* 1. 事件 -> 帽子                                                   */
/* ================================================================== */

// core.js 的 HAT_TYPES 用的 kind -> methodtable 的 HATS 键
var HAT_KEY = {
  flag: 'hat:flag',
  key: 'hat:key',
  message: 'hat:message',
  clicked: 'hat:clicked',
  clone_start: 'hat:clone_start',
  backdrop: 'hat:backdrop',
  condition_hat: 'hat:condition',
  loudness: 'hat:loudness',
  timer: 'hat:timer',
  // 「当在手机中向 上/下/左/右 滑动」（K4 的 on_swipe）
  swipe: 'hat:swipe',
  // 「当切换到当前屏幕时」（K4 的 on_running_group_activated）
  screen: 'hat:screen'
};

var HAT_LABEL = {
  flag: '当开始被点击时',
  key: '当按下',
  message: '当接收到广播',
  clicked: '当角色被点击时',
  clone_start: '当克隆体启动时',
  backdrop: '当背景切换为',
  condition_hat: '当满足条件',
  loudness: '当响度大于',
  timer: '当计时器大于',
  swipe: '当在手机中向',
  screen: '当切换到当前屏幕'
};

/* ================================================================== */
/* 2. 语句 / 取值 -> 方法实参顺序                                     */
/*                                                                     */
/* methodtable 用中文参数名声明签名；这里声明「从 IR 节点取哪些字段、   */
/* 按什么顺序当实参」。两侧顺序必须一致（生成器会校验实参个数）。       */
/* `null` 表示该位是 ctx（由生成器自动插入）。                         */
/* ================================================================== */

var ARG = {
  /* —— 控制/特殊：由代码展开，不走方法 —— */
  forever: null, repeat: null, repeat_until: null, if: null, break: null,
  warp: null, return: null, def: null, param: null, nop: null,
  broadcast_body: null, broadcast_body_wait: null,

  /* —— 语句方法 —— */
  wait: ['seconds'],
  wait_until: ['cond'],
  show: [],
  hide: [],
  bounce: [],
  next_costume: [],
  set_costume: ['value'],
  move_steps: ['steps'],
  set_coord: ['axis', 'value'],
  change_coord: ['axis', 'delta', 'sign'],
  // K4 的「分裂 <角色> 到 x:<x> y:<y>」—— IR 上的字段是 target/x/y（不是 args），
  // 不登记这张表的话调用点会生成 `角色.分裂()`（0 个实参），落点全丢。
  split: ['target', 'x', 'y'],
  // 「停止 <某个声音>」——IR 上的字段是 sound（名字或编号表达式）
  stop_sound_named: ['sound'],
  goto_xy: ['x', 'y'],
  set_rotation: ['value'],
  change_rotation: ['delta'],
  point_towards: ['target'],
  goto_target: ['target'],
  face_to: ['target'],
  clone_target: ['target'],
  set_scale: ['value'],
  change_scale: ['value'],
  flip: ['axis'],
  glide_to: ['seconds', 'x', 'y'],
  layer: ['dir'],
  layer_move: ['value'],
  layer_with_pen: ['position'],
  set_visible: ['value'],
  set_opacity: ['value'],
  change_opacity: ['value'],
  set_effect: ['scope', 'value'],
  change_effect: ['scope', 'sign', 'value'],
  say: ['text'],
  say_for: ['text', 'seconds'],
  think: ['text'],
  think_for: ['text', 'seconds'],
  play_sound: ['sound'],
  stop_sound: [],
  set_volume: ['value'],
  change_volume: ['value'],
  // 「把 <音量/播放速率> 设为 X」：轴/项在 fields.audio_key，值在音频输入里
  set_volume_or_rate: ['item', 'value'],
  change_volume_or_rate: ['item', 'value'],
  pen_clear: [],
  pen_down: [],
  pen_up: [],
  pen_stamp: [],
  text_stamp: ['text', 'size', 'align'],
  pen_color: ['value'],
  pen_size: ['value'],
  pen_change_size: ['value'],
  pen_change_color: ['value'],
  pen_change_shade: ['value'],
  pen_color_property: ['prop', 'value'],
  pen_change_property: ['prop', 'sign', 'value'],
  fill_style: ['value'],
  fill_path: ['point'],
  set_var: ['name', 'value'],
  change_var: ['name', 'value'],
  list_add: ['name', 'value'],
  list_delete: ['name', 'index'],
  list_delete_special: ['name', 'where', 'index'],
  list_clear: ['name'],
  list_insert: ['name', 'index', 'value'],
  list_replace: ['name', 'where', 'index', 'value'],
  list_show: ['name'],
  list_hide: ['name'],
  list_copy: ['name', 'value'],
  broadcast: ['message'],
  broadcast_wait: ['message'],
  destroy_self: [],
  clone_self: [],
  restart: [],
  stop: ['option'],
  timer_reset: [],
  cloud_set: ['name', 'value'],
  cloud_change: ['name', 'value'],
  cloud_list_append: ['name', 'value'],
  fade_in: ['seconds'],
  fade_out: ['seconds'],
  // ask_choose 走专门分支（要传问题 + 选项数组 + 可能的子栈），见 stmtLines
  ask_choose: null,

  /* —— 取值方法（reporter）—— */
  ref: ['name'],
  add: ['op', 'args'],
  sub: ['op', 'args'],
  mul: ['op', 'args'],
  div: ['op', 'args'],
  pow: ['op', 'args'],
  mod: ['args'],
  neg: ['args'],
  and: ['op', 'args'],
  or: ['op', 'args'],
  not: ['args'],
  math_root_n: ['args'],
  math_root: ['args'],
  round_mode: ['args'],
  is_divisibleby: ['args'],
  random_int: ['args'],
  random_float: ['args'],
  join: ['args'],
  append: ['args'],
  str_len: ['args'],
  str_empty: ['args'],
  str_index: ['args'],
  str_last_index: ['args'],
  str_char_at: ['@0', '@1'],
  str_substring: ['@0', '@1', '@3'],
  str_case: ['@1', '@0'],
  str_trim: ['args'],
  str_contains: ['args'],
  str_split: ['@0', '@1'],
  to_string: ['args'],
  to_number: ['args'],
  list_len: ['args'],
  list_empty: ['args'],
  list_index: ['args'],
  list_last_index: ['args'],
  list_item: ['@0', '@1'],
  list_item_special: ['@0', '@1', '@2'],
  list_contains: ['args'],
  list_index_of: ['args'],
  cloud_get: ['args'],
  cloud_list_get: ['args'],
  timer: [],
  mouse_x: [],
  mouse_y: [],
  mouse_down: [],
  mouse_up: [],
  mouse_info: ['args'],
  key_pressed: ['args'],
  touching: ['args'],
  // 「<a> 碰到 <b>」——★这条以前是空数组 `[]`，等于告诉 opCall "这个方法没有实参"★，
  //   于是 core.js 辛苦解析出来的 sprite1 / sprite2 **两个目标全被丢掉**，
  //   生成的是无参的 `碰到角色()`（而且不会报"实参丢失"，因为 given 一开始就是空的）。
  //   用户图 3 的「碰到 侦测组 / 运算组 / 侦测 / 运算」四个目标一个都没传下去。
  touching_entities: ['args'],
  distance_to: ['args'],
  answer: [],
  loudness: [],
  of_property: ['args'],
  entity_property: ['args'],
  self_name: [],
  self_visible: [],
  self_costume: [],
  self_size: [],
  self_rotation: [],
  self_scale: [],
  screen_coord: ['args'],
  screen_rotation: ['args'],
  screen_scale: ['args'],
  midi_note: [],
  ask: ['args']
};

// 算术/逻辑运算：op 名 -> 中文运算符 token
var OP_TOKEN = {
  add: 'add', sub: 'sub', mul: 'mul', div: 'div', pow: 'pow',
  and: 'and', or: 'or',
  eq: 'eq', neq: 'neq', lt: 'lt', lte: 'lte', gt: 'gt', gte: 'gte'
};

/* ================================================================== */
/* 3. 命名                                                           */
/* ================================================================== */

var IDENT_OK = /[A-Za-z0-9_\u0080-\uFFFF]/;

// 角色基类已经实现的方法名。自定义积木 / 变量撞上它们会直接报
// `Too few arguments for "初始化()" call` 或成员遮蔽，所以必须当保留字处理。
var BASE_METHODS = {
  初始化: 1, 新建上下文: 1, 进入warp: 1, 退出warp: 1, 一步: 1,
  找: 1, 转整数: 1, 取值: 1, 列表: 1, 比较: 1, 算术运算: 1, 为真: 1,
  复制列表: 1,
  // 类型转换 / 取余放在**库层**而不是桩层：
  // 它们是生成代码的基础设施（`角色.转数字(x)` 会出现在每一个算术表达式里），
  // 如果留在 角色自带积木.gd 当桩（`return ""` / `return 0.0`），
  // 任何没实现它们的工程都会**静默算错**，而不是"少个功能"。
  转文本: 1, 转数字: 1, 取余: 1,
  等于: 1, 不等于: 1, 小于: 1, 小于等于: 1, 大于: 1, 大于等于: 1,
  克隆自己: 1, 删除自己: 1, 设置画布: 1, 标为克隆: 1, 自己的名字: 1,
  计时器: 1, 重置计时器: 1, 开始计时器: 1, 停止计时器: 1,
  // K4 的「当前 年/月/日」——模板里已有真实现，签名是**无参**，
  //   不登记的话生成器会按"类型层桩"给它补 ctx，调用点就会实参对不上。
  当前年: 1, 当前月: 1, 当前日: 1,
  // 按键的"按下 / 松开"两档 + 音量/速率
  按键按下: 1, 按键松开: 1, 设置音量或速率: 1, 增加音量或速率: 1,
  克隆体编号: 1, 克隆体数量: 1, 画布落笔: 1,
  // 「发送广播」——实现在 角色基类.gd（基础设施层，生成代码写 `角色.广播(名)`）
  广播: 1
};

// GDScript 关键字 + 内建函数名：自定义积木名撞上它们会让生成物直接语法错误
var GD_KEYWORDS = {
  'if': 1, 'elif': 1, 'else': 1, 'for': 1, 'while': 1, 'match': 1, 'break': 1,
  'continue': 1, 'pass': 1, 'return': 1, 'func': 1, 'class': 1, 'class_name': 1,
  'extends': 1, 'is': 1, 'in': 1, 'as': 1, 'and': 1, 'or': 1, 'not': 1, 'null': 1,
  'true': 1, 'false': 1, 'self': 1, 'super': 1, 'var': 1, 'const': 1, 'enum': 1,
  'signal': 1, 'static': 1, 'await': 1, 'yield': 1, 'void': 1, 'preload': 1, 'load': 1,
  'assert': 1, 'typeof': 1, 'PI': 1, 'TAU': 1, 'INF': 1, 'NAN': 1,
  'sign': 1, 'abs': 1, 'min': 1, 'max': 1, 'len': 1, 'str': 1, 'int': 1, 'float': 1,
  'bool': 1, 'pow': 1, 'round': 1, 'floor': 1, 'ceil': 1, 'clamp': 1, 'lerp': 1,
  'randi': 1, 'randf': 1, 'sin': 1, 'cos': 1, 'tan': 1, 'sqrt': 1, 'print': 1,
  'range': 1, 'String': 1, 'Array': 1, 'Dictionary': 1, 'Vector2': 1, 'Vector3': 1,
  'Color': 1, 'Node': 1, 'Node2D': 1, 'Object': 1, 'Callable': 1, 'Variant': 1,
  'weakref': 1, 'is_instance_valid': 1, 'instance_from_id': 1
};

function sanitize(raw, fallback) {
  var s = String(raw === undefined || raw === null ? '' : raw);
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (IDENT_OK.test(ch)) out += ch;
    else out += '_';
  }
  out = out.replace(/^_+/, '') || String(fallback || 'x');
  if (/^[0-9]/.test(out)) out = 'n' + out;
  return out;
}

/** 自定义积木名 -> 合法且安全的 GDScript 函数名 */
// 会真正让出帧的语句：循环 + 方法表里标了 await 的积木。
// （tell / call / call_remote 不在此列，它们由下面的递归判断决定）
var AWAIT_KINDS = { forever: 1, repeat: 1, repeat_until: 1 };
Object.keys(MT.IR_METHODS).forEach(function (k) {
  if (MT.IR_METHODS[k].await) AWAIT_KINDS[k] = 1;
});

/**
 * 深扫一段积木体，判断它编译出来会不会是协程（含 await）。
 * 只要出现「循环 / 等待类积木 / 调用了协程过程」就返回 true。
 * 必须深扫表达式：`elif 角色.可获得buff(...)` 这种条件里的过程调用也会让整个函数变成协程。
 */
function bodyNeedsAwait(list, procDefs, cache, visiting) {
  var found = false;
  function checkProc(name) {
    var nm = procIdent(name || '');
    if (!nm || visiting[nm]) return;
    var d = procDefs[nm];
    if (!d) return;
    visiting[nm] = 1;
    if (cache[nm] === undefined) cache[nm] = bodyNeedsAwait(d.body, procDefs, cache, visiting);
    delete visiting[nm];
    if (cache[nm]) found = true;
  }
  function scan(n) {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (var i = 0; i < n.length && !found; i++) scan(n[i]); return; }
    var k = n.k;
    if (k && AWAIT_KINDS[k]) { found = true; return; }
    if (k === 'op' && (n.op === 'call_proc' || n.op === 'call_remote')) {
      var a0 = (n.args || [])[0];
      checkProc(a0 && a0.v !== undefined ? String(a0.v) : '');
      if (found) return;
    }
    if (k === 'call' || k === 'call_remote' || k === 'tell' || k === 'tell_sync') {
      checkProc(n.name || n.proc || '');
      if (found) return;
    }
    for (var key in n) {
      if (key === 'k') continue;
      var v = n[key];
      if (v && typeof v === 'object') { scan(v); if (found) return; }
    }
  }
  scan(list);
  return found;
}

/** 粗略推断一个表达式节点的静态类型：'n' 数字 / 's' 字符串 / 'b' 布尔 / '?' 动态 */
function staticKind(node) {
  if (!node || typeof node !== 'object') return '?';
  if (typeof node === 'number') return 'n';
  if (typeof node === 'boolean') return 'b';
  if (typeof node === 'string') return 's';
  if (node.k === 'lit') {
    if (node.str) return 's';
    if (node.num) return 'n';
    if (node.bool) return 'b';
    return '?';
  }
  if (node.k === 'emptybool') return '?';
  if (node.k === 'op') {
    var o = node.op;
    if (/^cmp_/.test(o) || /^is_/.test(o)) return 'b';
    if (o === 'and' || o === 'or' || o === 'not' || o === 'list_empty' ||
        o === 'list_contains' || o === 'list_has' || o === 'key_pressed' || o === 'touching' ||
        o === 'mouse_down' || o === 'mouse_up' || o === 'self_visible' ||
        o === 'str_empty' || o === 'str_contains' || o === 'is_divisibleby') return 'b';
    if (o === 'join' || o === 'to_string' || o === 'str_char_at' ||
        o === 'str_substring' || o === 'str_trim' || o === 'str_case' ||
        o === 'self_name' || o === 'self_costume' || o === 'answer') return 's';
    // 数值型：列全一点 → 比较/算术能内联成原生运算符，代码才好看。
    // （漏掉的会被当成"动态值"，于是退回 角色.等于()/角色.转数字()，正确但啰嗦。）
    if (/^math_/.test(o)) return 'n';
    if (['add','sub','mul','div','pow','mod','neg','math_abs','math_sqrt','math_sin',
         'math_cos','math_tan','math_atan','list_len','list_index','list_index_of',
         'list_last_index','to_number','distance_to','round_mode','random_int',
         'random_float','math_root','math_root_n','str_index','str_last_index',
         'self_rotation','self_scale','self_size','coord_x','coord_y','timer',
         'mouse_x','mouse_y','loudness','str_len','clone_index','clone_count'].indexOf(o) >= 0) return 'n';
    return '?';
  }
  return '?';
}

var UUID_LIKE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 求「屏幕」实参。K4 把目标屏幕放在 get_current_scene 影子的 scene 字段里。
 * 优先用那个名字；同一条路径也用于 check_screen。
 */
function screenArg(em, argNode, fieldName, ctx) {
  // 1) 影子/块里有 scene 字段 -> 直接用（resolveIRNames 已把 uuid 换回屏幕名）
  var multi = [argNode];
  if (argNode && argNode.inputs) Object.keys(argNode.inputs).forEach(function (k) { multi.push(argNode.inputs[k]); });
  for (var i = 0; i < multi.length; i++) {
    var nd = multi[i];
    if (!nd || typeof nd !== 'object') continue;
    var f = nd.fields || {};
    var cand = f.scene !== undefined ? f.scene : (f.SCENE !== undefined ? f.SCENE : (f.screen !== undefined ? f.screen : undefined));
    if (typeof cand === 'string' && cand !== '' && !UUID_LIKE.test(cand)) return gdStr(cand);
  }
  // 2) 显式字段
  if (fieldName && !UUID_LIKE.test(fieldName)) return gdStr(fieldName);
  // 3) get_current_scene -> 当前屏幕
  if (argNode && argNode.type === 'get_current_scene') return 'K4Global.当前屏幕';
  if (argNode) return em.expr(argNode, ctx);
  return '""';
}

function procIdent(raw) {
  var n = sanitize(raw, '过程');
  if (GD_KEYWORDS[n] === 1 || BASE_METHODS[n] === 1) n = '积木_' + n;
  return n;
}

/* ------------------------------------------------------------------ *
 * ★命名隔离前缀★（K4 变量 与 参数/局部名 撞名的根治）
 *
 * 为什么必须隔离：这一层生成的所有标识符都落在**同一个类**里
 * （K4 变量/列表成员声明在 角色变量.gd，方法参数在 角色自带积木.gd），
 * 而 K4 允许角色变量叫 `名`、方法参数也叫 `名` —— 撞上就是
 *   "There is already a variable named 名 in this scope"
 * 或者更阴的「参数把成员遮蔽掉」，静默算错。
 *
 * 为什么用 `_` 开头：**K4 的标识符不允许以 `_` 开头，Godot 允许**。
 * 所以只要生成名一律带 `_` 前缀，就与 K4 侧的一切名字天然隔离，
 * 而且隔离是「构造性」的 —— 不依赖把 200+ 个方法名/参数名提前登记成保留字。
 *
 * 分工：
 *   变量 -> _v_  列表 -> _l_      （K4 数据成员，调试器里能看出是数据）
 *   参数 -> _p_  局部 -> _t_      （方法形参 / 生成器临时量）
 *   积木参数 -> _p_               （K4 自定义积木的形参）
 *   ctx 例外：它不是 K4 名字，而是运行时约定的上下文参数，两边都写 ctx。
 * ------------------------------------------------------------------ */
var NS_PREFIXES = {
  '变量': '_v_',
  '列表': '_l_',
  '参数': '_p_',
  '局部': '_t_',
  '积木参数': '_p_',
  '全局变量': '_v_',
  '全局列表': '_l_',
  '局部变量': '_v_',
  '局部列表': '_l_',
  '全局': '_v_'
};

function NameSpace(names, extraReserved) {
  this.names = names;
  this.reserved = {};
  var R = MT.RESERVED || [];
  for (var i = 0; i < R.length; i++) this.reserved[R[i]] = true;
  var mn = MT.methodNames ? MT.methodNames() : {};
  for (var k in mn) this.reserved[k] = true;
  (extraReserved || []).forEach(function (n) { this.reserved[n] = true; }, this);
  this.used = {};      // kind -> { 原名: 生成名 }
  this.byKey = {};     // kind + '\u0000' + 原名 -> 生成名
}

NameSpace.prototype.assign = function (kind, rawName, prefix) {
  var key = kind + '\u0000' + String(rawName);
  if (this.byKey[key] !== undefined) return this.byKey[key];
  var base = sanitize(rawName, kind);
  // ★命名隔离★：所有生成名一律加 `_` 前缀（K4 不允许 `_` 开头，Godot 允许）。
  //   前缀由 kind 决定，见 NS_PREFIXES —— 于是"K4 变量"与"参数/局部名"
  //   在词法上就落在两个永不重叠的命名空间里，**不可能**撞名。
  //   prefix 参数保留只为兼容调用点，实际前缀一律查表得到。
  var out = (NS_PREFIXES[kind] || '_k4_') + base;
  // 去重
  var n = out, i = 2;
  while (this._taken(out)) { out = n + '_' + i; i++; }
  this._takenMap = this._takenMap || {};
  this._takenMap[out] = true;
  this.byKey[key] = out;
  this.used[kind] = this.used[kind] || {};
  this.used[kind][String(rawName)] = out;
  if (out !== base) {
    this.renames = this.renames || [];
    this.renames.push({ kind: kind, 原名: String(rawName), 生成名: out });
  }
  return out;
};

NameSpace.prototype._taken = function (n) {
  this._takenMap = this._takenMap || {};
  return this._takenMap[n] === true;
};

/* ================================================================== */
/* 4. GDScript 字面量                                                */
/* ================================================================== */

/* ---- 超长文本外置的门槛 ---- */
/* K4 的文本可以是**整块数据**（谱面、存档串…），实际见过 800 万字符一个字面量。
   内联进 .gd 的话，编辑器打开那个文件就卡死：语法高亮、折叠、解析全要过一遍
   这一行。所以超过这个长度的字符串单独落成 txt，代码里用 K4Text.读取() 取。 */
var TEXT_FILE_LIMIT = 1024;
var TEXT_READER = 'K4Text';       // autoload 名（必须 ASCII）

function gdStr(s) {
  return '"' + String(s === undefined || s === null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

function gdNum(n) {
  var v = Number(n);
  if (!isFinite(v)) return '0.0';
  if (Number.isInteger(v)) return String(v) + '.0';
  return String(v);
}

// 参数类型缩写 -> GDScript 类型
var GTYPE = { f: 'float', s: 'String', b: 'bool', a: 'Array', v: 'Variant', c: 'Callable', ctx: '角色基类.WarpCtx' };
// 返回类型
var GRET = { void: 'void', f: 'float', s: 'String', b: 'bool', a: 'Array', v: 'Variant' };
// 默认返回值
// v(Variant) 用 0.0 而不是 null：K4 里『没有值』就是 0/空，
// 而 null 参与算术会报 Invalid operands 'float' and 'Nil'。
var GDEF = { f: '0.0', s: '""', b: 'false', a: '[]', v: '0.0', void: '' };

/* ================================================================== */
/* 5. 生成器                                                         */
/* ================================================================== */

function Emitter(ir, opts) {
  this.ir = ir;
  this.project = ir.project;
  this.names = this.project.names;
  this.files = {};
  this.report = {
    stubs: {},          // 类型层桩：块类型 -> {方法名, 次数}
    unknown: {},        // 完全没有落点的 k/op
    renames: [],
    argMismatch: [],
    argLoss: [],        // 实参被**截断**（真丢了）—— 方法表参数个数写少了，必须修
    实参类型转换: [],   // 按声明的类型给实参包了 str()/转数字()/为真()（见 call()）
    spare: 0,           // 备份成 预备块.gd 的悬空文本段数
    外置文本: 0         // 落到 文本/*.txt 的超长字符串个数
  };
  // 超长文本外置：目录 -> { 序号, 索引:内容->路径, 列表:[{rel,text}] }
  this.textPool = {};
  this.curDir = '全局';   // 当前正在生成哪个目录下的脚本（决定外置文本落到哪）
  this.extraReserved = [];
  // 自定义积木名会变成方法名 —— 它们与局部变量撞名时，
  // Godot 报 "The member X already exists in parent class"。
  // 所以必须在建 NameSpace 之前把它们塞进保留字。
  var extra = this.extraReserved;
  // 生成代码里会直接引用这些标识符，变量/列表/枚举名绝不能撞（否则遮蔽后行为错乱）
  ['角色', 'K4Global', 'K4Bus', 'K4Canvas', 'self', 'ctx'].forEach(function (n) { extra.push(n); });
  Object.keys(BASE_METHODS).forEach(function (n) { extra.push(n); });
  var procNames = collectProcDefs(ir);
  Object.keys(procNames).forEach(function (n) { extra.push(n); });
  if (ir.procRegistry) {
    Object.keys(ir.procRegistry).forEach(function (n) { extra.push(procIdent(n)); });
  }
  this.ns = new NameSpace(this.names, this.extraReserved);
  this.tmpSeq = 0;
  this.loopSeq = 0;
  this.procDefs = collectProcDefs(ir);
  this.usedProcs = {};
  this.awaitCache = {};      // procName -> 是否是协程
  this.协程 = 取协程方法集合();   // ★方法名 -> true 表示"实现里含 await"★
  this._proc协程 = {};            // 自定义积木名 -> 是否协程（惰性递归判定）
  this.stubRenames = renamedStubNames();
  this.sig = buildSignatures(this.report);
  this.report.桩改名 = this.stubRenames;
  // 扫一遍 runtime 模板，把函数分成两类：
  //   _模板已实现：函数体里有**真代码** → emit 不再报成桩
  //   _模板真桩：  函数体里只有 `_桩提醒(...)` / `pass` → 仍然要报成桩
  //   （stmtLines 生成类型层桩调用时用这个区分。只看"函数名存在"是不够的 ——
  //     模板里有不少函数壳子本身就是桩，例如 显示隐藏计时器。）
  this._模板已实现 = {};
  this._模板真桩 = {};
  this._模板函数名 = {};
  var 模板源 = 读自带积木模板();
  var self = this;
  if (模板源) {
    // 按行切：每个 `func 名(...)` 到下一个顶层 `func` 之间就是它的函数体。
    // 函数体里去掉 `_桩提醒(...)` 调用、注释行、以及空的 pass / return 默认值之后
    // 还有代码，才算"真实现"；否则就是**壳子桩**（例如 显示隐藏计时器）。
    var 行们 = 模板源.split('\n');
    var 当前 = null;
    var 收集 = [];
    var 头行 = /^func[ \t]+([^ \t(]+)[ \t]*\(/;
    for (var li = 0; li < 行们.length; li++) {
      var hm = 头行.exec(行们[li]);
      if (hm) {
        当前 = { 名: hm[1], 行: [] };
        收集.push(当前);
        self._模板函数名[hm[1]] = 1;      // API 参数名要避开这些名字，见下
      } else if (当前) {
        当前.行.push(行们[li]);
      }
    }
    收集.forEach(function (f) {
      var 实质 = f.行.join('\n')
        .replace(/_桩提醒\([^\n]*/g, '')
        .replace(/^[ \t]*#[^\n]*$/gm, '')
        .replace(/^[ \t]*(pass|return[ \t]+(null|0\.0|""|\[\]))[ \t]*$/gm, '')
        .replace(/\s+/g, '');
      if (实质.length > 0) self._模板已实现[f.名] = 1;
      else self._模板真桩[f.名] = 1;
    });
  }
  // ★参数名避开函数名★（GDScript 的 SHADOWED_VARIABLE）
  //   模板里有一堆**既是函数名、又当参数名**的词，例如：
  //     func _秒(_v) -> float            ← 函数 _秒
  //     func 等待_秒(ctx, _秒: Variant)   ← 参数 _秒  → 遮蔽上面那个函数
  //   Godot 报：The local function parameter "_秒" is shadowing an already-declared
  //   function at line 197 in the current class. 一次转换几百条，把日志刷满、
  //   也把真正的错误埋掉。
  //   这里统一给撞名的 API 参数加 `_p_` 前缀 —— 与"K4 变量用 _v_ 隔离"是同一套思路：
  //   让**类成员名字**和**参数名**在词法上不可能重叠。
  //   调用点按位置传参，不受影响。
  if (this.sig) {
    var 改过 = [];
    Object.keys(this.sig).forEach(function (mn) {
      var sg = self.sig[mn];
      (sg.params || []).forEach(function (p) {
        if (!p || p[1] === 'ctx') return;
        if (self._模板函数名[p[0]]) {
          改过.push(mn + ' 的 ' + p[0] + ' -> _p_' + p[0]);
          p[0] = '_p_' + p[0];
        }
      });
    });
    if (改过.length) this.report.参数避让 = 改过;
  }
  // ★交叉校验：方法表声明的 await 与 runtime 实现是否一致★
  //   判定以**实现**为准（GDScript 就是这么判的）；不一致时记进报告，
  //   让作者知道该改哪一边 —— 而不是默默按某一边生成。
  var 不一致 = [];
  ['IR_METHODS', 'OP_METHODS', 'FAMILY_METHODS', 'TYPE_METHODS'].forEach(function (t) {
    Object.keys(MT[t] || {}).forEach(function (kk) {
      var m = MT[t][kk];
      if (!m || !m.name || m.inline) return;
      if (!self._模板函数名[m.name]) return;         // 模板里没有的方法不校验（桩/基类方法）
      var 声明 = !!m.await;
      var 实现 = !!self.协程[m.name];
      if (声明 !== 实现) {
        不一致.push(m.name + '（声明 ' + (声明 ? 'await' : '同步') + '，实现 ' + (实现 ? 'await' : '同步') + '）[' + t + ':' + kk + ']');
      }
    });
  });
  if (不一致.length) this.report.await声明不一致 = 不一致;
}

/* ------------------------------------------------------------------ *
 * 自定义积木（K4 的函数）是不是协程
 *
 * 生成的自定义积木体里只要出现会让出的语句（循环 / 等待类积木 / 广播并等待 /
 * 调用另一个协程积木），它自己就变成协程 —— 调用点必须 await。
 * 递归判定 + 缓存；遇到环（互相调用）保守当作协程。
 * ------------------------------------------------------------------ */
Emitter.prototype.过程是协程 = function (rawName, 拜访) {
  var name = procIdent(rawName || '');
  if (!name) return true;
  if (this._proc协程[name] !== undefined) return this._proc协程[name];
  拜访 = 拜访 || {};
  if (拜访[name]) return true;              // 环：保守
  拜访[name] = 1;
  var def = this.procDefs[name];
  var 是 = def ? this.语句列表会让出(def.body, 拜访) : true;   // 找不到定义 → 保守
  this._proc协程[name] = 是;
  return 是;
};

/** 语句列表里是否会出现"让出帧" */
Emitter.prototype.语句列表会让出 = function (list, 拜访) {
  var self = this;
  if (!list || !list.length) return false;
  for (var i = 0; i < list.length; i++) {
    if (this.语句会让出(list[i], 拜访)) return true;
  }
  return false;
};

Emitter.prototype.语句会让出 = function (st, 拜访) {
  if (!st) return false;
  var k = st.k;
  // ★先深扫所有「表达式位置」★ —— 必须放在下面那些「分支内 return」之前。
  //   典型：`if (角色.不等于(await 角色.所在房间(ctx), ""))` —— await 落在**条件表达式**里。
  //   以前 k==='if' 只扫分支体、扫完就 return false，条件里的协程调用永远看不到；
  //   op / stub / warp 分支同理。于是「只在条件/实参里调用协程过程」的自定义积木
  //   被判成非协程，所有调用点漏写 await，Godot 报
  //     Function "xxx()" is a coroutine, so it must be called with "await"
  if (this.表达式会让出(st, 拜访)) return true;
  // 控制流：循环里必有 一步(ctx)
  if (k === 'forever' || k === 'repeat' || k === 'repeat_until' || k === 'wait_until') return true;
  if (k === 'broadcast_body_wait') return true;      // 广播并等待
  if (k === 'ask_choose') return true;               // 询问并选择
  if (k === 'tell' || k === 'tell_sync') return this.过程是协程(st.proc, 拜访);
  if (k === 'call' || k === 'call_remote') return this.过程是协程(st.name, 拜访);
  if (k === 'if') {
    var brs = st.branches || [];
    for (var b = 0; b < brs.length; b++) {
      if (this.语句列表会让出(brs[b].body, 拜访)) return true;
    }
    return false;
  }
  if (k === 'warp') return this.语句列表会让出(st.body, 拜访);
  if (k === 'op') {
    var om = MT.OP_METHODS[st.op];
    return !!(om && this.协程[om.name]);
  }
  if (k === 'stub') {
    var tm = MT.TYPE_METHODS[st.type];
    if (!tm) return false;
    var tn = (this.stubRenames && this.stubRenames[tm.name]) || tm.name;
    return !!this.协程[tn];
  }
  var m = MT.IR_METHODS[k];
  if (m && this.协程[m.name]) return true;
  // 表达式的深扫已经在本函数开头统一做过了（见上面的「先深扫所有表达式位置」）
  return false;
};

/**
 * 深扫任意节点里的「值形态调用」，判断它会不会让出。
 *
 * 覆盖所有表达式位置：return 的 value、if / 循环的条件、实参列表……
 * 判据与 语句会让出 保持一致（协程方法表 + 自定义积木递归判定），
 * 多出来的是 op(call_proc/call_remote) 这种「把自定义积木当值用」的形态。
 */
Emitter.prototype.表达式会让出 = function (n, 拜访) {
  if (!n || typeof n !== 'object') return false;
  if (Array.isArray(n)) {
    for (var i = 0; i < n.length; i++) {
      if (this.表达式会让出(n[i], 拜访)) return true;
    }
    return false;
  }
  var k = n.k;
  if (k === 'tell' || k === 'tell_sync') return this.过程是协程(n.proc, 拜访);
  if (k === 'call' || k === 'call_remote') return this.过程是协程(n.name, 拜访);
  if (k === 'op') {
    // 值形态的过程调用：IR 里是 op('call_proc', [名字, ...])
    if (n.op === 'call_proc' || n.op === 'call_remote') {
      var a0 = (n.args || [])[0];
      var nm = a0 && a0.v !== undefined ? String(a0.v) : (typeof a0 === 'string' ? a0 : '');
      if (nm && this.过程是协程(nm, 拜访)) return true;
    }
    var om = MT.OP_METHODS[n.op];
    if (om && this.协程[om.name]) return true;
  }
  if (k && AWAIT_KINDS[k]) return true;
  if (k && MT.IR_METHODS[k] && this.协程[MT.IR_METHODS[k].name]) return true;
  for (var key in n) {
    if (key === 'k') continue;
    var v = n[key];
    if (v && typeof v === 'object') {
      if (this.表达式会让出(v, 拜访)) return true;
    }
  }
  return false;
};

/* ------------------------------------------------------------------ *
 * 方法签名合并（唯一真源）
 *
 * 同一个方法名可能同时出现在 IR_METHODS / OP_METHODS / FAMILY_METHODS /
 * TYPE_METHODS 里，而且**实参个数还不一样**。接口文件只能声明一次，
 * 所以必须先把它们合并成一个签名；调用点也必须按**同一个**合并结果补/截实参。
 *
 * 以前调用点按自己那张表的条数补，接口按合并结果声明 —— 两边不一致时
 * Godot 在**解析期**就报错，而不是运行期：
 *     Parse Error: Too few arguments for "停止计时器()" call.
 * 这类错误会让整个 .tscn 加载失败，表现为"场景似乎无效/损坏"。
 * ------------------------------------------------------------------ */

/* 类型层桩的调用形态是 `角色.名([...])`（恰好 1 个 Array 实参），
   IR/OP 的调用形态是 `角色.名(逐个实参)`。两者同名就会抢同一个签名 ——
   所以桩一旦撞名就自动改名（加 `_桩` 后缀）。 */
function renamedStubNames() {
  var taken = {};
  ['IR_METHODS', 'OP_METHODS', 'FAMILY_METHODS'].forEach(function (t) {
    Object.keys(MT[t] || {}).forEach(function (k) {
      var m = MT[t][k];
      if (m && m.name && !m.inline) taken[m.name] = 1;
    });
  });
  var r = {};
  Object.keys(MT.TYPE_METHODS || {}).forEach(function (k) {
    var m = MT.TYPE_METHODS[k];
    if (m && m.name && !m.inline && taken[m.name]) r[m.name] = m.name + '_桩';
  });
  return r;
}

function buildSignatures(report) {
  var renames = renamedStubNames();
  var groups = {};
  function add(m) {
    if (!m || !m.name || m.inline) return;
    (groups[m.name] = groups[m.name] || []).push(m);
  }
  Object.keys(MT.IR_METHODS).forEach(function (k) { add(MT.IR_METHODS[k]); });
  Object.keys(MT.OP_METHODS).forEach(function (k) { add(MT.OP_METHODS[k]); });
  Object.keys(MT.FAMILY_METHODS || {}).forEach(function (k) { add(MT.FAMILY_METHODS[k]); });
  Object.keys(MT.TYPE_METHODS || {}).forEach(function (k) {
    var m = MT.TYPE_METHODS[k];
    if (!m) return;
    var nm = renames[m.name];
    if (nm) {
      var c = {};
      Object.keys(m).forEach(function (kk) { c[kk] = m[kk]; });
      c.name = nm;
      add(c);
    } else add(m);
  });

  var out = {};
  Object.keys(groups).forEach(function (name) {
    var g = groups[name];
    var off = function (m) { var p = m.params || []; return (p[0] && p[0][1] === 'ctx') ? 1 : 0; };
    var hasCtx = g.some(function (m) { return off(m) === 1; });
    var maxN = 0;
    g.forEach(function (m) { maxN = Math.max(maxN, (m.params || []).length - off(m)); });
    var slots = [];
    for (var i = 0; i < maxN; i++) slots.push(null);
    g.forEach(function (m) {
      var p = m.params || [], o = off(m);
      for (var i = o; i < p.length; i++) {
        var cur = slots[i - o];
        if (!cur) slots[i - o] = [p[i][0], p[i][1], p[i][2]];
        else {
          if (cur[1] !== p[i][1]) cur[1] = 'v';   // 同一位置类型不一致 -> 放宽成 Variant
          if (cur[2] === undefined) cur[2] = p[i][2];
        }
      }
    });
    var params = [];
    if (hasCtx) params.push(['ctx', 'ctx']);
    slots.forEach(function (s, i) {
      // 第 3 项 = 补齐用的默认值，必须原样带出去（掉了的话 call() 会退回 GDEF，例如开方给 0.0）
      params.push([s && s[0] ? s[0] : ('参数' + (i + 1)), s ? s[1] : 'a', s ? s[2] : undefined]);
    });

    // ★参数名去重★
    // 上面是按**位置**合并的、名字取"先遇到的那一份"（IR 表在前）。
    // 如果两张表给同一个位置起了不同的名字，就会出现重名参数 ——
    // GDScript 直接报 "Duplicate parameter name"，而且症状是
    // 「整个 class_name 链解析不了」，极难定位。
    // 例：list_item_special 曾经生成 `(_列表, _序号, _序号)`。
    // 这里兜一道：重名就加后缀，并记进报告。
    var 见过名 = {};
    params.forEach(function (p) {
      if (p[0] === 'ctx') return;
      var 基名 = p[0];
      var n = 基名;
      var k = 2;
      while (见过名[n]) { n = 基名 + '_' + k; k++; }
      if (n !== 基名) {
        if (report) {
          report.参数改名 = report.参数改名 || [];
          report.参数改名.push(name + ' 的 ' + 基名 + ' -> ' + n);
        }
      }
      p[0] = n;
      见过名[n] = 1;
    });

    var rets = {};
    g.forEach(function (m) { rets[m.ret || 'void'] = 1; });
    var rk = Object.keys(rets);
    var isStub = g.every(function (m) { return !!m.stub; });
    // 类型层桩：反编译器给这类块留下的输入顺序/个数都不确定，
    // 生成器统一用 `角色.名([...])` 兜住 —— 签名必须恰好 1 个 Array。
    if (isStub) params = [['参数', 'a']];

    out[name] = {
      name: name,
      params: params,
      ret: rk.length === 1 ? rk[0] : 'v',
      cat: g[0].cat,
      stub: isStub
    };
  });
  return out;
}

Emitter.prototype.file = function (path, content) { this.files[path] = content; };

/* ---------- 超长文本外置 ---------- */
/* 超过 TEXT_FILE_LIMIT 的字符串不再内联进 .gd，而是落到
 *     <脚本所在目录>/文本/<编号>.txt
 * 代码里换成 K4Text.读取("目录/文本/N.txt")（autoload，读一次后缓存住）。
 *
 * 为什么放"脚本所在目录"：文本属于哪个角色一目了然，删角色时文本跟着走；
 * 同一个目录内**同内容只存一份**，编号从 1 开始。
 * 为什么不直接用 FileAccess.get_file_as_string()：一次调用读一次盘，
 * 万一落在循环里就是灾难；K4Text 把结果缓存住，且顺带集中处理读失败。 */

/** 返回外置后的项目内相对路径；没超阈值则返回 null */
Emitter.prototype.外置文本 = function (s) {
  var str = String(s === undefined || s === null ? '' : s);
  if (str.length <= TEXT_FILE_LIMIT) return null;
  var dir = this.curDir || '全局';
  var pool = this.textPool[dir];
  if (!pool) pool = this.textPool[dir] = { 序号: 0, 索引: {}, 列表: [] };
  if (!pool.索引[str]) {
    pool.序号++;
    pool.索引[str] = dir + '/文本/' + pool.序号 + '.txt';
    pool.列表.push({ rel: pool.索引[str], text: str });
    this.report.外置文本 = (this.report.外置文本 || 0) + 1;
  }
  return pool.索引[str];
};

/** 字符串 -> GDScript 表达式：超长则换成 K4Text.读取(...) */
Emitter.prototype.strLit = function (s) {
  var rel = this.外置文本(s);
  return rel ? (TEXT_READER + '.读取(' + gdStr(rel) + ')') : gdStr(s);
};

/** 值字面量：字符串走外置通道，其余交给 literalOf（数组仍按 literalOf 的老规矩给 []） */
Emitter.prototype.litOf = function (v) {
  if (typeof v === 'string') {
    var rel = this.外置文本(v);
    if (rel) return TEXT_READER + '.读取(' + gdStr(rel) + ')';
  }
  return literalOf(v);
};

/** 把攒下的外置文本真正写进输出（emitProject 返回前必须调用一次） */
Emitter.prototype.flushTextFiles = function () {
  var self = this;
  Object.keys(this.textPool).forEach(function (dir) {
    self.textPool[dir].列表.forEach(function (t) { self.file(t.rel, t.text); });
  });
};

/* 列表初值也可能非常大（K4 里可以往列表里塞整份数据）——
 * 和超长文本一样落到 <目录>/文本/列表N.txt，只是内容用 **JSON** 存：
 * 列表项有数字也有字符串，JSON 能把类型原样带回来（纯按行存会把 "1" 和 1 混掉）。
 * 运行时 K4Text.读取列表() 读一次、解析一次、缓存住。 */
Emitter.prototype.外置列表 = function (items) {
  var 文本;
  try { 文本 = JSON.stringify(Array.isArray(items) ? items : []); } catch (e) { 文本 = '[]'; }
  if (文本 === undefined || 文本 === null) 文本 = '[]';
  if (文本.length <= TEXT_FILE_LIMIT) return null;
  var dir = this.curDir || '全局';
  var pool = this.textPool[dir];
  if (!pool) pool = this.textPool[dir] = { 序号: 0, 索引: {}, 列表: [] };
  var key = 'LIST:' + 文本;                 // 加前缀，别和 外置文本 的索引撞
  if (!pool.索引[key]) {
    pool.序号++;
    pool.索引[key] = dir + '/文本/列表' + pool.序号 + '.txt';
    pool.列表.push({ rel: pool.索引[key], text: 文本 });
    this.report.外置列表 = (this.report.外置列表 || 0) + 1;
  }
  return pool.索引[key];
};

/** 列表初值 -> GDScript 表达式（小列表内联；超长走 K4Text.读取列表） */
Emitter.prototype.列表初值 = function (items) {
  var self = this;
  var arr = Array.isArray(items) ? items : [];
  var rel = this.外置列表(arr);
  if (rel) return TEXT_READER + '.读取列表(' + gdStr(rel) + ')';
  return '[' + arr.map(function (x) { return self.litOf(x); }).join(', ') + ']';
};

/** 这个表达式是不是"外置读取"（需要在 _ready 里才能赋值，不能写在声明处） */
function 是外置读取(表达式) {
  return typeof 表达式 === 'string' && 表达式.indexOf(TEXT_READER + '.读取') === 0;
}

/* ---------- 变量 / 列表声明收集 ---------- */

Emitter.prototype.collectDecls = function () {
  var P = this.project, ns = this.ns, self = this;
  var gv = [], gl = [];
  (P.variables || []).forEach(function (v) {
    if (v.is_global) gv.push({ decl: ns.assign('全局变量', v.name, '_v_'), src: v });
  });
  (P.lists || []).forEach(function (l) {
    if (l.is_global) gl.push({ decl: ns.assign('全局列表', l.name, '_l_'), src: l });
  });
  this.globalDecls = { vars: gv, lists: gl };
  // 供接口文件注释里列出全局变量名
  this.globalVars = {}; this.globalLists = {};
  gv.forEach(function (x) { self.globalVars[x.decl] = x; });
  gl.forEach(function (x) { self.globalLists[x.decl] = x; });

  // 局部变量必须声明在**所有角色共用的那个类**（角色自带积木）里。
  // 原因：生成代码写 `角色.v_名字`，而 `角色` 的静态类型是 角色类；
  // 如果成员声明在派生的 <角色名>.gd 里，Godot 静态检查会报找不到成员。
  this.localVars = {};    // 生成名 -> {decl, src}
  this.localLists = {};
  this.actorDecls = {};   // actorId -> {vars:[], lists:[]}

  (P.variables || []).forEach(function (v) {
    if (v.is_global) return;
    var dv = { decl: ns.assign('局部变量', v.name, '_v_'), src: v };
    if (!self.localVars[dv.decl]) self.localVars[dv.decl] = dv;
    if (!v.owner) return;                 // 没归属的也声明，只是不参与某个角色的初值
    var d = self.actorDecls[v.owner] = self.actorDecls[v.owner] || { vars: [], lists: [] };
    d.vars.push(dv);
  });
  (P.lists || []).forEach(function (l) {
    if (l.is_global) return;
    var dl = { decl: ns.assign('局部列表', l.name, '_l_'), src: l };
    if (!self.localLists[dl.decl]) self.localLists[dl.decl] = dl;
    if (!l.owner) return;
    var d = self.actorDecls[l.owner] = self.actorDecls[l.owner] || { vars: [], lists: [] };
    d.lists.push(dl);
  });
  this.report.renames = ns.renames || [];
};

Emitter.prototype.varRef = function (rawName, isList) {
  // ★K4 允许"变量里存一个列表"★：列表类积木（取值/添加/删除/长度…）的目标名字，
  //   可能指向的是 **type=any 的变量**（它的值就是一个数组），而不是列表成员。
  //   实测（外部图片绘制.bcm4）：`image_data` 在数据里是 type=any / is_global=true 的变量，
  //   列表积木却拿它当目标 → 以前按"列表"走，生成 `角色._l_image_data`
  //   （凭空造一个恒为空的局部列表）→ 数据永远加载不进去，
  //   rect_quantity 变 -1、画笔逐像素画的都是空文本。
  //   所以这里先纠偏：**名字登记在变量表里、却不在列表表里 → 按变量处理**。
  var 列表表 = this.names.listScope || {};
  var 变量表 = this.names.varScope || {};
  if (isList
      && !Object.prototype.hasOwnProperty.call(列表表, rawName)
      && Object.prototype.hasOwnProperty.call(变量表, rawName)) {
    isList = false;
  }
  // 决定「局部成员」还是「全局 autoload」
  var scope = isList ? (this.names.listScope || {})[rawName] : (this.names.varScope || {})[rawName];
  var kind = isList ? '局部列表' : '局部变量';
  var gkind = isList ? '全局列表' : '全局变量';
  var name;
  if (scope === 'global') name = this.ns.assign(gkind, rawName, isList ? '_l_' : '_v_');
  else name = this.ns.assign(kind, rawName, isList ? '_l_' : '_v_');
  // 兜底：只要生成代码引用了某个局部成员，就一定把它登记进声明表 ——
  // 否则会出现 `角色.n0` 这种「有引用、没声明」的运行时错误
  // （K4 里个别列表没有 current_entity，也没有出现在工程 variables 表里）。
  if (scope !== 'global') {
    if (isList) {
      if (!this.localLists[name]) this.localLists[name] = { decl: name, src: { value: [] } };
    } else if (!this.localVars[name]) {
      this.localVars[name] = { decl: name, src: { value: 0 } };
    }
  }
  return { target: scope === 'global' ? 'K4Global' : '角色', name: name, global: scope === 'global' };
};

/* ---------- 表达式 ---------- */

Emitter.prototype.expr = function (node, ctx) {
  var self = this;
  // 有些字段本身就是标量（例如 {k:'layer', dir:1} 的 dir），先兜住
  if (typeof node === 'number') return gdNum(node);
  if (typeof node === 'boolean') return node ? 'true' : 'false';
  if (typeof node === 'string') return this.strLit(node);
  if (!node) return '0.0';
  if (node.k === 'lit') {
    if (node.v === null || node.v === undefined) return '""';
    if (node.bool) return node.v ? 'true' : 'false';
    if (node.num) return gdNum(node.v);
    if (node.str) return this.strLit(node.v);
    return gdNum(node.v);
  }
  if (node.k === 'emptybool') return '""';
  if (node.k === 'ref') {
    // 过程体里，名字先当**参数**匹配（反编译器对参数和变量用的是同一种 ref 节点）
    if (ctx && ctx.params && ctx.params[String(node.name)] !== undefined) {
      return ctx.params[String(node.name)];
    }
    // 直接成员访问：局部变量 -> 角色.v_xxx，全局变量 -> K4Global.v_xxx
    var r = this.varRef(node.name, false);
    return r.target + '.' + r.name;
  }
  if (node.k === 'listref') {
    var rl = this.varRef(node.name, true);
    return rl.target + '.' + rl.name;
  }
  if (node.k === 'listref_from') {
    var a0 = (node.args || [])[0];
    // listref_from(VAR, A) 形如 {args:[ref/listref, ...]}；原样转 listref
    if (a0 && (a0.k === 'ref' || a0.k === 'listref')) {
      var r2 = this.varRef(a0.name, true);
      return r2.target + '.' + r2.name;
    }
    return '[]';
  }
  if (node.k === 'args') {
    return '[' + (node.args || []).map(function (x) { return self.expr(x, ctx); }).join(', ') + ']';
  }
  if (node.k === 'unknown') {
    // 屏幕相关的取值积木：直接落到运行时
    if (node.type === 'get_current_scene') return 'K4Global.当前屏幕';
    // ★sensing 分类的「当前场景」是**同一个语义**的孪生块★
    //   K4 在 外观/侦测 两个分类里各放了一个"当前场景"，块类型不同
    //   （get_current_scene / get_sensing_current_scene），含义都是"我现在在哪个屏幕"。
    //   以前只认前一个，后一个落到下面 `return '0.0'` —— 拿它和屏幕名比较永远为假。
    if (node.type === 'get_sensing_current_scene') return 'K4Global.当前屏幕';
    if (node.type === 'check_screen') {
      var cs = node.inputs || {};
      var cf = node.fields || {};
      var cArg = null;
      Object.keys(cs).forEach(function (kk) { if (!cArg && cs[kk]) cArg = cs[kk]; });
      var cKey = Object.keys(cf).filter(function (kk) { return typeof cf[kk] === 'string' && cf[kk] !== ''; })[0];
      return '角色.当前屏幕是(' + screenArg(this, cArg, cKey ? String(cf[cKey]) : '', ctx) + ')';
    }
    return '0.0';   // K4 里『没有值』就是 0，null 参与算术会报 Nil
  }
  if (node.k === 'nop') return '0.0';
  if (node.k === 'op') return this.opCall(node, ctx);
  return 'null';
};

/** 条件表达式：只有静态已知是 bool 时才原样用，其余一律走 K4 真值规则 */
Emitter.prototype.cond = function (node, ctx) {
  var src = this.expr(node, ctx);
  // K4 的真值规则：0 / "0" / "" / "false" 都是假。
  // Godot 对 Variant 的真值化对**非空字符串一律为真**（"0" 也是真），和 K4 不一致，
  // 所以动态值也要包一层 —— 否则 `如果 <列表项>` 在值是 "0" 时会走错分支。
  if (staticKind(node) === 'b') return '(' + src + ')';
  return '角色.为真(' + src + ')';
};

Emitter.prototype.opCall = function (node, ctx) {
  var op = node.op;
  var args = node.args || [];
  var self = this;
  var ex = function (i) { return self.expr(args[i], ctx); };
  var join = function (list) { return list.join(', '); };

  // —— 基础运算符内联：读起来就是普通算式 ——
  // 静态类型已知的运算数会被强制到同一类型（K4 是弱类型，GDScript 不是）；
  // 动态值（Variant）原样保留，所以绝大多数地方看起来就是 a + b / a == b。
  function coerce(i, want) {
    var k = staticKind(args[i]);
    var src = self.expr(args[i], ctx);
    if (k === want) return src;
    if (k === '?') {
      // ★动态值必须显式转换★
      // K4 是弱类型：`"175" / 1000` 合法（= 0.175），而 GDScript 运行期直接报
      //   Invalid operands 'String' and 'float' in operator '/'
      // 变量 / 列表项 / 自定义积木返回值 / 云变量取值…… 全都可能是字符串，
      // 所以凡是"要数字 / 要文本 / 要真假"的位置都得转一次。
      // 以前对 '?' 是**原样返回**的 —— phi 转换器里
      //   `列表取值_特殊(输入,"first",1.0) / 1000.0`
      // 就是这么炸的（而且那行还被帽子误触发提前跑到了）。
      if (want === 'n') return '角色.转数字(' + src + ')';
      if (want === 's') return 'str(' + src + ')';
      return '角色.为真(' + src + ')';
    }
    if (want === 'n') return (k === 's') ? ('(' + src + ').to_float()') : ('float(' + src + ')');
    if (want === 's') return 'str(' + src + ')';
    // want === 'b'：Godot 没有 bool(String)，按 K4 的真值规则写
    if (k === 's') return '(' + src + ' != "")';
    return '(' + src + ' != 0)';
  }
  var ARITH = { add: '+', sub: '-', mul: '*', div: '/', pow: '**' };
  if (ARITH[op] && args.length >= 2) {
    if (op === 'add') {
      // K4 的 + 是「两侧都能当数字就相加，否则拼字符串」（"5" + 1 = 6，"a" + 1 = "a1"）。
      // 所以既不能转数字、也不能只靠内联里的类型判断 —— 交给运行时函数。
      // 只有两侧都是**数字字面量**时才内联，那种情况 K4 和 GDScript 完全一致。
      if (staticKind(args[0]) !== 'n' || staticKind(args[1]) !== 'n') {
        return '角色.算术运算("add", ' + ex(0) + ', ' + ex(1) + ')';
      }
      return '(' + coerce(0, 'n') + ' + ' + coerce(1, 'n') + ')';
    }
    // - * / ** ：K4 一律按数值算
    return '(' + coerce(0, 'n') + ' ' + ARITH[op] + ' ' + coerce(1, 'n') + ')';
  }
  // K4 的取余结果符号**跟随除数**（-7 mod 3 = 2），GDScript 的 fmod 不是
  if (op === 'mod' && args.length >= 2) return '角色.取余(' + ex(0) + ', ' + ex(1) + ')';
  if (op === 'neg' && args.length >= 1) return '(-' + coerce(0, 'n') + ')';
  if ((op === 'and' || op === 'or') && args.length >= 2) {
    return '(' + coerce(0, 'b') + ' ' + op + ' ' + coerce(1, 'b') + ')';
  }
  if (op === 'not' && args.length >= 1) return '(not ' + coerce(0, 'b') + ')';
  // K4 的 转文本(3.0) 得 "3"，GDScript 的 str(3.0) 得 "3.0"
  if (op === 'to_string' && args.length >= 1) return '角色.转文本(' + ex(0) + ')';
  if (op === 'to_number' && args.length >= 1) return '角色.转数字(' + ex(0) + ')';
  if (op === 'is_divisibleby' && args.length >= 2) {
    return '(fmod(' + coerce(0, 'n') + ', ' + coerce(1, 'n') + ') == 0.0)';
  }
  if (op === 'join') {
    if (args.length === 2) return '(str(' + ex(0) + ') + str(' + ex(1) + '))';
  }
  if (op === 'str_len' && args.length >= 1) return 'str(' + ex(0) + ').length()';
  if (op === 'list_len' && args.length >= 1) return ex(0) + '.size()';
  if (op === 'list_empty' && args.length >= 1) return ex(0) + '.is_empty()';
  if (op === 'list_contains' && args.length >= 2) return ex(0) + '.has(' + ex(1) + ')';
  if (op === 'list_index_of' && args.length >= 2) return '(' + ex(0) + '.find(' + ex(1) + ') + 1)';

  // —— 比较：K4 的 eq/neq/lt/lte/gt/gte ——
  if (/^cmp_/.test(op)) {
    var CMP = { eq: '==', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' };
    var CMPFN = { eq: '等于', neq: '不等于', lt: '小于', lte: '小于等于', gt: '大于', gte: '大于等于' };
    var cop = CMP[op.slice(4)];
    if (cop && args.length >= 2) {
      var ck0 = staticKind(args[0]), ck1 = staticKind(args[1]);
      // ★只有两侧都确定是数字时才内联原生运算符★
      // 其余情况（尤其是动态值：变量 / 过程参数 / 列表项 / 自定义积木返回值）
      // 一律走 K4 的弱类型比较 —— 否则运行期会报
      //   Invalid operands 'String' and 'float' in operator '<='
      // K4 的规则是「两侧都能当数字就按数字比，否则按字符串比」，
      // 而 GDScript 的 `"175" == 175` 是 false（不报错但语义错），
      // `"175" <= 175` 直接报错 —— 两种都得走 角色.等于/小于…()。
      if (!(ck0 === 'n' && ck1 === 'n')) {
        return '角色.' + CMPFN[op.slice(4)] + '(' + ex(0) + ', ' + ex(1) + ')';
      }
      return '(' + ex(0) + ' ' + cop + ' ' + ex(1) + ')';
    }
  }
  if (/^math_/.test(op) && op !== 'math_root_n' && op !== 'math_root') {
    return '角色.数学函数(' + gdStr(op.slice(5)) + ', ' + ex(0) + ')';
  }
  if (/^is_/.test(op) && op !== 'is_divisibleby') {
    return '角色.是否判断(' + gdStr(op.slice(3)) + ', ' + ex(0) + ')';
  }
  if (op === 'coord_x') return '角色.坐标x()';
  if (op === 'coord_y') return '角色.坐标y()';

  // listref_from(VAR, A)：列表引用节点，等价于「取这个名字的列表」
  if (op === 'listref_from') {
    var rl0 = args[0];
    if (rl0 && (rl0.k === 'ref' || rl0.k === 'listref')) {
      var rr0 = this.varRef(rl0.name, true);
      return rr0.target + '.' + rr0.name;
    }
    if (rl0 && rl0.v !== undefined) {
      var rr1 = this.varRef(String(rl0.v), true);
      return rr1.target + '.' + rr1.name;
    }
    // 兜底：X 本身就是一个返回列表的表达式（如 str_split 的结果）
    if (rl0) return this.expr(rl0, ctx);
    return '[]';
  }

  // 自定义积木调用
  if (op === 'call_proc' || op === 'call_remote') {
    var pname = String(args[0] && args[0].v !== undefined ? args[0].v : (args[0] || ''));
    var box = args[args.length - 1];
    var ownerNode = op === 'call_remote' ? args[1] : null;
    var callStr = this.procCall(pname, box, ownerNode && ownerNode.v !== undefined ? ownerNode.v : null, ctx);
    // ★自定义积木调用一律 await★（procCall 里已经带上了）
    //   取值位置以前是"判断过程体是否含循环/等待才 await" —— 那是静态近似，
    //   一旦判断失手就是 `Function X() is a coroutine, so it must be called
    //   with "await"`。这与 K4 的语义也一致：K4 会等这一步（含它内部的等待）做完。
    return callStr;
  }
  if (op === 'return_proc') return this.expr(args[0], ctx);

  // join 是变参：K4 可能给 3 个以上文本，而方法签名是二元的 -> 折叠成嵌套调用
  if (op === 'join' && args.length > 2) {
    var acc = this.expr(args[args.length - 1], ctx);
    for (var q = args.length - 2; q >= 0; q--) {
      acc = '角色.连接(' + this.expr(args[q], ctx) + ', ' + acc + ')';
    }
    return acc;
  }

  var m = MT.OP_METHODS[op];
  if (!m) {
    this.report.unknown['op:' + op] = (this.report.unknown['op:' + op] || 0) + 1;
    return '0.0';   // 未映射取值积木：给个安全默认值，同时已记进报告
  }
  if (m.inline) return 'null';

  var a = ARG[op];
  if (a === undefined) a = ['args'];
  if (a === null) return 'null';
  var out = [];
  for (var i = 0; i < a.length; i++) {
    var f = a[i];
    if (f === 'args') {
      for (var j = 0; j < args.length; j++) out.push(this.expr(args[j], ctx));
    } else if (f === 'op') {
      out.push(gdStr(this.operToken(node)));
    } else if (typeof f === 'string' && f.charAt(0) === '@') {
      // '@N' = 取 args[N]（用于修正反编译器给出的实参顺序）
      var idx = parseInt(f.slice(1), 10);
      out.push(args[idx] !== undefined ? this.expr(args[idx], ctx) : 'null');
    } else {
      out.push(this.expr(node[f], ctx));
    }
  }
  return this.call('角色', m, out, ctx);
};

Emitter.prototype.operToken = function (node) {
  // add/sub/mul/div/pow 的 k 即运算符
  return node.k;
};

/* 生成一次方法调用：必要参数自动补 ctx。
   实参个数与签名不一致时**自动补齐/截断**（保证生成代码一定编译得过），
   同时记进报告，方便人工修正 ARG。 */
Emitter.prototype.call = function (target, m, argStrings, ctx) {
  if (!m) { this.report.unknown['method:?'] = 1; return 'null'; }
  // 实参个数必须跟**接口文件里最终声明的那个签名**一致（见 buildSignatures）。
  // 基类已实现的方法（BASE_METHODS）不走合并：它们的签名以 角色基类.gd 为准。
  var sig = (!BASE_METHODS[m.name] && this.sig) ? this.sig[m.name] : null;
  var params = (sig && sig.params) || m.params || [];
  var hasCtx = !!(params[0] && params[0][1] === 'ctx');
  var need = params.length - (hasCtx ? 1 : 0);
  var given = (argStrings || []).slice();
  if (need !== given.length) {
    // 「少给了」有两种情况，别混在一起报：
    //   ① 缺的参数**每一个都带默认值** → 那是"可省略参数"，正常。
    //      例如 开方 的「次」声明成 ['次','v','2.0']，而 K4 的 math_root
    //      本来就只塞 1 个实参 —— 以前这会被报成「实参个数不匹配」，
    //      每次转换都在报告里挂一条假警报（函数返回值尝试 就中了这条）。
    //   ② 缺的参数**没有默认值** → 真的不匹配，要报。
    var 可省略 = given.length < need;
    if (可省略) {
      for (var q = given.length; q < need; q++) {
        var s2 = params[q + (hasCtx ? 1 : 0)];
        if (!s2 || s2[2] === undefined) { 可省略 = false; break; }
      }
    }
    if (!可省略) this.report.argMismatch.push({ 方法: m.name, 需要: need, 给了: given.length });
    while (given.length < need) {
      var slot = params[given.length + (hasCtx ? 1 : 0)];
      // 参数元组可以带第 3 项 = 补齐用的默认值（例如 开方 的「次」应该是 2 而不是 0）
      given.push(slot[2] !== undefined ? slot[2] : (GDEF[slot[1]] || 'null'));
    }
    if (given.length > need) {
      // 截断 = **真实实参被丢掉**，这是方法表的参数个数写少了，不是无害的补齐。
      // convert.js 会把它升级成 ✗ 错误（见 report.argLoss）。
      var lost = given.slice(need);
      given.length = need;
      this.report.argLoss.push({ 方法: m.name, 声明: need, 实给: lost.length + need, 丢掉: lost });
    }
  }
  var list = [];
  var 原始个数 = (argStrings || []).length;
  for (var i = 0; i < params.length; i++) {
    if (params[i][1] === 'ctx') { list.push('ctx'); continue; }
    var 序号 = i - (hasCtx ? 1 : 0);
    var val = given[序号];
    // ★实参类型校正★
    //   模板/接口里的形参是**强类型**的（String / float / bool），而 K4 是弱类型：
    //   调用点送来的常常是 Variant（变量、列表项、积木返回值、计算结果）。
    //   Godot 把 Variant 传给强类型形参会报
    //     Invalid type in function ... Cannot convert argument N from float to String
    //   （运行期直接中断这条脚本）。所以按**声明的类型**在生成期包一层：
    //     s → 角色.转文本(x)   f → 角色.转数字(x)   b → 角色.为真(x)
    //   ★必须用 K4 自己的 转文本/转数字，不能用 Godot 的 str()/float()★：
    //     K4 的 转文本(3.0) = "3"，而 str(3.0) = "3.0" ——
    //     造型编号/列表序号这类"数字当名字用"的地方，差一个 ".0" 就匹配不上。
    //   只包"真实给的实参"和"类型不确定的表达式"；已经是同类型字面量的不包。
    //   （这段以前写的是 `this.relax[...] = true`，注释说"接口文件最后生成会读到"，
    //     但接口层后来换成了模板拷贝，没有任何地方再读它 —— 等于机制断线，
    //     现在改成真正生效的生成期转换。）
    if (序号 < 原始个数 && val !== 'null' && val !== 'undefined') {
      var 想要 = params[i][1];
      var 文本 = String(val);
      var 是字符串字面量 = /^"/.test(文本);
      var 是数字字面量 = /^-?\d+(\.\d+)?$/.test(文本);
      var 是布尔字面量 = (文本 === 'true' || 文本 === 'false');
      var 已转过 = /^(str|角色\.转文本|角色\.转数字|角色\.为真)\(/.test(文本);
      // 已经是"数值运算表达式"的也不再包：像 `(角色.转数字(x) - 20.0)` 这种
      // 整体必然算出 float（不含字符串字面量），再套一层 角色.转数字 只是噪音。
      var 像数值表达式 = /^\(.*\)$/.test(文本) && !/["']/.test(文本) &&
        /(角色\.转数字\(|float\()/.test(文本);
      if (!已转过 && !像数值表达式) {
        if (想要 === 's' && !是字符串字面量) {
          val = '角色.转文本(' + val + ')';
          this.report.实参类型转换.push(m.name + ' 第' + (序号 + 1) + '个实参 → String');
        } else if (想要 === 'f' && !是数字字面量) {
          val = '角色.转数字(' + val + ')';
          this.report.实参类型转换.push(m.name + ' 第' + (序号 + 1) + '个实参 → float');
        } else if (想要 === 'b' && !是布尔字面量) {
          val = '角色.为真(' + val + ')';
          this.report.实参类型转换.push(m.name + ' 第' + (序号 + 1) + '个实参 → bool');
        }
      }
    }
    list.push(val);
  }
  var src = target + '.' + m.name + '(' + list.join(', ') + ')';
  // ★只对**真正是协程**的方法写 await★（用户要求 + Godot 的 REDUNDANT_AWAIT 警告）
  //
  //   判定依据是 runtime 里的**实现**是否含 await（lib/k4/async.js 静态扫描 +
  //   传染闭包），而不是方法表里的 await 标记 —— GDScript 判断协程性看的就是
  //   "函数体里有没有 await"，所以实现在准。
  //     有 await 的方法：`await 角色.等待_秒(ctx, 1.0)`  ← K4 在这里等
  //     同步的方法：    `角色.移动_步(10.0)`             ← 以前无脑 await，会
  //                     把"不等待"的积木也变成协程调用（并让整个调用链变协程）
  //   方法表的 await 声明仍然有用：构造时会与本判定交叉校验，不一致会写进
  //   转换报告的 `await声明不一致`，提醒作者去改其中一边。
  var 需等待 = !!(this.协程 && this.协程[m.name]);
  return (需等待 ? 'await ' : '') + src;
};

/* ---------- 语句 ---------- */

Emitter.prototype.stmtLines = function (stmt, ctx, indent) {
  var self = this;
  var pad = indent;
  var out = [];
  var k = stmt && stmt.k;
  if (!k) return [pad + 'pass'];

  var note = function (label, blockId) {
    return pad + '# 原积木: ' + label + (blockId ? ' @' + blockId : '');
  };

  // —— 控制流 ——
  if (k === 'forever') {
    out.push(pad + 'while true:');
    this.loopDepth = (this.loopDepth || 0) + 1;
    out = out.concat(this.body(stmt.body, ctx, pad + '    '));
    this.loopDepth--;
    out.push(pad + '    await 角色.一步(ctx)');
    // ★被取消的协程必须**退出循环**★
    //   `一步()` 在 `_ctx._已取消` 时只是"让出一帧再返回"，循环会接着跑下一轮 ——
    //   实测：屏幕切走（或「停止」积木）之后，计数/克隆还在涨。
    //   GDScript 没有"取消协程"的原语，所以由生成器在每个循环末尾补一句 break：
    //   这才是「即走即取消」真正生效的地方（K4 的运行组语义要求旧屏幕的
    //   常驻脚本立刻停下，而不是留个后台循环继续克隆）。
    out.push(pad + '    if ctx._已取消: break');
    return out;
  }
  if (k === 'repeat') {
    this.loopSeq++;
    var it = '_k4i' + this.loopSeq;
    out.push(pad + 'for ' + it + ' in range(角色.转整数(' + this.expr(stmt.times, ctx) + ')):');
    this.loopDepth = (this.loopDepth || 0) + 1;
    out = out.concat(this.body(stmt.body, ctx, pad + '    '));
    this.loopDepth--;
    out.push(pad + '    await 角色.一步(ctx)');
    // ★被取消的协程必须**退出循环**★
    //   `一步()` 在 `_ctx._已取消` 时只是"让出一帧再返回"，循环会接着跑下一轮 ——
    //   实测：屏幕切走（或「停止」积木）之后，计数/克隆还在涨。
    //   GDScript 没有"取消协程"的原语，所以由生成器在每个循环末尾补一句 break：
    //   这才是「即走即取消」真正生效的地方（K4 的运行组语义要求旧屏幕的
    //   常驻脚本立刻停下，而不是留个后台循环继续克隆）。
    out.push(pad + '    if ctx._已取消: break');
    return out;
  }
  if (k === 'repeat_until') {
    out.push(pad + 'while not ' + this.cond(stmt.cond, ctx) + ':');
    this.loopDepth = (this.loopDepth || 0) + 1;
    out = out.concat(this.body(stmt.body, ctx, pad + '    '));
    this.loopDepth--;
    out.push(pad + '    await 角色.一步(ctx)');
    // ★被取消的协程必须**退出循环**★
    //   `一步()` 在 `_ctx._已取消` 时只是"让出一帧再返回"，循环会接着跑下一轮 ——
    //   实测：屏幕切走（或「停止」积木）之后，计数/克隆还在涨。
    //   GDScript 没有"取消协程"的原语，所以由生成器在每个循环末尾补一句 break：
    //   这才是「即走即取消」真正生效的地方（K4 的运行组语义要求旧屏幕的
    //   常驻脚本立刻停下，而不是留个后台循环继续克隆）。
    out.push(pad + '    if ctx._已取消: break');
    return out;
  }
  // 「等待直到<条件>」：直接展开成 while，而不是走 `等待直到(ctx, Callable)`。
  // 原因：反编译器给的是**布尔表达式**（如 cmp_lt(...)），不是可调用对象；
  // 展开成控制流既符合语义又避免生成 lambda。
  if (k === 'wait_until') {
    out.push(note('等待直到', stmt.blockId));
    out.push(pad + 'while not ' + this.cond(stmt.cond, ctx) + ':');
    out.push(pad + '    await 角色.一步(ctx)');
    // ★被取消的协程必须**退出循环**★
    //   `一步()` 在 `_ctx._已取消` 时只是"让出一帧再返回"，循环会接着跑下一轮 ——
    //   实测：屏幕切走（或「停止」积木）之后，计数/克隆还在涨。
    //   GDScript 没有"取消协程"的原语，所以由生成器在每个循环末尾补一句 break：
    //   这才是「即走即取消」真正生效的地方（K4 的运行组语义要求旧屏幕的
    //   常驻脚本立刻停下，而不是留个后台循环继续克隆）。
    out.push(pad + '    if ctx._已取消: break');
    return out;
  }
  if (k === 'if') {
    var brs = stmt.branches || [];
    for (var i = 0; i < brs.length; i++) {
      var b = brs[i];
      if (b.cond) out.push(pad + (i === 0 ? 'if ' : 'elif ') + this.cond(b.cond, ctx) + ':');
      else out.push(pad + 'else:');
      out = out.concat(this.body(b.body, ctx, pad + '    '));
    }
    if (!brs.length) out.push(pad + 'pass');
    return out;
  }
  if (k === 'break') {
    // ★K4 允许「退出循环」被摆在**循环之外**★（用户的"积木对查表"作品就是这么摆的）——
    //   而 GDScript 里循环外的 `break` 是**解析错误**：
    //     "Cannot use 'break' outside of a loop" —— 整个脚本文件都加载不了。
    if ((this.loopDepth || 0) > 0) return [pad + 'break'];
    return [pad + '# 退出循环（它不在任何循环里 —— K4 允许这样摆，这里无效果，但不能生成裸 break）'];
  }
  if (k === 'warp') {
    // 进入/退出 warp 只改 ctx 的深度计数，是**同步**函数 —— 不要写 await
    // （写了会得到 REDUNDANT_AWAIT，也会把"这段脚本"无谓地变成协程）。
    // 真正让出帧的地方是循环体末尾的 角色.一步(ctx)，它认识 warp 预算。
    out.push(pad + '角色.进入warp(ctx)');
    out = out.concat(this.body(stmt.body, ctx, pad));
    out.push(pad + '角色.退出warp(ctx)');
    return out;
  }
  if (k === 'return') {
    return [pad + (stmt.value ? 'return ' + this.expr(stmt.value, ctx) : 'return')];
  }
  // 广播（K4 的 `self_broadcast` / `self_broadcast_and_wait`，以及 Scratch 形态的 `broadcast`）
  //   ★K4 的广播块**自带一段脚本**★（截图里的 DO 体），
  //     语义 = **先把消息发出去，再立刻执行那段脚本**。
  //   ⚠ 以前这里只 push 了一行注释 + 体，**"发广播"这个动作根本没生成** ——
  //     于是「发送广播」的接收方永远收不到（用户实测到的就是"广播没发出去"）。
  //   「发送广播…并等待」是协程（用户注释原话），走 广播并等待()；普通广播不等。
  if (k === 'broadcast' || k === 'broadcast_body' || k === 'broadcast_body_wait' || k === 'broadcast_wait') {
    var 消息名 = stmt.message ? this.expr(stmt.message, ctx) : '""';
    var 要等 = (k === 'broadcast_body_wait' || k === 'broadcast_wait');
    out.push(note('发送广播' + (要等 ? '并等待' : ''), stmt.blockId));
    // 「发送广播」= 只发不等（K4 的语义：接收方各自跑，不等它们）；
    // 「发送广播并等待」= 等所有接收方的**这一段脚本跑完**才继续。
    if (要等) out.push(pad + (this.协程['广播并等待'] ? 'await ' : '') + '角色.广播并等待(ctx, ' + 消息名 + ')');
    else out.push(pad + '角色.广播(' + 消息名 + ')');
    if (stmt.body && stmt.body.length) out = out.concat(this.body(stmt.body, ctx, pad));
    return out;
  }
  if (k === 'nop') return [pad + 'pass'];

  // 询问并选择：要传「问题」+「选项数组」，走不了通用的 ARG 表（选项是个列表）。
  // 以前 ARG 里写的是 ['args']，而 IR 节点上根本没有 args 字段 →
  // 生成出来是 `角色.询问并选择(ctx, 0.0, 0.0)`，问题和选项全丢了。
  if (k === 'ask_choose') {
    var qExpr = this.expr(stmt.question, ctx);
    var chExpr = (stmt.choices || []).filter(function (c) { return c; })
      .map(function (c) { return self.expr(c, ctx); });
    out.push(note('询问并选择', stmt.blockId));
    out.push(pad + (this.协程['询问并选择'] ? 'await ' : '') + '角色.询问并选择(ctx, ' + qExpr + ', [' + chExpr.join(', ') + '])');
    if (stmt.body) out = out.concat(this.body(stmt.body, ctx, pad));
    return out;
  }

  // —— 类型层桩（反编译器没有专用分支的积木）——
  if (k === 'stub') {
    // 屏幕切换：不需要类型层桩，直接生成真调用（必须在 if (!tm) 之前）
    if (stmt.type === 'switch_to_screen') {
      var si = stmt.inputs || {};
      var sf = stmt.fields || {};
      var sArg = null;
      Object.keys(si).forEach(function (kk) { if (!sArg && si[kk]) sArg = si[kk]; });
      var sKey = Object.keys(sf).filter(function (kk) { return typeof sf[kk] === 'string' && sf[kk] !== ''; })[0];
      var sExpr = screenArg(self, sArg, sKey ? String(sf[sKey]) : '', ctx);
      out.push(note('切换到屏幕', stmt.blockId));
      // 切换屏幕是**协程**（转场要先盖幕、await 动画播完，再 change_scene_to_file）
      out.push(pad + (this.协程['切换屏幕'] ? 'await ' : '') + '角色.切换屏幕(' + sExpr + ')');
      return out;
    }
    var tm = MT.TYPE_METHODS[stmt.type];
    if (!tm) {
      this.report.unknown['type:' + stmt.type] = (this.report.unknown['type:' + stmt.type] || 0) + 1;
      return [pad + '# 未映射积木类型: ' + stmt.type, pad + 'pass'];
    }
    var tname = self.stubRenames[tm.name] || tm.name;
    // ★set_width_height_scale：轴信息在 fields.type 里，必须显式带出来★
    //   实测（高考呐 zundamon，_k4tmp_probe/probe_scale.js）：
    //     { "type":"set_width_height_scale",
    //       "fields": { "type": "height" },          ← 下拉框选的轴
    //       "shadows": { "value": <math_number 40> } } ← 目标百分比
    //   桩的通用形态 `名([值])` 只带得动数值、带不动"宽度/高度"，
    //   于是「将角色的高度设为 X」被当成等比缩放 —— 轴被静默丢掉。
    //   这里为它单独生成两个实参：轴 + 百分比。
    if (stmt.type === 'set_width_height_scale') {
      var 轴 = String((stmt.fields && (stmt.fields.type || stmt.fields.TYPE)) || '').toLowerCase();
      var 数值 = null;
      var 输入 = stmt.inputs || {};
      Object.keys(输入).forEach(function (n) { if (数值 === null && 输入[n]) 数值 = 输入[n]; });
      var 轴串 = (轴 === 'width' || 轴 === '宽' || 轴 === '宽度') ? '"width"' : '"height"';
      out.push(note('设置' + (轴串 === '"width"' ? '宽' : '高') + '缩放（轴感知）', stmt.blockId));
      out.push(pad + (self.协程[tname] ? 'await ' : '') + '角色.' + tname + '(' + 轴串 + ', ' + (数值 ? self.expr(数值, ctx) : '0.0') + ')');
      return out;
    }
    // 类型层桩统一签名：`func 名(参数: Array) -> void`。
    // 因为反编译器给这类块留下的输入顺序/个数都不确定，用数组兜住最稳。
    // 撞了 IR/OP 同名方法时桩会被改名（见 renamedStubNames），这里必须跟着改。
    // （tname 已在上面为 set_width_height_scale 分支提前算好）
    var targs = [];
    (stmt.inputs ? Object.keys(stmt.inputs) : []).forEach(function (n) {
      if (stmt.inputs[n]) targs.push(self.expr(stmt.inputs[n], ctx));
    });
    // ★报告口径：这个方法在 runtime 模板里已经有真实现了吗？★
    //   TYPE_METHODS 里标了 stub 的块，很多其实已经在 自带积木.gd 里实现了
    //   （只要它按"数组实参"的约定写就行，例如 设置宽高缩放）。
    //   那种情况下**不能**再报成"待你在角色类里实现" —— 那会让每次转换的
    //   报告都挂一条假缺口，掩盖真正的桩。
    if (self._模板已实现[tname] && !self._模板真桩[tname]) {
      self.report.已实现积木 = self.report.已实现积木 || {};
      self.report.已实现积木[stmt.type] = self.report.已实现积木[stmt.type] || { 方法名: tname, 次数: 0 };
      self.report.已实现积木[stmt.type].次数++;
      out.push(note(tname + '（数组实参）', stmt.blockId));
    } else {
      self.report.stubs[stmt.type] = self.report.stubs[stmt.type] || { 方法名: tname, 次数: 0 };
      self.report.stubs[stmt.type].次数++;
      self.report.stubs[stmt.type].方法名 = tname;
      out.push(note(tname + '（桩）', stmt.blockId));
    }
    out.push(pad + (self.协程[tname] ? 'await ' : '') + '角色.' + tname + '([' + targs.join(', ') + '])');
    return out;
  }

  // 变量赋值：直接写成员
  if (k === 'set_var' || k === 'change_var') {
    var vr = this.varRef(stmt.name, false);
    var lhs = vr.target + '.' + vr.name;
    out.push(note((k === 'set_var' ? '设置 ' : '增加 ') + stmt.name, stmt.blockId));
    var rhs = this.expr(stmt.value, ctx);
    if (k === 'set_var') {
      out.push(pad + lhs + ' = ' + rhs);
    } else {
      // ★「增加 X」不能无脑生成 `成员 += 值`★
      //   K4 是弱类型：`数字 + 文本` 在 K4 里合法（能转就转，否则拼接），
      //   而 GDScript 运行期直接报
      //     Invalid operands 'float' and 'String' in operator '+'.
      //   —— 该错误会**打断整个脚本的宏执行**（后面的积木全不跑），
      //   典型的触发点是"把列表里的项（可能是字符串）累加进一个数值变量"。
      //   取值类型能静态确定是数字时才内联原生 `+=`（代码干净、性能好）；
      //   其余一律退回运行时的 K4 弱类型语义（角色.算术运算）。
      if (staticKind(stmt.value) === 'n') {
        out.push(pad + lhs + ' += ' + rhs);
      } else {
        out.push(pad + lhs + ' = 角色.算术运算("add", ' + lhs + ', ' + rhs + ')');
      }
    }
    return out;
  }

  // 「告诉角色执行…」（tell / tell_sync）：目标是角色名，proc 是自动登记的过程名
  if (k === 'tell' || k === 'tell_sync') {
    out.push(note('告诉 ' + (stmt.target || '自己') + ' 执行', stmt.blockId));
    var tgt = stmt.target ? '角色.找(' + gdStr(String(stmt.target)) + ')' : '角色';
    var tname = procIdent(stmt.proc || '未命名积木');
    // 目标过程是不是协程由它的**函数体**决定（找不到定义时保守 await）
    out.push(pad + (this.过程是协程(stmt.proc) ? 'await ' : '') + tgt + '.' + tname + '(ctx)');
    return out;
  }

  // 自定义积木调用（语句）—— procCall 里已经带 await，这里不要再加
  if (k === 'call' || k === 'call_remote') {
    out.push(note('调用自定义积木 ' + (stmt.name || ''), stmt.blockId));
    out.push(pad + this.procCall(stmt.name, stmt.args, stmt.owner, ctx));
    return out;
  }
  // ★语句位置的「类型层方法调用」★
  //   IR 里的 `k:'op'` 在**取值**位置由 expr → opCall 处理，但语句位置以前没有分支
  //   → 直接落进下面的 `未映射语句积木` 生成 `pass`（K4 的「滑行坐标」就是这么丢的：
  //     转换日志里只有一行"未映射词条 k:op"，生成出来的代码该动的地方什么也不做）。
  //   opCall 返回值已经带 await（call() 无条件加），这里直接用。
  if (k === 'op') {
    // 注释里用**中文积木名**（查方法表），与生成代码里其它积木的注释风格一致
    var op名 = (MT.OP_METHODS[stmt.op] || {}).name || stmt.op;
    out.push(note(op名, stmt.blockId));
    out.push(pad + this.opCall(stmt, ctx));
    return out;
  }

  // —— 语句方法 ——
  var m = MT.IR_METHODS[k];
  if (!m) {
    this.report.unknown['k:' + k] = (this.report.unknown['k:' + k] || 0) + 1;
    return [pad + '# 未映射语句积木: ' + k, pad + 'pass'];
  }

  // play_sound 有 wait 标志，走不同的方法
  if (k === 'play_sound' && stmt.wait) {
    m = MT.IR_METHODS['play_sound_wait'] || { name: '播放声音并等待', params: [['ctx', 'ctx'], ['名称', 's']], ret: 'void', await: true };
    this.report.stubs.__play_sound_wait = true;
  }
  // 声音 / 造型名
  var argStrings = [];
  var a = ARG[k] || [];
  for (var i2 = 0; i2 < a.length; i2++) {
    var f = a[i2];
    if (f === 'name') {
      if (/^cloud_/.test(k)) {
        // ★云变量 / 云列表：直接用 K4 原始名字，**不要**走 varRef/NameSpace★
        //   云变量存在 K4Global 的字符串表里，不是 GDScript 成员。
        //   走 varRef 会被改名（`存档` -> `v_存档`，因为它和某个变量重名），
        //   而取值那边的 cloud_get 是表达式、走不到这里 ——
        //   结果同一个云变量「设置」用一个名字、「取值」用另一个，运行时对不上。
        argStrings.push(gdStr(String(stmt.name === undefined || stmt.name === null ? '' : stmt.name)));
      } else {
        var isList = /^list_/.test(k) || k === 'list_copy';
        var rr = this.varRef(stmt.name, isList);
        argStrings.push(rr.target + '.' + rr.name);
      }
    } else if (f === 'from' || f === 'to') {
      var rr2 = this.varRef(stmt[f], true);
      argStrings.push(rr2.target + '.' + rr2.name);
    } else {
      argStrings.push(this.expr(stmt[f], ctx));
    }
  }
  out.push(note(m.name, stmt.blockId));
  out.push(pad + this.call('角色', m, argStrings, ctx));
  return out;
};

Emitter.prototype.body = function (list, ctx, indent) {
  var self = this;
  var out = [];
  if (!list || !list.length) { out.push(indent + 'pass'); return out; }
  list.forEach(function (s) { out = out.concat(self.stmtLines(s, ctx, indent)); });
  return out;
};

/** 自定义积木调用：角色.积木名(ctx, 参数…) */
Emitter.prototype.procCall = function (rawName, argsNode, owner, ctx) {
  var name = procIdent(rawName || '未命名积木');
  this.usedProcs[name] = true;
  var cargs = [];
  if (argsNode && argsNode.k === 'args') cargs = argsNode.args || [];
  else if (Array.isArray(argsNode)) cargs = argsNode;
  var target = '角色';
  if (owner) target = '角色.找(' + gdStr(String(owner)) + ')';
  var parts = ['ctx'];
  for (var i = 0; i < cargs.length; i++) parts.push(this.expr(cargs[i], ctx));
  // 只在**这个自定义积木的函数体真的含 await** 时写 await（递归判定，见 过程是协程）
  return (this.过程是协程(rawName) ? 'await ' : '') + target + '.' + name + '(' + parts.join(', ') + ')';
};

/** 收集全工程的自定义积木定义（K4 里它们是跨角色全局可见的） */
function collectProcDefs(ir) {
  var defs = {};
  (ir.scenes || []).forEach(function (sc) {
    [sc].concat(sc.actors || []).forEach(function (ent) {
      (ent.procs || []).forEach(function (p) {
        if (!p || !p.name) return;
        var nm = procIdent(p.name);
        if (!defs[nm]) {
          defs[nm] = {
            name: nm, 原始名: p.name, params: p.params || [],
            body: p.body || [], 定义于: ent.name, 次数: 0
          };
        }
        defs[nm].次数++;
      });
    });
  });
  return defs;
}

/* ---------- 帽子脚本 ---------- */

Emitter.prototype.hatFileName = function (ev, index) {
  var label = HAT_LABEL[ev.kind] || '当事件';
  var extra = '';
  if (ev.kind === 'key') extra = String(ev.键 || ev.key || '');
  if (ev.kind === 'message') extra = String(ev.消息 || ev.message || '');
  if (ev.kind === 'swipe') extra = String(ev.direction || '');
  var base = label + (extra ? '_' + sanitize(extra, 'x') : '') + '_' + index;
  return sanitize(base, '帽子');
};

Emitter.prototype.emitHat = function (ev, body, hatId, actorName, ctx, actorK4Name) {
  var self = this;
  var key = HAT_KEY[ev.kind];
  var hat = key ? MT.HATS[key] : null;
  var base = hat ? hat.base : '帽子基类';
  var lines = [];
  lines.push('# K4-GENERATED  角色=' + actorName + '  事件=' + (ev.label || ev.kind) + '  hat=' + hatId);
  lines.push('extends ' + base);
  lines.push('');

  // 各帽子自己的配置字段
  if (ev.kind === 'key') {
    lines.push('func _配置键名() -> String:');
    lines.push('    return ' + gdStr(String(ev.键 || ev.key || '')));
    lines.push('');
    // ★按下 / 松开★（K4 的 fields.key_event_type = down | up）
    lines.push('func _配置按键事件() -> String:');
    lines.push('    return ' + gdStr(String(ev.keyEvent || 'down')));
    lines.push('');
  }
  if (ev.kind === 'message') {
    lines.push('func _配置消息() -> String:');
    lines.push('    return ' + gdStr(String(ev.消息 || ev.message || '')));
    lines.push('');
  }
  // 「当在手机中向 上/下/左/右 滑动」——方向由 fields.type 决定
  if (ev.kind === 'swipe') {
    lines.push('func _配置方向() -> String:');
    lines.push('    return ' + gdStr(String(ev.direction || 'up')));
    lines.push('');
  }
  // ★点击帽子：「被 点击 / 按下 / 放开」三档 + 「监听哪个角色」★
  //   ⚠ core.js 早就把 ev.tapType / ev.actor 读出来了，但**生成器从来没用过** ——
  //     于是同一角色下 4 个点击帽子生成的脚本一模一样，运行时只认"按下"：
  //     「当 X 被放开」变成了按下就触发，「当 [别的角色] 被点击」变成了监听自己。
  if (ev.kind === 'clicked') {
    lines.push('func _配置点击事件() -> String:');
    lines.push('    return ' + gdStr(String(ev.tapType || 'mouse_click')));
    lines.push('');
    // K4 里这个帽子可以写在 A 的脚本里、监听 B 被点击（触发的是 A 的这段脚本）。
    // 监听自己 → 空串，走 Area2D；监听别人 → 目标 K4 原名，走全局事件 + 包围盒。
    // ⚠ `fields.actor` 的"自己"在 K4 里是 `__self`，但 core.js 的 entityName()
    //   会把它换成中文「自己」—— 两种写法都要认，否则生成的是 `找("自己")`
    //   （找不到节点，白白多一轮查找）。
    var 监听目标 = String(ev.actor || '');
    var 自己K4名 = String(actorK4Name || '');
    if (监听目标 === '' || 监听目标 === '__self' || 监听目标 === '自己' ||
        监听目标 === 'self' || 监听目标 === 自己K4名) 监听目标 = '';
    lines.push('func _配置监听角色() -> String:');
    lines.push('    return ' + gdStr(监听目标));
    lines.push('');
  }
  // 条件帽子（当 <条件>）：把条件表达式直接生成 _条件()，
  // 帽子_条件 会拿它做 _process 轮询 + 边沿触发。
  if (ev.kind === 'condition_hat' && ev.condition) {
    lines.push('func _条件() -> bool:');
    lines.push('    var ctx: 角色基类.WarpCtx = 角色.新建上下文()');
    lines.push('    return ' + this.cond(ev.condition, {}));
    lines.push('');
  }
  // 计时器 / 响度帽子：阈值由 runtime 里的 @export 提供（子类再声明会同名遮蔽），
  // 这里只把比较表达式生成 _条件()。
  if ((ev.kind === 'timer' || ev.kind === 'loudness') && ev.condition) {
    lines.push('func _条件() -> bool:');
    lines.push('    var ctx: 角色基类.WarpCtx = 角色.新建上下文()');
    lines.push('    return ' + this.cond(ev.condition, {}));
    lines.push('');
  }

  lines.push('func _积木主体() -> void:');
  // ★必须用 _上下文()，不能用 角色.新建上下文()★（帽子基类【契约 B】）
  //   绿旗重启时，基类要靠"旧协程手上那个 ctx"去标记作废；
  //   生成代码自己 new 一个的话，旧协程就作废不掉 —— 会出现两个协程同时跑同一段积木。
  lines.push('    var ctx: 角色基类.WarpCtx = _上下文()');
  var bodyLines = this.body(body, ctx, '    ');
  // 去掉 body() 在空体时给的 pass（已有 ctx 行，不需要）
  if (bodyLines.length === 1 && bodyLines[0].trim() === 'pass') bodyLines = [];
  lines = lines.concat(bodyLines);
  return lines.join('\n') + '\n';
};

/* ---------- 角色脚本 ---------- */

Emitter.prototype.emitActorScript = function (ent) {
  var self = this;
  var lines = [];
  lines.push('# K4-GENERATED  角色脚本');
  lines.push('extends 角色类');
  lines.push('');
  // ★造型表（给 AnimatedSprite2D 用）★
  //   customs 是一个 AnimatedSprite2D，SpriteFrames 里**每个造型一帧**，
  //   帧号 = `_造型顺序()` 的下标（= K4 造型列表的原始顺序）。
  //   ⚠ SpriteFrames 的帧**不携带位移**，而 K4 每个造型有自己的 pivot
  //     （「旋转中心」相对图片中心的偏移）—— 所以偏移单独出一张表
  //     `_造型偏移()`，运行时切造型时套用到 customs.position 上。
  //   （以前是"一个造型一个 Sprite2D"，偏移画在各节点上；造型多的角色
  //     节点树会线性膨胀，Phigros 那种能拉出上万节点。）
  var 顺序 = [];
  var 偏移 = [];
  ((ent.styleInfo || {}).ids || []).forEach(function (sid) {
    var nm = (ent.styleInfo.byId || {})[sid] || sid;
    顺序.push(gdStr(String(nm)));
    var pv = ((ent.styleInfo || {}).pivots || {})[nm] || null;
    // 0.01px 以下当 0：K4 存的 pivot 常带 1e-6 级噪声
    var px = pv ? (Math.abs(Number(pv.x)) < 0.01 ? 0 : k4Number(pv.x)) : 0;
    var py = pv ? (Math.abs(Number(pv.y)) < 0.01 ? 0 : k4Number(pv.y)) : 0;
    偏移.push('Vector2(' + gdNum(-px) + ', ' + gdNum(-py) + ')');
  });
  if (!顺序.length) { 顺序.push(gdStr('默认造型')); 偏移.push('Vector2(0, 0)'); }
  lines.push('## 造型顺序（下标 = customs 的 SpriteFrames 帧号；按 K4 造型表原顺序）');
  lines.push('func _造型顺序() -> Array:');
  lines.push('    return [' + 顺序.join(', ') + ']');
  lines.push('');
  lines.push('## 每个造型的 pivot 偏移（相对图片中心；切造型时套用到 customs.position）');
  lines.push('func _造型偏移() -> Array:');
  lines.push('    return [' + 偏移.join(', ') + ']');
  lines.push('');
  var d = this.actorDecls[ent.id] || { vars: [], lists: [] };
  // ★本角色在 K4 里的**原名**★
  //   Godot 的节点名必须是合法标识符，而 K4 的角色名可以叫「变量独立性2(1)」——
  //   生成器把它清洗成节点名（"变量独立性2(1)" -> "变量独立性2_1_"），
  //   但 K4 的「<角色> 的 <属性>」「告诉 <角色> 执行 …」「克隆 <角色>」积木
  //   传来的都是**原名**。运行时的 角色基类.找() 靠这个函数把原名对回节点，
  //   缺了它跨角色访问直接丢目标（症状：读别的角色的变量恒为 0）。
  var k4名 = (this.names && this.names.actors) ? this.names.actors[ent.id] : '';
  if (k4名 === undefined || k4名 === null) k4名 = '';
  lines.push('## 本角色在 K4 里的原名（运行时 角色基类.找/取值 用它把 K4 名对回节点名）');
  lines.push('func _K4原名() -> String:');
  lines.push('    return ' + JSON.stringify(String(k4名)));
  lines.push('');
  // ★K4 变量名 -> 成员名★（跨角色读「<角色> 的 <变量>」时运行时按这张表找成员）
  var 变量别名 = [];
  (d.vars || []).forEach(function (v) {
    if (v.src && v.src.name !== undefined) 变量别名.push([String(v.src.name), v.decl]);
  });
  (d.lists || []).forEach(function (l) {
    if (l.src && l.src.name !== undefined) 变量别名.push([String(l.src.name), l.decl]);
  });
  if (变量别名.length) {
    lines.push('## K4 变量名 -> 成员名（成员名带 _v_/_l_ 命名空间前缀，见 emit.js 的 NS_PREFIXES）');
    lines.push('func _变量别名() -> Dictionary:');
    lines.push('    return {');
    变量别名.forEach(function (p) {
      lines.push('    ' + JSON.stringify(p[0]) + ': ' + JSON.stringify(p[1]) + ',');
    });
    lines.push('    }');
    lines.push('');
  }
  lines.push('func _ready() -> void:');
  // ★初始 transform / 可见性不再由脚本赋值★（用户要求：.tscn 是唯一真源）
  //   生成器已经把 K4 记录的 position / rotation / scale / visible 烘进
  //   <角色名>.tscn 的节点属性，运行时有 角色基类.初始化() 反读回填 k4_*。
  //   于是你在 Godot 编辑器里拖角色 / 改大小 / 改可见性，运行时就是这个值；
  //   以前这里会把编辑器里的改动原样覆盖回去。
  lines.push('    # 初始 transform / 可见性烘在 <角色名>.tscn 里，由 初始化() 反读');
  lines.push('    初始化()');
  // ★K4 的「角色组」→ Godot 原生 group★（用户提议，采纳）
  //   K4 的组是"一组角色的集合"（theatre.groups），而且**积木能引用它**
  //   （「将 <新角色组> 在 1 秒内 逐渐显示」的目标就是一个组）。
  //   运行时 自带积木.实体节点们() 用 get_nodes_in_group("K4组_<组名>") 取整组角色。
  (ent.groups || []).forEach(function (组名) {
    lines.push('    add_to_group(' + JSON.stringify('K4组_' + String(组名)) + ')');
  });
  if (d.vars.length || d.lists.length) {
    lines.push('    # 本角色的变量 / 列表初值（成员本身声明在 全局/角色变量.gd）');
    d.vars.forEach(function (v) {
      var lit = self.litOf(v.src.value);
      if (lit !== 'null') lines.push('    ' + v.decl + ' = ' + lit);
    });
    d.lists.forEach(function (l) {
      // 列表初值：小列表内联；超长的走 K4Text.读取列表（落到 <角色>/文本/列表N.txt）
      lines.push('    ' + l.decl + ' = ' + self.列表初值(l.src.value));
    });
  }
  return lines.join('\n') + '\n';
};

/* K4 里存的是 float32，读出来常带 1e-13 级噪声（5.68e-14、-0.0000030…）。
   这些既难看又没意义，统一在这里归零 + 收到 7 位有效数字。
   .gd 里的初值和 .tscn 里烘的属性都走这一个函数 —— 保证两边数值完全一致。 */
function k4Number(v) {
  var n = Number(v);
  if (!isFinite(n) || Math.abs(n) < 1e-4) return 0;
  return Number(n.toPrecision(7));
}

/** K4 存的是 Pixi 的 rotation（弧度，0 = 向右）；换算成 K4 方向（90 = 向右） */
function k4Direction(r) {
  var v = Number(r);
  if (!isFinite(v) || v === 0) return 90;
  return 90 - v * 180 / Math.PI;
}

/* ------------------------------------------------------------------ *
 * 把 K4 记录的初始 transform + 可见性**烘进 .tscn**
 *
 * 为什么需要：`初始化()` / `_apply_transform()` 只在**运行时**跑，
 * 编辑器不执行 _ready()，所以只写进 <角色名>.gd 的话，编辑器 2D 视图里
 * 所有角色都堆在 (0,0)、大小全是 100% —— 排版完全看不出来。
 * 烘进节点属性之后，编辑器里看到的就是运行时的排版（同一组公式、同一份数据）。
 *
 * 属性值必须是**字面量**（.tscn 是 Variant 解析器，不接受 deg_to_rad() 这种调用），
 * 所以 rotation 在这里先算成弧度。
 *
 * 公式必须和 runtime/全局/角色基类.gd 的 _apply_transform() 保持一致：
 *   position = Vector2(k4_x, -k4_y)              K4 原点居中、y 轴向上
 *   rotation = deg_to_rad(90 - k4_direction)     K4 方向 90 = 向右 = rotation 0
 *   scale    = k4_size_percent / 100
 * ------------------------------------------------------------------ */
/* 角色节点的初始 transform / 可见性 —— **唯一的初始状态真源**。
   运行时的 角色基类.初始化() 会把这些值反读回 k4_x / k4_y / k4_direction /
   k4_size_percent / k4_visible，所以 <角色名>.gd 的 _ready() 里**不再**赋值。
   在 Godot 编辑器里直接改这些属性即生效（改完不用碰脚本）。

   ⚠ .tscn 是 Variant 解析器，属性只能是字面量 —— 所以 rotation 在这里就算成弧度，
      且只在非 0 时写；scale / visible 同理只在偏离默认值时写。
      正因如此，初始化() 反读时每个字段都带默认回退（见 角色基类.初始化）。 */
function actorInitProps(ent) {
  var x = k4Number(ent.x);
  var y = k4Number(ent.y);
  var dir = k4Number(k4Direction(ent.rotation));
  var 系数 = (ent.scale === undefined || ent.scale === null) ? 100 : k4Number(ent.scale);
  if (!isFinite(系数)) 系数 = 100;
  var 弧度 = k4Number((90 - dir) * Math.PI / 180);
  var k = gdNum(系数 / 100);
  var props = [
    'position = Vector2(' + gdNum(x) + ', ' + gdNum(-y) + ')'
  ];
  if (Math.abs(弧度) > 1e-9) props.push('rotation = ' + gdNum(弧度));
  if (Math.abs(系数 - 100) > 1e-9) props.push('scale = Vector2(' + k + ', ' + k + ')');
  if (ent.visible === false) props.push('visible = false');
  return props;
}

function literalOf(v) {
  if (v === undefined || v === null) return 'null';
  if (typeof v === 'number') return gdNum(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return gdStr(v);
  if (Array.isArray(v)) return '[]';
  return 'null';
}

/* ---------- 场景（.tscn）---------- */

function Tscn() { this.ext = []; this.nodes = []; this.sub = []; }
Tscn.prototype.addExt = function (type, path) {
  var id = String(this.ext.length + 1);
  this.ext.push({ type: type, path: path, id: id });
  return id;
};
Tscn.prototype.node = function (name, type, parent, props, inst) {
  this.nodes.push({ name: name, type: type, parent: parent, props: props || [], inst: inst || null });
};
/** 加一个子资源（例如 SpriteFrames）。body 是资源体（不含 [sub_resource] 头）。返回 id */
Tscn.prototype.addSub = function (type, body) {
  var id = type + '_' + (this.sub.length + 1);
  this.sub.push('[sub_resource type="' + type + '" id="' + id + '"]\n' + body);
  return id;
};
Tscn.prototype.dump = function () {
  var out = [];
  out.push('[gd_scene load_steps=' + (this.ext.length + this.sub.length + 1) + ' format=3]');
  out.push('');
  this.ext.forEach(function (e) {
    out.push('[ext_resource type="' + e.type + '" path="' + e.path + '" id="' + e.id + '"]');
  });
  if (this.ext.length) out.push('');
  this.sub.forEach(function (s) { out.push(s); out.push(''); });
  this.nodes.forEach(function (n) {
    var parent = n.parent === undefined || n.parent === null ? null : n.parent;
    var attr = parent ? ' parent="' + parent + '"' : '';
    if (n.inst) {
      out.push('[node name="' + n.name + '"' + attr + ' instance=ExtResource("' + n.inst + '")]');
    } else {
      out.push('[node name="' + n.name + '" type="' + (n.type || 'Node2D') + '"' + attr + ']');
    }
    (n.props || []).forEach(function (p) { out.push(p); });
    out.push('');
  });
  return out.join('\n');
};

/* ---------- 主入口 ---------- */

function emitProject(ir, opts) {
  var em = new Emitter(ir, opts || {});
  em.collectDecls();

  // 1) 全局：变量容器
  var gl = [];
  em.curDir = '全局';      // 全局层的超长文本落 全局/文本/
  gl.push('# K4-GENERATED  全局变量 / 全局列表');
  gl.push('extends Node');
  gl.push('');
  gl.push('# —— 全局变量（真实成员变量，调试器里可见中文名）——');
  if (!em.globalDecls.vars.length) gl.push('# （本工程没有全局变量）');
  em.globalDecls.vars.forEach(function (v) { gl.push('var ' + v.decl + ': Variant = ' + em.litOf(v.src.value)); });
  gl.push('');
  gl.push('# —— 全局列表 ——');
  if (!em.globalDecls.lists.length) gl.push('# （本工程没有全局列表）');
  // ★列表初值★：K4 里列表是带初始内容的（成对的「1 a 2 b …」这种数据表很常见）。
  //   以前这里一律写 `Array = []` —— 初值整个丢掉（用户报的"列表没有初始值"）。
  //   超长的初值不内联：落到 文本/列表N.txt（JSON），在 _ready 里读一次。
  var 外置的全局列表 = [];
  em.globalDecls.lists.forEach(function (l) {
    var 初值 = em.列表初值(l.src.value);
    if (是外置读取(初值)) {
      gl.push('var ' + l.decl + ': Array = []        # 初值太长，_ready 里从外置文件读');
      外置的全局列表.push('    ' + l.decl + ' = ' + 初值);
    } else {
      gl.push('var ' + l.decl + ': Array = ' + 初值);
    }
  });
  gl.push('');
  gl.push('# —— 屏幕表（K4 屏幕名 -> Godot 场景路径），转换器生成 ——');
  gl.push('var 当前屏幕: String = ""');
  gl.push('var 当前背景: String = ""');
  // ★声音编号表★（用户实测：K4 的声音和造型一样，**既能用编号也能用名字**索引）
  //   K4 界面上把声音显示成 "1.倒水声 / 2.猫叫"，编号就是 audio_order 的顺序（1 开始）。
  //   运行时 播放声音()/停止声音() 收到**数字**时按这张表查名字，收到字符串按名字查 ——
  //   和 K4 的双索引语义一致。
  (function () {
    var raw = (ir.project && ir.project.raw) || {};
    var 音频表 = raw.audio || {};
    var 顺序 = Array.isArray(raw.audio_order) ? raw.audio_order : Object.keys(音频表);
    var 名单 = [];
    顺序.forEach(function (id) {
      var v = 音频表[id] || {};
      var nm = String(v.name || v.audio_name || id);
      if (名单.indexOf(nm) < 0) 名单.push(nm);
    });
    // 兜底：audio_order 里没列到的也补上，保证编号不丢声音
    Object.keys(音频表).forEach(function (id) {
      var nm = String((音频表[id] || {}).name || id);
      if (名单.indexOf(nm) < 0) 名单.push(nm);
    });
    gl.push('## ★声音编号表★：编号 = 本表顺序（1 开始），对应 K4 界面上的 "1.倒水声 / 2.猫叫"');
    gl.push('var 声音顺序: Array = [' + 名单.map(gdStr).join(', ') + ']');
  })();
  gl.push('');
  gl.push('const 屏幕表 := {');
  (ir.scenes || []).forEach(function (sc) {
    var d = sanitize(sc.name, '屏幕');
    var p = 'res://' + d + '/' + d + '.tscn';
    gl.push('    ' + gdStr(String(sc.name)) + ': ' + gdStr(p) + ',');
    if (d !== String(sc.name)) gl.push('    ' + gdStr(d) + ': ' + gdStr(p) + ',');
  });
  gl.push('}');
  gl.push('');
  gl.push('func 屏幕路径(_名: String) -> String:');
  gl.push('    if 屏幕表.has(_名):');
  gl.push('        return 屏幕表[_名]');
  gl.push('    return ""');
  gl.push('');
  // ★游戏屏幕容器★（全局/游戏屏幕.tscn）
  //   所有屏幕场景一开始就都挂在容器下，切换屏幕只改可见性 —— 见
  //   runtime/全局/游戏屏幕.gd 顶部的长注释（为什么不用 change_scene_to_file）。
  gl.push('# —— 游戏屏幕容器（转换器生成；主场景就是 全局/游戏屏幕.tscn）——');
  gl.push('signal 屏幕切换(名: String)');
  gl.push('var 游戏屏幕: Node = null');
  gl.push('var 屏幕节点: Dictionary = {}');
  gl.push('var 屏幕顺序: Array = [' + (ir.scenes || []).map(function (sc) { return gdStr(String(sc.name)); }).join(', ') + ']');
  gl.push('');
  gl.push('## 屏幕根脚本 _ready 时登记自己');
  gl.push('func 登记屏幕(_名: String, _节点: Node) -> void:');
  gl.push('    屏幕节点[_名] = _节点');
  gl.push('');
  gl.push('## 这个节点是不是"当前正在显示的屏幕"（帽子基类用它做屏幕限定）');
  gl.push('func 屏幕是否当前(_节点: Node) -> bool:');
  gl.push('    if _节点 == null:');
  gl.push('        return false');
  gl.push('    var 现 = 屏幕节点.get(当前屏幕, null)');
  gl.push('    if 现 == null:');
  gl.push('        return true          # 还没登记 / 不走容器（单独跑一个屏幕场景）→ 不拦');
  gl.push('    return _节点 == 现');
  gl.push('');
  gl.push('## 切到某个屏幕：只改可见性 + 当前屏幕名 + 画布指向，**不换场景**');
  gl.push('## ★K4 的运行组语义（用户确认）★：');
  gl.push('##   切走 = 该屏幕里**非全局**帽子的运行中协程「即走即取消」（不留后台循环）；');
  gl.push('##   切进 = 调用它们的 屏幕激活()，「当切换到当前屏幕」在这里重新跑一轮。');
  gl.push('func 切换屏幕到(_名: String) -> void:');
  gl.push('    var 目标 = 屏幕节点.get(_名, null)');
  gl.push('    if 目标 == null:');
  gl.push('        push_warning("切换屏幕：找不到屏幕 " + _名)');
  gl.push('        return');
  gl.push('    var 旧 = 屏幕节点.get(当前屏幕, null)');
  gl.push('    if 旧 != null and 旧 != 目标 and is_instance_valid(旧):');
  gl.push('        _通知屏幕(旧, false)          # 切走：取消非全局帽子的协程');
  gl.push('    当前屏幕 = _名');
  gl.push('    for k in 屏幕节点.keys():');
  gl.push('        var n = 屏幕节点[k]');
  gl.push('        if n != null and is_instance_valid(n) and n is CanvasItem:');
  gl.push('            (n as CanvasItem).visible = (str(k) == _名)');
  gl.push('    var 画 = 目标.get_node_or_null("屏幕绘制")');
  gl.push('    if 画 != null:');
  gl.push('        K4Canvas.设置画布(画)');
  gl.push('    屏幕切换.emit(_名)');
  gl.push('    if is_instance_valid(目标):');
  gl.push('        _通知屏幕(目标, true)         # 切进：需要重开的帽子重新跑一轮');
  gl.push('');
  gl.push('## 屏幕生命周期：_激活=false → 该屏幕被切走（取消运行中协程）；true → 它成为当前屏幕');
  gl.push('func _通知屏幕(_屏幕: Node, _激活: bool) -> void:');
  gl.push('    if _屏幕 == null or not is_instance_valid(_屏幕):');
  gl.push('        return');
  gl.push('    for n in _屏幕.find_children("*", "", true, false):');
  gl.push('        if n is 帽子基类:');
  gl.push('            if _激活:');
  gl.push('                (n as 帽子基类).屏幕激活()');
  gl.push('            else:');
  gl.push('                (n as 帽子基类).取消运行()');
  gl.push('');
  // 超长列表初值：声明处放不下（要运行时读盘），在这里补一个 _ready
  if (外置的全局列表.length) {
    gl.push('# —— 超长列表初值：从外置文件读（K4Text 会缓存，只读一次盘）——');
    gl.push('func _ready() -> void:');
    外置的全局列表.forEach(function (行) { gl.push(行); });
    gl.push('');
  }
  em.file('全局/全局变量.gd', gl.join('\n') + '\n');   // 先落一次，下面还会重写

  // —— 按名取值的三个 helper（兜底字典 + 前缀回落）——
  //   前缀必须和 runtime/全局/全局变量.gd 的 `变量前缀`/`列表前缀` 常量一致：
  //   成员是 `_v_原名` / `_l_原名`，所以 get(原名) 找不到，得先试前缀名。
  //   ★下面两行是**生成代码**，不是注释★ —— 改前缀时这里也要改。
  gl.push('const 变量前缀 := "_v_"');
  gl.push('const 列表前缀 := "_l_"');
  gl.push('');
  gl.push('# 兜底容器：没插入真实成员的变量放这里（转换器已插入的走成员）');
  gl.push('var _变量: Dictionary = {}');
  gl.push('var _列表: Dictionary = {}');
  gl.push('');
  gl.push('func 取值(_p_名: String) -> Variant:');
  gl.push('    if _变量.has(_p_名):');
  gl.push('        return _变量[_p_名]');
  gl.push('    var _p_成员: String = 变量前缀 + _p_名');
  gl.push('    if _脚本有(_p_成员):');
  gl.push('        return get(_p_成员)');
  gl.push('    if _列表.has(_p_名):');
  gl.push('        return _列表[_p_名]');
  gl.push('    return null');
  gl.push('');
  gl.push('func 设置(_p_名: String, _p_值: Variant) -> void:');
  gl.push('    if _变量.has(_p_名):');
  gl.push('        _变量[_p_名] = _p_值');
  gl.push('        return');
  gl.push('    var _p_成员: String = 变量前缀 + _p_名');
  gl.push('    if _脚本有(_p_成员):');
  gl.push('        set(_p_成员, _p_值)');
  gl.push('        return');
  gl.push('    _变量[_p_名] = _p_值');
  gl.push('');
  gl.push('func 列表(_p_名: String) -> Array:');
  gl.push('    if _列表.has(_p_名):');
  gl.push('        return _列表[_p_名]');
  gl.push('    var _p_成员: String = 列表前缀 + _p_名');
  gl.push('    if _脚本有(_p_成员):');
  gl.push('        var _p_旧 = get(_p_成员)');
  gl.push('        if _p_旧 is Array:');
  gl.push('            return _p_旧');
  gl.push('    var _p_新: Array = []');
  gl.push('    _列表[_p_名] = _p_新');
  gl.push('    if _脚本有(_p_成员):');
  gl.push('        set(_p_成员, _p_新)');
  gl.push('    return _p_新');
  gl.push('');
  gl.push('func _脚本有(_p_名: String) -> bool:');
  gl.push('    var _p_脚本 = get_script()');
  gl.push('    if _p_脚本 == null:');
  gl.push('        return false');
  gl.push('    for _p_项 in _p_脚本.get_script_property_list():');
  gl.push('        if String(_p_项["name"]) == _p_名:');
  gl.push('            return true');
  gl.push('    return false');
  gl.push('');
  gl.push('func 有(_p_名: String) -> bool:');
  gl.push('    if _变量.has(_p_名) or _列表.has(_p_名):');
  gl.push('        return true');
  gl.push('    return _脚本有(变量前缀 + _p_名) or _脚本有(列表前缀 + _p_名)');
  gl.push('');
  em.file('全局/全局变量.gd', gl.join('\n') + '\n');

  // 3) 场景（先跑：call() 会顺手把"实参类型校正"记进 report.实参类型转换）
  var scenes = ir.scenes || [];
  scenes.forEach(function (sc) { em.emitScene(sc); });

  // 2) 角色层的三个类（变量成员 / 自带积木桩 / 自定义积木真实现）—— 必须放在场景之后，
  //    这样 call() 里收集到的信息（实参类型转换等）已经齐了；分文件是为了能各自整体替换
  em.curDir = '全局';
  em.file('全局/角色变量.gd', emitVarLayer(ir, em));
  em.file('全局/角色自带积木.gd', emitBuiltinLayer(ir, em));
  em.file('全局/角色自定义积木.gd', emitProcLayer(ir, em));

  // 3.5) 超长文本：把攒下来的 文本/*.txt 真正落盘
  em.flushTextFiles();

  // 4) 积木映射.json
  em.report.argMismatch = dedupeObjects(em.report.argMismatch);
  em.report.argLoss = dedupeObjects(em.report.argLoss);
  em.report.实参类型转换 = dedupeStrings(em.report.实参类型转换);
  em.file('全局/积木映射.json', JSON.stringify({
    源文件: em.project.name,
    版本: em.project.version,
    方法表条数: {
      IR: Object.keys(MT.IR_METHODS).length,
      OP: Object.keys(MT.OP_METHODS).length,
      类型层: Object.keys(MT.TYPE_METHODS).length
    },
    改名: em.report.renames,
    桩: em.report.stubs,
    未映射: em.report.unknown,
    实参个数不匹配: em.report.argMismatch,
    实参被截断: em.report.argLoss,
    实参类型转换: em.report.实参类型转换,
    await声明不一致: em.report.await声明不一致 || [],
    桩改名: em.report.桩改名
  }, null, 2) + '\n');

  // 4.8) ★游戏屏幕容器★：把所有屏幕场景按 K4 的顺序实例进去，只显示第一个。
  //      project.godot 的主场景就是它；切换屏幕 = 改 visible（不换场景）。
  //      为什么这么做：见 runtime/全局/游戏屏幕.gd 顶部注释
  //      （K4 的屏幕=运行组，切屏幕不该销毁另一组的状态；所有屏幕同时在树里，
  //       广播才能按屏幕根隔离、帽子才能按"当前屏幕"限定）。
  (function () {
    var t = new Tscn();
    var 脚本id = t.addExt('Script', 'res://全局/游戏屏幕.gd');
    t.node('游戏屏幕', 'Node2D', null, ['script = ExtResource("' + 脚本id + '")']);
    scenes.forEach(function (sc, i) {
      var d = sanitize(sc.name, '屏幕');
      var inst = t.addExt('PackedScene', 'res://' + d + '/' + d + '.tscn');
      var 节点名 = sanitize(String(sc.name), '屏幕' + (i + 1));
      var props = [];
      if (i > 0) props.push('visible = false');       // 只显示第一个（初始屏幕）
      t.node(节点名, null, '.', props, inst);
    });
    em.file('全局/游戏屏幕.tscn', t.dump());
  })();

  // 5) project.godot
  em.file('project.godot', emitProjectGodot(em, scenes));

  return { files: em.files, report: em.report, emitter: em };
}

function dedupeStrings(arr) {
  var seen = {}, out = [];
  (arr || []).forEach(function (s) { if (!seen[s]) { seen[s] = 1; out.push(s); } });
  return out;
}

function dedupeObjects(arr) {
  var seen = {}, out = [];
  (arr || []).forEach(function (o) {
    var k = JSON.stringify(o);
    if (!seen[k]) { seen[k] = 1; out.push(o); }
  });
  return out;
}

Emitter.prototype.emitScene = function (sc) {
  var self = this;
  var sceneDir = sanitize(sc.name, '屏幕');
  var rootPath = sceneDir + '/' + sceneDir + '.tscn';
  var spareCount = 0;      // 备份了多少段悬空块文本（用于汇总提示）

  var tscn = new Tscn();
  // 屏幕绘制（第一个子节点 → 画在角色后面）
  var canvasScript = self.ns.assign('脚本', '屏幕绘制', 's_');
  var tscnScript = tscn.addExt('Script', 'res://' + sceneDir + '/屏幕绘制.gd');
  var rootScriptPath = 'res://' + sceneDir + '/' + sceneDir + '.gd';
  var rootScriptId = tscn.addExt('Script', rootScriptPath);

  tscn.node(sceneDir, 'Node2D', '', ['script = ExtResource("' + rootScriptId + '")']);
  // ===========================================================================
  // ★节点顺序 = 绘制顺序★（Godot 先画前面的兄弟节点，后画的盖在上面）
  //
  //   舞台层     K4 的「舞台实体」（scene 自己 —— 背景板的造型就挂在它身上）
  //   屏幕绘制   画笔层
  //   基础角色层 / 克隆体层   角色
  //
  //   这才是 K4/Scratch 的层序：**舞台背景 → 画笔 → 角色**。
  //
  //   以前没有 舞台层，舞台实体和普通角色一起塞在 基础角色层 里，于是
  //   背景板（一张铺满整个舞台的图）正好盖在 屏幕绘制 上面 —— 而 屏幕绘制
  //   的 z_index=-100 只对**同一个父节点下**的兄弟有效，管不到别的层。
  //   实测症状（画笔和嵌套循环测试）：画笔的 指令 数组一直在涨
  //   （240 帧积到 240 条线段、颜色粗细都对），屏幕上却一条线都看不到，
  //   录像全白、只有一个紫色角色在动。把背景板角色手动 visible=false 之后
  //   曲线立刻出现 —— 根因坐实。
  // ===========================================================================
  var 舞台宽 = Number(self.project.size && self.project.size.width) || 480;
  var 舞台高 = Number(self.project.size && self.project.size.height) || 360;
  var 舞台中心 = 'Vector2(' + gdNum(舞台宽 * 0.5) + ', ' + gdNum(舞台高 * 0.5) + ')';
  // ★舞台层：给一个很低的 z_index★
  //   为的是给「移到画笔图层 下方」(layer_with_pen = below) 留出位置：
  //     z=-100 舞台层（背景板，永远最底）
  //     z=  0  屏幕绘制（画笔层）
  //     z=  0  角色（树顺序在画笔层之后 → 默认在画笔之上）
  //     z= -50 「移到画笔图层 下方」的角色 → 在画笔之下、背景之上
  //   注意 屏幕绘制 自己**绝对不能**再设 z_index（见下面那条注释）。
  tscn.node('舞台层', 'Node2D', '.', ['position = ' + 舞台中心, 'z_index = -100']);
  // ⚠ 这里**绝对不能**写 z_index —— 哪怕是个看起来无害的 -100。
  //   Godot 的绘制顺序规则是：同一个 CanvasLayer 内**先按 z_index 全局排序**，
  //   z_index 相同的才按树顺序。所以"画笔层 z_index = -100"会把画笔压到
  //   **所有 z_index = 0 的东西底下**，而 K4 的背景板恰恰就是一个 z_index = 0
  //   的普通角色 —— 于是背景板又把画笔盖住了（这正是第二轮的翻车现场：
  //   舞台层加对了，线还是看不见）。层序**只靠节点顺序**表达就够了。
  tscn.node('屏幕绘制', 'Node2D', '.', ['script = ExtResource("' + tscnScript + '")']);
  // 「基础角色层」的 local (0,0) 就是舞台中心 —— 运行时 角色基类._对齐舞台层()
  // 会把它设成 视口尺寸*0.5，而视口尺寸 == K4 舞台尺寸，所以这里烘的就是同一个值。
  // 不烘的话编辑器里整层贴在 (0,0)，排版全歪。
  tscn.node('基础角色层', 'Node2D', '.', ['position = ' + 舞台中心]);
  tscn.node('克隆体层', 'Node2D', '.', []);

  // 舞台本身也当作一个"角色"处理（K4 的舞台有造型 + 脚本）
  var entities = [sc].concat(sc.actors || []);

  entities.forEach(function (ent) {
    var isStage = (ent === sc);
    var actorName = sanitize(ent.name, '角色');
    // 目录名：舞台常与屏幕同名（都叫"背景"），那样会出现 背景/背景/背景.gd 套娃 → 目录用「舞台」。
    // 但**节点名必须保留 K4 原名**：跨角色调用 角色.找("背景") 靠名字定位。
    var actorDir = (isStage && actorName === sceneDir) ? '舞台' : actorName;
    // 舞台实体单独挂 舞台层（排在画笔层之下）；其它角色挂 基础角色层。
    // 跨角色查找 角色.找("背景") 由 角色基类.找() 兜底到整个屏幕，不受影响。
    var parentPath = isStage ? '舞台层' : '基础角色层';
    var hatCount = 0;
    // 这个角色名下所有脚本里出现的超长文本，都落到 <屏幕>/<角色目录>/文本/
    self.curDir = sceneDir + '/' + actorDir;

    // 角色 .tscn
    var actorTscn = new Tscn();
    actorTscn.node(actorName, 'Node2D', '', ['script = ExtResource("__ACTOR__")']);
    // ★customs = 一个 AnimatedSprite2D★（SpriteFrames 里**每个造型一帧**）
    //   以前是"一个造型一个 Sprite2D 子节点"：节点树随造型数线性膨胀
    //   （几百造型的角色能拉出上万节点，切屏/克隆/遍历全都跟着变慢）。
    //   帧号 = K4 造型表顺序；每个造型的 pivot 偏移由角色脚本的 `_造型偏移()`
    //   提供，运行时切造型时套用（SpriteFrames 的帧不携带位移）。
    var styleInfo = ent.styleInfo || {};
    var customs = [];
    (styleInfo.ids || []).forEach(function (sid) {
      var nm = styleInfo.byId[sid] || sid;
      var f = (styleInfo.files || {})[nm] || '';
      var pv = (styleInfo.pivots || {})[nm];
      customs.push({
        原名: String(nm),
        // res://assets/styles/<owner>/<file> -> <file>（convert.js 会搬到 角色custom/<演员>/）
        file: f ? f.replace(/^res:\/\/.*\//, '') : '',
        pivot: pv || null
      });
    });
    if (!customs.length) customs.push({ 原名: '默认造型', file: '', pivot: null });
    // 当前造型（K4 的 current_style）-> 帧号
    var 当前造型 = String(ent.current_style || '');
    if (!当前造型) 当前造型 = customs[0].原名;
    var 当前帧 = 0;
    for (var ci = 0; ci < customs.length; ci++) {
      if (customs[ci].原名 === 当前造型) { 当前帧 = ci; break; }
    }
    var 帧项 = [];
    customs.forEach(function (c) {
      var 项 = '{ "duration": 1.0';
      if (c.file) {
        var tid = actorTscn.addExt('Texture2D', 'res://' + sceneDir + '/角色custom/' + actorDir + '/' + c.file);
        项 += ', "texture": ExtResource("' + tid + '")';
      }
      项 += ' }';
      帧项.push(项);
    });
    var sfid = actorTscn.addSub('SpriteFrames',
      'animations = [{\n' +
      '"frames": [' + 帧项.join(', ') + '],\n' +
      '"loop": true,\n' +
      '"name": "default",\n' +
      '"speed": 5.0\n' +
      '}]');
    var 造型属性 = [
      'sprite_frames = SubResource("' + sfid + '")',
      'animation = "default"',
      'frame = ' + 当前帧
    ];
    // ★锚点（K4 的「旋转中心」）★：角色 x/y 定位的是旋转中心，所以要让它相对
    //   原点偏移 -pivot。这里把**当前造型**的偏移烘进 tscn（编辑器里也能看到
    //   正确排版）；运行时切造型由 _造型偏移() 表逐帧套用（见 角色基类._应用造型）。
    var 当pivot = customs[当前帧] ? customs[当前帧].pivot : null;
    if (当pivot) {
      var pvx = Math.abs(Number(当pivot.x)) < 0.01 ? 0 : k4Number(当pivot.x);
      var pvy = Math.abs(Number(当pivot.y)) < 0.01 ? 0 : k4Number(当pivot.y);
      if (pvx !== 0 || pvy !== 0) {
        造型属性.push('position = Vector2(' + gdNum(-pvx) + ', ' + gdNum(-pvy) + ')');
      }
    }
    actorTscn.node('customs', 'AnimatedSprite2D', '.', 造型属性);

    // 帽子
    var hats = [];
    (ent.scripts || []).forEach(function (s) {
      hatCount++;
      var fname = self.hatFileName(s.event, hatCount);
      var key = HAT_KEY[s.event.kind];
      var hatMeta = key ? MT.HATS[key] : null;
      var gdPath = sceneDir + '/' + actorDir + '/' + fname + '.gd';
      self.file(gdPath, self.emitHat(s.event, s.body, s.hatId, actorName, {}, String(ent.name || '')));

      if (hatMeta && hatMeta.needsScene) {
        // 点击帽子：带 Area2D + CollisionPolygon2D 的小场景
        var hs = new Tscn();
        hs.addExt('Script', 'res://' + gdPath);
        hs.node(fname, 'Node2D', '', ['script = ExtResource("1")']);
        hs.node('点击区', 'Area2D', '.', ['input_pickable = true']);
        hs.node('碰撞形状', 'CollisionPolygon2D', '点击区', ['polygon = PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)']);
        self.file(sceneDir + '/' + actorDir + '/' + fname + '.tscn', hs.dump());
        hats.push({ name: fname, scene: 'res://' + sceneDir + '/' + actorDir + '/' + fname + '.tscn' });
      } else {
        hats.push({ name: fname, script: 'res://' + gdPath });
      }
    });

    // 角色脚本
    self.file(sceneDir + '/' + actorDir + '/' + actorName + '.gd', self.emitActorScript(ent));

    // 悬空块备份：<角色>/预备块.gd —— **不挂载到任何节点上**，纯粹存文本
    if (ent.spare && ent.spare.length) {
      self.file(sceneDir + '/' + actorDir + '/预备块.gd', emitSpareScript(ent, self));
      spareCount += ent.spare.length;
    }

    // 把角色 .tscn 落地（脚本 id 在第一行，先占位再回填）
    var actorScriptId = actorTscn.addExt('Script', 'res://' + sceneDir + '/' + actorDir + '/' + actorName + '.gd');
    actorTscn.nodes[0].props = ['script = ExtResource("' + actorScriptId + '")'];
    // 帽子节点加到角色场景里
    hats.forEach(function (h) {
      if (h.scene) {
        // ⚠ parent:'.' 不能省！少了它 Godot 会把这行当成**第二个根节点**，
        // 报 "Invalid scene: node X does not specify its parent node"，
        // 然后整个（引用它的）场景加载失败 —— 编辑器里就是"场景文件似乎无效/损坏"。
        // 只有"带场景的帽子"（点击帽子）走这条分支，所以症状只在有点击帽子的角色上出现。
        actorTscn.nodes.push({ name: h.name, inst: actorTscn.addExt('PackedScene', h.scene), parent: '.' });
      } else {
        var sid = actorTscn.addExt('Script', h.script);
        actorTscn.nodes.push({ name: h.name, type: 'Node2D', parent: '.', props: ['script = ExtResource("' + sid + '")'] });
      }
    });
    self.file(sceneDir + '/' + actorDir + '/' + actorName + '.tscn', actorTscn.dump());

    // 屏幕场景里实例化该角色
    // 初值烘进节点属性 → 编辑器里也能看到正确的位置/朝向/大小/可见性
    var inst = tscn.addExt('PackedScene', 'res://' + sceneDir + '/' + actorDir + '/' + actorName + '.tscn');
    tscn.node(actorName, null, parentPath, actorInitProps(ent), inst);
  });

  // 屏幕脚本
  var sl = [];
  sl.push('# K4-GENERATED  屏幕脚本');
  sl.push('extends Node2D');
  sl.push('');
  sl.push('func _ready() -> void:');
  sl.push('    # ★登记到游戏屏幕容器★（切换屏幕时按屏幕名找节点、改它的 visible）');
  sl.push('    #   注意：这里**不再**抢着设置 K4Global.当前屏幕 —— 容器里所有屏幕');
  sl.push('    #   都会 _ready，谁最后跑就把当前屏幕覆盖成谁（老实现就是这么错的）。');
  sl.push('    K4Global.登记屏幕(' + gdStr(String(sc.name)) + ', self)');
  sl.push('    # 兜底：没走容器（单独 run 这个屏幕场景，或在编辑器里直接打开）');
  sl.push('    if K4Global.游戏屏幕 == null:');
  sl.push('        K4Canvas.设置画布($屏幕绘制)');
  sl.push('        K4Global.当前屏幕 = ' + gdStr(String(sc.name)));
  em_file(this, sceneDir + '/' + sceneDir + '.gd', sl.join('\n') + '\n');

  if (spareCount) {
    self.report.spare = (self.report.spare || 0) + spareCount;
  }

  em_file(this, rootPath, tscn.dump());
};

function em_file(em, p, c) { em.file(p, c); }

/* ------------------------------------------------------------------ *
 * 角色层的生成：**两层分开写**
 *
 *   角色基类            runtime/全局/角色基类.gd   引擎胶水 + K4 语义（我们维护）
 *    └ 角色自带积木       全局/角色自带积木.gd        ★本函数：自带积木的桩
 *       └ 角色自定义积木   全局/角色自定义积木.gd      ★emitProcLayer：K4 自定义积木真实现
 *          └ 角色类        全局/角色类.gd             ★用户文件，永不覆盖
 *             └ <角色名>.gd
 *
 * 为什么要拆成两层：
 *   · K4 的「自带积木」和「自定义积木」是两种完全不同的东西 ——
 *     前者是引擎能力的桩（要你去实现 Godot 侧行为），后者是**用户自己写的 K4 代码**
 *     （转换器能给出真实现）。混在一个文件里，想整体替换其中一类就得连另一类一起抄。
 *   · 拆开之后：复制 全局/角色自带积木.gd 就能整文件接管全部自带积木；
 *     自定义积木那层照旧由转换器重写，互不干扰。
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 角色层的生成：**三层分开写**
 *
 *   角色基类            runtime/全局/角色基类.gd   引擎胶水 + K4 语义（我们维护）
 *    └ 角色变量          全局/角色变量.gd           ★emitVarLayer：变量/列表**成员声明**
 *       └ 角色自带积木    全局/角色自带积木.gd        ★emitBuiltinLayer：自带积木的桩
 *          └ 角色自定义积木 全局/角色自定义积木.gd     ★emitProcLayer：K4 自定义积木真实现
 *             └ 角色类      全局/角色类.gd            ★用户文件，永不覆盖
 *                └ <角色名>.gd
 *
 * 为什么把「变量/列表声明」也单独一层：
 *   · 它是**数据**（每个角色实例各一份的成员），不是行为；
 *   · 全部角色共用一个类，所以这些成员必须声明在共同祖先上 ——
 *     但它和"自带积木的桩"混在一起时，想整体替换自带积木就得连变量表一起抄；
 *   · 分开之后，`角色变量.gd` 就是一份干净的"角色数据表"，
 *     想换掉/扩展角色状态只动这一层。
 * ------------------------------------------------------------------ */

function emitVarLayer(ir, em) {
  var L = [];
  L.push('# K4-GENERATED  角色变量（每次转换都会**覆盖**这个文件）');
  L.push('#');
  L.push('# 这一层只放**数据**：K4 里各个角色的「局部变量 / 局部列表」成员声明。');
  L.push('# 全部角色共用一个类，所以这些成员必须集中声明在共同祖先上 ——');
  L.push('# 这样生成代码可以直接写 `角色.v_分数` / `角色.l_背包`（静态检查过得去、');
  L.push('# 调试器"变量"面板里也是中文名）。每个角色实例各有一份，互不影响；');
  L.push('# 各角色的**初值**由 <角色名>.gd 的 _ready() 赋。');
  L.push('#');
  L.push('# 继承链：');
  L.push('#   角色基类（引擎胶水 + K4 语义，runtime 提供）');
  L.push('#     └ 角色变量（本文件 · 每次覆盖）      ← 数据：变量 / 列表成员');
  L.push('#         └ 角色自带积木（每次覆盖）      ← 行为：自带积木的桩');
  L.push('#             └ 角色自定义积木（每次覆盖）← K4 自定义积木的真实现');
  L.push('#                 └ 角色类（★你写的文件 · 永不覆盖）');
  L.push('#                     └ <角色名>.gd');
  L.push('class_name 角色变量');
  L.push('extends 角色基类');
  L.push('');
  L.push('# ================= 变量 / 列表 =================');
  var lvNames = em ? Object.keys(em.localVars).sort() : [];
  var llNames = em ? Object.keys(em.localLists).sort() : [];
  var gvNames = em ? Object.keys(em.globalVars || {}).sort() : [];
  var glNames = em ? Object.keys(em.globalLists || {}).sort() : [];
  if (!lvNames.length && !llNames.length) L.push('# （本工程没有角色局部变量 / 列表）');
  lvNames.forEach(function (n) {
    var init = em ? em.litOf(em.localVars[n].src.value) : literalOf(em.localVars[n].src.value);
    L.push('var ' + n + ': Variant = ' + init);
  });
  llNames.forEach(function (n) { L.push('var ' + n + ': Array = []'); });
  // ---- 归属索引（纯注释，不改语义）----
  // 为什么要列：所有角色的局部变量**共用同一批成员声明**（原因见文件头：
  // 生成代码写 `角色._v_x`，而 `角色` 的静态类型是 角色类 ——
  // 声明一旦放到派生的 <角色名>.gd 里，Godot 静态检查就会报"找不到成员"）。
  // 于是"哪个变量属于哪个角色"从上面那张声明表里看不出来，这里补一张索引。
  // ⚠ 同名变量（本工程里的 x / y / t / a / j / n）在 K4 里是**多个独立变量**，
  //   这里共用同一个成员名 —— 成员是"每实例一份"，所以**值互不影响**；
  //   各自的初值由 <角色名>.gd 的 _ready() 赋（见每个角色脚本末尾）。
  if (em && em.actorDecls && ir && ir.names && ir.names.actors) {
    var 归属行 = [];
    Object.keys(em.actorDecls).sort().forEach(function (aid) {
      var d = em.actorDecls[aid] || {};
      var 列表 = (d.vars || []).map(function (v) { return v.decl; })
        .concat((d.lists || []).map(function (l) { return l.decl; })).sort();
      if (列表.length) 归属行.push('#   ' + (ir.names.actors[aid] || aid) + ' : ' + 列表.join(' '));
    });
    if (归属行.length) {
      L.push('');
      L.push('# ---- 归属索引：每个角色各自拥有哪些变量 / 列表 ----');
      L.push('#   同名变量会出现在多个角色后面 —— 它们共用同一个成员名，但值各自独立。');
      归属行.forEach(function (s) { L.push(s); });
    }
  }
  L.push('');
  L.push('# 全局变量 / 全局列表在 autoload 上（全局/全局变量.gd）：' +
    ((gvNames.length + glNames.length) ? (' ' + gvNames.concat(glNames).join(' ')) : ' （无）'));
  L.push('');
  return L.join('\n') + '\n';
}

function emitBuiltinLayer(ir, em) {
  // 签名表由 buildSignatures() 统一合并（IR + OP + 族 + 类型层桩改名后）。
  // 生成器里的每个调用点也读同一张表 —— 这是"接口声明"与"调用实参"必须一致的关键。
  var byName = (em && em.sig) ? em.sig : buildSignatures();
  // BASE_METHODS 里的方法基类已经实现 —— 子类不能再声明一遍，
  // 否则 Godot 报 "The function signature doesn't match the parent"。

  var 模板 = 读自带积木模板();
  var L = [];
  var 已有 = {};

  if (模板) {
    // 模板里已经实现了哪些方法（顶层 func 名）
    var re = /^func[ \t]+([^ \t(]+)[ \t]*\(/gm;
    var m;
    while ((m = re.exec(模板)) !== null) 已有[m[1]] = 1;
    L.push(模板.replace(/\s+$/, ''));
  } else {
    // 模板读不到也不能失败 —— 退回"纯桩"，保证工程仍然能跑
    L.push('# K4-GENERATED  角色自带积木（每次转换都会**覆盖**这个文件）');
    L.push('# ⚠ 没找到 runtime/模板/自带积木.gd，本文件退化成纯桩（全部 pass）。');
    L.push('class_name 角色自带积木');
    L.push('extends 角色变量');
    L.push('');
  }

  // 模板里没有、但映射表里有的方法 -> 在末尾补桩。
  // （最差也只是个 pass，符合"转换器永不失败"；把实现补进模板后这一段会自动消失。）
  var emitted = {};
  Object.keys(byName).forEach(function (n) {
    if (BASE_METHODS[n]) return;      // 基类已有实现，跳过
    if (已有[n]) return;              // 模板里已经实现了
    // ★跳过 `xxx_桩`★ —— 那是 renamedStubNames() 给 TYPE_METHODS 里的重名桩改的名
    //   （调用形态是 `角色.名([...])` 一个 Array 实参，和这一层的签名完全不同）。
    //   把它们追加进来会生成一个**签名错误**的同名方法，把真的那个遮蔽掉。
    if (/_桩$/.test(n)) return;
    var mm = byName[n];
    var cat = mm.cat || '其它';
    if (mm.stub) cat = cat.indexOf('桩') >= 0 ? cat : cat + '（桩）';
    emitted[cat] = emitted[cat] || [];
    emitted[cat].push(mm);
  });

  var 缺数 = 0;
  Object.keys(emitted).forEach(function (cat) { 缺数 += emitted[cat].length; });
  if (缺数) {
    L.push('');
    L.push('# =====================================================================');
    L.push('# 以下 ' + 缺数 + ' 个方法**不在模板里** —— 映射表里有、但');
    L.push('# runtime/模板/自带积木.gd 还没有实现。转换器在这里补桩，保证不会漏。');
    L.push('# 把实现补进模板之后，这一段会自动消失。');
    L.push('# =====================================================================');
    Object.keys(emitted).forEach(function (cat) {
      L.push('');
      L.push('# ================= ' + cat + ' =================');
      emitted[cat].sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (mm) {
        var ps = (mm.params || []).map(function (p, i) {
          // 参数类型统一放宽成 Variant（ctx 除外）。
          // 原因：K4 是动态类型语言，反编译器给不出每个调用点的确切类型；
          // 收紧类型会同时造成**解析期**和**运行期**的实参类型错误。
          // 参数名统一 `_p_` 前缀（与 K4 变量 `_v_`/`_l_` 隔离，见 NS_PREFIXES）。
          var t = p[1] === 'ctx' ? 'ctx' : 'v';
          return (t === 'ctx' ? 'ctx' : '_p_' + sanitize(p[0], 'p' + i)) + ': ' + (GTYPE[t] || 'Variant');
        });
        var ret = GRET[mm.ret] || 'void';
        L.push('func ' + mm.name + '(' + ps.join(', ') + ') -> ' + ret + ':');
        // ★缩进必须是 Tab★
        //   runtime/模板/自带积木.gd 全篇用 Tab，这里是**往那个文件后面追加**。
        //   以前这两行写的是 4 个空格 —— GDScript 一旦在同一文件里混用 Tab 和空格，
        //   直接报 "Used tab character for indentation instead of space as used before
        //   in the file"，**整个 角色自带积木.gd 加载失败**，于是继承链断掉，
        //   所有角色脚本都跟着报
        //   "Could not resolve super class inheritance from 角色类" ——
        //   看起来像转换器把继承链写坏了，其实只是两个空格。
        // ★桩体是**同步**的★（不再刻意 await 一帧）
        //   调用点现在按"这个方法在实现里是不是协程"来决定写不写 await
        //   （见 call() 与 lib/k4/async.js）。桩里没有 await → 它不是协程
        //   → 调用点也不 await：两边一致，既不会有 MISSING_AWAIT 也不会有
        //   REDUNDANT_AWAIT。
        //   "重复执行 + 空桩"也不会失控：循环体末尾有 `await 角色.一步(ctx)`，
        //   它每轮都真的让出一帧（warp 段内则受 warp 预算约束，与 K4 一致）。
        //   想把这个桩填成协程？把它写进 runtime/模板/自带积木.gd 即可 ——
        //   扫描器会发现里面新增的 await，调用点自动跟着加 await。
        if (ret === 'void') L.push('\tpass');
        else L.push('\treturn ' + (GDEF[mm.ret] || 'null'));
        L.push('');
      });
    });
  }

  return L.join('\n') + '\n';
}

/* 自定义积木层：全局/角色自定义积木.gd
   K4 的自定义积木是**全局**的：即使在某个角色上定义，任何角色都能调用。
   过程体是**以调用者的身份**运行的（K4 里跨角色调用时，局部变量会按调用者的
   实体去解析 —— 这正是 K4 里"别的角色调用就报错"的原因）。
   所以下面每个函数体第一行是 `var 角色 := self`。 */
function emitProcLayer(ir, em) {
  var L = [];
  L.push('# K4-GENERATED  角色自定义积木（每次转换都会**覆盖**这个文件）');
  L.push('#');
  L.push('# 与「自带积木」分开成两层，是为了能各自整体替换：');
  L.push('#   自带积木（K4 内建能力）-> 全局/角色自带积木.gd');
  L.push('#   自定义积木（你自己在 K4 里写的函数）-> 本文件');
  L.push('#');
  L.push('# K4 的自定义积木是**全局**的：即使在某个角色上定义，任何角色都能调用。');
  L.push('# 反过来说，过程体是**以调用者的身份**运行的（K4 里跨角色调用时，');
  L.push('# 局部变量会按调用者的实体去解析 —— 这正是 K4 里"别的角色调用就报错"的原因）。');
  L.push('# 所以下面每个函数体第一行是 `var 角色 := self`：让过程体里的');
  L.push('# `角色.xxx` 一律指向**正在运行的那个角色**，与 K4 语义一致，也与帽子脚本写法统一。');
  L.push('#');
  L.push('# 你仍然可以在 角色类.gd 里覆写同名方法（那边优先级最高）。');
  L.push('class_name 角色自定义积木');
  L.push('extends 角色自带积木');
  L.push('');

  // 自定义积木（K4 里跨角色全局可见）——按定义生成签名 + 真实现
  var procs = em ? em.procDefs : {};
  var used = em ? em.usedProcs : {};
  var names = Object.keys(procs);
  Object.keys(used).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
  if (!names.length) L.push('# （本工程没有自定义积木）');
  names.sort().forEach(function (n) {
    var def = procs[n];
    var rawParams = (def && def.params) || [];
    var pmap = {};
    var ps = ['ctx: 角色基类.WarpCtx'];
    rawParams.forEach(function (raw) {
      var gname = em ? em.ns.assign('积木参数', raw, '_p_') : ('_p_' + raw);
      pmap[String(raw)] = gname;
      ps.push(gname + ': Variant');
    });
    L.push('func ' + n + '(' + ps.join(', ') + ') -> Variant:');
    if (def && def.body && def.body.length && def.body.length > 0) {
      L.push('    var 角色 := self        # 过程体以「调用者」身份运行（K4 语义）');
      var pctx = { params: pmap, self: '角色' };
      var bodyLines = em.body(def.body, pctx, '    ');
      // body() 在空体时给 pass；这里已经有 var 角色 一行，去掉多余的 pass
      if (bodyLines.length === 1 && bodyLines[0].trim() === 'pass') bodyLines = [];
      L = L.concat(bodyLines);
      L.push('    return null        # K4 过程可能没有显式 return');
    } else {
      L.push('    return null');
    }
    L.push('');
  });
  return L.join('\n') + '\n';
}

/* ------------------------------------------------------------------ *
 * 悬空块备份：<角色>/预备块.gd
 *
 * K4 里会有**没连到任何事件上**的块（写了一半、换过一版、复制过来忘掉的），
 * 它们不参与运行。转换器不把它们变成代码 —— 但里面的文本可能是唯一的一份
 * 数据（用户说"有时作为替换当前运行文本用"），所以原样备份下来。
 *
 * ⚠ 这个脚本**故意不挂载到任何节点上**（不在任何 .tscn 里被引用），
 *   只是躺在角色目录里当"备胎"。要用的时候把字符串复制回脚本即可。
 * ------------------------------------------------------------------ */

/** GDScript 三引号字符串：反斜杠和 """ 必须转义 */
function gdTriple(s) {
  var body = String(s).replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  // 前后各留一个换行：既避免结尾 " 和闭合符连成 """"，也让 Godot 正确去掉公共缩进
  return '"""\n' + body + '\n"""';
}

function emitSpareScript(ent, em) {
  var L = [];
  L.push('# K4-GENERATED  预备块（' + ent.name + ' 的悬空块备份）');
  L.push('#');
  L.push('# 这些积木在 K4 里**没有连到任何事件上**，不参与运行。');
  L.push('# 转换器不把它们变成代码（本来就不该跑），只把里面的**文本内容**原样存下来，');
  L.push('# ⚠ 本脚本**不挂载到任何节点上**（没有任何 .tscn 引用它），纯粹是个"备胎库"。');
  L.push('# 要用的时候，把对应的三引号字符串整段复制回脚本里就行。');
  if (em) {
    L.push('#');
    L.push('# 超长（> ' + TEXT_FILE_LIMIT + ' 字）的段落没有内联进来 —— 内联会让编辑器打开本文件时卡死。');
    L.push('# 它们都在同目录的 文本/ 下，用 ' + TEXT_READER + '.读取("…/文本/N.txt") 取，');
    L.push('# 或者直接双击那个 txt 看内容。');
  }
  L.push('#');
  L.push('# 共 ' + ent.spare.length + ' 段。');
  L.push('');
  ent.spare.forEach(function (s, i) {
    var rel = em ? em.外置文本(s.text) : null;
    L.push('# ── ' + (i + 1) + ') 原块 id=' + s.id + '，共 ' + s.text.length + ' 字 ' +
      (rel ? ('→ ' + rel + ' ') : '') + '─────────────────────');
    if (rel) {
      L.push('#    （已外置成独立文本文件，内容见 ' + rel + '）');
    } else {
      L.push('const 预备文本_' + (i + 1) + ' := ' + gdTriple(s.text));
    }
    L.push('');
  });
  return L.join('\n') + '\n';
}

function emitProjectGodot(em, scenes) {
  var main = '';
  if (scenes.length) {
    // ★主场景 = 游戏屏幕容器★（所有屏幕都在里面，只有当前屏幕可见）
    main = 'res://全局/游戏屏幕.tscn';
  }
  var w = em.project.size.width || 480, h = em.project.size.height || 360;
  var L = [];
  L.push('; K4-GENERATED');
  L.push('config_version=5');
  L.push('');
  L.push('[application]');
  L.push('');
  L.push('config/name=' + gdStr(em.project.name));
  L.push('run/main_scene=' + gdStr(main));
  L.push('config/features=PackedStringArray("4.4", "GL Compatibility")');
  L.push('run/max_fps=60');
  L.push('');
  L.push('[autoload]');
  L.push('');
  L.push('K4Global="*res://全局/全局变量.gd"');
  L.push('K4Bus="*res://全局/广播总线.gd"');
  L.push('K4Canvas="*res://全局/画布调度.gd"');
  // 超长文本外置读取器：K4 里几 MB 的文本字面量被搬到 文本/*.txt，
  // 生成代码用 K4Text.读取("...") 取（读一次缓存住）。
  // ⚠ 导出成 exe/apk 时记得在导出预设的
  //   「资源 → 导出非资源文件/文件夹的过滤器」里加 *.txt，
  //   否则这些 txt 不会被打进 pck，运行时读出来是空串。
  L.push('K4Text="*res://全局/大文本.gd"');
  // 计时器（全作品唯一一份，与 K4/Scratch 语义一致）
  L.push('K4Timer="*res://全局/计时器.gd"');
  // ★声音侦测（麦克风音量）★—— K4 的「开启 / 关闭 声音侦测」「当前 音量」
  //   麦克风要占一条**全局音频总线**，而角色节点会随屏幕切换被销毁，
  //   挂在角色上会重复建、会漏。autoload 天然跨场景存活，正好当这个侦测器。
  //   —— 这是本轮"项目结构"唯一的改动点。
  L.push('K4Voice="*res://全局/声音侦测.gd"');
  L.push('');
  // ★打开音频输入驱动★：Godot 默认**关闭输入**（省设备占用），不开的话
  //   麦克风拿不到任何数据，K4Voice.当前音量() 恒为 0。
  L.push('[audio]');
  L.push('');
  L.push('driver/enable_input=true');
  L.push('');
  L.push('[display]');
  L.push('');
  L.push('window/size/viewport_width=' + w);
  L.push('window/size/viewport_height=' + h);
  L.push('window/stretch/mode="canvas_items"');
  L.push('window/stretch/aspect="keep"');
  L.push('');
  // ★把 GDScript 的调用栈上限抬到和 K4 一个量级★
  //   K4 运行时配置里是 `max_call_stack_size: 1e4`（= 10000 层递归），
  //   而 Godot 默认只有 1024（实测能跑到 2047 层就 Stack overflow）。
  //   症状：K4 里能跑的递归，搬到 Godot 就爆栈（K4 自己的报错文案是
  //   "函数递归调用次数过多，调用栈溢出"）。
  //
  //   ⚠ 键名必须是 **settings/gdscript/max_call_stack**（带中间的 settings/）★
  //     Godot 4.7 的 ProjectSettings 里 `debug/gdscript/max_call_stack` 和
  //     `debug/settings/gdscript/max_call_stack` **两条都查得到**，
  //     但引擎真正读的是**带 settings/ 的那条**。
  //
  //   ⚠⚠ 实测结论（Godot 4.7.2，2026-10，headless 与窗口模式都一样）：
  //     这个设置在**非编辑器运行**时根本不生效 ——
  //       写 100 / 500 / 10000 / 100000，递归都在 **2047 层**处
  //       "Stack overflow. Check for infinite recursion in your script."
  //     也就是说 Godot 的 GDScript 递归硬上限就是 ~2048 层，
  //     而 K4 的 max_call_stack_size 是 10000。**这个差距靠设置消不掉。**
  //     所以保留这行只是"编辑器里可能有用、且无害"；
  //     真要跑 K4 里上千层的递归，得在转换器里做**尾递归改写**（见 README 待办）。
  L.push('[debug]');
  L.push('');
  L.push('settings/gdscript/max_call_stack=10000');
  L.push('');
  L.push('[physics]');
  L.push('');
  L.push('common/physics_ticks_per_second=60');
  L.push('');
  L.push('[rendering]');
  L.push('');
  L.push('renderer/rendering_method="gl_compatibility"');
  L.push('renderer/rendering_method.mobile="gl_compatibility"');
  L.push('textures/canvas_textures/default_texture_filter=0');
  return L.join('\n') + '\n';
}

module.exports = {
  emitProject: emitProject,
  NameSpace: NameSpace,
  sanitize: sanitize,
  HAT_KEY: HAT_KEY,
  HAT_LABEL: HAT_LABEL,
  ARG: ARG
};
