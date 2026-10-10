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
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = _rv(d, f);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.git/.test(f)) walk(p); }
    else if (/\.js$/.test(f)) files.push(p);
  }
})(_rv(ROOT, 'js'));

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

let bad = 0;
for (const [abs, stamps] of [...byTarget].sort()) {
  if (stamps.size <= 1) continue;
  bad++;
  console.log(`  ❌ ${_rel(ROOT, abs)} 被当成 ${stamps.size} 个实例加载`);
  for (const [stamp, users] of stamps) {
    console.log(`       ${stamp.padEnd(8)} ← ${[...users].join(', ')}`);
  }
}
console.log(bad ? `\n模块身份分裂: ${bad} 处` : '✅ 每个模块都只有一个实例');
process.exit(bad ? 1 : 0);
