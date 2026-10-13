#!/usr/bin/env node
// 死成员检测 —— 「导出对象/常量表上声明了,但没人按名字读过」
//
// 【它补的是哪两个盲区】
//   lint-deadexport.mjs 与 lint-deadwire.mjs 都只扫**模块级导出名**:
//     export function foo / export const FOO
//   它们把「一个名字出现了几次」当判据。于是本项目里两大类真实 API 面**完全隐形**:
//
//   (1) 导出常量表的字段 —— `export const STAGES = [{ key, name, need, bg, desc }, …]`
//       lint-deadexport 看到 `STAGES` 被读了 12 次,判「在用」;
//       五个元素里**每一个**字段都可能是死的,它一个都看不见。
//   (2) 导出对象上的成员 —— `export const COMPANION = { load(){}, form(){}, … }`
//       同样:`COMPANION` 被读了 40 次,判「在用」;
//       `COMPANION.form` 有没有第二个调用点,它看不见。
//
//   2026-10-11 实测同时踩中两个:`MUTATION.STAGES[].bg` 写进 derive() 后零读取、
//   `COMPANION.form()` 零调用点。两个都是「图没到位 → 没接线」的半成品,
//   测试全绿、merge 干净、merge 干净、玩家什么都看不到。
//
// 【为什么不能按裸名字数 —— 必须做限定访问】
//   本仓库里 `bg` 同时是两个毫不相干的东西:
//     STAGES[].bg    = 0~4 的数字(立绘背景档位)
//     FAMILIES[].bg  = '墓园水墨' 这样的字符串(美术方向词)
//   按裸名字数,FAMILIES 那 6 处声明会把 STAGES 的 `bg` 洗成「有 6 处读取」→ 假绿。
//   **同名不同义,是这条门禁唯一真正的难点**,所以口径写死为「限定访问」:
//     实体 E 的成员 m 被读过 ⇔ 出现过 `E.m` / `NS.E.m` / `E[i].m` / 解构 / 整体展开。
//
// 【判据是怎么定出来的 —— 先普查,后定线】
//   与 lint-dead-state-field.mjs 同一条纪律:先把 js/ 下所有「导出对象/表」普查一遍,
//   看清楚哪些能稳定判、哪些判不准,再决定线画在哪。普查用 --census(不阻断)。
//   **判不准的一律不编成断言**,只列出来给人看。假红的代价是让人学会忽略门禁。
//
// 【已知局限(写清楚,免得把输出当真理)】
//   · 经由对象传递的间接调用查不到(`const C = COMPANION; C.form()`),
//     这类**恰恰是真正在用的** —— 所以报出来的「候选」需要人看,不能直接删。
//   · **同名回调参数按「一名对多」处理 ⇒ 多记读点 ⇒ 漏报方向。**
//     ⚠️ 实测:抹掉 gearIcons.js 里唯一的 `SLOTS.map(s => s.icon)` 之后,
//        `SLOTS.icon` 仍被判活 —— 该文件另一个回调里的 `s`
//        (来自 `const s = SLOT_BY_KEY.get(k)`,与 SLOTS 无关)让 `s#icon`
//        一并回译到了 SLOTS。这是「宁可漏报不可误杀」的实付代价,
//        也是默认 report-only 唯一诚实的理由。
//   · 中缀表达式读不出来:`(a ? b : c).name` 识别不了。
//   · **不追传递死**:方法返回值(derive() 那类)的字段看不见。
//     `STAGES[].bg` 之所以报不出来,是因为 derive() 里有一句 `bg: STAGES[st].bg`
//     —— 字段确实有读点,可读它的那行本身就在一条零调用点的死路径上。
//     「靠死路径活着的字段」只能靠删掉死路径暴露,静态判不出。
//   · **不追** `this.m` 的间接层(比如 a() 调 this.b() 里的 this.s.run),
//     只认字面写出来的成员名。
//
// 用法:
//   node tests/lint-dead-member.mjs                  门禁(退出码 0/1/2)
//   node tests/lint-dead-member.mjs --census         普查:全量列出,不阻断
//   node tests/lint-dead-member.mjs --self-check     自检:引擎方向反了必须被抓住(退出码 1)
//   node tests/lint-dead-member.mjs --write-baseline [--force]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join, relative } from 'path';
import { codeMask } from './lib-uimod.mjs';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const BASELINE = join(ROOT, 'tests/dead-member-baseline.json');
const PRODUCT_DIRS = ['js'];
const CONSUMER_DIRS = ['tests', 'tools'];

const has = (...f) => f.includes(process.argv[2]) || f.some(a => process.argv.includes(a));

/* ═══════════════════════ 1. 文件与词法 ═══════════════════════ */

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

/**
 * 每个文件解析一次,后面所有匹配都在 masked code 上做。
 * ⚠️ 用 lib-uimod 的 codeMask 而不是自己再写一个:它已经踩过嵌套模板串
 *    (ui 层 7 处,最长的吞掉 3039 字符)和正则字面量两个坑,重写等于重踩。
 * `src` 与 `code` **等长且下标对齐** —— 字符串在 code 里是空格,
 *    但我们偶尔需要读字符串键的内容,这时回 src 取。
 */
function load(abs) {
  const src = readFileSync(abs, 'utf8');
  return { file: relative(ROOT, abs), src, code: codeMask(src).code };
}

const ID_START = /[A-Za-z_$]/;
const ID_CHAR = /[A-Za-z0-9_$]/;

/** code[i] 是空格但 src[i] 是引号 ⇒ 这里被抹掉的是一段字符串 */
function isStrStart(d, i) {
  return d.code[i] === ' ' && (d.src[i] === '"' || d.src[i] === "'");
}

const isWs = (d, i) => d.code[i] === ' ' || d.code[i] === '\n' || d.code[i] === '\t' || d.code[i] === '\r';

function skipWs(d, i, end) {
  while (i < end && isWs(d, i)) i++;
  return i;
}

