#!/usr/bin/env node
/*!
 * 新版本 - Kitten4(.bcm4) -> Godot 4 工程转换器
 *
 * 用法：
 *   node convert.js <输入.bcm4> <输出目录> [--clean]
 *
 * 生成的工程结构见《全意义转换-设计规范》§1。
 * 转换**永远不会失败**：语义做不到的积木会在 全局/角色自带积木.gd 里留下桩（pass），
 * 你只要在 全局/函数单例.gd 里把桩换成真实实现即可（那个文件转换器永不覆盖）。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var CORE = require('./lib/k4/core.js');
var EMIT = require('./lib/k4/emit.js');
var MT = require('./lib/k4/methodtable.js');
var SVG = require('./lib/k4/svg.js');

var HERE = __dirname;
var RUNTIME = path.join(HERE, 'runtime');
// 光栅化缓存（按内容 hash，重复转换不用再起 Edge 进程）
var SVG_CACHE = path.join(HERE, '_cache', 'svg');

/* ------------------------------------------------------------------ */
/* 小工具                                                             */
/* ------------------------------------------------------------------ */

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function writeFile(outDir, rel, content, stats) {
  var full = path.join(outDir, rel);
  mkdirp(path.dirname(full));
  if (typeof content === 'string') fs.writeFileSync(full, content, 'utf8');
  else fs.writeFileSync(full, content);
  stats.files++;
  stats.bytes += (typeof content === 'string' ? Buffer.byteLength(content) : content.length);
}

function copyFile(src, dst, stats) {
  mkdirp(path.dirname(dst));
  fs.copyFileSync(src, dst);
  stats.files++;
  stats.bytes += fs.statSync(dst).size;
}

// 必须和 emit.js 的 sanitize 完全一致 —— 两边不一致会出现
// 「.tscn 引用 res://.../标题_1_/标题.png，但文件落在 .../标题(1)/标题.png」
// 这种 ext_resource 找不到资源的错误。
function safeDir(name, fallback) {
  return EMIT.sanitize(name === undefined || name === null ? '' : name, fallback || 'x');
}

/* ------------------------------------------------------------------ */
/* 主流程                                                             */
/* ------------------------------------------------------------------ */

