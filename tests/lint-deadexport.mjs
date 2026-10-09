#!/usr/bin/env node
// 未使用导出检测(工单 TECHDEBT P1-2 / XX-AUDIT-007)—— **报告模式,不阻断**
//
// 为什么要做这个检测器:
//   TECHDEBT P1-2 的验收标准写的是「跑本文件不再报新条目」,但这个文件**从来没被写出来过**。
//   验收标准指向一个不存在的文件 = 这条债既没清偿,也没法被验证。
//   Z8 侧已先写出一版(纯正则全仓库搜名字),本轮在它基础上按 C1~C6 加固。
//
// 【本文件是 report-only】
//   候选里混着两类东西,机器分不开:
//     1. 真的没人用 → 该删
//     2. 动态访问(obj['NAME'])、HTML 里内联引用、给外部调试开的口子 → 不能删
//   分不清就别让它拦路。所以默认 exit 0,只打印。
//   人工过一遍、把确认该留的写进 deadexport-baseline.txt 之后,
//   再把下面的 REPORT_ONLY 改成 false,它才会阻断新增条目。
//
// ── C1~C6:本轮加固的设计约定 ─────────────────────────────────
// C1 roots 硬编码含 tests/ 与 tools/
//    「外部无人 import」≠「没人调用」。测试与工具都在调用产品代码,
//    漏扫 tests/ 会把测试正在用的导出全判成死代码(上一次 V0.89 事故同源)。
// C2 判定顺序:先判模块内部使用,再判外部引用
//    ENEMY_POOL 这种「在 world.js 里自己用」的导出,只查跨文件会误报。
// C3 同时解析静态 import 与 `await import()`;并处理命名空间成员访问
//    **这是 Z8 版最严重的一个 bug**:它用 `(?<![\w$.])NAME` 做 lookbehind,
//    把 `Enemies.setEnemyMod(...)` 这种「命名空间.成员」形式的调用
//    全部判成零命中 → setEnemyMod 在 js/main.js 被调用 3 次却被报成死导出。
//    已实测复现。必须先解析 import 语句建「命名空间 → 模块」映射,
//    再把 `NS.NAME` 形式的命中认回来。
// C4 同名导出用 add 合并(同名多声明算一个候选)
// C5 动态取值保守处理:`obj[NAME]`、`obj['NAME']` 命中即视为在用,不报错
// C6 剔除对象字面量键:`{ setVolume: fn }` 里的键不是引用,不计入命中
//    否则任何 `{ 名: ... }` 的配置写法都会把导出「洗白」成在用。
//
// 已知局限(写清楚,免得把它的输出当真理):
//   · 动态下标访问 A[someVar] 仍可能漏(变量名拼出来的情况)
//   · eval / new Function 里拼的名字查不到
//   · `export {A, B}` 再导出形式只统计、不判定
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join, relative } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const REPORT_ONLY = true;                 // ← 人工确认完 baseline 后可改 false
const BASELINE = join(ROOT, 'tests/deadexport-baseline.txt');
const SCAN_ROOTS = ['js', 'tests', 'tools'];   // C1:三个都不能漏