/** 跳过一个平衡的 ()/[]/{} 块,返回闭括号之后的下标 */
function skipBalanced(d, i, end) {
  const open = d.code[i];
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  if (d.code[i + 1] !== open) return i + 1;              // 自闭合 `[1]` 之类,尽力而为
  let depth = 0;
  while (i < end) {
    const c = d.code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return end;
}

/** 从 openIdx 处的 `{` 或 `[` 找到配对闭括号的下标 */
function matchClose(d, openIdx, end) {
  let depth = 0;
  for (let i = openIdx; i < end; i++) {
    const c = d.code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 读一个标识符,返回 {name, end};不是标识符返回 null */
function readIdent(d, i, end) {
  if (i >= end || !ID_START.test(d.code[i])) return null;
  let j = i + 1;
  while (j < end && ID_CHAR.test(d.code[j])) j++;
  return { name: d.code.slice(i, j), end: j };
}

/** 读一个字符串键(含引号),返回 {name, end} */
function readStrKey(d, i, end) {
  if (!isStrStart(d, i)) return null;
  const q = d.src[i];
  let j = i + 1;
  while (j < end) {
    if (d.src[j] === '\\') { j += 2; continue; }
    if (d.src[j] === q) return { name: d.src.slice(i + 1, j), end: j + 1, quoted: true };
    j++;
  }
  return null;
}

function readKey(d, i, end) {
  return readIdent(d, i, end) || readStrKey(d, i, end);
}

const MOD_PREFIX = new Set(['async', 'get', 'set']);

/* ═══════════════════════ 2. 结构扫描:对象字面量 / 数组 ═══════════════════════ */

/**
 * 列出对象字面量 `d.code[openIdx] === '{'` 的**直接成员**。
 *
 * 核心规则一句话:**记下一个键之后,直接跳到下一个「相对深度 0 的逗号」**。
 * 这样一个方法体里、嵌套对象里的逗号全都被深度挡掉,
 * `{ key:'a', name:'b' }` 这种一行多键也能逐个拆出来(常量表全是这个写法)。
 *
 * @returns {{keys:string[], spread:boolean, shorthand:Set<string>, close:number}}
 *   keys      —— 直接成员名(顺序)
 *   spread    —— 出现过 `...rest`(整体展开)
 *   shorthand —— 值就是**本文件的模块级符号**的成员(`{ STAGES, MAX_STAGE }` 或 `{ x: SYM }`)
 *                也就是门面再导出,analyze 会把它们让给 lint-deadexport
 */
/**
 * 这个名字在本文件里是不是**模块级**绑定(顶层 const/let/var/function/class)。
 *
 * 靠「必须出现在行首」来排除函数体内的同名局部变量 —— 门面判定要的就是这个严格口径。
 * ⚠️ 必须带 `m` 标志:不带的话 `^` 只匹配整个字符串的第一个字符,判定永远为假。
 */
function isModuleBinding(d, name) {
  return new RegExp(`^(?:export\\s+)?(?:const|let|var|function|class)\\s+${esc(name)}\\b`, 'm')
    .test(d.code);
}

function objectMembers(d, openIdx, end) {
  const close = matchClose(d, openIdx, end);
  const stop = close < 0 ? end : close;
  const keys = [];
  const shorthand = new Set();
  let spread = false;
  let i = openIdx + 1;
  while (i < stop) {
    i = skipWs(d, i, stop);
    if (i >= stop) break;
    const c = d.code[i];
    if (c === ',') { i++; continue; }
    if (c === '.') {                       // ...rest —— 整体展开
      spread = true;
      while (i < stop && d.code[i] !== ',') i++;
      continue;
    }
    // 先摘 async/get/set 前缀:`get foo()` 的真键是 foo,不是 get
    let k = readKey(d, i, stop);
    if (k && MOD_PREFIX.has(k.name)) {
      const nx = skipWs(d, k.end, stop);
      const k2 = readKey(d, nx, stop);
      const after = k2 && skipWs(d, k2.end, stop);
      if (k2 && (d.code[after] === '(' || d.code[after] === ':' || d.code[after] === ',')) k = k2;
    }
    if (!k) {                              // 认不出来的 token:跳过它,不猜
      while (i < stop && d.code[i] !== ',') i++;
      continue;
    }
    // 键之后必须是 ( : , 三者之一,否则这是表达式不是成员
    const afterKey = skipWs(d, k.end, stop);
    const nx = d.code[afterKey];
    if (nx !== '(' && nx !== ':' && nx !== ',') {
      while (i < stop && d.code[i] !== ',') i++;
      continue;
    }
    if (!keys.includes(k.name)) keys.push(k.name);
    // 门面判定:`{ SYM, }` 简写 或 `{ k: SYM, }`,且 SYM 是本文件的**模块级**绑定
    // ⚠️ 两个踩过的坑:
    //   ① 简写形式 `{ STAGES, MAX_STAGE }` 的值就是键自己 —— 早先只处理了 `k: SYM`,
    //      简写一律漏判,MUTATION 的 16 条门面全部误报。
    //   ② 模块级绑定的判定正则**必须带 m 标志** —— 不带的话 `^` 只匹配文件第一个字符,
    //      整个判定永远为假。
    if (nx === ',') {
      if (isModuleBinding(d, k.name)) shorthand.add(k.name);
    } else if (nx === ':') {
      const valStart = skipWs(d, afterKey + 1, stop);
      const v = readIdent(d, valStart, stop);
      const vEnd = v && skipWs(d, v.end, stop);
      if (v && (d.code[vEnd] === ',' || d.code[vEnd] === '}')
          && isModuleBinding(d, v.name)) {
        shorthand.add(k.name);
      }
    }
    // ← 关键:跳到下一个深度 0 的逗号(或对象闭合)
    let depth = 0;
    while (i < stop) {
      const ch = d.code[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break;
        depth--;
      } else if (ch === ',' && depth === 0) break;
      i++;
    }
  }
  return { keys, spread, shorthand, close: stop };
}

/**
 * 列出数组字面量里的**对象元素**。
 * @returns {number[]} 每个对象元素的 `{` 下标
 */
function arrayObjectElements(d, openIdx, end) {
  const close = matchClose(d, openIdx, end);
  const stop = close < 0 ? end : close;
  const out = [];
  let depth = 0;
  for (let j = openIdx + 1; j < stop; j++) {
    const c = d.code[j];
    if (c === '(' || c === '[' || c === '{') { if (depth === 0 && c === '{') out.push(j); depth++; }
    else if (c === ')' || c === ']' || c === '}') depth--;
  }
  return out;
}

/* ═══════════════════════ 3. 限定访问索引 ═══════════════════════ */

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 单趟把一个文件里所有「限定访问」抽成索引,之后所有查询都是 O(1) 的 Set 查找。
 *
 * 【为什么不按 (实体 × 成员 × 文件) 嵌套跑正则】
 *   第一版就是这么写的,一次普查跑了几分钟没跑完(≈20 万次正则编译)。
 *   而这些查询问的其实是同一件事:「`E#m` 这个 token 在全仓出现过没有」。
 *
 * 索引的键统一是 `实体#成员`。**只认带限定词的访问** —— 本仓库 `bg` 同时是
 * STAGES 的数字档位和 FAMILIES 的美术方向词,按裸名字数必然假绿。
 *
 * ═══════════ 这里踩过的坑,三个都在 2026-10-11 普查时一次性撞出来 ═══════════
 *
 * 【坑一:非重叠匹配只吃到链的第一环】
 *   `/ID\s*\??\.\s*ID/g` 直接 matchAll,`M.COMPANION.load()` 只记成 `M#COMPANION`,
 *   `COMPANION#load` 整个丢了。必须扫整条链、记录**每一对相邻标识符**。
 *
 * 【坑二:元素被绑到局部变量,字段读点就断了 —— 这是 288 条普查里的头号假阳性源】
 *   `const t = ENEMY_TYPES[typeId]; … t.xp` —— 字段的接收者是 `t` 不是 `ENEMY_TYPES`。
 *   所以要建**别名闭包**:别名 → 实体,再把 `t#xp` 翻译回 `ENEMY_TYPES#xp`。
 *   这一条能把假阳性从 288 砍掉大半。
 *
 * 【坑三:整表遍历,读点根本不在表名下】
 *   `SLOTS.map(s => s.key)`、`SLOTS.find(s => s.key === k)`、`for (const s of SLOTS)` ——
 *   回调参数 `s` 的字段全都在动态地读表里的每一项,静态逐字段枚举不出来。
 *   这类实体一律降级为「判不准」:整体放过,只登记不判死。
 *   **宁可漏报不可误杀** —— 288 条废报的代价是门禁被人直接关掉。
 *
 * @returns {{file:string, product:boolean, acc:Map<string,Set<string>>, self:Map<string,Set<string>>, dynamic:Set<string>}}
 */
/**
 * 扫出「调用结果上取字段」的读点,返回 `['接收者#字段', …]。
 *
 * 覆盖两种真实形状:
 *   f(x).name                 接收者是 f
 *   (f(x) || {}).name         接收者仍是 f,中间隔着 ` || {}`
 *
 * 【为什么手写而不是正则】
 *   正则 `NAME(\([^()]*\))[^;]{0,40}?\.field` 的惰性量词在每个起点都要重扫,
 *   实测全仓扫描 81 秒里 **79.9 秒** 花在它一条上,而它只命中 6480 次。
 *   栈式单趟扫描是 O(n),并且行为能逐字说清(见下面每一步)。
 *
 * 【判据】
 *   · 只有「标识符(或 标识符.方法)紧跟左括号」才算一次调用,其余 `(` 压 null
 *   · 右括号弹出后,跨过一段**白名单字符**(空白 | { } 与右括号,上限 40),
 *     遇到 `.` + 标识符就算一次读点。白名单里没有 `; , ? :`,所以不会跨语句。
 *   · `(a ? b : c).name` 这种带三元的中缀**识别不了** —— 记在下面的已知局限里。
 *
 * @param {string} C 已去注释/去字符串的源码(与 src 等长)
 * @returns {string[]}
 */
function callResultFields(C) {
  const out = [];
  const stack = [];
  const n = C.length;
  const isIdStart = c => c !== undefined && /[A-Za-z_$]/.test(c);
  const isIdChar = c => c !== undefined && /[A-Za-z0-9_$]/.test(c);
  const skipWs = i => { while (i < n && /\s/.test(C[i])) i++; return i; };
  const GAP = ' \t\n\r|{}()';
  let i = 0;
  while (i < n) {
    const c = C[i];
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(C[j])) j++;
      const name = C.slice(i, j);
      let k = skipWs(j);
      if (C[k] === '.') {                       // NAME.method( → 接收者仍是 NAME
        const k2 = skipWs(k + 1);
        if (isIdStart(C[k2])) {
          let k3 = k2 + 1;
          while (k3 < n && isIdChar(C[k3])) k3++;
          k = skipWs(k3);
        }
      }
      if (C[k] === '(') { stack.push(name); i = k + 1; continue; }
      i = j;
      continue;
    }
    if (c === '(') { stack.push(null); i++; continue; }
    if (c === ')') {
      const recv = stack.pop();
      i++;
      let g = i, budget = 40;
      while (g < n && budget > 0 && GAP.includes(C[g])) { g++; budget--; }
      if (recv && C[g] === '.') {
        const f0 = skipWs(g + 1);
        if (isIdStart(C[f0])) {
          let f1 = f0 + 1;
          while (f1 < n && isIdChar(C[f1])) f1++;
          out.push(`${recv}#${C.slice(f0, f1)}`);
          i = f1;
          continue;
        }
      }
      continue;
    }
    i++;
  }
  return out;
}

function indexDoc(d) {
  const C = d.code;
  const acc = new Map();      // "E#m"  -> Set(命中它的文件)
  const self = new Map();     // "m"    -> Set(命中它的文件),仅 this.m
  const dynHard = new Set();    // 硬降级:两种形状都判不准
  const dynR1 = new Set();      // 只对 R1 对象降级
  const whyDyn = new Map();    // 触发点,给 --why 用
  // ⚠️ 降级**只认产品代码**。
  //   踩过:tests/t81.js 里 `const co = C.COMPANION; … typeof co[m] !== 'function'`
  //   把 COMPANION 的 34 个成员全部降级放过了 —— 而那是对 API 面做**反射**,
  //   它证明成员存在,不证明游戏里用得到它。
  //   门槛要回答的是「产品用不用得到」,测试反射不该替产品回答这个问题。
  const isProduct = PRODUCT_DIRS.some(p => d.file.startsWith(p + '/'));
  const put = (map, key) => {
    let s = map.get(key);
    if (!s) map.set(key, s = new Set());
    s.add(d.file);
  };

  // ── ① 索引访问 E[i].m / E[i]?.m  与  at 形式 E.at(i).m ──
  //    这两条是**常量表的唯一读法**,承重。
  for (const re of [
    /([A-Za-z_$][\w$]*)\s*\[[^\]]*\]\s*\??\.\s*([A-Za-z_$][\w$]*)/g,
    /([A-Za-z_$][\w$]*)\s*\??\.\s*at\s*\([^()]*\)\s*\??\.\s*([A-Za-z_$][\w$]*)/g,
  ]) for (const m of C.matchAll(re)) put(acc, `${m[1]}#${m[2]}`);

  // ── ② 点访问:扫整条链,记每一对相邻标识符(坑一) ──
  for (const m of C.matchAll(/([A-Za-z_$][\w$]*)(?:[ \t]*\??\.[ \t]*[A-Za-z_$][\w$]*)+/g)) {
    const parts = m[0].split(/\??\./).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i + 1 < parts.length; i++) put(acc, `${parts[i]}#${parts[i + 1]}`);
  }
  for (const m of C.matchAll(/this\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) put(self, m[1]);

  // ④ 调用结果上取字段:`f(x).name` / `(f(x) || {}).name`
  //   这里接收者是**表达式**不是标识符,② 的链扫描跨不过 `)`,
  //   早先整片漏读 —— 实测 SLOTS.name 被误判成零读(真实读点是
  //   `(SLOTS.find(s => s.key === k) || {}).name`)。
  //   ⚠️ 这条**必须手写扫描,不能用正则**:正则版
  //   `NAME(\([^()]*\))[^;]{0,40}?\.field` 因为惰性量词回溯,
  //   单这一条就把全仓扫描从 1.6 秒拖到 **81 秒**(其余全部正则加起来不到 2 秒)。
  //   改成栈式单趟:O(n),而且行为可逐字说清。
  for (const pair of callResultFields(C)) put(acc, pair);

  // ── ③ 解构:{ a, b } = E  /  { a: x } = NS.E ──
  for (const m of C.matchAll(/\{\s*([^}]*)\}\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)\s*(?:\[[^\]]*\])?/g)) {
    for (const k of m[1].split(',').map(s => s.split(':')[0].split('=')[0].trim()).filter(k => k && ID_START.test(k[0]))) {
      put(acc, `${m[2]}#${k}`);
    }
  }

  // ── ④ 别名闭包(坑二) ──
  //   import { SLOTS as S }        → S 是 SLOTS 的别名
  //   const t = ENEMY_TYPES[x]     → t 是 ENEMY_TYPES 的别名(元素)
  //   const t = ENEMY_TYPES.at(0)  → 同上
  //   const c = COMPANION          → c 是 COMPANION 的别名(整体)
  // ⚠️ 别名是**一名对多**:Map<本地名, Set<实体>>。
  //   因为回调参数名会跨回调重名 —— 同一个文件里
  //   `VIA_ITER.map(x => x.aa)` 与 `SLOTS.find(x => x.key === k)` 的 `x` 是两个东西。
  //   早先用 Map<名, 单个实体> 时后者覆盖前者,`x#aa` 被错记到 SLOTS 上,
  //   VIA_ITER.aa 被误判成死成员 —— 是自检语料里的同名样本抓出来的。
  //   一律记成 Set:多记只会「多算读点」(漏报方向),不会「少算」(误报方向)。
  const alias = new Map();
  const addAlias = (name, base) => {
    if (!name || !base) return;
    let st = alias.get(name);
    if (!st) alias.set(name, st = new Set());
    st.add(base);
  };
  // 没有别名记录时**退回本名** —— MAP_OBJ[who] 里的 MAP_OBJ 并不是谁的别名,
  // 它自己就是实体。早先这里返回空集,dynR1/dynHard 一个都没记上。
  const resolve = name => {
    const st = alias.get(name);
    return (st && st.size) ? st : new Set([name]);
  };
  for (const m of C.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().split(/\s+as\s+/).map(s => s.trim()).filter(Boolean);
      if (t.length === 2) addAlias(t[1], t[0]);
    }
  }
  for (const m of C.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)\s*(?:\[[^\]]*\]|\.at\s*\([^()]*\)|;|,|\))/g)) {
    addAlias(m[1], m[2]);
  }
  // 传递闭包:a→b→E 要能一路还原(最多迭代 5 轮,超过就放弃解析,宁可放过)
  for (let round = 0; round < 5; round++) {
    let changed = false;
    for (const [k, vs] of [...alias]) {
      for (const v of [...vs]) {
        const rs = alias.get(v);
        if (!rs) continue;
        for (const r of rs) if (r !== v && !vs.has(r)) { vs.add(r); changed = true; }
      }
    }
    if (!changed) break;
  }
  // 把 `别名#成员` 的读点翻译成 `实体#成员`
  if (alias.size) {
    for (const ix of [...acc]) {
      const [head, member] = ix[0].split('#');
      for (const base of resolve(head)) {
        let s = acc.get(`${base}#${member}`);
        if (!s) acc.set(`${base}#${member}`, s = new Set());
        for (const f of ix[1]) s.add(f);
      }
    }
  }

  // ── ⑤ 降级判定:分「硬降级」与「只对 R1 降级」两档 ──
  //
  //   硬降级(dynHard)—— 两种形状都判不准,因为**字段**本身静态不可知:
  //     · Object.keys/values/entries/assign(T[i]) —— 枚举字段
  //     · { ...T[i] }                            —— 元素整体铺开
  //     · 遍历回调里出现动态字段:T.map(s => s[k])
  //
  //   只对 R1 降级(dynR1)—— 仅当实体是「对象」时判不准:
  //     · 被遍历(T.map / for…of) · 被动态下标(T[k],k 是变量)
  //   理由见 wholeUse():R2 是记录数组,元素的**字段集**是确定的,
  //   T[k].f 与 T.map(s => s.f) 里的 f 都是「读了这个字段」,与 k 无关。
  //
  //   ⚠️ 踩过:第一版把「遍历」一律当硬降级,于是 SLOTS 被自己的
  //   SLOTS.map(s => s.key) 静默,R2 表字段规则整个失效 ——
  //   反向注入往 SLOTS 塞了个零读字段,门禁**没报**(EXIT=0)。
  const ITER = /(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)\s*\??\.\s*(?:map|filter|find|findIndex|forEach|some|every|reduce|flatMap|sort|slice|concat|keys|values|entries|join|splice|reverse)\s*\(/g;
  const FOROF = /for\s*\([^)]*\b(?:of|in)\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)\s*\)/g;
  const SPREAD = /\.\.\.\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)/g;
  const OBJ = /Object\.(?:keys|values|entries|assign|getOwnPropertyNames)\s*\(\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)/g;
  const note = (n, tag) => {
    if (isProduct && !whyDyn.has(n)) whyDyn.set(n, `${d.file}: ${tag}`);
  };
  for (const m of C.matchAll(ITER))  { for (const n of resolve(m[1])) dynR1.add(n);  note(m[1], m[0].slice(0, 60).replace(/\s+/g, ' ')); }
  for (const m of C.matchAll(FOROF)) { for (const n of resolve(m[1])) dynR1.add(n);  note(m[1], m[0].slice(0, 60).replace(/\s+/g, ' ')); }
  for (const m of C.matchAll(SPREAD)) { for (const n of resolve(m[1])) dynHard.add(n); note(m[1], m[0].slice(0, 60).replace(/\s+/g, ' ')); }
  for (const m of C.matchAll(OBJ))   { for (const n of resolve(m[1])) dynHard.add(n); note(m[1], m[0].slice(0, 60).replace(/\s+/g, ' ')); }

  // 遍历回调参数注册成别名:SLOTS.map(s => s.icon) ⇒ s 是 SLOTS 的别名 ⇒
  // s#icon 回译成 SLOTS#icon。少了这一步,R2 表字段会被自己的正常遍历判成死的。
  for (const m of C.matchAll(
    /(?:([A-Za-z_$][\w$]*)\s*\??\.\s*(?:map|filter|find|findIndex|forEach|some|every|reduce|flatMap|sort)\s*\(\s*(?:[A-Za-z_$][\w$]*\s*=>\s*)?([A-Za-z_$][\w$]*)\s*=>)/g)) {
    for (const b of resolve(m[1])) addAlias(m[2], b);
    if (!alias.get(m[1])) addAlias(m[2], m[1]);
  }
  for (const m of C.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([^)]*)\)/g)) {
    const src = (m[2].match(/([A-Za-z_$][\w$]*)\s*(?:\[[^\]]*\])?\s*$/) || [])[1];
    if (src) { for (const b of resolve(src)) addAlias(m[1], b); if (!alias.get(src)) addAlias(m[1], src); }
  }
  // 别名闭包再跑一轮(回调参数可能又指向别的别名)
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (const [k2, vs] of [...alias]) {
      for (const v of [...vs]) {
        const rs = alias.get(v);
        if (!rs) continue;
        for (const r of rs) if (r !== v && !vs.has(r)) { vs.add(r); changed = true; }
      }
    }
    if (!changed) break;
  }
  // 把「别名#成员」的读点回译成「实体#成员」(回调参数这批是第二遍,必须重跑)
  for (const ix of [...acc]) {
    const [head, member] = ix[0].split('#');
    for (const base of resolve(head)) {
      let st = acc.get(`${base}#${member}`);
      if (!st) acc.set(`${base}#${member}`, st = new Set());
      for (const f of ix[1]) st.add(f);
    }
  }

  // 动态下标(非字面量):
  //   · 实体本身被动态下标(T[w.id])⇒ 只对 R1 降级 —— 是对象时,读的是哪个**键**不可知
  //   · 遍历回调参数被动态下标(s[k],s 来自 T.map)⇒ **硬降级** —— 读的是哪个**字段**不可知
  for (const m of C.matchAll(/([A-Za-z_$][\w$]*)\s*\[([^\]]*)\]/g)) {
    const idxExpr = m[2].trim();
    if (/^'[^']*'$|^"[^"]*"$|^[0-9]+$/.test(idxExpr)) continue;   // 字面量下标:静态
    if (!isProduct) continue;
    const bs = resolve(m[1]);
    let hard = false;
    for (const b of bs) { if (dynR1.has(b)) { dynHard.add(b); hard = true; } }
    if (!hard) { for (const b of bs) dynR1.add(b); note(m[1], m[0].slice(0, 60).replace(/\s+/g, ' ')); }
  }
  //  别名被整体展开/枚举(JSON.stringify(t) 之类)也归入判不准
  for (const [a, bases] of alias) {
    if (isProduct && new RegExp(`\\.\\.\\.\\s*${esc(a)}\\b|Object\\.(?:keys|values|entries|assign)\\s*\\(\\s*${esc(a)}\\b`).test(C)) {
      for (const base of bases) dynHard.add(base);
    }
  }

  // ── ⑥ 门面再导出:成员的值就是本文件的模块级符号 ──
  //   `export const MUTATION = { STAGES, MAX_STAGE, …, derive(){} }`
  //   这里 `MUTATION.MAX_STAGE` 确实零读,但它只是**转发**:
  //   真正有意义的判据是模块级导出 `MAX_STAGE` 有没有被用,而那正是
  //   lint-deadexport.mjs 的地盘。这门禁不该在一个转发壳上重复报警。
  //   ⇒ 只跳过「值是本文件模块级绑定」的成员,不跳过普通成员。
  const facade = new Map();     // 实体名 -> Set(转发出去的符号)
  for (const m of C.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
    const close = matchClose({ code: C }, m.index + m[0].length - 1, C.length);
    if (close < 0) continue;
    const { keys, shorthand } = objectMembers({ code: C, src: d.src }, m.index + m[0].length - 1, close);
    void keys;
    if (shorthand && shorthand.size) facade.set(m[1], shorthand);
  }

  return {
    file: d.file,
    product: isProduct,
    acc, self, dynHard, dynR1, whyDyn, facade,
    code: C,
  };
}

