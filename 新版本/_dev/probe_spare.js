// 检查各实体收集到的「悬空块文本」
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const 示例 = path.join(__dirname, '..', '..', 'kitten示例项目');
const 文件 = process.argv[2] || 'pec2txt-phi谱面转换器';
const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(path.join(示例, 文件 + '.bcm4'), 'utf8')));
let 总 = 0;
ir.scenes.forEach(function (sc) {
  [sc].concat(sc.actors || []).forEach(function (e) {
    const n = (e.spare || []).length;
    if (n) {
      总 += n;
      console.log('  ' + e.name + '：' + n + ' 段');
      (e.spare || []).slice(0, 3).forEach(function (s, i) {
        console.log('      ' + (i + 1) + ') ' + s.text.length + ' 字  ' + JSON.stringify(s.text.slice(0, 50)));
      });
    }
  });
});
console.log('合计 ' + 总 + ' 段');