// ---------- 收集源文件 ----------
function walk(dir, out = []) {
  const p = join(ROOT, dir);
  if (!existsSync(p)) return out;
  for (const e of readdirSync(p)) {
    if (e === 'node_modules' || e === '__pycache__' || e.startsWith('.')) continue;
    const rel = `${dir}/${e}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(mjs|js)$/.test(e)) out.push(rel);
  }
  return out;
}
const files = SCAN_ROOTS.flatMap(r => walk(r));

// ---------- 收集导出 ----------
/** @type {{name:string, file:string, line:string, kind:string}[]} */
const exportsList = [];
for (const f of files) {
  if (!f.startsWith('js/')) continue;           // 只在产品代码里找导出
  const src = readFileSync(join(ROOT, f), 'utf8').split('\n');
  src.forEach((line, i) => {
    let m;
    if ((m = line.match(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/))) {
      exportsList.push({ name: m[1], file: f, line: line.trim(), kind: 'function' });
    } else if ((m = line.match(/^export\s+class\s+([A-Za-z_$][\w$]*)/))) {
      exportsList.push({ name: m[1], file: f, line: line.trim(), kind: 'class' });
    } else if ((m = line.match(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/))) {
      exportsList.push({ name: m[1], file: f, line: line.trim(), kind: 'const' });
    }
  });
}

// ---------- C3:预载全文 + 解析命名空间映射 ----------
// 把「某个文件里 `import * as X from './p.js'`」记下来,
// 之后遇到 `X.NAME` 就知道它是在用 p.js 的 NAME 导出。
const nsMap = new Map();                     // file -> Map(命名空间名 -> 模块路径)
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  const m = new Map();
  for (const im of src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g)) {
    m.set(im[1], im[2]);
  }
  nsMap.set(f, m);
}

/** 归一化 import 路径 → 仓库内相对路径(js/main.js 里 './game/enemies.js?v=17' → js/game/enemies.js) */
function resolveMod(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const abs = join(_dn(fromFile), spec).replace(/\\/g, '/');
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  return rel.split('?')[0];
}

/** 该文件里有哪些命名空间指向目标模块 */
function nsFor(file, targetMod) {
  const m = nsMap.get(file);
  if (!m) return [];
  const hit = [];
  for (const [ns, spec] of m) {
    if (resolveMod(file, spec) === targetMod) hit.push(ns);
  }
  return hit;
}

// ---------- C2:判定 ----------
// 顺序:先看声明所在模块内部有没有用(C2),再看外部。
const candidates = [];
const names = new Map();          // 同名导出可能有多个,按名字合并(C4)
for (const e of exportsList) {
  if (!names.has(e.name)) names.set(e.name, []);   // C4:合并而非覆盖
  names.get(e.name).push(e);
}

for (const [name, decls] of names) {
  const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
  // 裸名出现次数(不区分前缀),用于内部/外部的粗筛
  const bareRe = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
  // C3:成员访问形式 NAME. / .NAME
  const memberRe = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}\\s*\\.`, 'g');

  let used = false;
  const where = [];

  outer:
  for (const f of files) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');

    // 先算这个文件里,哪些命名空间指向任一声明模块
    const nss = decls.flatMap(d => nsFor(f, d.file));
    const nsRe = nss.length
      ? new RegExp(`(?<![\\w$])(?:${nss.join('|')})\\s*\\.\\s*${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')
      : null;

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      // 跳过声明那一行本身(C2:声明不算使用)
      if (decls.some(d => d.file === f && d.line === ln.trim())) continue;

      // C3:命名空间成员访问 —— Z8 版在这里全漏
      if (nsRe) { nsRe.lastIndex = 0; if (nsRe.test(ln)) { used = true; where.push(`${f}:${i + 1}`); break outer; } }

      // C5:动态取值 obj[NAME] / obj['NAME'] 保守算在用
      const dynRe = new RegExp(`\\[\\s*['"\`]?${name.replace(/\$/g, '\\$')}['"\`]?\\s*\\]`, 'g');
      dynRe.lastIndex = 0;
      if (dynRe.test(ln)) { used = true; where.push(`${f}:${i + 1}`); break outer; }

      // 裸名命中(去注释后)
      const stripped = ln.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (stripped.trim().startsWith('//')) continue;      // 整行是注释 → 不算
      // 全行扫描**每一个**命中位置,而不是只看第一个。
      //   为什么:同一行里可能先出现一次「不算引用」的形态,后面才是真引用。
      //   实测踩坑:js/xiuxian/world.js:57
      //     export const WORLD = { nodes: MAP, edges: buildEdges(), grid: 6 };
      //   `search()` 命中的是前面某处,真调用 `buildEdges()` 反而没被看到,
      //   导致一个**在自己模块内被调用**的导出被误报成死代码。
      let bareHit = false;
      bareRe.lastIndex = 0;
      let mm;
      while ((mm = bareRe.exec(stripped)) !== null) {
        const idx = mm.index;
        const before = stripped.slice(Math.max(0, idx - 3), idx);
        const after = stripped.slice(idx + name.length, idx + name.length + 1);
        // `...NAME` 展开运算符 —— 是真实使用,不能当成成员访问排除掉。
        //   (js/sprites.js 的 PIX 聚合就是这么用的:
        //    export const PIX = { ...PIX_GROUND, ...PIX_HERO_KNIGHT, ... })
        //   这是加固时踩过的坑:第一版按「后面紧跟 . 」判成员访问,
        //   结果 12 个 PIX_* 全被误报成死导出。展开是**引入**,不是**访问**。
        const isSpread = before.endsWith('...');
        // C3/C5:`SOMEOBJ.NAME` 形式的成员访问按「在用」算。
        //   为什么要保守:命名空间导入只是其中一种写法,本仓库还有
        //   `const C = Camp; C.momochaIn()` 这种解构后再挂到别的对象上的
        //   (tests/t84.mjs:28 就这么调 momochaIn)。
        //   静态解析追不到别名链,而漏报的代价(把在用的导出当死代码删掉)
        //   远大于误报的代价(多列一条让人看一眼)。所以成员访问一律算在用。
        const isMemberTail = !isSpread && after === '.';
        const isMemberHead = !isSpread && before.trimEnd().endsWith('.');
        if (isMemberTail) { bareHit = true; break; }   // NAME. 形式是访问,算在用
        if (isSpread)     { bareHit = true; break; }   // ...NAME 是引入,算在用
        // 排除 import 语句本身(那是「引用来源」不是「使用」)
        if (/^\s*import\b/.test(stripped)) continue;
        // 只排除「导出声明行」本身,不能整行排除所有以 export 开头的行。
        //   实测踩坑:js/xiuxian/world.js:57
        //     export const WORLD = { nodes: MAP, edges: buildEdges(), grid: 6 };
        //   这一行既导出 WORLD,又在**同一条语句里调用**了本模块的 buildEdges。
        //   早先写成 `/^\s*export\s*$/` 之外的宽松版,把这行整行跳过了,
        //   于是 buildEdges 被误报成死代码 —— 而它恰恰是 C2 要抓的
        //   「模块内部自用」场景。声明行已在上面按 `d.line === ln.trim()` 精确跳过,
        //   这里只需再挡 `export ... from`(再导出)与 `export * from`。
        if (/^\s*export\s+(\*|\{[^}]*\})\s+from\b/.test(stripped)) continue;
        // C6:对象字面量键 `{ NAME: ... }` 里的 NAME 是键名不是引用,
        //     不能让它把一个没人用的导出「洗白」成在用。
        if (after === ':' && !isMemberHead) continue;
        bareHit = true; break;
      }
      if (bareHit) { used = true; where.push(`${f}:${i + 1}`); break outer; }
      // 成员访问的「头」(NAME. 形式)也算引用
      memberRe.lastIndex = 0;
      if (memberRe.test(stripped)) {
        used = true; where.push(`${f}:${i + 1}`); break outer;
      }
    }
  }

  if (!used) candidates.push({ name, decls });
}

