#!/usr/bin/env node
// 断头路检测(工单 XX-AUDIT-027)—— **报告模式,不阻断**
//
// 【它与 `lint-deadexport.mjs` 的分工】
//   lint-deadexport 查「全仓库都没人用」。
//   但它的 C1 规则**硬编码把 `tests/` 与 `tools/` 当 root** ——
//   这条规则本身是对的(测试确实在调用产品代码,漏扫会把在用的导出全判死),
//   **代价就是「只有测试在调」的导出对它完全隐形**。
//
//   本文件专查这一类:**产品代码零调用,却只有测试在调**。
//
// 【为什么这类最危险】
//   它不是死代码,是**半死的代码** —— 看起来在用、测试也过、
//   实际玩家永远走不到。2026-10-10 一天之内就撞见两个:
//     · `_sFeedable` —— ui.js 拆分时被漏掉,源石卡上的「饲」按钮消失,
//       投喂整条链不可达;而四个 act 分支都还在、merge 干净、测试全绿。
//     · `player.gearBonus` —— main.js 算完挂上、recalc() 压根不读,
//       整套装备 17 条词条全部悬空;数据层对、存档对、UI 对,只有战斗数字不变。
//   两者都不报错。**只能靠门禁抓。**
//
// 【判定口径】
//   同一段代码里出现一个名字可能不是调用:
//     · 声明行本身(必须排除)
//     · 对象字面量键 `{ heal: fn }` —— 不是引用
//   所以先建「命名空间 → 模块」映射,再认回 `NS.NAME` 形式,
//   与 lint-deadexport 的 C2/C3/C6 同一套做法,不重新发明。
//
//   **字符串字面量里的出现算产品侧使用**(保守):
//   因为 `data-act="feeddo"` 这类 HTML 内联动作名,就是靠字符串接到 act() 的。
//   把它判成未接线会误报一大片,而误报的代价是这条门禁被人忽略。
//
// 【已知局限(写清楚,免得把输出当真理)】
//   · 动态下标访问 A[someVar] 仍可能漏
//   · eval / new Function 里拼的名字查不到
//   · 经由对象传递的间接调用(存进 map 再取)查不到 —— 这类**恰恰是真正在用的**,
//     所以本门禁报出来的「候选」需要人看,不能直接删
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join, relative } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const REPORT_ONLY = true;                 // 与 lint-deadexport 同策略:分不清就别拦路
const BASELINE = join(ROOT, 'tests/.deadwire-baseline.txt');

/** 产品代码目录 vs 消费侧目录 */
const PRODUCT_DIRS = ['js'];
const CONSUMER_DIRS = ['tests', 'tools'];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')          // 块注释
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');     // 行注释(避开 http://)

/** 取一个文件里的所有导出名 */
function exportsOf(src) {
  const code = strip(src);
  const names = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g))
    names.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of m[1].split(',')) {
      const t = part.trim().split(/\s+as\s+/);
      const n = (t[1] || t[0] || '').trim();
      if (n) names.add(n);
    }
  return [...names];
}

/**
 * 建「本地绑定 → 本模块」映射,用来认回 `NS.NAME` 形式。
 * 与 lint-deadexport C3 同解法:先解析 import,再按命名空间查。
 */
function namespacesOf(code) {
  const map = new Map();
  for (const m of code.matchAll(/import\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from/g))
    map.set(m[1], true);
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g))
    for (const part of m[1].split(',')) {
      const t = part.trim().split(/\s+as\s+/);
      const local = (t[1] || t[0] || '').trim();
      if (local && local !== t[0]) map.set(t[0].trim(), local);   // 原名 → 别名
    }
  return map;
}

/** 对象字面量键不算引用(C6):把 `{ name: ... }` 里的 name 挖掉 */
function dropObjectKeys(code) {
  return code.replace(/\{[^{}]{0,400}?\}/g, m => m.replace(/([A-Za-z_$][\w$]*)\s*:/g, ' _:'));
}

/**
 * 统计一个名字在某个文件里出现多少次(排除声明、排除对象键)。
 * 用词边界而不是裸子串,免得 `heal` 被 `healT` 命中。
 */
function hits(code, nsMap, name) {
  let c = strip(code);
  c = dropObjectKeys(c);
  // 先把 `NS.NAME` 归一成 `NAME`,否则命名空间形式会漏
  if (nsMap.size) {
    for (const ns of nsMap.keys()) {
      c = c.replace(new RegExp(`\\b${ns.replace(/\$/g, '\\$')}\\.${name}\\b`, 'g'), name);
    }
  }
  // 排除声明行:`export function NAME` / `export const NAME`
  c = c.replace(new RegExp(`export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+${name}\\b`, 'g'), ' ');
  // 词边界计数
  const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
  return (c.match(re) || []).length;
}

// ── 扫描 ────────────────────────────────────────────────────
const productFiles = PRODUCT_DIRS.flatMap(d => walk(join(ROOT, d)));
const consumerFiles = CONSUMER_DIRS.flatMap(d => walk(join(ROOT, d)));

const prodCache = productFiles.map(f => ({
  file: relative(ROOT, f),
  src: readFileSync(f, 'utf8'),
}));

const findings = [];
for (const pf of prodCache) {
  const nsMap = namespacesOf(pf.src);
  for (const name of exportsOf(pf.src)) {
    let prod = 0, who = [];
    for (const other of prodCache) {
      const n = hits(other.src, other === pf ? nsMap : namespacesOf(other.src), name);
      if (n > 0) { prod += n; if (other.file !== pf.file) who.push(other.file); }
    }
    if (prod > 0) continue;                       // 产品侧有用 → 不是本门禁的事

    let cons = 0;
    const consWho = [];
    for (const cf of consumerFiles) {
      const n = hits(readFileSync(cf, 'utf8'), new Map(), name);
      if (n > 0) { cons += n; consWho.push(relative(ROOT, cf)); }
    }
    if (cons === 0) continue;                     // 纯死导出 → lint-deadexport 管

    findings.push({ name, decl: pf.file, tests: cons, who: consWho });
  }
}

// ── 基线(人工确认过的,不报) ────────────────────────────────
const baseline = existsSync(BASELINE)
  ? new Set(readFileSync(BASELINE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean))
  : new Set();
const fresh = findings.filter(f => !baseline.has(`${f.decl} :: ${f.name}`));

console.log(`断头路扫描: ${prodCache.length} 个产品文件 · ${findings.length} 处「仅测试在调」`);
console.log(`  已在基线内、人工确认过: ${findings.length - fresh.length}`);
console.log(`  新增候选:               ${fresh.length}`);

if (fresh.length) {
  console.log('\n新增候选(机器分不出「真死」还是「间接调用」,需人工判):');
  for (const f of fresh) {
    console.log(`  · ${f.name}  (声明于 ${f.decl},仅被 ${f.tests} 处测试/工具引用)`);
    console.log(`      ${f.who.slice(0, 3).join(', ')}${f.who.length > 3 ? ' …' : ''}`);
  }
  console.log('\nℹ️  经由对象传递的间接调用查不到 —— 这类恰恰是**真正在用的**,');
  console.log('   所以删之前必须人看。确认该删的写进 tests/.deadwire-baseline.txt');
  console.log(`   格式:  <声明文件> :: <导出名>`);
}

if (REPORT_ONLY) console.log('\nℹ️  report-only 模式,不阻断(候选未经人工分类,拦住会误伤)。');
process.exit(0);