/** 建全仓索引 */
function buildIndex(docs) {
  return docs.map(indexDoc);
}

/**
 * 实体是否被「整体消费」→ 它的成员一律放过。**按实体的形状分开判**,这是本门禁
 * 最容易搞错的一处,单开一段说清楚:
 *
 *   R2 导出常量表 —— `export const T = [{…},{…}]`,「成员」是记录的**字段**。
 *      `T[k].f` 里的 `k` 是谁**根本不重要**:每个元素都带 `f`,
 *      所以「读到 f」这件事与 k 无关 ⇒ 动态下标**不**降级。
 *      (STAGES 被 `STAGES[ev.to]` / `STAGES[m.stage]` 这类下标用到,
 *       按老口径整表静默,连 bg 是死是活都问不出来 —— 那是过度保守,不是严谨。)
 *
 *   R1 导出对象 —— `export const E = { a(){…}, b(){…} }`,「成员」是**键**。
 *      `E[k]` 的 k 是运行时值,静态枚举不出到底读了哪几个键 ⇒ **必须**降级。
 *      (WEAPONS[id] 就是这个形状:weapon id 是运行时值。)
 *
 * 遍历/整体展开(Object.*、map/for…of、展开运算符)对两种形状都是真降级,没有例外。
 */
function wholeUse(idx, entityName, kind = 'object') {
  const forms = new Set();
  for (const ix of idx) {
    if (ix.dynHard.has(entityName)) forms.add('硬降级(枚举/铺开/动态字段)');
    if (kind !== 'table' && ix.dynR1.has(entityName)) forms.add('R1 降级(遍历/动态下标)');
  }
  return forms;
}

