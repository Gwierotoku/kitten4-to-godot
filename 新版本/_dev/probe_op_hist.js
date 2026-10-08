// 统计 IR 里各种 op / k 的出现频次（只读探针）。
//   用法: node _dev/probe_op_hist.js <工程.bcm4>
// 目的：确认 `列表取值_特殊` 在 IR 里到底叫什么（op 名），以及遍历是否真的走全了。
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ir = CORE.projectToIR(raw);

const opHist = {};
const kHist = {};
let 节点数 = 0;
function 走(n, 深) {
  if (n == null || 深 > 2000) return;
  if (Array.isArray(n)) { n.forEach(x => 走(x, 深 + 1)); return; }
  if (typeof n !== 'object') return;
  节点数++;
  if (typeof n.k === 'string') kHist[n.k] = (kHist[n.k] || 0) + 1;
  if (n.k === 'op' && typeof n.op === 'string') opHist[n.op] = (opHist[n.op] || 0) + 1;
  for (const key of Object.keys(n)) 走(n[key], 深 + 1);
}
for (const sc of (ir.scenes || [])) {
  走(sc.scripts, 0);
  走(sc.procs, 0);
  走(sc.spare, 0);
  走(sc.actors, 0);          // ★角色的 scripts/procs 挂在这里★（只走 sc.scripts 会得到 0）
}
console.log('IR 节点总数 = ' + 节点数);
console.log('scenes = ' + (ir.scenes || []).length +
  ' ；每个 scene 的 scripts/procs = ' +
  (ir.scenes || []).map(s => (s.scripts || []).length + '/' + (s.procs || []).length).join(', '));
console.log('--- k 频次 ---');
Object.keys(kHist).sort((a, b) => kHist[b] - kHist[a]).slice(0, 12)
  .forEach(k => console.log('  ' + k.padEnd(12) + kHist[k]));
console.log('--- op 频次 top 25 ---');
Object.keys(opHist).sort((a, b) => opHist[b] - opHist[a]).slice(0, 25)
  .forEach(k => console.log('  ' + k.padEnd(24) + opHist[k]));
console.log('含 split 的 op: ' + Object.keys(opHist).filter(k => /split/i.test(k)).join(', '));
console.log('含 item/special 的 op: ' + Object.keys(opHist).filter(k => /item|special/i.test(k)).join(', '));
