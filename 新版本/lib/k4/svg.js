/* =============================================================================
 * svg.js —— 把「带文字的 SVG」光栅化成 PNG
 * =============================================================================
 *
 * 为什么必须做这件事：
 *   Godot 4 的 SVG 导入器用的是 **ThorVG**，它**不支持 `<text>` 元素**。
 *   带文字的美术资源导进 Godot 之后，字全部消失（只剩图形）。
 *   K4 的画板导出 SVG 时文字就是 `<text>`，所以这类资源必须换掉。
 *
 * 为什么用 Edge：
 *   本机没有 inkscape / rsvg-convert / resvg / imagemagick，Python 侧也没有
 *   cairosvg；而 Windows 自带 **Edge（Chromium）**，它渲染 SVG 是完整的，
 *   而且支持真正的透明背景（--default-background-color=00000000）。
 *
 * 策略：
 *   · **只**光栅化含 `<text>` 的 SVG（其余保持矢量，缩放大图更清晰）；
 *   · 按「内容 hash + 目标尺寸」缓存，重复转换不用再起进程；
 *   · Edge 不可用 / 失败 → **保留原 SVG** 并记一条 warning（转换永不失败）。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

let _browser;          // undefined = 还没找过
function 找浏览器() {
  if (_browser !== undefined) return _browser;
  _browser = null;
  for (let i = 0; i < EDGE_CANDIDATES.length; i++) {
    try {
      if (fs.existsSync(EDGE_CANDIDATES[i])) { _browser = EDGE_CANDIDATES[i]; break; }
    } catch (e) { /* 忽略 */ }
  }
  return _browser;
}

/** 这个 SVG 里有哪些 ThorVG 不认的东西（只用来写报告） */
function 诊断(svgText) {
  return {
    文字: /<text[\s>]/i.test(svgText),
    内嵌位图: /<image[\s>]/i.test(svgText) && /data:image\//i.test(svgText)
  };
}

/** 兼容旧名 */
function 含文字(svgText) { return 诊断(svgText).文字; }

/**
 * ★快速通道★：SVG 只是「包了一层内嵌位图」时，直接把 base64 解出来用。
 *
 * 为什么要它：Phigros 的舞台背景是 2–4MB 的 SVG，里面就一张 base64 位图。
 * 交给 Edge 渲染的话，光解析那几 MB base64 就要好几分钟（实测 148 个 SVG
 * 冷跑 1433 秒，瓶颈全在这几个大文件上）。直接解码是**毫秒级**，
 * 而且更保真 —— 不经过任何二次渲染。
 *
 * 只有「纯外壳」才走这条路：除 `<image>` 外没有别的绘制元素。
 * 有矢量叠加的（边框、文字等）仍要交给浏览器合成。
 *
 * @returns { suffix, data } 或 null
 */