/* ═══════════════════════ 4. 实体发现 ═══════════════════════ */

const RULES = { R1: '导出对象的成员', R2: '导出常量表的字段' };

function findEntities(docs) {
  const entities = [];
  for (const d of docs) {
    const end = d.src.length;
    for (const m of d.code.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\{\[])/gm)) {
      const name = m[1];
      const open = m.index + m[0].length - 1;
      const shape = d.code[open];
      const close = matchClose(d, open, end);
      if (close < 0) continue;
      if (shape === '{') {
        const { keys, spread } = objectMembers(d, open, close);
        entities.push({ kind: 'object', rule: 'R1', name, decl: d.file, keys, spread });
      } else {
        const els = arrayObjectElements(d, open, close);
        const keys = [];
        const coverage = new Map();
        for (const e of els) {
          const { keys: k } = objectMembers(d, e, end);
          for (const key of k) {
            if (!keys.includes(key)) keys.push(key);
            coverage.set(key, (coverage.get(key) || 0) + 1);
          }
        }
        entities.push({ kind: 'table', rule: 'R2', name, decl: d.file, keys, els: els.length, coverage });
      }
    }
  }
  return entities;
}

/* ═══════════════════════ 5. 引擎(自检与正式跑共用同一段) ═══════════════════════ */

