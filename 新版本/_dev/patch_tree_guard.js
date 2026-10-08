// 给 `自带积木.gd` 里每一处 `var 树 := get_tree()` 前面补一句"自己还在不在"的检查。
//   原因：节点被释放后 `get_tree()` 自己就会报 Parameter "data.tree" is null.
//   （角色协程里 `等待_秒` 这类高频调用会把调试器刷屏。）
const fs = require('fs');
const 路径 = process.argv[2];
let s = fs.readFileSync(路径, 'utf8');

let 改 = 0;
s = s.replace(/^([ \t]*)var 树 := get_tree\(\)$/gm, (全, 缩进) => {
  // 上一行已经检查过就跳过（幂等）
  const 前 = s.slice(0, s.indexOf(全));
  const 上一行 = 前.split('\n').slice(-2)[0] || '';
  if (/is_instance_valid\(self\)/.test(上一行)) return 全;
  改++;
  return 缩进 + 'if not is_instance_valid(self):\n' + 缩进 + '\treturn\n' + 缩进 + 'var 树 := get_tree()';
});

fs.writeFileSync(路径, s, 'utf8');
console.log('插入检查 ' + 改 + ' 处');
