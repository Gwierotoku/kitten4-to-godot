/*!
 * k4godot - 积木支持清单
 *
 * 说明：Kitten4 的内置积木定义在编辑器内部运行时注册（kitten.*.js 中的
 * define_blocks_with_json_array / domain_function 注册），并不存在一份官方公开清单。
 * 本文件的清单来源分三级，全部标注在 VERIFIED 中：
 *
 *   A 级（已在 K4 Ultra 打包产物中逐字核对）
 *     - 控制类：repeat_forever / repeat_n_times / repeat_forever_until / break / warp /
 *       wait / wait_until / controls_if / destruct
 *     - 影子积木：math_number / controller_shadow / text / logic_empty / lists_get /
 *       broadcast_input / get_audios / get_whole_audios / get_current_costume /
 *       default_value / get_current_scene / get_sensing_current_scene
 *     - 样例工程实例：self_change_coordinate（字段 coordinary / increase）
 *
 *   B 级（来自 Kitten4 反编译器公开映射，见 https://github.com/S-LIGHTNING/Kitten-4-Decompiler）
 *
 *   C 级（按 K4/Scratch 命名习惯推断，仅供参考；命中即用，未命中会在报告中列出）
 *
 * 未列出的积木不会让转换失败：会生成可读的 TODO 占位并在报告中标记。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof K4_BUNDLED === 'undefined') {
    module.exports = factory();
  } else {
    root.K4 = root.K4 || {};
    root.K4.blocks = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis
  : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  /** type -> { cat, ir, level }  level: A/B/C */
  var SUPPORTED = {};

  function add(types, cat, ir, level) {
    for (var i = 0; i < types.length; i++) {
      SUPPORTED[types[i]] = { cat: cat, ir: ir, level: level };
    }
  }

  /* ---------------- 事件（帽子块） ---------------- */
  add(['event_whenflagclicked'], 'event', 'hat:flag', 'C');
  add(['event_whenkeypressed'], 'event', 'hat:key', 'C');
  add(['event_whenbroadcastreceived'], 'event', 'hat:message', 'C');
  add(['event_whenclicked', 'event_whenthisspriteclicked', 'event_whenstageclicked'], 'event', 'hat:clicked', 'C');
  add(['event_when_clone_start', 'event_whenclone', 'event_whenIstart'], 'event', 'hat:clone_start', 'C');
  add(['event_whengreaterthan'], 'event', 'hat:loudness', 'C');
  add(['event_whentimer'], 'event', 'hat:timer', 'C');
  add(['event_whenIreceive', 'event_whenbackdropswitchto'], 'event', 'hat:message', 'C');

  /* ---------------- 控制（A 级：已核对） ---------------- */
  add(['repeat_forever'], 'control', 'forever', 'A');
  add(['repeat_n_times'], 'control', 'repeat', 'A');
  add(['repeat_forever_until'], 'control', 'repeat_until', 'A');
  add(['break'], 'control', 'break', 'A');
  add(['warp'], 'control', 'warp', 'A');
  add(['wait'], 'control', 'wait', 'A');
  add(['wait_until'], 'control', 'wait_until', 'A');
  add(['controls_if', 'controls_if_1', 'controls_if_no_else', 'controls_if_dropdown'], 'control', 'if', 'A');
  add(['destruct'], 'control', 'destroy_self', 'A');
  add(['stop', 'terminate'], 'control', 'stop', 'C');
  add(['restart'], 'control', 'restart', 'C');
  add(['clone'], 'control', 'clone', 'A');
  add(['tell', 'sync_tell'], 'control', 'tell', 'A');
  add(['control_repeat', 'control_forever', 'control_wait', 'control_if', 'control_if_else',
    'control_repeat_until', 'control_stop', 'control_create_clone_of', 'control_delete_this_clone',
    'control_wait_until'], 'control', 'mapped-alias', 'C');

  /* ---------------- 运动 ---------------- */
  add(['self_change_coordinate'], 'motion', 'change_coord', 'A');
  add(['self_move_steps', 'motion_movesteps'], 'motion', 'move_steps', 'C');
  add(['self_set_coordinate'], 'motion', 'set_coord', 'C');
  add(['self_set_position', 'motion_gotoxy'], 'motion', 'goto_xy', 'C');
  add(['self_set_rotation', 'motion_pointindirection'], 'motion', 'set_rotation', 'C');
  add(['self_change_rotation', 'motion_turnright', 'motion_turnleft'], 'motion', 'change_rotation', 'C');
  add(['motion_pointtowards'], 'motion', 'point_towards', 'C');
  add(['motion_goto', 'self_move_to'], 'motion', 'goto_target', 'C');
  add(['self_bounce', 'motion_ifonedgebounce'], 'motion', 'bounce', 'C');
  add(['self_set_scale'], 'motion', 'set_scale', 'C');
  add(['self_change_scale'], 'motion', 'change_scale', 'C');
  add(['self_get_coordinate'], 'motion', 'coord_get', 'C');
  add(['self_get_rotation'], 'motion', 'rotation_get', 'C');
  add(['self_get_scale'], 'motion', 'scale_get', 'C');

  /* ---------------- 外观 ---------------- */
  add(['self_show'], 'looks', 'show', 'C');
  add(['self_hide'], 'looks', 'hide', 'C');
  add(['self_set_visible'], 'looks', 'set_visible', 'C');
  add(['self_set_opacity'], 'looks', 'set_opacity', 'C');
  add(['self_change_opacity'], 'looks', 'change_opacity', 'C');
  add(['self_set_costume'], 'looks', 'set_costume', 'C');
  add(['looks_say'], 'looks', 'say', 'C');
  add(['looks_sayforsecs'], 'looks', 'say_for', 'C');
  add(['looks_think'], 'looks', 'think', 'C');
  add(['looks_thinkforsecs'], 'looks', 'think_for', 'C');
  add(['self_get_visible'], 'looks', 'visible_get', 'C');
  add(['self_get_costume', 'get_current_costume'], 'looks', 'costume_get', 'B');
  add(['self_get_size'], 'looks', 'size_get', 'C');
  // self_go_forward / self_go_backward = 「移动 N 步 / 后退 N 步」（输入名 steps），
  // 属于运动类，不是「移到图层」。真正的图层块是 self_change_layer / set_layer。
  add(['self_go_forward', 'self_go_backward'], 'motion', 'move_steps', 'C');

  /* ---------------- 声音 ---------------- */
  add(['sound_play', 'self_play_audio'], 'sound', 'play_sound', 'C');
  add(['sound_stop_all', 'self_stop_audio'], 'sound', 'stop_sound', 'C');
  add(['sound_set_volume'], 'sound', 'set_volume', 'C');
  add(['sound_change_volume'], 'sound', 'change_volume', 'C');

  /* ---------------- 画笔 ---------------- */
  add(['pen_clear'], 'pen', 'pen_clear', 'C');
  add(['pen_penDown'], 'pen', 'pen_down', 'C');
  add(['pen_penUp'], 'pen', 'pen_up', 'C');
  add(['pen_setPenColorToColor'], 'pen', 'pen_color', 'C');
  add(['pen_setPenSizeTo'], 'pen', 'pen_size', 'C');
  add(['pen_stamp'], 'pen', 'pen_stamp', 'C');

  /* ---------------- 数据 ---------------- */
  add(['variables_set', 'data_setvariableto'], 'data', 'set_var', 'C');
  add(['variables_change', 'data_changevariableby'], 'data', 'change_var', 'C');
  add(['lists_add', 'data_addtolist'], 'data', 'list_add', 'C');
  add(['lists_delete', 'data_deleteoflist'], 'data', 'list_delete', 'C');
  add(['lists_delete_all', 'data_deletealloflist'], 'data', 'list_clear', 'C');
  add(['lists_insert', 'data_insertatlist'], 'data', 'list_insert', 'C');
  add(['lists_replace', 'data_replaceitemoflist'], 'data', 'list_replace', 'C');
  add(['lists_show'], 'data', 'list_show', 'C');
  add(['lists_hide'], 'data', 'list_hide', 'C');
  add(['lists_get', 'variables_get'], 'data', 'ref', 'B');
  add(['lists_length'], 'data', 'list_len', 'C');
  add(['lists_isEmpty'], 'data', 'list_empty', 'C');
  add(['lists_indexOf'], 'data', 'list_index', 'C');
  add(['lists_itemOf', 'lists_getIndex'], 'data', 'list_item', 'C');
  add(['broadcast_input'], 'data', 'lit:str', 'A');
  add(['get_current_scene', 'get_sensing_current_scene'], 'data', 'lit:str', 'A');
  add(['default_value'], 'data', 'lit:str', 'A');

  /* ---------------- 运算 ---------------- */
  add(['math_number'], 'operator', 'lit:num', 'A');
  add(['controller_shadow'], 'operator', 'lit:num', 'A');
  add(['text'], 'operator', 'lit:str', 'A');
  add(['logic_empty'], 'operator', 'emptybool', 'A');
  add(['math_arithmetic'], 'operator', 'arith', 'C');
  add(['math_single'], 'operator', 'math_single', 'C');
  add(['math_round'], 'operator', 'math_round', 'C');
  add(['math_number_property'], 'operator', 'math_property', 'C');
  add(['math_modulo'], 'operator', 'mod', 'C');
  add(['math_random_int'], 'operator', 'random_int', 'C');
  add(['math_random_float'], 'operator', 'random_float', 'C');
  add(['logic_compare'], 'operator', 'compare', 'C');
  add(['logic_operation'], 'operator', 'logic_op', 'C');
  add(['logic_negate'], 'operator', 'not', 'C');
  add(['logic_boolean'], 'operator', 'lit:bool', 'C');
  add(['logic_null'], 'operator', 'lit:null', 'C');
  add(['text_join'], 'operator', 'join', 'C');
  add(['text_append'], 'operator', 'append', 'C');
  add(['text_length'], 'operator', 'str_len', 'C');
  add(['text_isEmpty'], 'operator', 'str_empty', 'C');
  add(['text_indexOf'], 'operator', 'str_index', 'C');
  add(['text_charAt'], 'operator', 'str_char_at', 'C');
  add(['text_getSubstring'], 'operator', 'str_substring', 'C');
  add(['text_changeCase'], 'operator', 'str_case', 'C');
  add(['text_trim'], 'operator', 'str_trim', 'C');
  add(['text_prompt_ext'], 'operator', 'ask', 'C');

  /* ---------------- 侦测 ---------------- */
  add(['self_get_entity_id', 'get_entity_id'], 'sensing', 'self_name', 'C');
  // ⚠ get_time 是 K4 的「当前 年 / 月 / 日」（fields.op），**不是**计时器 ——
  //   它由 core.js 显式按 fields.op 分派成 time_year / time_month / time_date。
  //   以前它和计时器一起映成 'timer'，日期三件套全变成计时器读数。
  add(['sensing_timer'], 'sensing', 'timer', 'C');
  add(['timer_reset', 'sensing_resettimer', 'reset_timer'], 'sensing', 'timer_reset', 'C');
  add(['sensing_mouse_x'], 'sensing', 'mouse_x', 'C');
  add(['sensing_mouse_y'], 'sensing', 'mouse_y', 'C');
  add(['sensing_mousedown'], 'sensing', 'mouse_down', 'C');
  add(['sensing_keypressed'], 'sensing', 'key_pressed', 'C');
  add(['sensing_touchingobject'], 'sensing', 'touching', 'C');
  add(['sensing_distanceto'], 'sensing', 'distance_to', 'C');
  add(['sensing_answer'], 'sensing', 'answer', 'C');
  add(['sensing_loudness'], 'sensing', 'loudness', 'C');
  add(['sensing_of'], 'sensing', 'of_property', 'C');

  /* ---------------- 广播 / 过程 ---------------- */
  add(['event_broadcast'], 'event', 'broadcast', 'C');
  add(['event_broadcastandwait'], 'event', 'broadcast_wait', 'C');
  add(['procedures_callnoreturn', 'procedures_callreturn'], 'procedure', 'call', 'C');
  add(['procedures_return'], 'procedure', 'return', 'C');
  add(['procedures_defnoreturn', 'procedures_defreturn'], 'procedure', 'def', 'C');

  /* ================================================================== */
  /* A+ 级：Kitten4 真实积木                                             */
  /* 名字、字段名、输入名均来自对 7 个官方样例工程(.bcm4)的统计，        */
  /* 以及 K4 打包产物里 395 个积木类型的交叉确认。                       */
  /* ================================================================== */

  /* ---- 事件帽块 ---- */
  add(['start_on_click', 'start_on_click_2'], 'event', 'hat:flag', 'A');
  add(['self_listen'], 'event', 'hat:message', 'A');
  add(['on_keydown'], 'event', 'hat:key', 'A');
  add(['start_as_a_mirror'], 'event', 'hat:clone_start', 'A');
  add(['sprite_on_tap'], 'event', 'hat:clicked', 'A');
  add(['backdrop_on_change'], 'event', 'hat:backdrop', 'A');
  add(['when'], 'event', 'hat:condition', 'A');

  /* ---- 广播（K4 的广播块自带 DO 脚本）---- */
  add(['self_broadcast'], 'event', 'broadcast_body', 'A');
  add(['self_broadcast_and_wait'], 'event', 'broadcast_body_wait', 'A');

  /* ---- 外观 ---- */
  add(['self_appear'], 'looks', 'show', 'A');
  add(['self_disappear'], 'looks', 'hide', 'A');
  add(['self_gradually_show_hide'], 'looks', 'fade', 'A');
  add(['set_costume'], 'looks', 'set_costume', 'A');
  add(['self_next_style'], 'looks', 'next_costume', 'A');
  add(['self_prev_next_style'], 'looks', 'next_costume', 'A');
  add(['self_dialog'], 'looks', 'say', 'A');
  add(['self_dialog_wait'], 'looks', 'say_for', 'A');
  add(['self_flip'], 'looks', 'flip', 'A');
  add(['set_theatre_layer', 'set_layer'], 'looks', 'layer', 'A');
  add(['self_change_layer'], 'looks', 'layer_move', 'A');

  /* ---- 运动 ---- */
  add(['self_move_to'], 'motion', 'goto_target', 'A');
  add(['self_move_specify'], 'motion', 'goto_target', 'A');
  add(['self_point_towards'], 'motion', 'point_towards', 'A');
  add(['self_rotate'], 'motion', 'change_rotation', 'A');
  add(['self_set_position'], 'motion', 'set_coord', 'A');
  add(['self_glide_to'], 'motion', 'glide_to', 'A');
  add(['self_bounce_off_edge'], 'motion', 'bounce', 'A');
  add(['self_change_scale', 'self_change_scale_2'], 'motion', 'change_scale', 'A');

  /* ---- 数据 ---- */
  add(['change_variable'], 'data', 'change_var', 'A');
  add(['lists_append'], 'data', 'list_add', 'A');
  add(['lists_delete'], 'data', 'list_delete_special', 'A');
  add(['lists_insert_value'], 'data', 'list_insert', 'A');
  add(['lists_copy'], 'data', 'list_copy', 'A');

  /* ---- 取值 ---- */
  add(['get_3', 'get'], 'sensing', 'entity_property', 'A');
  add(['random'], 'operator', 'random_int', 'A');
  add(['lists_length'], 'data', 'list_len', 'A');
  add(['lists_is_exist'], 'data', 'list_contains', 'A');
  add(['lists_index_of'], 'data', 'list_index_of', 'A');
  add(['lists_get_value'], 'data', 'list_item_special', 'A');
  add(['self_distance_to'], 'sensing', 'distance_to', 'A');
  add(['get_timer'], 'sensing', 'timer', 'A');   // 计时器（get_time 见上方注释，不在此列）
  add(['mouse_down'], 'sensing', 'mouse_down', 'A');
  add(['check_key'], 'sensing', 'key_pressed', 'A');
  add(['check_hidden'], 'looks', 'self_visible', 'A');
  add(['bump'], 'sensing', 'touching_entities', 'A');

  /* ---- 声音 ---- */
  add(['play_audio', 'play_audio_2'], 'sound', 'play_sound', 'A');
  add(['play_audio_and_wait', 'play_audio_and_wait_2'], 'sound', 'play_sound_wait', 'A');
  add(['stop_audio_2'], 'sound', 'stop_sound', 'A');
  add(['set_volume_or_rate', 'set_volume_or_rate_2'], 'sound', 'set_volume', 'A');
  add(['change_volume_or_rate', 'change_volume_or_rate_2'], 'sound', 'change_volume', 'A');

  /* ---- 画笔 ---- */
  add(['clear_drawing'], 'pen', 'pen_clear', 'A');
  add(['self_pen_down', 'pen_begin_path'], 'pen', 'pen_down', 'A');
  add(['self_pen_up', 'pen_close_path'], 'pen', 'pen_up', 'A');
  // Kitten4 的 `stamp` 是「文字图章」（text + size + align），不是画笔图章
  add(['stamp'], 'pen', 'text_stamp', 'A');
  add(['self_set_pen_size'], 'pen', 'pen_size', 'A');
  add(['self_change_pen_size', 'self_change_pen_size_2'], 'pen', 'pen_change_size', 'A');
  add(['self_set_pen_color'], 'pen', 'pen_color', 'A');
  add(['self_change_pen_color_property', 'self_change_pen_color_property_2'], 'pen', 'pen_change_color', 'A');

  /* ---- 侦测 / 输入 ---- */
  add(['set_timer_state'], 'sensing', 'timer_reset', 'A');
  add(['ask_and_choose'], 'sensing', 'ask_choose', 'A');

  /* ---- 克隆体 ---- */
  add(['dispose', 'dispose_clone'], 'control', 'destroy_self', 'A');
  add(['mirror'], 'control', 'clone_self', 'A');

  /* ---- 自定义积木（K4 真实命名）---- */
  add(['procedures_2_callnoreturn'], 'procedure', 'call', 'A');
  add(['procedures_2_callreturn'], 'procedure', 'call_proc', 'A');
  add(['procedures_2_defnoreturn', 'procedures_2_defreturn'], 'procedure', 'def', 'A');
  add(['procedures_2_return_value', 'procedures_return'], 'procedure', 'return', 'A');
  add(['procedures_2_parameter', 'procedures_2_stable_parameter'], 'procedure', 'param', 'A');
  add(['shadow_number', 'shadow_text'], 'data', 'lit', 'A');

  /* ---- 复杂工程里出现的其它真实积木 ---- */
  add(['math_trig'], 'operator', 'math_trig', 'A');
  add(['convert_type'], 'operator', 'convert_type', 'A');
  add(['divisible_by'], 'operator', 'is_divisibleby', 'A');
  add(['text_contain'], 'operator', 'str_contains', 'A');
  add(['text_select_changeable'], 'operator', 'to_string', 'A');
  add(['get_mouse_info'], 'sensing', 'mouse_info', 'A');
  add(['get_current_clone_index', 'get_clone_num'], 'sensing', 'num1', 'A');
  add(['get_clone_index_property'], 'sensing', 'self_name', 'A');
  add(['user_id_get'], 'sensing', 'lit:str', 'A');
  add(['check_running_device'], 'sensing', 'lit:str', 'A');
  add(['get_stage_info'], 'sensing', 'num0', 'A');
  add(['self_out_of_boundary'], 'sensing', 'touching', 'A');
  add(['controller_shadow'], 'operator', 'lit:num', 'A');
  add(['image_stamp'], 'pen', 'pen_stamp', 'A');
  add(['set_fill_style'], 'pen', 'unsupported', 'A');
  add(['set_pen_path'], 'pen', 'unsupported', 'A');
  add(['set_layer_with_pen'], 'looks', 'unsupported', 'A');
  add(['show_ranking'], 'sensing', 'unsupported', 'A');
  add(['set_width_height_scale'], 'looks', 'unsupported', 'A');
  add(['self_change_effect_3'], 'looks', 'unsupported', 'A');
  add(['self_face_to'], 'motion', 'unsupported', 'A');
  add(['set_scale'], 'looks', 'unsupported', 'A');
  add(['self_set_pen_color_property'], 'pen', 'unsupported', 'A');
  add(['cloud_variables_get'], 'data', 'num0', 'A');
  add(['cloud_variables_set'], 'data', 'unsupported', 'A');

  /* ---- 资源选择影子积木（K4 里也是独立积木类型）---- */
  add(['get_audios', 'get_whole_audios'], 'sound', 'lit:str', 'A');
  add(['get_current_costume'], 'looks', 'self_costume', 'A');
  add(['get_current_scene', 'get_sensing_current_scene'], 'data', 'lit:str', 'A');

  /* ---- MIDI（Godot 无内置 MIDI 合成，按音高数值近似）---- */
  add(['midi_get'], 'sensing', 'midi_note', 'A');
  add(['midi_play_num_note'], 'sound', 'unsupported', 'A');

  /* ---- 物理引擎积木（Kitten4 用 Box2D，Godot 端需改 RigidBody2D）---- */
  add(['physics2_set_texture', 'physics2_set_mass', 'physics2_set_boundary',
    'physics2_allow_rotate', 'physics2_set_flexibility', 'physics2_enable_force',
    'physics2_set_resilience', 'physics2_set_roughness', 'physics2_set_speed',
    'physics2_set_gravity', 'physics2_set_force', 'physics2_set_actor_as',
    'physics2_set_force_in_time', 'set_gravity', 'set_gravity_by_orientation',
    'set_velocity', 'set_velocity_by_vector', 'allow_rotate',
    'self_enable_physics', 'self_disable_physics', 'self_set_mass', 'self_set_gravity',
    'self_set_friction', 'self_set_air_friction', 'self_set_static_friction',
    'self_set_density', 'self_set_restitution', 'self_set_role_camp',
    'self_enable_angle_constraint', 'self_out_of_boundary'], 'physics', 'unsupported', 'A');
  add(['physics2_get_property', 'get_physics_property', 'physics2_forbid_bump_with'],
    'physics', 'num0', 'A');

  /* ---- 其它真积木 ---- */
  add(['self_set_effect', 'self_set_effect_2'], 'looks', 'set_effect', 'A');
  add(['show_hide_timer'], 'sensing', 'unsupported', 'A');
  add(['get_choice_or_index', 'get_choice', 'get_choice_index'], 'sensing', 'unsupported', 'A');
  add(['text_split'], 'operator', 'str_split', 'A');
  add(['self_ask', 'self_ask_listen', 'self_ask_record'], 'sensing', 'unsupported', 'A');

  /* ---------------- 影子类型（XML 里的 <shadow type=...>） ---------------- */
  var SHADOWS = {
    math_number: { field: 'NUM', kind: 'num' },
    controller_shadow: { field: 'NUM', kind: 'num' },
    text: { field: 'TEXT', kind: 'str' },
    logic_empty: { field: 'BOOL', kind: 'emptybool' },
    lists_get: { field: 'VAR', kind: 'listref' },
    broadcast_input: { field: 'MESSAGE', kind: 'str' },
    get_audios: { field: 'sound_id', kind: 'str' },
    get_whole_audios: { field: 'sound_id', kind: 'str' },
    get_current_costume: { field: 'style_id', kind: 'str' },
    default_value: { field: 'TEXT', kind: 'str' },
    get_current_scene: { field: 'scene', kind: 'str' },
    get_sensing_current_scene: { field: 'scene', kind: 'str' }
  };

  /** 覆盖率统计 */
  function coverage(blockTypes) {
    var encountered = Object.keys(blockTypes || {});
    var known = [];
    var unknown = [];
    var byLevel = { A: 0, B: 0, C: 0, unknown: 0 };
    for (var i = 0; i < encountered.length; i++) {
      var t = encountered[i];
      if (SUPPORTED[t]) {
        known.push(t);
        byLevel[SUPPORTED[t].level] = (byLevel[SUPPORTED[t].level] || 0) + (blockTypes[t] || 1);
      } else {
        unknown.push(t);
        byLevel.unknown += blockTypes[t] || 1;
      }
    }
    return {
      encountered: encountered,
      known: known,
      unknown: unknown,
      byLevel: byLevel,
      coveragePercent: encountered.length ? Math.round((known.length / encountered.length) * 1000) / 10 : 100
    };
  }

  return {
    SUPPORTED: SUPPORTED,
    SHADOWS: SHADOWS,
    coverage: coverage
  };
});