/** 读位图数据的像素尺寸（PNG / JPEG / WebP 文件头）。读不到返回 null */
function 读位图尺寸(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG：魔数 + IHDR（宽在偏移 16、高在 20）
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG：扫段找 SOFn（0xC0-0xCF 里除 DHT/JPG/DAC 的那些）
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const 标记 = buf[i + 1];
      if (标记 === 0xd8 || 标记 === 0x01 || (标记 >= 0xd0 && 标记 <= 0xd7)) { i += 2; continue; }
      const 段长 = buf.readUInt16BE(i + 2);
      if ((标记 >= 0xc0 && 标记 <= 0xc3) || (标记 >= 0xc5 && 标记 <= 0xc7) ||
          (标记 >= 0xc9 && 标记 <= 0xcb) || (标记 >= 0xcd && 标记 <= 0xcf)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + 段长;
    }
    return null;
  }
  // WebP：RIFF....WEBP + VP8 / VP8L / VP8X
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    const 四 = buf.toString('ascii', 12, 16);
    if (四 === 'VP8X' && buf.length > 29) {
      return { w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    }
    if (四 === 'VP8 ' && buf.length > 29) {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (四 === 'VP8L' && buf.length > 24) {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function 抽取内嵌位图(svgText) {
  // ⚠ 不要按 `xlink:href` 匹配：K4 画板导出用的是 SVG2 的 **`href`**，
  //   实际长这样： <image id="…" href="data:image/png;base64,…"/>
  //   一开始按 xlink:href 写，结果一个都没抽出来（105 个内嵌位图全去排队渲染，
  //   冷跑 1433 秒全耗在这上面）。
  const 全部 = svgText.match(/data:image\/[a-z0-9+.-]+;base64,/gi);
  if (!全部 || 全部.length !== 1) return null;      // 多个内嵌图要交给浏览器合成
  const m = /data:image\/([a-z0-9+.-]+);base64,/i.exec(svgText);
  if (!m) return null;
  const 起点 = m.index + m[0].length;
  let 终点 = svgText.indexOf('"', 起点);
  const 单引 = svgText.indexOf("'", 起点);
  if (终点 < 0 || (单引 >= 0 && 单引 < 终点)) 终点 = 单引;
  if (终点 < 0) return null;
  let 数据;
  try { 数据 = Buffer.from(svgText.slice(起点, 终点).replace(/\s+/g, ''), 'base64'); } catch (e) { return null; }
  if (数据.length < 32) return null;
  // 只有「纯外壳」才直接抽：把 <image> 元素整段拿掉后，不该再有别的绘制元素
  const 去掉图 = svgText.replace(/<image\b[^>]*\/?>/gi, '');
  const 剩 = (去掉图.match(/<(path|text|rect|circle|ellipse|polygon|polyline|line)\b/gi) || []).length;
  if (剩 > 0) return null;
  const 类型 = m[1].toLowerCase();
  const 后缀 = (类型 === 'jpeg' || 类型 === 'jpg') ? 'jpg' : (类型 === 'webp' ? 'webp' : 'png');
  // ★必须比对"声明尺寸 vs 位图实际尺寸"★
  //   K4 的"在画板上缩放造型"是**烘进 SVG 的 width/height** 的（例如把造型缩到 0 →
  //   `width="3px" height="3.5px"`），而 <image> 里仍是原始大图。
  //   直接抽出来就等于丢掉了缩放 —— 实测（印章custom测试 的"头像"造型）：
  //   声明 3×3.5px，抽出来是整张 512 级别的原图，画面上凭空多出一个大头像。
  //   尺寸不一致时返回 null，交给浏览器按声明尺寸光栅化。
  const 声明 = 读尺寸(svgText);
  const 实际 = 读位图尺寸(数据);
  const 尺寸一致 = !!(声明 && 实际 && 声明.w === 实际.w && 声明.h === 实际.h);
  return { 后缀: 后缀, 数据: 数据, 声明: 声明, 实际: 实际, 尺寸一致: 尺寸一致 };
}

/** 从 SVG 文本里读内在尺寸（像素）；读不到返回 null */
function 读尺寸(svgText) {
  const head = svgText.slice(0, 4000);
  const wm = /<svg[^>]*?\swidth\s*=\s*"([^"]+)"/i.exec(head);
  const hm = /<svg[^>]*?\sheight\s*=\s*"([^"]+)"/i.exec(head);
  const num = (s) => {
    if (!s) return null;
    const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(s);
    return m ? parseFloat(m[1]) : null;
  };
  let w = num(wm && wm[1]);
  let h = num(hm && hm[1]);
  if (w && h) return { w: Math.ceil(w), h: Math.ceil(h) };
  const vb = /<svg[^>]*?\sviewBox\s*=\s*"([^"]+)"/i.exec(head);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(parseFloat);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w: Math.ceil(p[2]), h: Math.ceil(p[3]) };
  }
  return null;
}

/** 内容 + 尺寸 -> 缓存文件名 */
function 缓存键(svgBuf, w, h) {
  return crypto.createHash('sha1').update(svgBuf).update('|' + w + 'x' + h).digest('hex');
}
function 缓存名(svgBuf, w, h) {
  return 缓存键(svgBuf, w, h) + '.png';
}

function 建目录(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* 已存在 */ }
}

/**
 * 批量光栅化（并行）。
 *
 * 串行版实测 165 个 SVG 要 **883 秒** —— 瓶颈是每次 Edge 冷启动都要新建
 * user-data-dir。这里改成：把任务写成 jobs.json，交给 svgrender.js
 * 用「常驻 profile + N 个工人并行」跑完。
 *
 * @param items [{ id, svgBuf, w, h }]
 * @returns { id: Buffer }（拿不到的不放进结果里）
 */
