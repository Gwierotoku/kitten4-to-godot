/* 版本备份 / 回滚（这台机器上没有 git，所以自己做一个最小可用的）
 *
 *   node _dev/backup.js save [备注]     把源码快照到 _backup/<时间戳>[_备注]/
 *   node _dev/backup.js list            列出所有快照
 *   node _dev/backup.js restore <名字>  回滚到某个快照（会先把当前状态另存一份）
 *   node _dev/backup.js prune [N]       只保留最近 N 份（默认 10）
 *
 * 快照内容 = 新版本/ 下的**源码**：convert.js / lib / runtime / _dev /
 * huanzhuang.ps1 / 转换并验证.cmd / README.md …
 * 不含 _out（生成物，可重新转换）、_cache（SVG 光栅化缓存）、_backup 自身。
 * 整个源码才 ~0.6 MB，所以快照很便宜，改之前随手存一份就行。
 */
const fs = require('fs');
const path = require('path');

const 根 = path.join(__dirname, '..');
const 备份根 = path.join(根, '_backup');
const 跳过目录 = /^(?:_out|_cache|_backup|\.godot|node_modules|\.git)$/;
const 收文件 = /\.(js|gd|tscn|godot|ps1|cmd|md|json|txt|cfg)$/i;

function 收集(目录, 前缀, 出) {
  for (const e of fs.readdirSync(目录, { withFileTypes: true })) {
    if (跳过目录.test(e.name)) continue;
    const 全 = path.join(目录, e.name);
    const 相对 = 前缀 ? 前缀 + '/' + e.name : e.name;
    if (e.isDirectory()) 收集(全, 相对, 出);
    else if (收文件.test(e.name)) 出.push(相对);
  }
  return 出;
}

function 复制(从, 到, 列表) {
  for (const rel of 列表) {
    const dst = path.join(到, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(从, rel), dst);
  }
}

function 时间戳() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function 快照们() {
  if (!fs.existsSync(备份根)) return [];
  return fs.readdirSync(备份根, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

const 命令 = process.argv[2] || 'save';

if (命令 === 'list') {
  const 列 = 快照们();
  if (!列.length) { console.log('（还没有快照）'); process.exit(0); }
  for (const n of 列) {
    const 数 = 收集(path.join(备份根, n), '', []).length;
    console.log('  ' + n + '   (' + 数 + ' 个文件, ' +
      new Date(fs.statSync(path.join(备份根, n)).mtime).toLocaleString() + ')');
  }
  process.exit(0);
}

if (命令 === 'restore') {
  const 名字 = process.argv[3];
  if (!名字) { console.log('用法: node _dev/backup.js restore <快照名>'); process.exit(1); }
  const 源 = path.join(备份根, 名字);
  if (!fs.existsSync(源)) {
    console.log('没有这个快照：' + 名字 + '\n现有：\n  ' + 快照们().join('\n  '));
    process.exit(1);
  }
  // 回滚前先把"当前状态"存一份，免得回滚本身变成单向操作
  const 保底 = 时间戳() + '_回滚前的状态';
  const 清单 = 收集(根, '', []);
  复制(根, path.join(备份根, 保底), 清单);
  console.log('已先把当前状态存为 _backup/' + 保底);
  复制(源, 根, 收集(源, '', []));
  console.log('已回滚到 ' + 名字);
  process.exit(0);
}

if (命令 === 'prune') {
  const 留 = Number(process.argv[3] || 10);
  const 列 = 快照们();
  const 删 = 列.slice(0, Math.max(0, 列.length - 留));
  删.forEach((n) => fs.rmSync(path.join(备份根, n), { recursive: true, force: true }));
  console.log('删掉 ' + 删.length + ' 份旧快照，保留最近 ' + Math.min(留, 列.length) + ' 份');
  process.exit(0);
}

// save
const 备注 = process.argv.slice(3).join('_').replace(/[\\/:*?"<>|]/g, '');
const 名字 = 时间戳() + (备注 ? '_' + 备注 : '');
const 清单 = 收集(根, '', []);
复制(根, path.join(备份根, 名字), 清单);
console.log('快照完成：_backup/' + 名字 + '   (' + 清单.length + ' 个文件)');
