// 统计一个生成工程的"运行期热点"关键字（只读，不运行游戏）。
//   用法: node _dev/probe_hotspots.js <工程目录>
// 用途：定位"运行卡死/很慢"的可疑点 —— 画笔指令量、循环、克隆、等待。
const fs = require('fs');
const path = require('path');

const 根 = process.argv[2];
if (!根) { console.log('用法: node _dev/probe_hotspots.js <工程目录>'); process.exit(1); }

let 文件 = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (/^(\.godot|_backup|_cache)$/.test(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.gd$/.test(e.name)) 文件.push(f);
  }
})(根);

const 词 = ['屏幕绘制', '图章', '文字图章', '落笔', '抬笔', '全部擦除', '填充路径',
  '广播并等待', '广播(', '克隆自己', '克隆_角色', '一步(', '进入warp', 'repeat_forever',
  'while true', '等待直到', '等待_秒', 'await ', 'K4Canvas', 'move_child', 'set_process'];
const 统计 = {};
const 每文件 = [];
for (const f of 文件) {
  const s = fs.readFileSync(f, 'utf8');
  const 行 = s.split('\n').length;
  const 本 = { 文件: f.replace(根 + path.sep, ''), 行: 行, 计数: {} };
  for (const w of 词) {
    const n = s.split(w).length - 1;
    if (n) { 统计[w] = (统计[w] || 0) + n; 本.计数[w] = n; }
  }
  每文件.push(本);
}
console.log('=== 全工程关键字统计（' + 文件.length + ' 个 .gd）===');
Object.keys(统计).sort((a, b) => 统计[b] - 统计[a]).forEach(k => {
  console.log('  ' + k.padEnd(16) + 统计[k]);
});
console.log('');
console.log('=== 最大的 8 个脚本 ===');
每文件.slice().sort((a, b) => b.行 - a.行).slice(0, 8).forEach(x => {
  console.log('  ' + String(x.行).padStart(5) + ' 行  ' + x.文件);
});
console.log('');
console.log('=== 画笔/循环最密集的 8 个文件 ===');
const 热点 = 每文件.map(x => ({
  文件: x.文件, 行: x.行,
  分: (x.计数['图章'] || 0) + (x.计数['文字图章'] || 0) + (x.计数['落笔'] || 0) +
     (x.计数['屏幕绘制'] || 0) + (x.计数['repeat_forever'] || 0) * 2 + (x.计数['while true'] || 0) * 2,
  计数: x.计数
}));
热点.sort((a, b) => b.分 - a.分).slice(0, 8).forEach(x => {
  console.log('  分=' + String(x.分).padStart(4) + '  ' + x.文件 + '   ' + JSON.stringify(x.计数));
});
