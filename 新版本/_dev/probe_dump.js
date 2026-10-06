// dump 某个实体某个帽子的 IR（JSON），用来判断问题出在反编译还是生成阶段
// 用法： node probe_dump.js <bcm4> <实体名> [帽子类型关键字]
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const 实体 = process.argv[3] || '函数';
const 关键字 = process.argv[4] || 'flag';
const ir = CORE.projectToIR(raw);

ir.scenes.forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (e) {
    if (e.name !== 实体) return;
    (e.scripts || []).forEach(function (s) {
      const kind = s.event && s.event.kind;
      if (关键字 && String(kind).indexOf(关键字) < 0) return;
      console.log('=== 实体「' + 实体 + '」帽子 kind=' + kind + ' label=' + (s.event && s.event.label));
      console.log(JSON.stringify(s.body, function (k, v) {
        if (typeof v === 'string' && v.length > 90) return v.slice(0, 50) + '…(len=' + v.length + ')';
        return v;
      }, 1));
    });
  });
});
