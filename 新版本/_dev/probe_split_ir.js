// 看 `列表取值_特殊(文本分割(...))` 在 IR 里到底长什么样（只读探针）。
//   用法: node _dev/probe_split_ir.js <工程.bcm4>
// 目的：确认 emit.js 里那条"合并成 文本分割取值"的模式识别为什么没命中。
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ir = CORE.projectToIR(raw);

let 命中 = 0, 样本 = [];
function 走(n, 深) {
  if (n == null || 深 > 400 || 命中 > 6) return;
  if (Array.isArray(n)) { n.forEach(x => 走(x, 深 + 1)); return; }
  if (typeof n !== 'object') return;
  if (n.k === 'op' && n.op === 'list_item_special') {
    命中++;
    const a0 = (n.args || [])[0];
    if (样本.length < 4) {
      样本.push({
        第一个实参: a0 ? { k: a0.k, op: a0.op, type: a0.type, 参数个数: (a0.args || []).length } : null,
        全部实参: (n.args || []).map(x => (x && x.k === 'op') ? ('op:' + x.op) : (x && x.k))
      });
    }
  }
  for (const k of Object.keys(n)) 走(n[k], 深 + 1);
}
for (const sc of (ir.scenes || [])) {
  走(sc.scripts, 0);
  走(sc.procs, 0);
}
console.log('list_item_special 节点数 = ' + 命中);
样本.forEach((s, i) => console.log('  [' + i + '] ' + JSON.stringify(s)));
