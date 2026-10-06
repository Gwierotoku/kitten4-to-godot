'use strict';
/* 在打包过的 K4 源码里按关键字找代码片段（文件是超长单行，ripgrep 会炸） */
var fs = require('fs');
var 文件 = process.argv[2];
var 关键字 = process.argv[3];
var 前后 = parseInt(process.argv[4] || '300', 10);
var 上限 = parseInt(process.argv[5] || '8', 10);
var s = fs.readFileSync(文件, 'utf8');
var i = 0, c = 0;
while (c < 上限) {
  i = s.indexOf(关键字, i);
  if (i < 0) break;
  console.log('--- 命中 #' + (c + 1) + ' @' + i);
  console.log(s.slice(Math.max(0, i - 前后), i + 前后));
  console.log('');
  i += 关键字.length;
  c++;
}
if (c === 0) console.log('没找到: ' + 关键字);
