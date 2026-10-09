// XX-BUG-A 防回归 —— updater 累积闸门
//
// 背景:engine.updaters 只在构造函数里清空,局与局之间从不清空。
// main.js 的「开局装配」里有 7 处 engine.addUpdater,每开一局就多注册一个副本,
// 于是 SPIRIT.tick() 每帧被跑 N 遍,灵气计数爆到八千万。
//
// 这个 lint 盯两件事:
//   1. engine 提供 addUpdaterOnce 原语
//   2. main.js 里裸 addUpdater 只允许出现在开机装配之外(目前只剩 line 55 的灵伴)
//
// 为什么不让它自动修:这要判断「这一处是不是在会被重跑的函数里」,那是语义问题。
// 宁可误报让人来看一眼,也不放过 —— XX-BUG-A 的代价是玩家看着数字爆表。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

let fail = 0;
const ok = (n, c, d = '') => {
  if (c) console.log(`  ✓ ${n}`);
  else { fail++; console.log(`  ❌ ${n} ${d}`); }
};

console.log('\n[1] engine 提供 addUpdaterOnce');
const eng = read('js/core/engine.js');
ok('engine.js 有 addUpdaterOnce', /addUpdaterOnce\s*\(\s*key/.test(eng));
ok('addUpdaterOnce 内部有去重集合', /this\._once\s*=\s*this\._once\s*\|\|\s*new Set\(\)/.test(eng));
ok('addUpdaterOnce 命中已注册的 key 时返回 false', /if\s*\(this\._once\.has\(key\)\)\s*return false;/.test(eng));

console.log('\n[2] main.js 开局装配区不得用裸 addUpdater');
const main = read('js/main.js');
const lines = main.split('\n');
const bare = [];
lines.forEach((l, i) => {
  // 裸调用:engine.addUpdater( 但不是 addUpdaterOnce(
  if (/engine\.addUpdater\(/.test(l)) bare.push(i + 1);
});
ok(`裸 addUpdater 只出现在开机处(共 ${bare.length} 处，行 ${bare.join(',') || '无'})`,
   bare.length <= 1, `发现 ${bare.length} 处，多余的会随局数累积`);

const once = (main.match(/engine\.addUpdaterOnce\(/g) || []).length;
ok(`开局装配的 7 处已改走 addUpdaterOnce（当前 ${once} 处）`, once >= 7);

console.log(`\nlint-updaters: ${fail ? 'FAIL' : 'PASS'} (${fail ? fail : 'ok'})`);
process.exit(fail ? 1 : 0);