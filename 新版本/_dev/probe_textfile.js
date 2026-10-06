/* 合成验证：超长文本外置
   真的样本里没有「既悬空、又超长」的文本块，所以这里手工往一个真实 IR 上挂一段，
   走一遍 emitProject，看 预备块.gd / 文本/*.txt 生成得对不对。
   用法： node _dev/probe_textfile.js [<bcm4 的完整路径>]                     */
const fs = require('fs');
const path = require('path');
const CORE = require(path.join(__dirname, '..', 'lib', 'k4', 'core.js'));
const EMIT = require(path.join(__dirname, '..', 'lib', 'k4', 'emit.js'));

const 示例 = process.argv[2] ||
  path.join(__dirname, '..', '..', 'kitten示例项目', 'pec2txt-phi谱面转换器.bcm4');
const ir = CORE.projectToIR(JSON.parse(fs.readFileSync(示例, 'utf8')));

const 长文本 = '悬空块里的超长文本，'.repeat(60);      // 660 字
const sc = ir.scenes[0];
const 演员 = (sc.actors && sc.actors[0]) || sc;
演员.spare = [{ id: 'TEST_LONG', text: 长文本 }, { id: 'TEST_SHORT', text: '短文本' }];

const res = EMIT.emitProject(ir, {});
console.log('外置计数 = ' + (res.report.外置文本 || 0));
Object.keys(res.files).filter(function (f) { return /文本\/|预备块/.test(f); }).sort()
  .forEach(function (f) {
    const c = res.files[f];
    console.log('--- ' + f + '  (' + c.length + ' 字节)');
    console.log(c.slice(0, 700));
    if (c.length > 700) console.log('    …');
    console.log('');
  });