function analyze(docs, { invert = false } = {}) {
  const idx = buildIndex(docs);
  const entities = findEntities(docs);
  const findings = [];
  const stats = { entities: entities.length, members: 0, dead: 0, covered: 0, facade: 0 };

  for (const ent of entities) {
    stats.members += ent.keys.length;
    const whole = wholeUse(idx, ent.name, ent.kind);
    // 门面成员让给 lint-deadexport:它的真符号是本文件的模块级导出
    const facade = new Set();
    for (const ix of idx) {
      const f = ix.facade && ix.facade.get(ent.name);
      if (f) for (const k of f) facade.add(k);
    }
    for (const member of ent.keys) {
      if (facade.has(member)) { stats.facade++; continue; }
      const key = `${ent.name}#${member}`;
      const prodFiles = new Set();
      const consFiles = new Set();
      const where = [];
      // 索引里每个文件一份 acc / self,合并成「文件 → 命中形态」
      for (const ix of idx) {
        const hit = ix.acc.get(key);
        const selfHit = ix.self.get(member);
        if (!hit && !(selfHit && ix.file === ent.decl)) continue;
        (ix.product ? prodFiles : consFiles).add(ix.file);
        const tags = [];
        if (hit) tags.push(`${ent.name}?.${member}`);
        if (selfHit && ix.file === ent.decl) tags.push(`this.${member}`);
        where.push(`${ix.file} [${tags.join(' ')}]`);
      }
      if (whole.size) { stats.covered++; continue; }        // 整体被展开/枚举 ⇒ 一律放过
      // ← 自检用的方向反转:让**声明本身**算一次读。
      //   语义 = 「把判据写反」—— 任何成员只要写在表里就自动有读点。
      //   正常跑时 invert=false,这段不生效。
      if (invert) prodFiles.add('<inverted>');
      if (prodFiles.size) continue;
      const consN = consFiles.size;
      stats.dead++;
      findings.push({
        kind: consN > 0 ? 'testonly' : 'dead',
        rule: ent.rule, entity: ent.name, member, decl: ent.decl,
        tests: consN, where,
        partial: ent.coverage && ent.coverage.get(member) !== undefined
          ? `${ent.coverage.get(member)}/${ent.els} 个元素有`
          : null,
      });
    }
  }
  return { findings, stats, entities, idx };
}