function convert(inFile, outDir, opts) {
  opts = opts || {};
  var stats = { files: 0, bytes: 0 };
  var report = { warnings: [], errors: [] };

  var raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  var ir = CORE.projectToIR(raw);
  report.warnings = report.warnings.concat(ir.warnings || []);

  // ---- 0.5 SVG -> PNG（默认**全部**光栅化）----
  // 必须在 EMIT.emitProject **之前**做：生成器写 .tscn 时用的就是这个文件名。
  //
  // 为什么全部都要转：Godot 4 的 SVG 导入器是 ThorVG，它有两类东西不认，
  // 而且**不报错、直接画黑**：
  //   ① `<text>`          —— 文字消失
  //   ② `<image>` + data: URI（内嵌位图）—— 整张图变黑
  //      Phigros 的舞台背景（空白场景*.svg）就是内嵌位图，转出来全黑。
  // 所以与其逐个判断，不如一律用 Chromium（Edge）光栅化成 PNG。
  // 想保留矢量：加 --svg=vector（那时只有含 <text> 的会被转）。
  var svgStats = { 总数: 0, 含文字: 0, 内嵌位图: 0, 直接抽取: 0, 已光栅化: 0, 失败: 0, 读不到尺寸: 0 };
  (function () {
    var styles = (ir.assets && ir.assets.styles) || [];
    var 全部转 = (opts.svg !== 'vector');
    var 改名 = {};
    var 任务 = [];        // 需要交给浏览器的
    styles.forEach(function (a, i) {
      if (!/\.svg$/i.test(a.file || '')) return;
      svgStats.总数++;
      var buf = Buffer.from(a.bytes);
      var 文本 = buf.toString('utf8');
      var 诊断 = SVG.诊断(文本);
      if (诊断.文字) svgStats.含文字++;
      if (诊断.内嵌位图) svgStats.内嵌位图++;

      // ① 快速通道：纯「内嵌位图外壳」直接抽出来，不起浏览器
      //    ★但必须比对"SVG 声明尺寸 vs 位图实际尺寸"★：K4 的"在画板上缩放造型"是
      //    烘进 SVG 的 width/height 的（缩到 0 → `width="3px"`），而 <image> 里还是
      //    原始大图。尺寸不一致时直接抽出来 = 丢掉缩放（实测 印章custom测试 的"头像"
      //    造型：声明 3×3.5px，抽出来是整张原图，画面上凭空多出个大头像）。
      //    这种情况**不抽**，落到下面的光栅化路径 —— 浏览器按声明尺寸渲染，尺寸才对。
      var 抽 = 诊断.内嵌位图 ? SVG.抽取内嵌位图(文本) : null;
      if (抽 && 抽.尺寸一致) {
        svgStats.直接抽取++;
        var 新路径2 = String(a.path).replace(/\.svg$/i, '.' + 抽.后缀);
        改名['res://' + a.path] = 'res://' + 新路径2;
        a.file = String(a.file).replace(/\.svg$/i, '.' + 抽.后缀);
        a.path = 新路径2;
        a.ext = 抽.后缀;
        a.mime = 'image/' + (抽.后缀 === 'jpg' ? 'jpeg' : 抽.后缀);
        a.bytes = 抽.数据;
        a.size = 抽.数据.length;
        return;
      }
      if (抽) {
        svgStats.尺寸不符转光栅化 = (svgStats.尺寸不符转光栅化 || 0) + 1;
      }

      if (!全部转 && !诊断.文字 && !抽) return;      // --svg=vector：只转含文字的（含内嵌位图的必须转）
      var 尺寸 = SVG.读尺寸(文本);
      if (!尺寸) { svgStats.读不到尺寸++; return; }   // 没尺寸信息就没法定窗口大小
      任务.push({ id: i, svgBuf: buf, w: 尺寸.w, h: 尺寸.h, 源: a });
    });
    // 并行光栅化（常驻 profile + 多工人；结果按内容 hash 缓存）
    var 渲好的 = SVG.批量光栅化(任务, SVG_CACHE);
    任务.forEach(function (t) {
      var png = 渲好的[t.id];
      var a = t.源;
      if (!png) { svgStats.失败++; return; }
      svgStats.已光栅化++;
      var 新路径 = String(a.path).replace(/\.svg$/i, '.png');
      改名['res://' + a.path] = 'res://' + 新路径;
      a.file = String(a.file).replace(/\.svg$/i, '.png');
      a.path = 新路径;
      a.ext = 'png';
      a.mime = 'image/png';
      a.bytes = png;
      a.size = png.length;
    });
    if (Object.keys(改名).length) {
      // styleInfo 里存的 res:// 路径是 projectToIR 时就固定下来的，得一起改
      (ir.scenes || []).forEach(function (sc) {
        [sc].concat(sc.actors || []).forEach(function (ent) {
          var si = ent.styleInfo;
          if (!si || !si.files) return;
          Object.keys(si.files).forEach(function (k) {
            if (改名[si.files[k]]) si.files[k] = 改名[si.files[k]];
          });
        });
      });
    }
  })();
  if (svgStats.已光栅化 || svgStats.失败 || svgStats.直接抽取) {
    report.warnings.push('SVG 保真: ' + svgStats.总数 + ' 个 SVG（含 <text> ' + svgStats.含文字 +
      ' 个、内嵌位图 ' + svgStats.内嵌位图 + ' 个 —— 这两类 Godot 的 SVG 导入器都不认）→ ' +
      '直接抽出内嵌位图 ' + svgStats.直接抽取 + ' 个、浏览器光栅化 ' + svgStats.已光栅化 + ' 个' +
      (svgStats.失败 ? ('，**失败 ' + svgStats.失败 + ' 个**') : '') +
      (svgStats.读不到尺寸 ? ('，无尺寸信息跳过 ' + svgStats.读不到尺寸 + ' 个') : ''));
  }
  if (svgStats.失败) {
    report.errors.push('有 ' + svgStats.失败 + ' 个 SVG 光栅化失败（Edge/Chrome 不可用或渲染超时）—— ' +
      '这些资源在 Godot 里可能变黑或丢字。装个 Edge/Chrome 再重新转换即可。');
  }

  if (opts.clean && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  mkdirp(outDir);

  // ---- 1. 生成代码 ----
  var res = EMIT.emitProject(ir, opts);

  // 先建立 演员名 -> 屏幕目录 的索引（素材要按屏幕归档）
  // 注意：舞台的名字常常和屏幕同名，生成器会把那个节点改名成「舞台」，
  //       所以素材目录也必须同步用「舞台」，否则 .tscn 里引用不到。
  var ownerScene = {};
  var ownerActorDir = {};
  (ir.scenes || []).forEach(function (sc) {
    var dir = safeDir(sc.name, '屏幕');
    ownerScene[dir] = dir;
    [sc].concat(sc.actors || []).forEach(function (e) {
      var nm = safeDir(e.name, '角色');
      ownerScene[nm] = dir;
      ownerActorDir[nm] = (nm === dir) ? '舞台' : nm;
    });
  });

  // ---- 2. 素材：从 assets/styles/<owner>/<f> 搬到 <屏幕>/角色custom/<演员目录>/<f> ----
  // （含 <text> 的 SVG 已经在 0.5 步换成了 PNG，这里只管搬）
  var assets = ir.assets;
  var assetMap = {};   // 原 res:// 路径 -> 新 res:// 路径
  if (assets) {
    (assets.styles || []).forEach(function (a) {
      var owner = safeDir(a.owner, 'common');
      var dir = ownerScene[owner] || safeDir((ir.scenes[0] || {}).name, '屏幕');
      var leaf = ownerActorDir[owner] || owner;
      var rel = dir + '/角色custom/' + leaf + '/' + a.file;
      writeFile(outDir, rel, a.bytes, stats);
      assetMap['res://' + a.path] = 'res://' + rel;
    });
    (assets.audios || []).forEach(function (a) {
      var rel = '音频/' + safeDir(a.owner, 'common') + '/' + a.file;
      writeFile(outDir, rel, a.bytes, stats);
      assetMap['res://' + a.path] = 'res://' + rel;
    });
  }

  // ---- 3. 生成的文件（路径不动，但把 tscn 里的素材路径改到新位置）----
  Object.keys(res.files).forEach(function (rel) {
    var content = res.files[rel];
    if (/\.tscn$/.test(rel)) {
      content = String(content).replace(/path="res:\/\/assets\/(styles|sounds)\/[^"]*"/g, function (m) {
        var old = m.slice(6, -1);
        return 'path="' + (assetMap[old] || old) + '"';
      });
    }
    writeFile(outDir, rel, content, stats);
  });

  // ---- 4. 运行时库 ----
  var runtimeCopied = [];
  var gdir = path.join(RUNTIME, '全局');
  if (fs.existsSync(gdir)) {
    fs.readdirSync(gdir).forEach(function (f) {
      if (!/\.gd$/.test(f)) return;
      // 屏幕绘制.gd 不进 全局/，它要挂到每个屏幕节点下
      if (f === '屏幕绘制.gd') return;
      // 全局变量.gd 由生成器按本工程实际声明产出（含真实成员），不要被模板覆盖
      if (f === '全局变量.gd') return;
      copyFile(path.join(gdir, f), path.join(outDir, '全局', f), stats);
      runtimeCopied.push('全局/' + f);
    });
  } else {
    report.errors.push('运行时库缺失：' + gdir + '（请先把 runtime/ 补齐）');
  }

  // 屏幕绘制.gd -> 每个屏幕目录一份
  var canvasSrc = path.join(RUNTIME, '全局', '屏幕绘制.gd');
  if (fs.existsSync(canvasSrc)) {
    (ir.scenes || []).forEach(function (sc) {
      var dir = safeDir(sc.name, '屏幕');
      copyFile(canvasSrc, path.join(outDir, dir, '屏幕绘制.gd'), stats);
    });
  } else {
    report.errors.push('缺少 runtime/全局/屏幕绘制.gd');
  }

  // ---- 4.5 清理上一版留下的过时生成文件 ----
  // 角色层从「一个 角色接口.gd」拆成了「角色自带积木.gd + 角色自定义积木.gd」。
  // 不加 --clean 时旧文件会留在工程里，虽然不报错但会让人分不清哪个才生效。
  ['全局/角色接口.gd', '全局/角色接口.gd.uid'].forEach(function (rel) {
    var p = path.join(outDir, rel);
    if (fs.existsSync(p)) {
      try { fs.rmSync(p, { force: true }); } catch (e) { /* 删不掉就算了 */ }
      report.warnings.push('已删除过时文件 ' + rel + '（角色层已拆成 角色自带积木.gd / 角色自定义积木.gd）');
    }
  });

  // ★架构更新（单例化）：旧的两层「角色类.gd / 角色接口.gd」路线整体取消★
  //   新架构：
  //     角色实例：角色基类 → 角色变量 → <角色名>.gd
  //     函数单例：角色自带积木 → 角色自定义积木 → 函数单例（autoload K4Func）
  //   ⚠ 旧的 全局/角色类.gd **不直接删**（里面可能有你手写的实现）——
  //     改名成 `角色类.gd.旧架构备份`，你把内容搬到 全局/函数单例.gd 即可。
  (function () {
    var 旧类 = path.join(outDir, '全局', '角色类.gd');
    if (fs.existsSync(旧类)) {
      var 备份 = 旧类 + '.旧架构备份';
      try {
        if (fs.existsSync(备份)) fs.rmSync(备份, { force: true });
        fs.renameSync(旧类, 备份);
        report.warnings.push('架构更新：全局/角色类.gd 这一层已取消，已改名为 全局/角色类.gd.旧架构备份 —— ' +
          '请把它里面手写的实现搬到 全局/函数单例.gd（新架构下用户实现的唯一落点）。');
      } catch (e) {
        report.errors.push('改名 全局/角色类.gd 失败: ' + (e && e.message));
      }
    }
    var 旧uid = path.join(outDir, '全局', '角色类.gd.uid');
    if (fs.existsSync(旧uid)) { try { fs.rmSync(旧uid, { force: true }); } catch (e) { /* 忽略 */ } }
  })();

  // ---- 5. 函数单例.gd（autoload K4Func）：只在不存在时写，永不覆盖 ----
  var 单例Dst = path.join(outDir, '全局', '函数单例.gd');
  if (!fs.existsSync(单例Dst)) {
    var tpl2 = path.join(RUNTIME, '模板', '函数单例.gd');
    if (fs.existsSync(tpl2)) {
      copyFile(tpl2, 单例Dst, stats);
      report.warnings.push('已创建 全局/函数单例.gd（模板）。这是你写实现的地方，以后转换不会覆盖它。');
    } else {
      report.errors.push('缺少 runtime/模板/函数单例.gd');
    }
  } else {
    // ★极少数会动你文件的例外★：只把 extends 那一行从旧基类改成新基类，其余一个字不动。
    try {
      var sc = fs.readFileSync(单例Dst, 'utf8');
      var fixed2 = sc.replace(/^(\s*extends\s+)角色类\s*$/m, '$1角色自定义积木');
      if (fixed2 !== sc) {
        fs.writeFileSync(单例Dst, fixed2, 'utf8');
        report.warnings.push('已把 全局/函数单例.gd 的 `extends 角色类` 改成 `extends 角色自定义积木`（只改了这一行）');
      }
    } catch (e) {
      report.errors.push('更新 全局/函数单例.gd 的 extends 失败: ' + (e && e.message));
    }
  }

  // ---- 5.5 自检：.tscn 里不能有非法节点名（编辑器会因为它们打不开场景） ----
  var illegalNode = /[.:@/"%\[\]]/;
  var badNodes = [];
  Object.keys(res.files).forEach(function (rel) {
    if (!/\.tscn$/.test(rel)) return;
    String(res.files[rel]).split('\n').forEach(function (ln, i) {
      var m = /^\[node name="([^"]*)"/.exec(ln);
      if (!m) return;
      if (m[1] === '' || illegalNode.test(m[1])) badNodes.push(rel + ':' + (i + 1) + ' ' + JSON.stringify(m[1]));
    });
  });
  if (badNodes.length) {
    report.errors.push('有 ' + badNodes.length + ' 个非法节点名（编辑器会打不开这些场景）: ' + badNodes.slice(0, 5).join(' | '));
  }

  // ---- 5.55 自检：一个 .tscn 只能有一个根节点 ----
  // 除了第一条之外，任何 `[node ...]` 都必须带 parent=。
  // 少了 parent= 的那行会被 Godot 当成第二个根节点：
  //   ERROR: Invalid scene: node X does not specify its parent node.
  //   ERROR: Failed to load scene dependency: "res://..."
  // 结果是引用它的场景**整个加载失败** → 编辑器弹"场景文件似乎无效/损坏"。
  // 这个错在运行期 load() 里看不见（依赖是延迟加载的），只有编辑器会拒绝，
  // 所以必须在这里静态拦住。
  var multiRoot = [];
  Object.keys(res.files).forEach(function (rel) {
    if (!/\.tscn$/.test(rel)) return;
    var roots = 0;
    String(res.files[rel]).split('\n').forEach(function (ln, i) {
      if (/^\[node /.test(ln) && !/ parent=/.test(ln)) {
        roots++;
        if (roots > 1) multiRoot.push(rel + ':' + (i + 1) + ' ' + ln.slice(0, 70));
      }
    });
  });
  if (multiRoot.length) {
    report.errors.push('有 ' + multiRoot.length + ' 个节点没写 parent=（会被 Godot 当成第二个根节点，整个场景打不开）: ' +
      multiRoot.slice(0, 5).join(' | '));
  }

  // ---- 5.57 自检：函数不能有重复参数名 ----
  // GDScript 里重名参数是**解析错误**，而且症状会表现成
  // "Could not resolve super class inheritance from 角色自带积木" 这种
  // 完全指不到原因的连锁报错（整条 class_name 链一起崩）。
  // 合签名表时两张表对同一个位置给了不同的名字就会撞出来（曾经撞过：
  // list_item_special 生成 `(_列表, _序号, _序号)`），这里静态拦住。
  var dupParam = [];
  Object.keys(res.files).forEach(function (rel) {
    if (!/\.gd$/.test(rel)) return;
    String(res.files[rel]).split('\n').forEach(function (ln, i) {
      var m = /^\s*(?:static\s+)?func\s+[^(]+\(([^)]*)\)/.exec(ln);
      if (!m) return;
      var 名 = {}, 重 = [];
      m[1].split(',').forEach(function (p) {
        var n = /^\s*([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)\s*(?::|$)/.exec(p);
        if (!n) return;
        if (名[n[1]]) 重.push(n[1]);
        名[n[1]] = 1;
      });
      if (重.length) dupParam.push(rel + ':' + (i + 1) + ' ' + 重.join(','));
    });
  });
  if (dupParam.length) {
    report.errors.push('有 ' + dupParam.length + ' 个函数重复参数名（GDScript 解析错误，会让整条 class_name 链崩掉）: ' +
      dupParam.slice(0, 5).join(' | '));
  }

  // ---- 5.6 自检：调用点有没有把**真实实参**截断掉 ----
  // 补齐（给少了）无害：K4 的空输入本来就等于默认值。
  // 截断（给多了）说明方法表的参数个数写少了，生成代码会静默丢参数 —— 必须报错。
  var argLoss = res.report.argLoss || [];
  if (argLoss.length) {
    report.errors.push('有 ' + argLoss.length + ' 处调用丢掉了真实实参（方法表参数个数不够）: ' +
      argLoss.slice(0, 5).map(function (x) {
        return x.方法 + ' 声明' + x.声明 + '个/实给' + x.实给 + '个(丢 ' + JSON.stringify(x.丢掉) + ')';
      }).join(' | '));
  }

  // ---- 6. 统计 ----
  var usedIR = {}, usedOP = {}, usedType = {};
  var stubs = res.report.stubs || {};
  Object.keys(stubs).forEach(function (t) { if (t !== '__play_sound_wait') usedType[t] = stubs[t]; });

  return {
    outDir: outDir,
    stats: stats,
    files: Object.keys(res.files).length,
    report: report,
    genReport: res.report,
    ir: ir,
    counts: {
      屏幕: (ir.scenes || []).length,
      角色: (ir.scenes || []).reduce(function (a, s) { return a + (s.actors || []).length; }, 0),
      帽子: (ir.scenes || []).reduce(function (a, s) {
        return a + [s].concat(s.actors || []).reduce(function (b, e) { return b + (e.scripts || []).length; }, 0);
      }, 0),
      造型: assets ? (assets.styles || []).length : 0,
      声音: assets ? (assets.audios || []).length : 0,
      桩类型: Object.keys(usedType).length
    }
  };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

function main() {
  var argv = process.argv.slice(2);
  var pos = [], opts = {};
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--clean') opts.clean = true;
    else if (argv[i].indexOf('--svg=') === 0) opts.svg = argv[i].slice(6);   // png(默认) | vector
    else pos.push(argv[i]);
  }
  if (pos.length < 2) {
    console.log('用法: node convert.js <输入.bcm4> <输出目录> [--clean] [--svg=png|vector]');
    console.log('  --svg=png    （默认）所有 SVG 都光栅化成 PNG —— Godot 的 SVG 导入器');
    console.log('               不认 <text>（丢字）和 <image> data:URI（整张变黑）');
    console.log('  --svg=vector 保留矢量，只把含 <text> 的转成 PNG（更清晰，但那两类仍会坏）');
    process.exit(1);
  }
  var t0 = Date.now();
  var r = convert(path.resolve(pos[0]), path.resolve(pos[1]), opts);
  console.log('转换完成: ' + r.outDir);
  console.log('  屏幕 ' + r.counts.屏幕 + ' / 角色 ' + r.counts.角色 + ' / 帽子 ' + r.counts.帽子 +
    ' / 造型 ' + r.counts.造型 + ' / 声音 ' + r.counts.声音);
  console.log('  写出文件 ' + r.stats.files + ' 个，' + (r.stats.bytes / 1048576).toFixed(2) + ' MB，用时 ' + (Date.now() - t0) + ' ms');
  var un = Object.keys(r.genReport.unknown || {});
  if (un.length) console.log('  ⚠ 未映射词条 ' + un.length + ' 个: ' + un.slice(0, 20).join(' '));
  if (Object.keys(r.genReport.stubs || {}).length) {
    console.log('  桩（待你在函数单例里实现）: ' + Object.keys(r.genReport.stubs).filter(function (k) { return k !== '__play_sound_wait'; }).join(' '));
  }
  if (r.genReport.argMismatch && r.genReport.argMismatch.length) {
    console.log('  ⚠ 实参个数不匹配: ' + JSON.stringify(r.genReport.argMismatch.slice(0, 10)));
  }
  if (r.genReport.实参类型转换 && r.genReport.实参类型转换.length) {
    console.log('  实参类型校正 ' + r.genReport.实参类型转换.length +
      ' 处（按形参声明包了 str() / 角色.转数字() / 角色.为真()）');
  }
  if (r.genReport.await声明不一致 && r.genReport.await声明不一致.length) {
    console.log('  ⚠ 方法表的 await 声明与 runtime 实现不一致: ' +
      r.genReport.await声明不一致.slice(0, 5).join(' | '));
  }
  if (r.genReport.外置文本) {
    console.log('  超长文本外置 ' + r.genReport.外置文本 + ' 段 → 各角色目录的 文本/*.txt' +
      '（代码里用 K4Text.读取("…") 取）');
  }
  (r.report.errors || []).forEach(function (e) { console.log('  ✗ ' + e); });
  (r.report.warnings || []).slice(0, 20).forEach(function (w) { console.log('  · ' + w); });
}

if (require.main === module) main();

module.exports = { convert: convert };
