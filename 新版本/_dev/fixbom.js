// 给文件补 UTF-8 BOM（huanzhuang.ps1 必须是 UTF-8 **with BOM** ——
// 它是被 powershell 5.1 执行的，5.1 对无 BOM 的文件按 ANSI 读，中文会乱码甚至语法错）。
// 用法： node _dev/fixbom.js <文件> [<文件> ...]
const fs = require('fs');
process.argv.slice(2).forEach(function (p) {
  const b = fs.readFileSync(p);
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    console.log('已有 BOM: ' + p);
    return;
  }
  fs.writeFileSync(p, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), b]));
  console.log('已补 BOM: ' + p);
});
