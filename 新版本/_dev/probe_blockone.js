// dump 某个块类型的 1~2 个完整实例（含所有键），用来定 K4 的真实数据结构
// 用法： node _dev/probe_blockone.js <文件名.bcm4> <块类型> [最多几个]
const fs = require('fs');
const path = require('path');
const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 文件 = process.argv[2] || '游戏-空白作品.bcm4';
const 目标 = process.argv[3];
const 上限 = Number(process.argv[4] || 2);
if (!目标) { console.log('用法: node _dev/probe_blockone.js <bcm4> <块类型> [个数]'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(path.join(示例, 文件), 'utf8'));
let 找到 = 0;
function walk(o, 父键) {
  if (找到 >= 上限 || !o || typeof o !== 'object') return;
  if (Array.isArray(o)) { for (const x of o) { if (找到 >= 上限) return; walk(x, 父键); } return; }
  if (o.type === 目标 && o.fields !== undefined) {
    找到++;
    console.log('--- #' + 找到 + '  在键 "' + 父键 + '" 下 ---');
    console.log(JSON.stringify(o, function (k, v) {
      if (typeof v === 'string' && v.length > 120) return v.slice(0, 60) + '…(len=' + v.length + ')';
      return v;
    }, 1));
    console.log('');
  }
  for (const k in o) { if (找到 >= 上限) return; walk(o[k], k); }
}
walk(raw, 'root');
if (!找到) console.log('没找到 ' + 目标);