// ---------- 基线比对 ----------
const known = existsSync(BASELINE)
  ? new Set(readFileSync(BASELINE, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')))
  : new Set();
const fresh = candidates.filter(c => !known.has(c.name));
const accepted = candidates.filter(c => known.has(c.name));

// ---------- 输出 ----------
console.log(`\n未使用导出扫描: ${files.length} 个源文件 · ${exportsList.length} 条导出 · ${names.size} 个唯一名字`);
console.log(`  候选(全仓库除声明行外零命中): ${candidates.length}`);
console.log(`  其中已在基线内、人工确认过:   ${accepted.length}`);
console.log(`  新增候选:                     ${fresh.length}`);

if (fresh.length) {
  console.log('\n新增候选(机器分不出「真死」还是「动态访问」,需人工判):');
  for (const c of fresh) {
    const d = c.decls[0];
    console.log(`  · ${c.name.padEnd(22)} ${d.file}  (${d.kind}, 共 ${c.decls.length} 处声明)`);
    console.log(`      ${d.line.slice(0, 96)}`);
  }
}

if (process.argv.includes('--write-baseline')) {
  const lines = [
    '# 未使用导出 · 人工确认清单',
    '#',
    '# 写进来 = 确认「这个导出不能删」。理由写清楚,别只列名字:',
    '#   · 动态访问 / HTML 内联引用 / 给调试留的口子',
    '#   · 计划用(注明挂在哪个工单上)',
    '# 确认没人用的,**不要**写进来 —— 它会一直出现在上面那份清单里提醒你删。',
    '',
    ...candidates.map(c => c.name),
    '',
  ];
  writeFileSync(BASELINE, lines.join('\n'));
  console.log(`\n✅ 基线已写:${BASELINE}(${candidates.length} 条)`);
}

console.log(REPORT_ONLY
  ? '\nℹ️  report-only 模式,不阻断(候选未人工分类,拦住会误伤)。'
  : (fresh.length ? `\n❌ 新增未使用导出 ${fresh.length} 项` : '\n✅ 无新增未使用导出'));
process.exit(REPORT_ONLY ? 0 : (fresh.length ? 1 : 0));