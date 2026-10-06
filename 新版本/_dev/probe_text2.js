// 探针：把 IR 里所有「文本类取值」节点打出来，看反编译阶段到底拿到了什么。
// 用法： node _dev/probe_text2.js <bcm4>
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ir = CORE.projectToIR(raw);

function 值(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(值).join(', ') + ']';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (v.k === 'lit') return (v.str ? 'S:' : 'N:') + JSON.stringify(v.v);
  if (v.k === 'ref') return 'REF:' + v.name;
  if (v.k === 'listref') return 'LIST:' + v.name;
  if (v.k === 'op') return v.op + '(' + (v.args || []).map(值).join(', ') + ')';
  if (v.k === 'unknown') return 'UNKNOWN(' + v.type + ')';
  if (v.k === 'emptybool') return 'EMPTYBOOL';
  return v.k;
}

const 看到的 = {};
function 走(n) {
  if (Array.isArray(n)) return n.forEach(走);
  if (!n || typeof n !== 'object') return;
  if (n.k === 'op' && /^(str_|text_)/.test(String(n.op))) {
    const line = 值(n);
    看到的[line] = (看到的[line] || 0) + 1;
  }
  Object.keys(n).forEach(function (k) { 走(n[k]); });
}
ir.scenes.forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (e) {
    (e.scripts || []).forEach(function (s) { 走(s.body); });
  });
});
const keys = Object.keys(看到的).sort();
console.log('共 ' + keys.length + ' 种文本类 IR 节点：');
keys.slice(0, 45).forEach(function (k) { console.log('  ' + 看到的[k] + 'x  ' + k.slice(0, 200)); });
