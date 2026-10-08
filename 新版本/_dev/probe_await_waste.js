// 找出"被 await，但那个方法内部根本没有 await"的调用（多余的 await）。
//   用法: node _dev/probe_await_waste.js <已转换工程目录>
//
// 为什么关心：GDScript 的编译成本 ∝ await 数量（实测约 26ms/个），
//   而 await 一个**立刻返回的协程并不会让出帧** —— 纯属白付编译成本。
//   （生成器只在"能判定成协程"时才写 await，但跨角色 / 找不到定义时会保守写。）
const fs = require('fs');
const path = require('path');

const 根 = process.argv[2];
if (!根) { console.log('用法: node _dev/probe_await_waste.js <工程目录>'); process.exit(1); }

const 文件列表 = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (/^(\.godot|_backup)$/.test(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.gd$/.test(e.name)) 文件列表.push(f);
  }
})(根);

// 1) 收集每个 func 的名字 + 函数体里有没有 await
const 定义 = {};
for (const f of 文件列表) {
  const L = fs.readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < L.length; i++) {
    const m = /^func\s+([^\s(]+)\s*\(/.exec(L[i]);
    if (!m) continue;
    let j = i + 1, 体 = '';
    while (j < L.length && !/^func\s/.test(L[j])) { 体 += L[j] + '\n'; j++; }
    定义[m[1]] = /await\s/.test(体);
  }
}

// 2) 统计 await 角色.X( 的调用
let 总 = 0, 废 = 0;
const 废表 = {}, 全表 = {};
for (const f of 文件列表) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /await\s+角色\.([^\s(]+)\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    总++;
    const 名 = m[1];
    全表[名] = (全表[名] || 0) + 1;
    if (定义[名] === false) { 废++; 废表[名] = (废表[名] || 0) + 1; }
  }
}
console.log('await 角色.X( 调用总数 = ' + 总);
console.log('其中 X 的函数体里**没有** await 的（多余）= ' + 废);
console.log('');
console.log('多余 await 的 top（方法 : 次数）：');
Object.entries(废表).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([k, v]) => console.log('   ' + k.padEnd(24) + v));
console.log('');
console.log('被 await 最多的 top（方法 : 次数 : 内部有 await？）：');
Object.entries(全表).sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([k, v]) => console.log('   ' + k.padEnd(24) + String(v).padStart(5) + '   ' +
    (定义[k] === undefined ? '未找到定义' : (定义[k] ? '有' : '★无'))));
