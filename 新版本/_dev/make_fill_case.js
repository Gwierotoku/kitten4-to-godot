// 造一个"填充接线"最小用例：拿 运算 (2).bcm4 当骨架，加一条
//   绿旗 → 设置填充样式 → 设置当前为填充(起点) → 设置当前为填充(终点)
// 的栈，用来证明 emit 的 stmtLines 现在真的会生成填充调用。
// 用法: node _dev/make_fill_case.js
const fs = require('fs');

const 骨架 = 'D:/Download/运算 (2).bcm4';
const 输出 = 'D:/Download/_填充最小用例.bcm4';

const raw = JSON.parse(fs.readFileSync(骨架, 'utf8'));
const t = raw.theatre;
const s = t.scenes[Object.keys(t.scenes)[0]];
const b = s.block_data_json.blocks;
const c = s.block_data_json.connections;

function 加块(id, type, fields) {
  b[id] = {
    type, id, comment: null, is_shadow: false, collapsed: false, disabled: false,
    deletable: true, movable: true, editable: true, visible: 'visible',
    location: [0, 0], shadows: {}, fields: fields || {}, field_constraints: {},
    field_extra_attr: {}, mutation: '', is_output: false, parent_id: null
  };
  c[id] = {};
  return id;
}
function 栈(父, 子) {
  if (!c[父]) c[父] = {};
  c[父][子] = { type: 'next' };
}

const A = 加块('K4FILL0001', 'start_on_click');
const B = 加块('K4FILL0002', 'set_fill_style', { color: '#FF0000' });
const C = 加块('K4FILL0003', 'set_pen_path', { point: 'start_point' });
const D = 加块('K4FILL0004', 'set_pen_path', { point: 'end_point' });
const E = 加块('K4FILL0005', 'image_stamp');          // 顺带验证「图章」分支
栈(A, B); 栈(B, C); 栈(C, D); 栈(D, E);

fs.writeFileSync(输出, JSON.stringify(raw), 'utf8');
console.log('已写出 ' + 输出);
console.log('块顺序：start_on_click -> set_fill_style(#FF0000) -> set_pen_path(start_point) -> set_pen_path(end_point) -> image_stamp');
