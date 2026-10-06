/* =============================================================================
 * svgrender.js —— SVG -> PNG 的并行渲染工人（独立进程，由 svg.js 调用）
 * =============================================================================
 *
 * 为什么不直接在 convert.js 里串行 spawnSync：
 *   一次 Edge 冷启动（建 profile、起 renderer）要好几秒。
 *   165 个 SVG 串行 = **883 秒**，完全不能用。
 *
 * 这里做两件事：
 *   ① **每个工人一个常驻 user-data-dir** —— profile 建一次就一直复用，
 *      后面每次启动只花几百毫秒；
 *   ② 开 N 个工人并行跑。
 *
 * 用法： node svgrender.js <jobs.json>
 *   jobs.json = { browser, concurrency, tmpRoot, profileRoot,
 *                 jobs: [ { svg, png, w, h } ] }
 * 结果**直接写进 jobs[i].png**；stdout 最后一行 `PNGOK <成功> <失败>`。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const 配置 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const 浏览器 = 配置.browser;
const 任务 = 配置.jobs || [];
const 并发 = Math.max(1, Math.min(配置.concurrency || 6, 任务.length || 1));

let 下一个 = 0;
let 成功 = 0;
let 失败 = 0;

function 渲染(工人号, 任务项, profileDir, 超时秒) {
  return new Promise(function (完成) {
    const 参数 = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--hide-scrollbars',
      // 关键：真透明背景，否则会给图糊一层白底
      '--default-background-color=00000000',
      '--user-data-dir=' + profileDir,
      '--window-size=' + 任务项.w + ',' + 任务项.h,
      '--screenshot=' + 任务项.png,
      'file:///' + String(任务项.svg).replace(/\\/g, '/')
    ];
    let 子进程;
    let 结束 = false;
    function 收尾() {
      if (结束) return;
      结束 = true;
      clearTimeout(定时);
      完成();
    }
    try {
      子进程 = cp.spawn(浏览器, 参数, { stdio: 'ignore', windowsHide: true });
    } catch (e) {
      完成();
      return;
    }
    // ★硬看门狗★：超时后强杀，并且**不再等 exit 就收尾**。
    //   以前超时只 kill() 却继续等 exit —— 一旦 kill 没生效（Edge 卡在
    //   建窗口上），那个工人就永远卡住，整个进程池再也不推进。
    const 定时 = setTimeout(function () {
      try { 子进程.kill('SIGKILL'); } catch (e) { /* 已退出 */ }
      收尾();
    }, 超时秒 * 1000);
    子进程.on('exit', 收尾);
    子进程.on('error', 收尾);
  });
}

function 出图有效(p) {
  try { return fs.existsSync(p) && fs.statSync(p).size > 8; } catch (e) { return false; }
}

async function 主流程() {
  const 总并发 = 并发;
  const 工人们 = [];
  for (let w = 0; w < 总并发; w++) {
    工人们.push((async function (工人号) {
      const profile = path.join(配置.profileRoot, 'p' + 工人号);
      for (;;) {
        const i = 下一个++;
        if (i >= 任务.length) return;
        // 常驻 profile 会被复用 —— 绝大多数任务都是"热启动"，快得多
        await 渲染(工人号, 任务[i], profile, 90);
        if (出图有效(任务[i].png)) 成功++; else 失败++;
      }
    })(w));
  }
  await Promise.all(工人们);

  // ★失败重试★：用**全新 profile** 串行重跑。
  //   并发跑时偶发失败的根因是 profile 被上一轮的残留进程占住
  //   （Chromium 单实例语义：同 user-data-dir 的新进程会被吸收掉、直接退出、
  //    什么也不产出）。全新 profile 没有这个问题；失败数很少，串行不心疼。
  const 待重试 = 任务.filter(function (t) { return !出图有效(t.png); });
  if (待重试.length) {
    const 重试根 = path.join(配置.tmpRoot, 'retry');
    fs.mkdirSync(重试根, { recursive: true });
    for (let i = 0; i < 待重试.length; i++) {
      const t = 待重试[i];
      const profile = path.join(重试根, 'r' + i);
      await 渲染(-1, t, profile, 120);
      if (出图有效(t.png)) { 成功++; 失败--; }
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
    }
  }

  console.log('PNGOK ' + 成功 + ' ' + 失败);
}

主流程();
