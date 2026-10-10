// 依赖图 lint —— 工单 XX-UNK-001
// 运行: node tests/lint-deps.mjs
//
// 查三件事,任何一条不满足就 exit 1:
//
//   1. 循环依赖 —— ES module 里循环不一定会立刻炸,但会让模块的初始化顺序
//      变成隐式依赖,改一个文件就可能连锁出问题,而且极难定位。
//   2. 从入口 main.js 不可达的模块 —— **真死代码**。
//      这条是本文件的主要价值:spine.js 曾经写好、单测 26/26 全绿、文件也在仓库里,
//      但没有任何模块 import 它。上面三条测试一条都抓不到,只有可达性能抓。
//   3. 无人 import 的模块(孤儿)—— 允许的只有入口本身。
//
// 用法: node tests/lint-deps.mjs [--verbose]
import { readdirSync, readFileSync } from 'fs';
import { dirname, resolve, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'js/main.js';
const VERBOSE = process.argv.includes('--verbose');

// ---------- 收集模块 ----------
const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = d + sep + e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(resolve(ROOT, 'js'));
const id = p => relative(ROOT, p).split(sep).join('/');
const ids = new Set(files.map(id));

// ---------- 建图(只认静态 import;动态 import() 不构成初始化期依赖)----------
const graph = new Map();
const unresolved = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const deps = new Set();
  for (const m of src.matchAll(/(?:^|[;\n])\s*import\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g)) {
    const raw = m[1];
    if (!raw.startsWith('.')) continue;                 // 裸说明是外部依赖
    const spec = raw.split('?')[0];                     // main.js 大量用 ?v=17
    let t = id(resolve(dirname(f), spec));
    if (!ids.has(t)) t += '.js';
    if (ids.has(t)) deps.add(t);
    else unresolved.push(`${id(f)} → ${raw}`);
  }
  graph.set(id(f), [...deps].sort());
}

let bad = 0;

// ---------- 1. 循环依赖(Tarjan)----------
let idx = 0;
const index = new Map(), low = new Map(), onstk = new Set(), stk = [], sccs = [];
function strong(v) {
  index.set(v, idx); low.set(v, idx); idx++; stk.push(v); onstk.add(v);
  for (const w of graph.get(v) || []) {
    if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onstk.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const c = []; let w;
    do { w = stk.pop(); onstk.delete(w); c.push(w); } while (w !== v);
    sccs.push(c);
  }
}
for (const v of graph.keys()) if (!index.has(v)) strong(v);

const cycles = sccs.filter(c => c.length > 1 || (graph.get(c[0]) || []).includes(c[0]));
if (cycles.length) {
  console.log(`  ❌ 检出 ${cycles.length} 处循环依赖:`);
  for (const c of cycles) {
    console.log(`     ${[...c].reverse().join(' → ')} → ${c[0]}`);
    for (const n of c) for (const d of graph.get(n) || [])
      if (c.includes(d)) console.log(`        ${n} → ${d}`);
  }
  bad++;
} else {
  console.log('✅ 无循环依赖');
}

// ---------- 2. 从入口不可达 = 真死代码 ----------
const seen = new Set(); const stack = [ENTRY];
while (stack.length) {
  const v = stack.pop(); if (seen.has(v)) continue; seen.add(v);
  for (const w of graph.get(v) || []) if (!seen.has(w)) stack.push(w);
}
// 【阶段化白名单】—— 2026-10-10 工单 XX-WORLD-001 起
//
// 有些模块是**故意**先落地、后接线的:大世界的 types/nodes/regions/network
// 四件套按工单要求「纯数据落地、FEATURE_FLAGS 全 false、world.js 一行不改」,
// 也就是阶段 0。它此刻必然是死代码 —— 但它是**有计划地**死,不是忘了接线。
//
// 白名单规则(刻意做得很严):
//   · 必须逐个列出文件路径,不允许前缀/通配
//   · 必须写清「哪个工单、哪个阶段接它」
//   · 阶段一旦落地,该条**必须删掉** —— 否则就变成了永久豁免,而豁免是腐烂的起点
// 到期没删时,本门禁会打印提醒(不阻断),让「该接线的还没接」重新变得可见。
// 只剩阶段 2 的了:types/nodes/regions 已随 XX-WORLD-004 接线,自己过期了。
const STAGED = {
  'js/xiuxian/world/network.js': 'XX-WORLD-005 阶段 2:Dijkstra 赶路',
};