/* ═══════════════════════ 6. 自检(反向) ═══════════════════════ */

function selfCheck() {
  /**
   * 合成语料:**故意**用真实仓库里的形状
   *   · 常量表是一行多键的写法(`{ key:'sealed', name:'封印', need:0, bg:0 }`)
   *   · 有第二个**同名字段**的表 OTHER(验「同名不同义」)
   *   · 有第二个文件用 **import * as NS** 的命名空间形式读表(验限定访问)
   *   · 对象方法内部用 this.s 自读(验私有辅助成员不会被误杀)
   *   · 有一个零调用点的方法 form(验门禁确实会红)
   */
  const declSrc = `
export const STAGES = [
  { key:'sealed', name:'封印', need:0, bg:0, desc:'a' },
  { key:'true',   name:'真身', need:10, bg:4, desc:'b' },
];
export const OTHER = [
  { key:'bone', name:'骸', bg:'墓园水墨' },
];
export const COMPANION = {
  s: null,
  load() { return this.s; },
  form() { return STAGES[0].bg; },
};
export const NS_ONLY = [
  { alpha: 1, beta: 2 },
];
export const VIA_ALIAS = [
  { live: 1, dead: 2 },
];
export const VIA_ITER = [
  { aa: 1, bb: 2 },
];
export const VIA_BARE = [
  { xx: 1, yy: 2 },
];
// R1 对象 + 运行时键:MAP_OBJ[k] 的 k 是变量,静态枚举不出读了哪个键 ⇒ 整对象降级。
// (真实形状:WEAPONS[weaponId],weaponId 是运行时值)
export const MAP_OBJ = {
  alpha: 1, beta: 2,
};
export const OBJ_ITER = {
  pp: 1, qq: 2,
};
export const SLOTS = [
  { key: 'sword', name: '剑', icon: 'i' },
];
// 门面再导出:成员的值就是本文件的模块级符号。
// FACADE.STAGES 零读,但真符号 STAGES 归 lint-deadexport 管 —— 不该在这道门上重复报警。
export const FACADE = { STAGES };
`;
  // 第二个文件:靠 `M.STAGES[i].x` / `M.COMPANION.load()` 读
  //   —— 索引限定(E[i].m)与点限定(E.m)各来一处,两条分支都要被断言到。
  //   `STAGES_LOCAL[0].need` 是**故意的近似陷阱**:前缀相同但不是同一个标识符,
  //   它不该给 STAGES.need 算读点(靠的是紧跟实体名的 `\s*\[`,不是任何"前缀匹配")。
  //   `el.live` / `M.VIA_ITER.map(...)` / `M.VIA_BARE[who]` 分别钉住
  //   **别名闭包**、**遍历降级**、**裸动态索引降级**三条新逻辑。
  const useSrc = `
import * as M from './synthetic.js';
const A = M.STAGES[1].bg;
const N = M.STAGES[0].name;
const LOAD = M.COMPANION.load();
const B = M.NS_ONLY[0].alpha;
const TRAP = STAGES_LOCAL[0].need;
const el = M.VIA_ALIAS[0];
const LIVE = el.live;
const ALL = M.VIA_ITER.map(x => x.aa);
const TBL = { img: M.VIA_BARE[who] };
const SLOTTED = (M.SLOTS.find(x => x.key === k) || {}).name;
const MAPK = M.MAP_OBJ[who];
const ITERK = M.OBJ_ITER.map(v => v.pp);
`;
  const d1 = { file: 'js/synthetic.js', src: declSrc, code: codeMask(declSrc).code };
  const d2 = { file: 'js/consumer.js', src: useSrc, code: codeMask(useSrc).code };
  // 第三个文件走 **tests/ 路径**:对 COMPANION 做反射。反射证明成员存在,
  // 不证明产品用得到它,所以**不许**把 COMPANION 降级放过。
  // (真实事故:tests/t81.js 的 `typeof co[m] !== 'function'` 曾把 34 个成员全部放过。)
  const t1 = `
import * as M from '../js/synthetic.js';
const co = M.COMPANION;
const METHODS = ['load','save','form','say'];
for (const m of METHODS) t(\`\${m}\`, typeof co[m] === 'function');
`;
  const d3 = { file: 'tests/synthetic-test.mjs', src: t1, code: codeMask(t1).code };
  const docs = [d1, d2, d3];
  const a = analyze(docs);
  const byKey = new Map(a.findings.map(f => [`${f.entity}.${f.member}`, f]));

  /**
   * [键, 是否应该判死, 为什么]
   * ⚠️ 这张表的每一格都必须能对着上面那段合成源码逐字指认,不能凭印象写 ——
   *    第一版我就是凭印象写的,十一条全标「应该判死」,自检立刻报出三处对不上。
   *    期望表写错,自检就变成了测「我以为的引擎」,而不是测引擎。
   */
  const expect = [
    ['STAGES.key',  true,  '两处读点只碰了 .bg 与 .name,没人读 .key'],
    ['STAGES.name', false, 'M.STAGES[0].name —— 命名空间限定的读点'],
    ['STAGES.bg',   false, 'M.STAGES[1].bg 与 form() 里的 STAGES[0].bg'],
    ['STAGES.need', true,  'STAGES_LOCAL[0].need 是另一个标识符,不算 STAGES 的读点'],
    ['STAGES.desc', true,  '没有任何一处读 .desc'],
    ['NS_ONLY.alpha', false, 'M.NS_ONLY[0].alpha —— 索引限定这条分支的活体样本'],
    ['NS_ONLY.beta', true,  '与 alpha 同表,beta 零读点 ⇒ 索引限定不能一刀切放过'],
    ['COMPANION.s', false, 'load() 里 this.s 是自读(私有辅助成员不该被误杀)'],
    ['COMPANION.load', false, 'M.COMPANION.load() 有外部调用'],
    ['COMPANION.form', true,  '只有声明,零调用点 ⇒ 必须被抓出来'],
    ['OTHER.key',   true,  'OTHER.key 零读'],
    ['OTHER.name',  true,  '⚠️ STAGES.name **有**读点,若引擎按裸名字数,OTHER.name 会被洗成假绿'],
    ['OTHER.bg',    true,  '⚠️ STAGES.bg **有**读点,若引擎按裸名字数,OTHER.bg 会被洗成假绿'],
    // 别名闭包:`const el = M.VIA_ALIAS[0]; el.live` 的接收者是 el 不是 VIA_ALIAS。
    // 缺了这一步,VIA_ALIAS.live 会被误判成死 —— 这正是普查里 288 条的头号来源。
    ['VIA_ALIAS.live', false, 'el.live 经别名闭包回译成 VIA_ALIAS.live'],
    ['VIA_ALIAS.dead', true,  '同一张表,dead 字段没有任何读点 —— 别名闭包不能一刀切放过'],
    // 遍历降级:`M.VIA_ITER.map(x => x.aa)` 静态枚举不出 aa/bb 各被读了什么,
    // 所以整张表降级为「判不准」,两个字段都不该出现在结论里。
    // R2 遍历不降级 ⇒ 零读字段真死;name 是活读点(经调用结果形态,见 acc 的第 ④ 条)
    ['SLOTS.name', false, '(SLOTS.find(x => x.key === k) || {}).name —— 接收者是表达式,链扫描跨不过 )'],
    ['SLOTS.key',  false, 'SLOTS.find(x => x.key === k) 里的 x#key 回译'],
    ['SLOTS.icon', true,  '同一张表零读字段 —— 调用结果形态不能一刀切放过整表'],
    // R2 记录数组 + 遍历:**不**降级。这条是本门禁定线的分水岭 ——
    //   早先「遍历一律降级」把 SLOTS 整个静默,反向注入塞零读字段门禁没报。
    ['VIA_ITER.aa', false, 'R2 遍历:回调参数 s 已回译成 VIA_ITER.aa'],
    ['VIA_ITER.bb', true,  'R2 遍历不降级 ⇒ bb 零读点,真死'],
    // R1 对象 + 遍历:降级。`E.map(v => …)` 里读的是哪个键静态不可知。
    ['OBJ_ITER.pp', false, 'R1 被遍历 ⇒ 降级放过'],
    ['OBJ_ITER.qq', false, 'R1 被遍历 ⇒ 降级放过'],
    // R2 数组表 + 动态下标:**不**降级。`T[k].f` 的 k 是谁无所谓,每个元素都带 f。
    //   这是本次定线最关键的一条区分,判错的方向是「静默」而不是「误报」。
    ['VIA_BARE.xx', true,  'R2 记录数组:动态下标不降级,xx 确实零读'],
    ['VIA_BARE.yy', true,  'R2 记录数组:动态下标不降级,yy 确实零读'],
    // R1 对象 + 动态键:降级。`E[k]` 的 k 是运行时值,静态枚举不出读了哪个键。
    ['MAP_OBJ.alpha', false, 'R1 对象被动态下标 ⇒ 降级放过'],
    ['MAP_OBJ.beta', false, 'R1 对象被动态下标 ⇒ 降级放过'],
    // 门面再导出:FACADE.STAGES 零读,但真符号归 lint-deadexport
    ['FACADE.STAGES', false, '门面成员让给 lint-deadexport,不在本门禁重复报警'],
  ];
  const problems = [];
  for (const [k, shouldBeDead, why] of expect) {
    const got = byKey.get(k);
    if (shouldBeDead && !got) problems.push(`漏报:${k} 实际零读,却没被判死 —— ${why}`);
    if (!shouldBeDead && got) problems.push(`误报:${k} 有读点却被判死 —— ${why}`);
  }
  // 期望表覆盖不到的多余结论也要报出来(引擎可能把不该管的也管了)
  const known = new Set(expect.map(e => e[0]));
  for (const f of a.findings) {
    const k = `${f.entity}.${f.member}`;
    if (!known.has(k)) problems.push(`越界:${k} 不在期望表里 —— 引擎多报了一个成员`);
  }
  // 反向自检:判据写反(声明即算读)时必须一条都不剩 —— 这条不过,说明引擎没在数读点
  const inv = analyze(docs, { invert: true });
  if (inv.findings.length) {
    problems.push(`方向自检失败:判据反转后仍报出 ${inv.findings.length} 条死成员 `
      + `(${inv.findings.slice(0, 3).map(f => f.entity + '.' + f.member).join(', ')}) —— 引擎可能在空转`);
  }
  if (a.findings.length === 0) problems.push('方向自检失败:正跑一条死成员都没报出来 —— 引擎可能在空转');

  if (problems.length) {
    console.log('❌ 自检不通过:');
    for (const p of problems) console.log('   · ' + p);
    return 1;
  }
  console.log(`✅ 自检通过:${a.stats.entities} 个实体 / ${a.stats.members} 个成员,`);
  console.log(`   ${a.stats.dead} 个判死与期望表逐条对上、${a.stats.covered} 个整体消费放过;`);
  console.log(`   同名不同义(OTHER.name / OTHER.bg 对 STAGES 的活读点)未被洗白;`);
  console.log(`   判据反转后 ${inv.findings.length} 条 —— 引擎确实在数读点,不是恒真。`);
  return 0;
}

