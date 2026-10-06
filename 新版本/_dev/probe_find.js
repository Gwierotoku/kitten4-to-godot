// 在 bcm4 原文里定位一个字符串，打印它前后文，判断它属于哪个字段
const fs = require('fs');
const 文件 = process.argv[2];
const 目标 = process.argv[3];
const s = fs.readFileSync(文件, 'utf8');
let i = -1, n = 0;
while ((i = s.indexOf(目标, i + 1)) >= 0) {
  n++;
  if (n > 4) break;
  console.log('=== 第 ' + n + ' 处，位置 ' + i);
  console.log(s.slice(Math.max(0, i - 260), i + 目标.length + 80).replace(/\\n/g, '\\n'));
  console.log('');
}
if (n === 0) console.log('原文里也没有');
