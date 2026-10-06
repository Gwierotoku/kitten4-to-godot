/*! 新版本 - 积木 → 中文方法名映射表（单一上游，改这里全项目生效）
 *
 * 两层：
 *   1. IR_METHODS   : IR 操作码 → 方法（153 条，多个块类型共享）
 *   2. TYPE_METHODS : 块类型   → 方法（54 条，没有 IR 语义实现的块，全是桩）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.K4 = root.K4 || {}; root.K4.methodtable = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 参数类型缩写：'f'=float 's'=String 'b'=bool 'a'=Array 'v'=Variant 'c'=Callable 'ctx'=WarpCtx
  // 返回类型：'void' 'f' 's' 'b' 'a' 'v'
  // await: true 表示是"等待方法"，生成器必须写 await

  // ------------------------------------------------------------------
  // 来源：全意义转换-设计规范.md 附录 A（A.1–A.9）
  // 计数：附录 A 全部行 = 153 个唯一 IR 键
  //   ├─ HATS       : 9   （帽子模板，不进方法表）
  //   ├─ INLINE_IR  : 20  （控制流 / 字面量 / 广播主键 / warp / 取值兜底 num0 num1）
  //   ├─ IR_METHODS : 124 （其中 14 条 await 方法）
  //   └─ unsupported: 1   （已消灭：拆成 TYPE_METHODS 的 54 个块类型）
  // ------------------------------------------------------------------

  var IR_METHODS = {

    /* ===== A.1 事件 / 广播 ===== */
    broadcast_wait:      { name: '广播并等待', params: [['ctx','ctx'],['名','s']], ret: 'void', await: true,  cat: 'event' },

    /* ===== A.2 控制 ===== */
    // 注：warp / forever / repeat / repeat_until / if / break / def / return / param /
    //     mapped-alias / broadcast / broadcast_body / broadcast_body_wait / lit:* / num0 / num1
    //     均为生成器内联，见 INLINE_IR。warp 生成 角色.进入warp(ctx) / 角色.退出warp(ctx)。
    wait:                { name: '等待_秒',   params: [['ctx','ctx'],['秒','f']], ret: 'void', await: true,  cat: 'control' },
    wait_until:          { name: '等待直到',   params: [['ctx','ctx'],['条件','c']], ret: 'void', await: true,  cat: 'control' },
    stop:                { name: '停止',       params: [['选项','s']], ret: 'void', await: false, cat: 'control' },
    restart:             { name: '重新开始',   params: [], ret: 'void', await: false, cat: 'control' },
    clone:               { name: '克隆自己',   params: [], ret: 'void', await: false, cat: 'control' },
    // ★K4 的「分裂 <角色> 到 x:<x> y:<y>」★（block type `clone`，和上面的 mirror 不是一回事）
    //   语义（用户注释原话）："分裂是深度复制，像普通角色一样，**不是克隆体**"。
    //   core.js 的 case 'clone' 现在产出这个 op；实现在 自带积木.分裂()。
    split:               { name: '分裂',       params: [['目标','v'],['x','v'],['y','v']], ret: 'void', await: false, cat: 'control' },
    clone_self:          { name: '克隆自己',   params: [], ret: 'void', await: false, cat: 'control' },
    // 「克隆 <角色>」：K4 的 mirror 块 sprite 字段是实体 uuid 时走这条
    clone_target:        { name: '克隆_角色', params: [['目标','v']], ret: 'void', await: false, cat: 'control' },
    destroy_self:        { name: '删除克隆体', params: [], ret: 'void', await: false, cat: 'control' },
    tell:                { name: '调用_同步',  params: [['ctx','ctx'],['目标','s'],['参数','a']], ret: 'void', await: true, cat: 'control' },
    // 注（歧义）：附录 A.2 把 call / call_proc 标为"直接用中文积木名"（生成期替换），
    //     而 §5.2 等待白名单把 `调用_同步(ctx, …)` 同时挂在 tell / call_proc 上。
    //     这里统一给 调用_同步 作为缺省名（自定义积木的真实中文名由生成器替换）。
    call:                { name: '调用_同步',  params: [['ctx','ctx'],['目标','s'],['参数','a']], ret: 'void', await: true, cat: 'control' },
    call_proc:           { name: '调用_同步',  params: [['ctx','ctx'],['目标','s'],['参数','a']], ret: 'void', await: true, cat: 'control' },

    /* ===== A.3 运动 ===== */
    move_steps:          { name: '移动_步',      params: [['步数','f']], ret: 'void', await: false, cat: 'motion' },
    goto_xy:             { name: '移到x_y',      params: [['x','f'],['y','f']], ret: 'void', await: false, cat: 'motion' },
    set_coord:           { name: '将坐标设为',   params: [['轴','v'],['值','v']], ret: 'void', await: false, cat: 'motion' },
    // ★`change_coord` 的「增加 / 减少」是同一个积木上的复选框★
    //   K4 把它放在 fields.increase = "increase" / "decrease"，
    //   core.js 折成 sign(±1)。以前 ARG 表漏了 sign → 「减少 200」被生成成
    //   `将坐标增加("y", 200.0)`（方向反了）。
    change_coord:        { name: '将坐标增加',   params: [['轴','v'],['值','v'],['符号','v']], ret: 'void', await: false, cat: 'motion' },
    set_rotation:        { name: '设置方向',     params: [['角度','f']], ret: 'void', await: false, cat: 'motion' },
    change_rotation:     { name: '转动_度',      params: [['角度','f']], ret: 'void', await: false, cat: 'motion' },
    point_towards:       { name: '面向',         params: [['目标','v']], ret: 'void', await: false, cat: 'motion' },
    goto_target:         { name: '移到_目标',    params: [['目标','v']], ret: 'void', await: false, cat: 'motion' },
    // 「面向 <目标>」：反编译器把 self_face_to 映射成 face_to（目标来自 field `sprite`）
    face_to:             { name: '面向_角色',    params: [['目标','v']], ret: 'void', await: false, cat: 'motion' },
    bounce:              { name: '碰到边缘就反弹', params: [], ret: 'void', await: false, cat: 'motion' },
    set_scale:           { name: '设置大小',     params: [['百分比','f']], ret: 'void', await: false, cat: 'motion' },
    change_scale:        { name: '增加大小',     params: [['百分比','f']], ret: 'void', await: false, cat: 'motion' },
    coord_get:           { name: '坐标',         params: [['轴','s']], ret: 'f', await: false, cat: 'motion' },
    rotation_get:        { name: '方向',         params: [], ret: 'f', await: false, cat: 'motion' },
    scale_get:           { name: '大小',         params: [], ret: 'f', await: false, cat: 'motion' },
    glide_to:            { name: '滑行到',       params: [['ctx','ctx'],['秒','f'],['x','f'],['y','f']], ret: 'void', await: true, cat: 'motion' },
    flip:                { name: '翻转',         params: [['方向','v']], ret: 'void', await: false, cat: 'motion', uncertain: true },

    /* ===== A.4 外观 ===== */
    show:                { name: '显示',         params: [], ret: 'void', await: false, cat: 'looks' },
    hide:                { name: '隐藏',         params: [], ret: 'void', await: false, cat: 'looks' },
    // 注（歧义）：附录 A.4 把 set_visible 同时列在 `显示` 与 `隐藏` 两行下面。
    //     旧 blocks.js 里 self_set_visible 是独立块类型（带布尔输入），故单独给一个方法名。
    set_visible:         { name: '设置可见',     params: [['开关','b']], ret: 'void', await: false, cat: 'looks', uncertain: true },
    self_visible:        { name: '是否可见',     params: [], ret: 'b', await: false, cat: 'looks' },
    visible_get:         { name: '是否可见',     params: [], ret: 'b', await: false, cat: 'looks' },
    set_opacity:         { name: '设置透明度',   params: [['值','f']], ret: 'void', await: false, cat: 'looks' },
    change_opacity:      { name: '增加透明度',   params: [['值','f']], ret: 'void', await: false, cat: 'looks' },
    set_costume:         { name: '设置造型',     params: [['名称','v']], ret: 'void', await: false, cat: 'looks' },
    next_costume:        { name: '下一个造型',   params: [], ret: 'void', await: false, cat: 'looks' },
    costume_get:         { name: '当前造型',     params: [], ret: 's', await: false, cat: 'looks' },
    self_costume:        { name: '当前造型',     params: [], ret: 's', await: false, cat: 'looks' },
    // 注：size_get 与 A.3 的 scale_get 共用中文名 `大小`（同名即合并，符合 §3.1 同名规则）。
    size_get:            { name: '大小',         params: [], ret: 'f', await: false, cat: 'looks' },
    say:                 { name: '说',           params: [['内容','s']], ret: 'void', await: false, cat: 'looks' },
    say_for:             { name: '说_秒',        params: [['ctx','ctx'],['内容','s'],['秒','f']], ret: 'void', await: true, cat: 'looks' },
    think:               { name: '想',           params: [['内容','s']], ret: 'void', await: false, cat: 'looks' },
    think_for:           { name: '想_秒',        params: [['ctx','ctx'],['内容','s'],['秒','f']], ret: 'void', await: true, cat: 'looks' },
    layer:               { name: '移到图层',     params: [['方向','f']], ret: 'void', await: false, cat: 'looks' },
    layer_move:          { name: '图层前后移',   params: [['层数','f']], ret: 'void', await: false, cat: 'looks' },
    // 「移到画笔图层 <上方 / 下方>」：字段 position = above / below
    layer_with_pen:      { name: '移到画笔图层', params: [['位置','s']], ret: 'void', await: false, cat: 'pen' },
    set_effect:          { name: '设置特效',     params: [['特效','s'],['值','f']], ret: 'void', await: false, cat: 'looks' },
    // 「把 <特效> 增加 <值>」：反编译器把 increase/decrease 折成 (特效, 符号±1, 值)。
    // 注意 k 是 change_effect（IR 名），OP 侧的入口是 self_change_effect_3。
    change_effect:       { name: '增加特效',     params: [['特效','s'],['符号','f'],['值','f']], ret: 'void', await: false, cat: 'looks' },
    fade:                { name: '渐变',         params: [['ctx','ctx'],['秒','f'],['目标','v']], ret: 'void', await: true, cat: 'looks', uncertain: true },
    of_property:         { name: '属性',         params: [['目标','v'],['属性','s']], ret: 'v', await: false, cat: 'sensing' },
    entity_property:     { name: '角色属性',     params: [['属性','s'],['目标','v']], ret: 'v', await: false, cat: 'sensing' },

    /* ===== A.5 声音 ===== */
    play_sound:          { name: '播放声音',       params: [['名称','v']], ret: 'void', await: false, cat: 'sound' },
    play_sound_wait:     { name: '播放声音并等待', params: [['ctx','ctx'],['名称','v']], ret: 'void', await: true, cat: 'sound' },
    stop_sound:          { name: '停止所有声音',   params: [], ret: 'void', await: false, cat: 'sound' },
    // 「停止 <某个声音>」——K4 的 stop_audio_2 在 audio 里给具体 sound_id 时走这条。
    //   实参可以是**名字**或**编号**（和播放声音同一套双索引规则）。
    stop_sound_named:    { name: '停止声音',       params: [['名称','v']], ret: 'void', await: false, cat: 'sound' },
    set_volume:          { name: '设置音量',       params: [['值','f']], ret: 'void', await: false, cat: 'sound' },
    change_volume:       { name: '增加音量',       params: [['值','f']], ret: 'void', await: false, cat: 'sound' },
    // ★K4 的「把 <音量/播放速率> 设为 <值>」带下拉框（fields.audio_key = volume|rate）★
    //   volume 仍走上面的 设置音量；只有 rate 走这两个（→ pitch_scale）。
    //   实参顺序 = (项, 值)，与 自带积木.设置音量或速率 的签名一致。
    set_volume_or_rate:    { name: '设置音量或速率', params: [['项','s'],['值','f']], ret: 'void', await: false, cat: 'sound' },
    change_volume_or_rate: { name: '增加音量或速率', params: [['项','s'],['值','f']], ret: 'void', await: false, cat: 'sound' },
    // 注：midi_get 不在旧 blocks.js 的 153 个 IR 里（旧实现把它并入 midi_note），
    //     但附录 A.5 明确列出 `播放音符` / `获取音符` 两个名字，故按附录转录。
    // await 以**实现**为准：runtime/模板/自带积木.gd 里的 播放音符() 目前是桩
    // （K4 的音符块要 AudioStreamGenerator 实时合成，属于另一摊工程），
    // 里面没有 await → 生成代码就不该 await 它。等哪天把它实现成协程，
    // lib/k4/async.js 会自动把调用点改成 await，到时候这里再同步改回 true。
    midi_note:           { name: '播放音符',       params: [['ctx','ctx'],['参数','a']], ret: 'void', await: false, cat: 'sound', uncertain: true },
    midi_get:            { name: '获取音符',       params: [['参数','a']], ret: 'v', await: false, cat: 'sound', uncertain: true },

    /* ===== A.6 画笔 ===== */
    pen_clear:           { name: '全部擦除',     params: [], ret: 'void', await: false, cat: 'pen' },
    pen_down:            { name: '落笔',         params: [], ret: 'void', await: false, cat: 'pen' },
    pen_up:              { name: '抬笔',         params: [], ret: 'void', await: false, cat: 'pen' },
    pen_color:           { name: '设置画笔颜色', params: [['颜色','v']], ret: 'void', await: false, cat: 'pen' },
    pen_size:            { name: '设置画笔粗细', params: [['值','f']], ret: 'void', await: false, cat: 'pen' },
    pen_change_color:    { name: '增加画笔颜色', params: [['值','f']], ret: 'void', await: false, cat: 'pen' },
    // 「增加画笔明暗」= K4 的 self_change_pen_shade → add_brush_brightness
    pen_change_shade:    { name: '增加画笔明暗', params: [['值','f']], ret: 'void', await: false, cat: 'pen' },
    // 「设置 / 增加画笔颜色属性」：K4 的 scope 是 hue / saturation / brightness / transparency
    // （实测 fields.scope = "hue"，值域 0~360）
    pen_color_property:  { name: '设置画笔颜色属性', params: [['属性','s'],['值','f']], ret: 'void', await: false, cat: 'pen' },
    pen_change_property: { name: '增加画笔颜色属性', params: [['属性','s'],['符号','f'],['值','f']], ret: 'void', await: false, cat: 'pen' },
    // 「设置填充 <颜色>」/「设置当前为填充 <起点|终点>」= K4 的填充多边形这条路
    fill_style:          { name: '设置填充', params: [['颜色','v']], ret: 'void', await: false, cat: 'pen' },
    fill_path:           { name: '设置填充路径', params: [['点','s']], ret: 'void', await: false, cat: 'pen' },
    pen_change_size:     { name: '增加画笔粗细', params: [['值','f']], ret: 'void', await: false, cat: 'pen' },
    pen_stamp:           { name: '图章',         params: [], ret: 'void', await: false, cat: 'pen' },
    // ★对齐方式来自 K4 的 fields.align（left / center / right）★
    //   以前只有 (文本, 字号) 两个参数 —— 对齐被截断丢掉，所有图章都按居中画。
    text_stamp:          { name: '文字图章',     params: [['文本','s'],['字号','f'],['对齐','s']], ret: 'void', await: false, cat: 'pen' },

    /* ===== A.7 数据 ===== */
    set_var:             { name: '设置变量',        params: [['名','s'],['值','v']], ret: 'void', await: false, cat: 'data' },
    change_var:          { name: '增加变量',        params: [['名','s'],['值','v']], ret: 'void', await: false, cat: 'data' },
    ref:                 { name: '取值',            params: [['名','s']], ret: 'v', await: false, cat: 'data' },
    list_add:            { name: '列表添加',        params: [['列表','a'],['值','v']], ret: 'void', await: false, cat: 'data' },
    list_delete:         { name: '列表删除',        params: [['列表','a'],['序号','f']], ret: 'void', await: false, cat: 'data' },
    // ★列表的顺序参数统一放在「序号」前面：`列表删除_特殊(列表, 方式, 序号)`★
    //   方式 = first / last / all（K4 里「删除列表的第 n 项 / 倒数第 n 项 / 全部」）。
    //   以前这里是 (列表, 序号, 方式)，和 列表取值_特殊 的顺序**正好相反** ——
    //   同一个概念两套位置，实现时极易写错。
    list_delete_special: { name: '列表删除_特殊',   params: [['列表','a'],['方式','s'],['序号','f']], ret: 'void', await: false, cat: 'data' },
    list_clear:          { name: '列表清空',        params: [['列表','a']], ret: 'void', await: false, cat: 'data' },
    list_insert:         { name: '列表插入',        params: [['列表','a'],['序号','f'],['值','v']], ret: 'void', await: false, cat: 'data' },
    // 以前这里**丢了 方式**：K4 的「替换列表的第 n 项」也有 first/last 下拉，
    // TYPE=last 的（空白作品里 5 处）会被当成 first 处理。
    list_replace:        { name: '列表替换',        params: [['列表','a'],['方式','s'],['序号','f'],['值','v']], ret: 'void', await: false, cat: 'data' },
    list_show:           { name: '显示列表',        params: [['列表','a']], ret: 'void', await: false, cat: 'data' },
    list_hide:           { name: '隐藏列表',        params: [['列表','a']], ret: 'void', await: false, cat: 'data' },
    list_len:            { name: '列表长度',        params: [['列表','a']], ret: 'f', await: false, cat: 'data' },
    list_empty:          { name: '列表是否为空',    params: [['列表','a']], ret: 'b', await: false, cat: 'data' },
    list_index:          { name: '列表第几项',      params: [['列表','a'],['值','v']], ret: 'f', await: false, cat: 'data' },
    list_item:           { name: '列表第几项的值',  params: [['列表','a'],['序号','f']], ret: 'v', await: false, cat: 'data' },
    // 参数顺序必须和 OP_METHODS 里的同名条目一致（buildSignatures 按**位置**合并，
    // 名字取先遇到的那一份；两表不一致时会撞出重复参数名）。
    list_item_special:   { name: '列表取值_特殊',   params: [['列表','a'],['方式','v'],['序号','v']], ret: 'v', await: false, cat: 'data' },
    list_contains:       { name: '列表包含',        params: [['列表','a'],['值','v']], ret: 'b', await: false, cat: 'data' },
    list_index_of:       { name: '列表项序号',      params: [['列表','a'],['值','v']], ret: 'f', await: false, cat: 'data' },
    // K4 的「复制 <值> 到 <列表>」：值是**任意表达式**
    //（常见是 text_split 的结果：把文本按分隔符分开成列表）
    list_copy:           { name: '复制列表',        params: [['目标列表','a'],['值','v']], ret: 'void', await: false, cat: 'data' },
    emptybool:           { name: '空判断',          params: [['值','v']], ret: 'b', await: false, cat: 'operator' },

    /* ===== A.8 运算 ===== */
    arith:               { name: '算术运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'f', await: false, cat: 'operator' },
    mod:                 { name: '取余',       params: [['a','v'],['b','v']], ret: 'f', await: false, cat: 'operator' },
    math_single:         { name: '数学函数',   params: [['函数','s'],['值','v']], ret: 'f', await: false, cat: 'operator' },
    math_round:          { name: '取整',       params: [['模式','s'],['值','v']], ret: 'f', await: false, cat: 'operator' },
    math_property:       { name: '数学属性',   params: [['属性','s'],['值','v']], ret: 'b', await: false, cat: 'operator' },
    math_trig:           { name: '三角函数',   params: [['函数','s'],['值','v']], ret: 'f', await: false, cat: 'operator' },
    random_int:          { name: '随机整数',   params: [['起','f'],['止','f']], ret: 'f', await: false, cat: 'operator' },
    random_float:        { name: '随机小数',   params: [['起','f'],['止','f']], ret: 'f', await: false, cat: 'operator' },
    compare:             { name: '比较',       params: [['运算符','s'],['a','v'],['b','v']], ret: 'b', await: false, cat: 'operator' },
    logic_op:            { name: '逻辑运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'b', await: false, cat: 'operator' },
    not:                 { name: '不成立',     params: [['值','v']], ret: 'b', await: false, cat: 'operator' },
    join:                { name: '连接',       params: [['a','v'],['b','v']], ret: 's', await: false, cat: 'operator' },
    append:              { name: '连接_续',    params: [['a','v'],['b','v']], ret: 's', await: false, cat: 'operator', uncertain: true },
    str_len:             { name: '文本长度',   params: [['文本','s']], ret: 'f', await: false, cat: 'operator' },
    str_empty:           { name: '文本是否为空', params: [['文本','s']], ret: 'b', await: false, cat: 'operator' },
    str_index:           { name: '文本第几个字符', params: [['文本','s'],['值','v']], ret: 'f', await: false, cat: 'operator' },
    str_char_at:         { name: '文本取字符', params: [['文本','s'],['序号','f']], ret: 's', await: false, cat: 'operator' },
    str_substring:       { name: '文本截取',   params: [['文本','s'],['起','f'],['止','v']], ret: 's', await: false, cat: 'operator' },
    str_case:            { name: '文本大小写', params: [['模式','s'],['文本','s']], ret: 's', await: false, cat: 'operator' },
    str_trim:            { name: '去除空格',   params: [['文本','s']], ret: 's', await: false, cat: 'operator' },
    str_contains:        { name: '文本包含',   params: [['文本','s'],['子串','s']], ret: 'b', await: false, cat: 'operator' },
    str_split:           { name: '文本分割',   params: [['文本','s'],['分隔符','s']], ret: 'a', await: false, cat: 'operator' },
    to_string:           { name: '转文本',     params: [['值','v']], ret: 's', await: false, cat: 'operator' },
    convert_type:        { name: '转换类型',   params: [['类型','s'],['值','v']], ret: 'v', await: false, cat: 'operator' },
    is_divisibleby:      { name: '是倍数',     params: [['a','v'],['b','v']], ret: 'b', await: false, cat: 'operator' },

    /* ===== A.9 侦测 ===== */
    ask:                 { name: '询问并等待',   params: [['ctx','ctx'],['问题','s']], ret: 'void', await: true, cat: 'sensing' },
    ask_choose:          { name: '询问并选择',   params: [['ctx','ctx'],['问题','v'],['选项','v']], ret: 'void', await: true, cat: 'sensing', uncertain: true },
    answer:              { name: '回答',         params: [], ret: 'v', await: false, cat: 'sensing' },
    timer:               { name: '计时器',       params: [], ret: 'f', await: false, cat: 'sensing' },
    timer_reset:         { name: '重置计时器',   params: [], ret: 'void', await: false, cat: 'sensing' },
    mouse_x:             { name: '鼠标x',        params: [], ret: 'f', await: false, cat: 'sensing' },
    mouse_y:             { name: '鼠标y',        params: [], ret: 'f', await: false, cat: 'sensing' },
    mouse_down:          { name: '鼠标按下',     params: [], ret: 'b', await: false, cat: 'sensing' },
    mouse_info:          { name: '鼠标信息',     params: [], ret: 'v', await: false, cat: 'sensing' },
    key_pressed:         { name: '按键按下',     params: [['键','s']], ret: 'b', await: false, cat: 'sensing' },
    touching:            { name: '碰到',         params: [['目标','v']], ret: 'b', await: false, cat: 'sensing' },
    // 注（歧义）：碰到角色无输入参数，附录未给返回说明；按"是否碰到任意角色"取 bool。
    touching_entities:   { name: '碰到角色',     params: [], ret: 'b', await: false, cat: 'sensing', uncertain: true },
    distance_to:         { name: '到_的距离',    params: [['目标','v']], ret: 'f', await: false, cat: 'sensing' },
    loudness:            { name: '响度',         params: [], ret: 'f', await: false, cat: 'sensing' },
    self_name:           { name: '自己的名字',   params: [], ret: 's', await: false, cat: 'sensing' },

    /* —— 云变量（core.js 里的 k:'cloud_*' 语句）—— */
    cloud_set:           { name: '云变量设置',   params: [['名','v'],['值','v']], ret: 'void', await: false, cat: 'data' },

    /* —— 屏幕 / 计时器（语句）——
       K4 的 set_timer_state 只有三种 actions（已在 4 个样例里核对过），
       由 core.js 分成三条 IR：
         start -> timer_start（开始计时器）
         stop  -> timer_stop （停止计时器）
         reset -> timer_reset（重置计时器）
       三者都实现在 runtime/全局/角色基类.gd 里，并登记在 emit.js 的
       BASE_METHODS 名单中 —— 所以 角色自带积木.gd 不会给它们再声明一遍桩。 */
    timer_start:         { name: '开始计时器',   params: [], ret: 'void', await: false, cat: 'sensing' },
    timer_stop:          { name: '停止计时器',   params: [], ret: 'void', await: false, cat: 'sensing' },
    fade_in:             { name: '淡入',         params: [['ctx','ctx'],['秒','f']], ret: 'void', await: true,  cat: 'looks' },
    fade_out:            { name: '淡出',         params: [['ctx','ctx'],['秒','f']], ret: 'void', await: true,  cat: 'looks' },
    cloud_change:        { name: '云变量增加',   params: [['名','v'],['值','v']], ret: 'void', await: false, cat: 'data' },
    cloud_list_append:   { name: '云列表添加',   params: [['名','v'],['值','v']], ret: 'void', await: false, cat: 'data' }
  };

  // ------------------------------------------------------------------
  // 来源：全意义转换-设计规范.md 附录 B（B.1–B.3）
  // 按"块类型"建键 = 54 条（同名块类型共享一个方法名，全部是桩）。
  //   B.1 物理 31 键 / 25 个方法名
  //   B.2 取值兜底 5 键 / 4 个方法名
  //   B.3 其它 18 键 / 18 个方法名
  // ------------------------------------------------------------------
  var TYPE_METHODS = {
    // —— 屏幕 / 场景（switch_to_screen / get_current_scene / check_screen 由生成器直接实现，见 emit.js）——
    // 注意：fade_in / fade_out / timer_stop 曾经在这里也有条目，后来进了 IR_METHODS。
    // 同名的两条会抢同一个签名（IR 是逐个实参、桩是 1 个 Array），
    // 于是 Godot 解析期报 "Too few arguments" —— 已删除，别再往这里加回来。
    self_clear_effects: { name: '清除特效', params: [['参数','a']], ret: 'void', await: false, cat: '外观（桩）', stub: true },
    // 注：self_glide_coordinate 已**迁到 OP_METHODS**（4 个明确实参：轴/方向/时间/值）——
    //   它留在本表只能生成"实参打包成数组"的桩，而那个桩什么也不做（角色纹丝不动）。
    show_hide_variable: { name: '显示隐藏变量', params: [['参数','a']], ret: 'void', await: false, cat: '数据（桩）', stub: true },
    show_hide_list:     { name: '显示隐藏列表', params: [['参数','a']], ret: 'void', await: false, cat: '数据（桩）', stub: true },
    // 注：image_stamp（图片图章 / 角色印章）在 core.js 里直接映射成 pen_stamp → 图章，
    //     所以这里不再需要单独的 stub 条目。

    /* ===== B.1 物理（31 键） ===== */
    self_set_friction:           { name: '设置摩擦系数', params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_set_static_friction:    { name: '设置静摩擦系数', params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_set_air_friction:       { name: '设置空气阻力', params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_set_mass:               { name: '设置质量',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_mass:           { name: '设置质量',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_set_density:            { name: '设置密度',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_set_restitution:        { name: '设置弹性',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_resilience:     { name: '设置弹性',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_set_gravity:            { name: '设置角色重力', params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    set_gravity:                 { name: '设置重力',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_gravity:        { name: '设置重力',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    set_gravity_by_orientation:  { name: '按方向设置重力', params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    set_velocity:                { name: '设置速度',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_speed:          { name: '设置速度',     params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    set_velocity_by_vector:      { name: '设置速度向量', params: [['x','f'],['y','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_force:          { name: '施加力',       params: [['x','f'],['y','f'],['秒','v']], ret: 'void', await: false, cat: 'physics', stub: true, uncertain: true },
    physics2_set_force_in_time:  { name: '施加力',       params: [['x','f'],['y','f'],['秒','v']], ret: 'void', await: false, cat: 'physics', stub: true, uncertain: true },
    physics2_enable_force:       { name: '启用力',       params: [['开关','b']], ret: 'void', await: false, cat: 'physics', stub: true },
    allow_rotate:                { name: '允许旋转',     params: [['开关','b']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_allow_rotate:       { name: '允许旋转',     params: [['开关','b']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_enable_angle_constraint:{ name: '启用角度约束', params: [['开关','b']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_enable_physics:         { name: '启用物理',     params: [], ret: 'void', await: false, cat: 'physics', stub: true },
    self_disable_physics:        { name: '关闭物理',     params: [], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_texture:        { name: '设置物理贴图', params: [['造型','s']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_boundary:       { name: '设置物理边界', params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_actor_as:       { name: '设置物理类型', params: [['类型','s']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_flexibility:    { name: '设置柔韧度',   params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    physics2_set_roughness:      { name: '设置粗糙度',   params: [['值','f']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_set_role_camp:          { name: '设置碰撞分组', params: [['组','s']], ret: 'void', await: false, cat: 'physics', stub: true },
    self_out_of_boundary:        { name: '是否超出边界', params: [], ret: 'b', await: false, cat: 'physics', stub: true },
    physics2_forbid_bump_with:   { name: '禁止与_碰撞',  params: [['目标','v']], ret: 'void', await: false, cat: 'physics', stub: true },

    /* ===== B.2 取值兜底（5 键） ===== */
    // 注：clone_index / clone_count 这两个 **op 名** 曾误登记在本表（TYPE_METHODS）里，
    //     而 emit.js 查的是 MT.OP_METHODS → 查不到 → 记 unknown 并生成裸 `0.0`。
    //     症状：K4 里用到「克隆体编号 / 克隆体数量」的表达式**静默变成 0**。
    //     已移到 OP_METHODS 的「侦测」段（见下）。
    get_current_clone_index:     { name: '克隆体编号',   params: [], ret: 'f', await: false, cat: 'sensing', stub: true },
    get_clone_num:               { name: '克隆体数量',   params: [], ret: 'f', await: false, cat: 'sensing', stub: true },
    // 注：get_stage_info 已由 core.js 映射成 op('screen_info') ——
    //   它现在走 OP_METHODS（有"宽/高"实参），**不能**再留在这里当无参桩：
    //   两张表同名会导致调用点补 `([...])` 而签名声明 `(_项)`，解析期就报实参错误。
    //   （以前这里有一条 `get_stage_info: { name: '舞台信息', params: [] , stub: true }`。）
    physics2_get_property:       { name: '获取物理属性', params: [], ret: 'v', await: false, cat: 'physics', stub: true },
    get_physics_property:        { name: '获取物理属性', params: [], ret: 'v', await: false, cat: 'physics', stub: true },

    /* ===== B.3 其它（18 键） ===== */
    show_ranking:                { name: '显示排行榜',       params: [['参数','a']], ret: 'void', await: false, cat: 'sensing', stub: true },
    show_hide_timer:             { name: '显示隐藏计时器',   params: [['开关','b']], ret: 'void', await: false, cat: 'sensing', stub: true },
    // 注：get_choice / get_choice_index / get_choice_or_index 三兄弟**已从 TYPE_METHODS 迁到这里**
    //   （core.js 现在给它们产出 op('get_choice') / op('get_choice_index')）。
    //   留在 TYPE_METHODS 里没用：emit 的取值路径只查 OP_METHODS，
    //   而 stub 语句路径会把它们当"无参桩"补成 `([...])` —— 和真签名对不上。
    self_ask:                    { name: '自己询问',         params: [['参数','a']], ret: 'void', await: false, cat: 'sensing', stub: true },
    self_ask_listen:             { name: '自己询问并监听',   params: [['参数','a']], ret: 'void', await: false, cat: 'sensing', stub: true },
    self_ask_record:             { name: '自己询问并录音',   params: [['参数','a']], ret: 'void', await: false, cat: 'sensing', stub: true },
    set_fill_style:              { name: '设置填充样式',     params: [['样式','s']], ret: 'void', await: false, cat: 'pen', stub: true },
    set_pen_path:                { name: '设置画笔路径',     params: [['路径','s']], ret: 'void', await: false, cat: 'pen', stub: true },
    // 注：self_set_pen_color_property 已由 core.js 映射成 pen_color_property → 设置画笔颜色属性。
    // 注：set_layer_with_pen 已由 core.js 映射成 layer_with_pen → 移到画笔图层。
    // ★「设置宽高缩放」的轴在 K4 的 fields.type（"width" / "height"）里★
    //   实测结构见 _k4tmp_probe/probe_scale.js；emit.js 为它单独生成
    //   `角色.设置宽高缩放("height", 40)` 两个实参（轴 + 百分比），
    //   所以签名必须是 (轴, 百分比) —— **不能**退化成通用桩的 `([...])`。
    set_width_height_scale:      { name: '设置宽高缩放',     params: [['轴','s'],['百分比','f']], ret: 'void', await: false, cat: 'looks', stub: true },
    self_change_effect_3:        { name: '增加特效',         params: [['特效','s'],['符号','f'],['值','f']], ret: 'void', await: false, cat: 'looks' },
    // 注：与 A.3 的 set_scale（设置大小）重名 → 按 §3.1 加后缀区分（见 §12 待拍板）。
    set_scale:                   { name: '设置大小_外观',    params: [['百分比','f']], ret: 'void', await: false, cat: 'looks', stub: true, uncertain: true },
    self_face_to:                { name: '面向_角色',        params: [['目标','v']], ret: 'void', await: false, cat: 'motion' },
    cloud_variables_set:         { name: '设置云变量',       params: [['名','s'],['值','v']], ret: 'void', await: false, cat: 'data', stub: true },
    midi_play_num_note:          { name: '播放音符_序号',    params: [['序号','f']], ret: 'void', await: false, cat: 'sound', stub: true }
  };

  /* ==================================================================
   * 取值层（reporter）：core.js 把取值类积木统一吐成 {k:'op', op:'xxx'}
   *
   * 注意：这一层的命名与附录 A 的"目录名"不同 —— 反编译器用的是
   *   add/sub/mul/div/pow、cmp_*、and/or/neg、math_*、round_mode、
   *   is_*、coord_x/coord_y、self_*、listref_from、call_remote…
   * 所以必须单独列一层，否则生成器查不到。
   *
   * 前缀族不在此表里逐条列，由生成器按前缀归一：
   *   cmp_X   -> 比较("X", a, b)
   *   math_X  -> 数学函数("X", 值)      （math_root_n 单列）
   *   is_X    -> 是否判断("X", 值)
   *   coord_X -> 坐标x / 坐标y
   * inline:true 表示生成器直接内联，不生成方法调用。
   * ================================================================== */
  var OP_METHODS = {
    /* —— 基础节点 —— */
    lit:           { name: '(字面量)',   params: [], ret: 'v', inline: true },
    ref:           { name: '取值',       params: [['名','s']], ret: 'v' },
    listref:       { name: '(列表)',     params: [], ret: 'a', inline: true },
    listref_from:  { name: '(列表)',     params: [], ret: 'a', inline: true },
    emptybool:     { name: '(空)',       params: [], ret: 'b', inline: true },
    args:          { name: '(参数组)',   params: [], ret: 'a', inline: true },
    unknown:       { name: '(未知)',     params: [], ret: 'v', inline: true },

    /* —— 算术 —— */
    add:           { name: '算术运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'v' },
    sub:           { name: '算术运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'v' },
    mul:           { name: '算术运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'v' },
    div:           { name: '算术运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'v' },
    pow:           { name: '算术运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'v' },
    mod:           { name: '取余',       params: [['a','v'],['b','v']], ret: 'v' },
    neg:           { name: '取反',       params: [['值','v']], ret: 'f' },

    /* —— 逻辑 —— */
    and:           { name: '逻辑运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'b' },
    or:            { name: '逻辑运算',   params: [['运算符','s'],['a','v'],['b','v']], ret: 'b' },
    not:           { name: '不成立',     params: [['值','v']], ret: 'b' },

    /* —— 数学 —— */
    math_root_n:   { name: '开方',       params: [['值','v'],['次','v','2.0']], ret: 'f' },
    math_root:     { name: '开方',       params: [['值','v'],['次','v','2.0']], ret: 'f' },
    round_mode:    { name: '取整',       params: [['模式','s'],['值','v']], ret: 'f' },
    is_divisibleby:{ name: '是倍数',     params: [['a','v'],['b','v']], ret: 'b' },
    random_int:    { name: '随机整数',   params: [['起','v'],['止','v']], ret: 'f' },
    random_float:  { name: '随机小数',   params: [['起','v'],['止','v']], ret: 'f' },

    /* —— 文本 —— */
    join:          { name: '连接',       params: [['a','v'],['b','v']], ret: 's' },
    append:        { name: '连接_续',    params: [['a','v'],['b','v']], ret: 's' },
    str_len:       { name: '文本长度',   params: [['文本','v']], ret: 'f' },
    str_empty:     { name: '文本是否为空', params: [['文本','v']], ret: 'b' },
    str_index:     { name: '文本第几个字符', params: [['文本','v'],['值','v']], ret: 'f' },
    str_last_index:{ name: '文本最后位置', params: [['文本','v'],['值','v']], ret: 'f' },
    str_char_at:   { name: '文本取字符', params: [['文本','v'],['序号','v']], ret: 's' },
    str_substring: { name: '文本截取',   params: [['文本','v'],['起','v'],['止','v']], ret: 's' },
    str_case:      { name: '文本大小写', params: [['模式','s'],['文本','v']], ret: 's' },
    str_trim:      { name: '去除空格',   params: [['文本','v']], ret: 's' },
    str_contains:  { name: '文本包含',   params: [['文本','v'],['子串','v']], ret: 'b' },
    str_split:     { name: '文本分割',   params: [['文本','v'],['分隔符','v']], ret: 'a' },
    to_string:     { name: '转文本',     params: [['值','v']], ret: 's' },
    to_number:     { name: '转数字',     params: [['值','v']], ret: 'f' },

    /* —— 数据 —— */
    list_len:      { name: '列表长度',   params: [['列表','v']], ret: 'f' },
    list_empty:    { name: '列表是否为空', params: [['列表','v']], ret: 'b' },
    list_index:    { name: '列表第几项', params: [['列表','v'],['值','v']], ret: 'f' },
    list_last_index:{ name: '列表最后位置', params: [['列表','v'],['值','v']], ret: 'f' },
    list_item:     { name: '列表第几项的值', params: [['列表','v'],['序号','v']], ret: 'v' },
    list_item_special:{ name: '列表取值_特殊', params: [['列表','v'],['方式','v'],['序号','v']], ret: 'v' },
    list_contains: { name: '列表包含',   params: [['列表','v'],['值','v']], ret: 'b' },
    list_index_of: { name: '列表项序号', params: [['列表','v'],['值','v']], ret: 'f' },
    cloud_get:     { name: '云变量取值', params: [['名','v']], ret: 'v' },
    cloud_list_get:{ name: '云列表',     params: [['名','v']], ret: 'a' },

    /* —— 侦测 —— */
    timer:         { name: '计时器',     params: [], ret: 'f' },
    // ★K4 的「当前 <年/月/日>」★（块类型 get_time，fields.op = year|month|date）
    //   实现在 自带积木.当前年/当前月/当前日()（BASE_METHODS 里已登记）。
    //   以前 core.js 把它和 get_timer 一起映成 op('timer') —— 日期全变计时器。
    time_year:     { name: '当前年',     params: [], ret: 'f' },
    time_month:    { name: '当前月',     params: [], ret: 'f' },
    time_date:     { name: '当前日',     params: [], ret: 'f' },
    mouse_x:       { name: '鼠标x',      params: [], ret: 'f' },
    mouse_y:       { name: '鼠标y',      params: [], ret: 'f' },
    mouse_down:    { name: '鼠标按下',   params: [], ret: 'b' },
    mouse_up:      { name: '鼠标松开',   params: [], ret: 'b' },
    mouse_info:    { name: '鼠标信息',   params: [['项','s']], ret: 'v' },
    key_pressed:   { name: '按键按下',   params: [['键','v']], ret: 'b' },
    // K4 的按键侦测有"按下 / 松开"下拉（fields.key_event_type）→ core.js 产出这个 op。
    // 实现在 自带积木.按键松开()（BASE_METHODS 里已登记）。
    key_released:  { name: '按键松开',   params: [['键','v']], ret: 'b' },
    touching:      { name: '碰到',       params: [['目标','v']], ret: 'b' },
    touching_entities: { name: '碰到角色', params: [], ret: 'v' },
    distance_to:   { name: '到_的距离',  params: [['目标','v']], ret: 'f' },
    answer:        { name: '回答',       params: [], ret: 'v' },
    // ★「询问并选择」的配套取值★（core.js 从 get_choice / get_choice_index /
    //   get_choice_or_index 产出这两个 op）实现在 自带积木.获取选项() / 获取选项序号()。
    get_choice:       { name: '获取选项',     params: [], ret: 'v' },
    get_choice_index: { name: '获取选项序号', params: [], ret: 'f' },
    loudness:      { name: '响度',       params: [], ret: 'f' },
    of_property:   { name: '属性',       params: [['目标','v'],['属性名','s']], ret: 'v' },
    entity_property:{ name: '角色属性',  params: [['属性名','v'],['目标','v']], ret: 'v' },
    self_name:     { name: '自己的名字', params: [], ret: 's' },
    self_visible:  { name: '是否可见',   params: [], ret: 'b' },
    self_costume:  { name: '当前造型',   params: [], ret: 's' },
    self_size:     { name: '大小',       params: [], ret: 'f' },
    self_rotation: { name: '方向',       params: [], ret: 'f' },
    self_scale:    { name: '大小_缩放',  params: [], ret: 'f' },
    screen_coord:  { name: '舞台信息',   params: [['项','s']], ret: 'v' },
    screen_rotation:{ name: '舞台信息',  params: [['项','s']], ret: 'v' },
    screen_scale:  { name: '舞台信息',   params: [['项','s']], ret: 'v' },
    // ★「舞台的 <宽/高>」（K4 的 get_stage_info，字段 fields.info = width|height）★
    //   core.js 现在产出 screen_info，实现在 自带积木.舞台信息()（BASE_METHODS 里已登记）。
    //   以前这个块走 TYPE_METHODS 的桩、恒返回 0 —— 用舞台宽高算坐标的积木全错。
    screen_info:   { name: '舞台信息',   params: [['项','s']], ret: 'v' },
    // ★K4 的「计算」积木★（块类型 calculate，shadows.input 是文本框）
    //   core.js 现在产出 op('calculate', [算式])，实现在 自带积木.计算()。
    //   以前它在两张表里都没有 → 取值走 unknown → 生成裸 `0.0`（Phigros 16 处）。
    calculate:     { name: '计算',       params: [['算式','v']], ret: 'f' },
    // ★K4 的「设置 屏幕切换特效为 <方向> <效果>」★（块类型 set_scene_transition）
    //   core.js 产出 op('set_scene_transition', [效果, 方向])。
    //   实现在 自带积木.设置屏幕切换特效() → 画布调度.设置转场()（转场层在 autoload 上）。
    set_scene_transition: { name: '设置屏幕切换特效', params: [['效果','s'],['方向','s']], ret: 'void', await: false, cat: 'looks' },
    /* ── 本轮补齐（查表4 带出来的缺口）────────────────────────────────────
       · get_time 的 5 种新 op（week/week_num/hour/minute/second）——
         以前它们全部落到"当前年"，四个积木静默算错。
       · 离开边缘：以前被当成"碰到边缘"，语义正好相反。
       · 声音侦测：需要一个 autoload K4Voice（麦克风总线），见 runtime/全局/声音侦测.gd。 */
    time_week:            { name: '当前星期',     params: [], ret: 's', await: false, cat: '侦测' },
    time_week_num:        { name: '当前星期数字', params: [], ret: 'f', await: false, cat: '侦测' },
    time_hour:            { name: '当前小时',     params: [], ret: 'f', await: false, cat: '侦测' },
    time_minute:          { name: '当前分钟',     params: [], ret: 'f', await: false, cat: '侦测' },
    time_second:          { name: '当前秒',       params: [], ret: 'f', await: false, cat: '侦测' },
    out_of_boundary:      { name: '离开边缘',     params: [['边','v']], ret: 'b', await: false, cat: '侦测' },
    bump_into_color:      { name: '碰到颜色',     params: [['目标','v'],['颜色','s']], ret: 'b', await: false, cat: '侦测' },
    voice_volume:         { name: '当前音量',     params: [], ret: 'f', await: false, cat: '侦测' },
    enable_voice_detection: { name: '开启声音侦测', params: [['开关','s']], ret: 'void', await: false, cat: '侦测' },
    orientation:          { name: '屏幕方向',     params: [['轴','s']], ret: 'f', await: false, cat: '侦测' },
    // 「<a> 碰到 <b>」——两个目标都可以是**角色**或**角色组**（用户图 3）
    //   ⚠ 以前走的是无参的 touching_entities，两个目标在生成期就丢了。
    touching_pair:        { name: '碰到目标',     params: [['目标','v'],['目标2','v']], ret: 'b', await: false, cat: '侦测' },
    /* ── 本轮补齐（查表5）：云 / 列表监视器 / 排行榜 / 用户 / 设备 ──────────
       云变量与云列表在 K4 里是联网的，这里全部落到**本地持久化**
       （user://k4_cloud.json，见 自带积木.gd 的"云变量 / 云列表"段）。 */
    cloud_list_item:    { name: '云列表第几项',   params: [['名','s'],['类型','s'],['序号','v']], ret: 'v', await: false, cat: '云' },
    cloud_list_insert:  { name: '云列表插入',     params: [['名','s'],['序号','v'],['值','v']], ret: 'void', await: false, cat: '云' },
    cloud_list_delete:  { name: '云列表删除',     params: [['名','s'],['类型','s'],['序号','v']], ret: 'void', await: false, cat: '云' },
    cloud_list_replace: { name: '云列表替换',     params: [['名','s'],['类型','s'],['序号','v'],['值','v']], ret: 'void', await: false, cat: '云' },
    show_hide_var:      { name: '显示隐藏变量',   params: [['名','s'],['开关','s']], ret: 'void', await: false, cat: '监视器' },
    show_hide_list:     { name: '显示隐藏列表',   params: [['名','s'],['开关','s']], ret: 'void', await: false, cat: '监视器' },
    show_ranking:       { name: '显示排行榜',     params: [['名','s']], ret: 'void', await: false, cat: '云' },
    hide_ranking:       { name: '隐藏排行榜',     params: [], ret: 'void', await: false, cat: '云' },
    ranking_shown:      { name: '排行榜是否显示', params: [['项','s']], ret: 'b', await: false, cat: '云' },
    user_name:          { name: '用户名',         params: [], ret: 's', await: false, cat: '云' },
    user_id:            { name: '用户ID',         params: [], ret: 's', await: false, cat: '云' },
    connected_users:    { name: '在线用户数',     params: [], ret: 'f', await: false, cat: '云' },
    running_device:     { name: '运行设备',       params: [], ret: 's', await: false, cat: '侦测' },
    running_device_is:  { name: '运行设备为',     params: [['设备','s']], ret: 'b', await: false, cat: '侦测' },
    /* ── 本轮补齐（积木对查表测试_2 带出来的缺口）────────────────────────────
       实现在 runtime/模板/自带积木.gd，搜索对应中文方法名即可。
       ★「角色阵营」和「角色组」都用 Godot 原生 group 承接★（用户提议，采纳）：
         阵营 → add_to_group("K4阵营_<红/绿/蓝>")
         角色组 → 生成器写进角色脚本，运行时 add_to_group("K4组_<组名>")           */
    set_role_camp:        { name: '设置角色阵营',   params: [['阵营','s']], ret: 'void', await: false, cat: 'looks' },
    set_draggable:        { name: '设置可拖拽',     params: [['可拖','v']], ret: 'void', await: false, cat: 'control' },
    set_rotation_type:    { name: '设置旋转模式',   params: [['模式','v']], ret: 'void', await: false, cat: 'looks' },
    shake:                { name: '抖动',           params: [['秒','v']], ret: 'void', await: true,  cat: 'motion' },
    rotate_around:        { name: '围绕旋转',       params: [['目标','v'],['度','v']], ret: 'void', await: false, cat: 'motion' },
    stage_dialog:         { name: '新建对话框',     params: [['目标','v'],['文本','v']], ret: 'void', await: false, cat: 'looks' },
    add_width_height_scale: { name: '增加宽高缩放', params: [['轴','s'],['方向','s'],['值','v']], ret: 'void', await: false, cat: 'looks' },
    entity_show_hide:     { name: '显示隐藏实体',   params: [['目标','v'],['模式','s'],['秒','v']], ret: 'void', await: true, cat: 'looks' },
    translate:            { name: '翻译',           params: [['文本','v'],['语言','s']], ret: 'void', await: false, cat: 'sensing' },
    translate_result:     { name: '翻译结果',       params: [['文本','v'],['语言','s']], ret: 'v',    await: false, cat: 'sensing' },
    // ★K4 的「滑行坐标」★（块类型 self_glide_coordinate，core.js 产出 4 个实参）
    //   await: true —— 实现是 "Tween + await tween.finished"，属于**协程**：
    //   挂起的是当前脚本，不是主线程（画面照常刷新），动画播完才继续下一个积木。
    self_glide_coordinate: { name: '滑行坐标', params: [['轴','s'],['方向','s'],['时间','v'],['值','v']], ret: 'void', await: true },
    midi_note:     { name: '获取音符',   params: [], ret: 'v' },
    // 「克隆体编号 / 克隆体数量」—— core.js 的 get_current_clone_index / get_clone_num 产出这两个 op。
    //   实现在 角色基类.gd（BASE_METHODS 里已登记）。
    clone_index:   { name: '克隆体编号', params: [], ret: 'f' },
    clone_count:   { name: '克隆体数量', params: [], ret: 'f' },

    /* —— 询问 / 调用 —— */
    ask:           { name: '询问并等待', params: [['ctx','ctx'],['问题','v']], ret: 's', await: true },
    call_proc:     { name: '(自定义积木)', params: [], ret: 'v', inline: true },
    call_remote:   { name: '(自定义积木)', params: [], ret: 'v', inline: true },
    return_proc:   { name: '(返回值)',   params: [], ret: 'v', inline: true }
  };

  /* 前缀族归一后的落点方法（生成器按 cmp_/math_/is_/coord_ 前缀展开时调用它们）。
     它们不对应单个 op 名，但必须出现在接口文件里，否则生成代码静态检查不过。 */
  var FAMILY_METHODS = {
    '比较':      { name: '比较',     params: [['运算符','s'],['a','v'],['b','v']], ret: 'b', await: false, cat: '运算' },
    '数学函数':  { name: '数学函数', params: [['函数','s'],['值','v']], ret: 'f', await: false, cat: '运算' },
    '是否判断':  { name: '是否判断', params: [['属性','s'],['值','v']], ret: 'b', await: false, cat: '运算' },
    '坐标x':     { name: '坐标x',    params: [], ret: 'f', await: false, cat: '运动' },
    '坐标y':     { name: '坐标y',    params: [], ret: 'f', await: false, cat: '运动' }
  };

  // 帽子（事件）块 → 帽子模板。不进方法表。
  // kind: 'start' | 'screen' | 'clone' | 'broadcast' | 'key' | 'click' | 'condition' | 'timer' | 'loudness' | 'backdrop'
  // needsScene: 是否需要额外的 .tscn（只有 click 需要，因为要 Area2D）
  var HATS = {
    'hat:flag':        { kind: 'start',     base: '帽子_开始',     needsScene: false },
    'hat:message':     { kind: 'broadcast', base: '帽子_广播',     needsScene: false },
    'hat:key':         { kind: 'key',       base: '帽子_按键',     needsScene: false },
    'hat:clicked':     { kind: 'click',     base: '帽子_点击',     needsScene: true  },
    'hat:clone_start': { kind: 'clone',     base: '帽子_克隆启动', needsScene: false },
    'hat:backdrop':    { kind: 'backdrop',  base: '帽子_背景切换', needsScene: false },
    'hat:condition':   { kind: 'condition', base: '帽子_条件',     needsScene: false },
    'hat:timer':       { kind: 'timer',     base: '帽子_计时器',   needsScene: false },
    'hat:loudness':    { kind: 'loudness',  base: '帽子_响度',     needsScene: false },
    // 「当在手机中向 上/下/左/右 滑动」—— 帽子模板 runtime/全局/帽子_滑动.gd
    'hat:swipe':       { kind: 'swipe',     base: '帽子_滑动',     needsScene: false },
    // 「当切换到当前屏幕时」—— K4 的 on_running_group_activated
    //   帽子模板 runtime/全局/帽子_屏幕切换.gd（监听 K4Global.屏幕切换 信号）
    'hat:screen':      { kind: 'screen',    base: '帽子_屏幕切换', needsScene: false }
  };

  // 不是方法、生成器直接内联的 IR（控制流 / 字面量）
  // warp 会在生成器里展开成 角色.进入warp(ctx) / 角色.退出warp(ctx)。
  // num0 / num1 是取值兜底（旧 blocks.js 里 get_stage_info / cloud_variables_get /
  //   physics2_get_property / physics2_forbid_bump_with 走这两个 IR）——
  //   附录 A.7 有这两行，故一并归入内联。
  var INLINE_IR = ['forever','repeat','repeat_until','if','break','warp','def','return','param',
                   'lit:str','lit:num','lit:bool','lit:null','lit','mapped-alias',
                   'broadcast','broadcast_body','broadcast_body_wait','num0','num1'];

  // 附录 C 保留字（原样转录，注意排除注释行）
  // 判定规则：K4 名 ∈ 本表 ∪ methodNames() ∪ 自定义积木名 → 加前缀
  //   （附录 C 最后一行的"本次生成的方法名集合"是动态项，由生成器用 methodNames() 填入，故不在此数组里）
  var RESERVED = [
    // —— Node2D / CanvasItem 属性 ——
    'position','rotation','scale','skew','transform','global_position','global_rotation','global_scale',
    'global_transform','visible','modulate','self_modulate','z_index','z_as_relative','y_sort_enabled',
    'texture_filter','texture_repeat','material','light_mask','visibility_layer','show_behind_parent',
    'top_level','clip_children',

    // —— Node / Object ——
    'name','owner','process_mode','process_priority','process_physics_priority','scene_file_path',
    'unique_name_in_owner','auto_translate_mode','get','set','call','callv','connect','disconnect',
    'emit_signal','has_method','get_node','get_parent','add_child','remove_child','queue_free','free',
    'is_inside_tree','is_queued_for_deletion','duplicate','set_script','get_script','get_tree',
    'get_viewport','get_window','get_path','get_index','get_child_count','get_children','find_child',
    'find_children','has_node','notify','set_process','set_physics_process','set_process_input',
    'set_process_unhandled_input',

    // —— CanvasItem 方法 ——
    'rotate','move_toward','look_at','to_local','to_global','translate','hide','show',
    'is_visible_in_tree','queue_redraw','get_local_mouse_position','get_global_mouse_position',
    'draw_line','draw_rect','draw_circle','draw_texture','draw_string','draw_polygon','draw_set_transform',

    // —— GDScript 关键字 ——
    'if','elif','else','for','while','match','break','continue','pass','return','func','class','class_name',
    'extends','is','in','as','and','or','not','null','true','false','self','super','var','const','enum','signal',
    'static','await','yield','void','int','float','bool','String','Array','Dictionary','Vector2','Vector2i',
    'Color','Rect2','Node','Node2D','Sprite2D','Area2D',

    // —— Node 内置信号（广播名要判）——
    'ready','renamed','tree_entered','tree_exiting','tree_exited','child_entered_tree',
    'child_exiting_tree','child_order_changed','property_list_changed','script_changed',
    'draw','hidden','item_rect_changed','visibility_changed'
  ];

  function methodNames() {
    var s = {};
    for (var k in IR_METHODS)   { s[IR_METHODS[k].name] = 'ir'; }
    for (var k2 in TYPE_METHODS){ s[TYPE_METHODS[k2].name] = 'type'; }
    for (var k3 in FAMILY_METHODS){ s[FAMILY_METHODS[k3].name] = 'family'; }
    return s;
  }

  return {
    IR_METHODS: IR_METHODS,
    OP_METHODS: OP_METHODS,
    FAMILY_METHODS: FAMILY_METHODS,
    TYPE_METHODS: TYPE_METHODS,
    HATS: HATS,
    INLINE_IR: INLINE_IR,
    RESERVED: RESERVED,
    methodNames: methodNames
  };
});