/* ═══════════════════════ 7. 基线 ═══════════════════════ */

const keyOf = f => `${f.rule}|${f.entity}.${f.member}|${f.decl}`;

function loadBaseline() {
  if (!existsSync(BASELINE)) return { _note: '', entries: {} };
  return JSON.parse(readFileSync(BASELINE, 'utf8'));
}

/* ═══════════════════════ 8. 主流程 ═══════════════════════ */

function main() {
  function docsFor() {
    const productFiles = PRODUCT_DIRS.flatMap(d => walk(join(ROOT, d)));
    const consumerFiles = CONSUMER_DIRS.flatMap(d => walk(join(ROOT, d)));
    return [...productFiles, ...consumerFiles].map(load);
  }
  if (has('--self-check')) { process.exit(selfCheck()); }

  // ── 诊断口:`--why COMPANION` 说清每个成员是被判死、还是被哪条降级规则放过的 ──
  //   报告型 lint 必须能回答「你凭什么说它死」,否则人只能靠猜,门禁就会被忽略。
  const whyIdx = process.argv.indexOf('--why');
  if (whyIdx >= 0 && process.argv[whyIdx + 1]) {
    const name = process.argv[whyIdx + 1];
    const docs = docsFor();
    const ents = findEntities(docs).filter(e => e.name === name);
    if (!ents.length) {
      console.log(`没有找到名为 ${name} 的导出对象/表。`);
      console.log('已发现的实体(名字里含该串的):');
      for (const e of findEntities(docs).filter(e => e.name.includes(name))) console.log('  · ' + e.name + '  ← ' + e.decl);
      process.exit(2);
    }
    const r = analyze(docs, { explain: name });
    const idx = r.idx;
    for (const e of ents) {
      console.log(`${e.rule} ${e.name}  ← ${e.decl}  (${e.keys.length} 个成员)`);
      const dd = wholeUse(idx, e.name, e.kind);
      if (dd.size) {
        const trig = [];
        for (const ix of idx) { const w = ix.whyDyn && ix.whyDyn.get(e.name); if (w && !trig.includes(w)) trig.push(w); }
        console.log(`  ⚠️ 整体消费降级生效:[${[...dd].join(', ')}] —— 它的全部成员都会被放过,门禁对它无话说`);
        for (const t of trig.slice(0, 4)) console.log(`      触发点: ${t}`);
      }
      const fac = new Set();
      for (const ix of idx) { const f = ix.facade && ix.facade.get(e.name); if (f) for (const k of f) fac.add(k); }
      if (fac.size) console.log(`  ⚠️ 门面再导出降级生效:[${[...fac].join(', ')}] —— 让给 lint-deadexport`);
      for (const m of e.keys) {
        const dead = r.findings.find(f => f.entity === e.name && f.member === m);
        if (dead) {
          console.log(`  ✗ 死  ${m}${dead.partial ? '  [' + dead.partial + ']' : ''}  ${dead.where.length ? '读点:' + dead.where.slice(0,2).join('; ') : '零读点'}`);
        } else if (fac.has(m)) {
          console.log(`  – 门面 ${m}`);
        } else if (dd.size) {
          console.log(`  – 放过 ${m}(整表降级)`);
        } else {
          const key = `${e.name}#${m}`;
          const files = [];
          for (const ix of idx) {
            if (ix.acc.get(key)) files.push(ix.file + (ix.product ? '' : '(测试)'));
            if (ix.self.get(m) && ix.file === e.decl) files.push(`${e.name} 的 this.${m}`);
          }
          console.log(`  ✓ 活  ${m}  ← ${[...new Set(files)].slice(0, 3).join(', ') || '—'}`);
        }
      }
    }
    process.exit(0);
  }

  const productFiles = PRODUCT_DIRS.flatMap(d => walk(join(ROOT, d)));
  const consumerFiles = CONSUMER_DIRS.flatMap(d => walk(join(ROOT, d)));
  const docs = [...productFiles, ...consumerFiles].map(load);
  const { findings, stats, entities } = analyze(docs);

  console.log(`死成员扫描: ${productFiles.length} 个产品文件 · ${entities.length} 个导出对象/表 · ${stats.members} 个成员`);
  console.log(`  整体被消费(展开/枚举)→ 放过: ${stats.covered}`);
  console.log(`  判死:                      ${stats.dead}`);

  const hard = findings.filter(f => f.kind === 'dead');
  const soft = findings.filter(f => f.kind === 'testonly');
  console.log(`    其中产品与测试都零读(真死): ${hard.length}`);
  console.log(`    其中只有测试在读(半死):     ${soft.length}`);

  if (has('--census')) {    console.log('\n── 普查明细(不阻断) ──');
    for (const f of findings) {
      const partial = f.partial ? `  [${f.partial}]` : '';
      console.log(`  ${f.rule} ${f.entity}.${f.member}  ← ${f.decl}${partial}`);
      console.log(`      ${f.kind === 'dead' ? '产品零读' : `产品零读,仅 ${f.tests} 处测试引用`}`);
      for (const w of f.where.slice(0, 2)) console.log(`      · ${w}`);
    }
    console.log('\nℹ️ 经由对象传递的间接调用查不到 —— 这类恰恰是真正在用的,删之前必须人看。');
    process.exit(0);
  }

  const baseline = loadBaseline();
  const entries = baseline.entries || {};
  const stale = [];
  const fresh = [];
  for (const f of findings) {
    const k = keyOf(f);
    if (k in entries) stale.push(k); else fresh.push(f);
  }
  const gone = Object.keys(entries).filter(k => !findings.some(f => keyOf(f) === k));

  console.log(`  已登记在基线里(见下方「基线是什么」): ${findings.length - fresh.length}`);
  console.log(`  新增候选(基线里没有的):                  ${fresh.length}`);

  if (has('--write-baseline')) {
    if (Object.keys(entries).length && !has('--force')) {
      console.error(`\n❌ ${BASELINE} 已有 ${Object.keys(entries).length} 条人工确认条目,本次未写入。`);
      console.error('   重新生成会冲掉全部理由注释 —— 那正是这份文件存在的意义。确认要覆盖请加 --force。');
      process.exit(2);
    }
    const next = {};
    for (const f of findings) {
      next[keyOf(f)] = {
        kind: f.kind, rule: f.rule, file: f.decl, entity: f.entity, member: f.member,
        tests: f.tests, reviewed: false,
      };
    }
    writeFileSync(BASELINE, JSON.stringify({
      _note: [
        '死成员 · 存量清单。key = rule|实体.成员|声明文件(刻意不用行号:行号会被任何无关改动冲掉)。',
        '',
        '【这份文件的定位:它让「新死的」变得可见,不是给「已死的」发免责声明。】',
        '  本文件里的条目是 2026-10-11 首次普查时的**存量**,',
        '  它们**逐条未经人工复核** —— 静态上分不出「真死」与「经由对象传递的间接调用」,',
        '  而后者恰恰是真正在用的。所以 reviewed 一律 false,别拿它当「已审过」。',
        '  逐条复核后请把 reviewed 改成 true 并补一句人话理由。',
        '',
        '真正的闸门是:本清单里**没有**的成员一旦被判死,就会作为「新增候选」报出来。',
        '默认 report-only 退出 0;加 --strict 才退出 1(反向注入验证用)。',
      ].join('\n'),
      entries: next,
    }, null, 2) + '\n');
    console.log(`\n✅ 基线已写:${BASELINE}(${findings.length} 条存量,**均未逐条复核**)`);
    process.exit(0);
  }

  const unreviewed = Object.keys(entries).filter(k => entries[k].reviewed === false).length;
  if (unreviewed) {
    console.log(`\n⚠️  基线里 ${unreviewed} 条存量还没逐条复核(reviewed:false)——它们不构成「已审过」。`);
  }
  if (gone.length) {
    console.log('\nℹ️  基线里这些条目已不再判死(可能修好了,也可能门禁瞎了 —— 请确认):');
    for (const k of gone) console.log(`  · ${k}`);
  }
  if (fresh.length) {
    console.log('\n新增候选:');
    for (const f of fresh) {
      console.log(`  · ${f.rule} ${f.entity}.${f.member}  ← ${f.decl}${f.partial ? '  [' + f.partial + ']' : ''}`);
      console.log(`      ${f.kind === 'dead' ? '产品代码零读' : `产品代码零读,只有测试在读(${f.tests})`}`);
      for (const w of f.where.slice(0, 2)) console.log(`      · ${w}`);
    }
    console.log('\nℹ️ 经由对象传递的间接调用查不到 —— 这类恰恰是真正在用的,所以删之前必须人看。');
    console.log('   确认该删的直接删;确认可留的写进 tests/dead-member-baseline.json(要写理由)。');
  }

  if (fresh.length && has('--strict')) {
    console.error(`\n❌ 新增死成员 ${fresh.length} 项(--strict)`);
    process.exit(1);
  }
  if (fresh.length) {
    console.log('\nℹ️  report-only 模式,不阻断(存量 ${findings.length} 条未经逐条复核,拦住会误伤)。');
    console.log('   逐条复核用: node tests/lint-dead-member.mjs --why <实体名>');
  } else {
    console.log('\n✅ 无新增死成员');
  }
  process.exit(0);
}

// 作为库被 require 时不自动跑 main(给调试/测试用)。
if (!process.env.DM_LIB) main();
export { indexDoc, findEntities, analyze, buildIndex, wholeUse, codeMask };
