// tests/lint-module-identity.mjs —— 同一个模块不能被当成多个实例加载
// 运行: node tests/lint-module-identity.mjs
//
// 背景(XX-LINK-001 排查时实测撞上,2026-10-10):
//   ESM 里 `./spawner.js` 和 `./spawner.js?v=18` 是**两个不同的 URL**,
//   浏览器/Node 各自建一份模块记录,于是模块级的 `let` 是两份。
//   实测:
//     const a = await import('./js/game/spawner.js')
//     const b = await import('./js/game/spawner.js?v=18')
//     a.setRunTune === b.setRunTune   // false
//     b.setRunTune({hpMult:7}); a.getRunTune().hpMult   // 1 —— 写进去的读不到
//
//   实际后果:js/xiuxian/ui.js 无戳 import 了 spawner.js,而 js/main.js 用
//   ?v=18 import。ui.arrive() 里 setCollatzTrajectory() 写的是**另一份实例**,
//   于是 Collatz 曲线(XX-MATH-001,31 项门禁全绿)在真游戏里恒等于 1 ——
//   是个不报错的死特性。回归测试测的是"接线接对了",测不出"这份接线在不在
//   那条会被真正执行的模块实例上"。
//
// 为什么这类 bug 特别难查:两边**单测都全绿**。门禁只保证代码写对,
// 不保证它跑在玩家实际加载的那份实例上。
//
// 判据:剥注释/字符串(用 lib-uimod 的 codeMask —— 朴素正则会被注释里的
// /* 吞掉真代码,本轮就中过一次),把每个相对路径字面量归一到**无戳的真实文件
// 路径**,再统计它被写过几种不同的 URL 形态。>1 种即分裂。
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, relative as _rel } from 'path';
import { codeMask } from './lib-uimod.mjs';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const files = [];
// ⚠️ 原来只扫 js/。实测漏掉了**测试自己制造的一次真实分裂**(2026-10-11):
//   tests/collatz-difficulty-regression.mjs 无戳 import 了 ../js/game/spawner.js,
//   而它同一份文件里 await import('../js/ui/hud.js'),后者内部用 ?v=18 加载 spawner。
//   于是测试 setCollatzTrajectory() 写的那份 ≠ HUD 读的那份,
//   计时器后缀整个消失(渲染成「48:40」),两条断言红了。
//
//   也就是说:**这道门禁当时本该拦住这个 bug,但它自己没看 tests/。**
//   测试代码同样是 ESM,同样会按 URL 建模块记录 —— 扫 js/ 是不够的。
for (const dir of ['js', 'tests']) {
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = _rv(d, f);
      if (statSync(p).isDirectory()) { if (!/node_modules|\.git/.test(f)) walk(p); }
      else if (/\.(js|mjs)$/.test(f)) files.push(p);
    }
  })(_rv(ROOT, dir));
}

/** 抽出一个源文件里所有「真的是 import 进来的相对路径」 */
function relImports(src) {
  const m = codeMask(src);
  const out = [];
  for (const s of m.strings) {
    if (!/^['"]/.test(s.q || '')) continue;
    const body = src.slice(s.start + 1, s.end - 1);
    if (!/^\.\.?\//.test(body)) continue;
    // 必须在真代码里跟在 from / import 后面,而不是恰好出现在注释里
    if (!/\b(?:from|import)\s*$/.test(m.code.slice(0, s.start))) continue;
    out.push(body);
  }
  return out;
}

const byTarget = new Map();   // 真实路径 -> Map(stamp -> Set(导入方))
const add = (abs, spec, from) => {
  if (!byTarget.has(abs)) byTarget.set(abs, new Map());
  const stamp = spec.includes('?') ? spec.slice(spec.indexOf('?')) : '(无戳)';
  if (!byTarget.get(abs).has(stamp)) byTarget.get(abs).set(stamp, new Set());
  byTarget.get(abs).get(stamp).add(from);
};

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const spec of relImports(src)) {
    const abs = _rv(_dn(f), spec.split('?')[0]);
    if (!existsSync(abs) || !/\.js$/.test(abs)) continue;
    add(abs, spec, _rel(ROOT, f));
  }
}
// index.html 的 <script src="js/main.js?v=NN"> 也是一次加载,同样会分裂
{
  const html = readFileSync(_rv(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+\.js)(?:\?[^"']*)?["']/g)) {
    const abs = _rv(ROOT, m[1]);
    if (existsSync(abs)) add(abs, m[0].includes('?') ? m[0].slice(m[0].indexOf('?')) : '(无戳)', 'index.html');
  }
}

let bad = 0, warn = 0;
for (const [abs, stamps] of [...byTarget].sort()) {
  if (stamps.size <= 1) continue;
  // 分级,不是一刀切。判据是**只看 js/ 内部的那些用户**:
  //
  //   js/ 侧的戳不止一种 → **产品 bug**:玩家加载的就是分裂的那两份,
  //     特性会静默失效(本仓真实踩过:ui.js 无戳 + main.js ?v=18,
  //     COLLATZ 曲线恒等于 1)。硬错,必须拦住。
  //
  //   js/ 侧戳一致、只有 tests/ 不同 → 只报警不拦。多数回归测试直接
  //     import 被测模块、只验纯函数,实例不同完全无害;一刀切成 ❌ 就是
  //     误报制造机。但它会咬人 —— 实测咬过:collatz 那份测试自己 import 了
  //     无戳的 spawner,又 await 了 hud.js(内部 ?v=18),状态写进去读不到,
  //     计时器后缀整个消失。**只有跨实例断言时才是 bug**,静态判不出来。
  //
  // ⚠️ 判据里**不能**写"是否牵涉 tests/" —— 第一版就是这么写的,
  //   结果 tests/ 的文件把真正的产品分裂给**掩盖**了:注入 ui.js 掉戳之后,
  //   门禁仍然只报 ⚠️、退出码 0。测试是旁观者,没有投票权。
  const prodStamps = new Set();
  for (const [stamp, us] of stamps) {
    if ([...us].some((u) => !u.startsWith('tests/'))) prodStamps.add(stamp);
  }
  const isProduct = prodStamps.size > 1;
  if (isProduct) {
    bad++;
    console.log(`  ❌ ${_rel(ROOT, abs)} 被当成 ${prodStamps.size} 个实例加载(产品侧)`);
  } else {
    warn++;
    console.log(`  ⚠️  ${_rel(ROOT, abs)}:测试用的实例和生产不同(产品侧一致,故不阻断)`);
    console.log(`       (只有当该测试**跨实例断言**时才是 bug —— 例如它还加载了`);
    console.log(`        内部按别的戳加载本模块的生产模块,状态写进去读不到)`);
  }
  for (const [stamp, us] of stamps) {
    console.log(`       ${stamp.padEnd(8)} ← ${[...us].join(', ')}`);
  }
}
if (warn) console.log(`\n  ℹ️  上述 ${warn} 处为测试侧,不阻断;产品侧 ${bad} 处`);
console.log(bad ? `\n模块身份分裂: ${bad} 处` : '✅ 产品侧每个模块都只有一个实例');
process.exit(bad ? 1 : 0);