// 【纯类型声明文件】—— 与 STAGED 是两回事,别混为一谈
//
// STAGED 说的是「**有计划地还没接线**」,阶段一到就该删条目。
// TYPE_ONLY 说的是「**运行期本来就不该有谁 import 它**」——纯 typedef 模块,
// 引用只存在于 JSDoc 的 `import('./types.js')` 里,而 JSDoc 是注释,
// 注释在打包/运行期被擦除,所以依赖图上它永远是孤立点。
// 把它塞进 STAGED 会撒谎:它不会在某个阶段「接上线」,那条 ⚠️ 过期提醒
// 也会永远响,提醒一响就等于没提醒。
const TYPE_ONLY = {
  'js/xiuxian/world/types.js': '大世界类型契约。引用只在 JSDoc import() 里,运行期无人 import 是**正确状态**',
};
const dead = [...graph.keys()].filter(k => k !== ENTRY && !seen.has(k)).sort();
const deadStaged = dead.filter(d => STAGED[d]);
const deadTypes = dead.filter(d => TYPE_ONLY[d]);
const deadReal = dead.filter(d => !STAGED[d] && !TYPE_ONLY[d]);
if (deadReal.length) {
  console.log(`  ❌ ${deadReal.length} 个模块从 ${ENTRY} 不可达(写好了但没人用):`);
  deadReal.forEach(d => console.log(`     ${d}`));
  bad++;
} else {
  console.log(`✅ 无死代码(${graph.size} 个模块全部从入口可达${deadStaged.length ? `,${deadStaged.length} 个阶段化暂存` : ''}${deadTypes.length ? `,${deadTypes.length} 个纯类型模块` : ''})`);
}
for (const d of deadStaged) {
  console.log(`  ⏳ 暂存(按计划未接线): ${d}  ← ${STAGED[d]}`);
}
for (const d of deadTypes) {
  console.log(`  📐 类型声明(运行期无 importer 属正常): ${d}  ← ${TYPE_ONLY[d]}`);
}

// 白名单自身也要能过期:阶段早就到了却还挂着,提醒一次
for (const [p, why] of Object.entries(STAGED)) {
  if (!dead.some(d => d === p)) {
    console.log(`  ⚠️ 白名单里的 ${p} 已经接上线了,这条可以删掉(${why})`);
  }
}

// ---------- 3. 孤儿(无人 import) ----------
const imported = new Set([...graph.values()].flat());
const orphan = [...graph.keys()].filter(k => k !== ENTRY && !imported.has(k));
const orphanReal = orphan.filter(o => !STAGED[o] && !TYPE_ONLY[o]);
if (orphanReal.length) {
  console.log(`  ❌ ${orphanReal.length} 个模块无人 import:`);
  orphanReal.forEach(d => console.log(`     ${d}`));
  bad++;
}

// ---------- 4. 悬空 import ----------
if (unresolved.length) {
  console.log(`  ❌ ${unresolved.length} 处 import 指向不存在的文件:`);
  unresolved.forEach(u => console.log(`     ${u}`));
  bad++;
}

const edges = [...graph.values()].reduce((a, b) => a + b.length, 0);
console.log(`  ℹ️  ${graph.size} 个模块 · ${edges} 条导入边`);
if (VERBOSE) {
  const fanout = [...graph.entries()].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('  ℹ️  被依赖最多的模块:');
  fanout.forEach(([k, n]) => console.log(`     ${String(n).padStart(3)} ← ${k}`));
}

console.log(bad ? `\n依赖图检查失败: ${bad} 项` : '');
process.exit(bad ? 1 : 0);