function 批量光栅化(items, 缓存目录) {
  const 结果 = {};
  if (!items.length) return 结果;
  const 浏览器 = 找浏览器();
  if (!浏览器) return 结果;
  const profileRoot = path.join(缓存目录, 'profile');
  建目录(缓存目录);
  建目录(profileRoot);

  const 待跑 = [];
  items.forEach(function (it) {
    const 出手 = path.join(缓存目录, 缓存名(it.svgBuf, it.w, it.h));
    it._png = 出手;
    if (fs.existsSync(出手) && fs.statSync(出手).size > 8) return;   // 命中缓存
    待跑.push(it);
  });

  if (待跑.length) {
    const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), 'k4svg-'));
    try {
      const 任务 = 待跑.map(function (it) {
        const 源 = path.join(临时, String(it.id).replace(/[^\w.-]/g, '_') + '.svg');
        fs.writeFileSync(源, it.svgBuf);
        return { svg: 源, png: it._png, w: it.w, h: it.h };
      });
      const 配置文件 = path.join(临时, 'jobs.json');
      fs.writeFileSync(配置文件, JSON.stringify({
        browser: 浏览器,
        // 并发别开太大：并发一高，Chromium 的 profile 竞争会让整批任务失败，
        // 反而比串行还慢（失败项要靠最后的串行重试兜底）
        concurrency: Math.max(1, Math.min(5, require('os').cpus().length || 4)),
        tmpRoot: 临时,
        profileRoot: profileRoot,
        jobs: 任务
      }));
      // 时间上限给足（首次要跑几百个）；渲染工人自己会给单个任务 120s 超时
      cp.spawnSync(process.execPath, [path.join(__dirname, 'svgrender.js'), 配置文件],
        { stdio: 'ignore', timeout: 3600000, windowsHide: true });
    } catch (e) {
      /* 渲染失败就当这批拿不到，调用方保留原 SVG */
    } finally {
      try { fs.rmSync(临时, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
    }
  }

  items.forEach(function (it) {
    try {
      if (it._png && fs.existsSync(it._png) && fs.statSync(it._png).size > 8) {
        结果[it.id] = fs.readFileSync(it._png);
      }
    } catch (e) { /* 读不到就当失败 */ }
  });
  return 结果;
}

/**
 * 光栅化一个 SVG。
 * @returns {Buffer|null} PNG 内容；null = 做不了（调用方保留 SVG）
 */
function 光栅化(svgBuf, 缓存目录) {
  const 浏览器 = 找浏览器();
  if (!浏览器) return null;
  const svgText = svgBuf.toString('utf8');
  const 尺寸 = 读尺寸(svgText);
  if (!尺寸) return null;

  const 目标 = path.join(缓存目录, 缓存名(svgBuf, 尺寸.w, 尺寸.h));
  if (fs.existsSync(目标) && fs.statSync(目标).size > 0) {
    try { return fs.readFileSync(目标); } catch (e) { /* 重新生成 */ }
  }

  const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), 'k4svg-'));
  const 源文件 = path.join(临时, 'in.svg');
  const 出图 = path.join(临时, 'out.png');
  try {
    fs.writeFileSync(源文件, svgBuf);
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      // 关键：透明背景，否则会糊上一层白底
      '--default-background-color=00000000',
      // 关键：独立的 user-data-dir，绝不碰用户正在用的 Edge 配置
      '--user-data-dir=' + path.join(临时, 'profile'),
      '--window-size=' + 尺寸.w + ',' + 尺寸.h,
      '--screenshot=' + 出图,
      'file:///' + 源文件.replace(/\\/g, '/')
    ];
    // stdio:'ignore'：Edge 会往 stderr 刷一堆无关的 renderer 日志，不需要看
    cp.spawnSync(浏览器, args, { stdio: 'ignore', timeout: 60000, windowsHide: true });
    if (!fs.existsSync(出图) || fs.statSync(出图).size === 0) return null;
    const png = fs.readFileSync(出图);
    // 校验它真的是 PNG
    if (png.length < 8 || png[0] !== 0x89 || png.toString('ascii', 1, 4) !== 'PNG') return null;
    建目录(缓存目录);
    try { fs.writeFileSync(目标, png); } catch (e) { /* 缓存写不了也无所谓 */ }
    return png;
  } catch (e) {
    return null;
  } finally {
    try { fs.rmSync(临时, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

module.exports = { 诊断, 含文字, 读尺寸, 读位图尺寸, 光栅化, 批量光栅化, 缓存键, 找浏览器, 抽取内嵌位图 };
