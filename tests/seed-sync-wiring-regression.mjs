// ===== 种子同步接线门禁(XX-FIX-003 / ui.js setseed 分支)=====
//
// 运行: node tests/seed-sync-wiring-regression.mjs
// 退出码:0 通过 / 1 不通过 / 2 门禁自身失效(解析不到东西,后面全在空转)
//
// 存在理由 —— 这个 bug 静默失效了 12 轮没人发现:
//   ui.js 的「换一世」分支原本写的是 `try { Profile.collect(mods); } catch (e) { console.warn(…) }`。
//   `mods` 是 main.js:559 的**模块局部 const**,ui.js 是另一个模块,根本取不到 ——
//   实测每次点「换一世」都抛 `ReferenceError: mods is not defined`,
//   而 try/catch 把它吞成一行 console.warn。于是:
//     · 种子同步**一次都没成功过**
//     · 没有异常、没有红条、没有失败测试
//   这是最坏的一类失效:**代码看起来是对的,而且失败还被主动静音了**。
//
//   原注释把影响写成「只是存档码里那个种子名显示成旧的」—— **低估了**。
//   真实链路(profile.js:101 `Seed.set(this.data.seed)`)会用存档里的旧种子盖回真源,
//   于是玩家点完「换一世」,**只要重开一次页面,种子连同整个世界就被回退**。
//   种子是当局唯一改不回来的东西 —— 这是真丢档,不是显示问题。详见门禁 [G2]。
//
// ⚠️ 为什么静态检查不够、本门禁必须真跑:
//   同一个 `try/catch + console.warn` 的形状,静态扫永远"没问题" ——
//   它语法完全合法。所以 [G2] 用 DOM 桩真的走一遍那条 UI 分支,
//   并在**跨页面重载**的第二个进程里验证种子真的活下来了。
//
// ⚠️ 本机没有浏览器(harness.mjs 顶上写着:playwright 在 Android PRoot 上装不上,
//   且严禁安装)。这里验的是**真实模块 + 真实 localStorage 写入 + 自写 DOM 桩**,
//   不等于「浏览器里点过了」。真机触摸与页面生命周期由 CI 补。

import { install } from './harness.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
import { ROOT, readOne, codeMask } from './lib-uimod.mjs';

const H = install();

// ══════════════════════════════════════════════════════════
// 子进程模式:`--reboot-check`
// 「玩家重开一次页面」= 全新模块实例 + 只带 localStorage。
// 这个进程只从快照灌 localStorage、走真实开机链路,把种子喊出来。
// 必须在**独立进程**里做:同一进程里 seed.js 的 currentMaster 是模块级
// 记忆,读的就是刚才那个值,量不到「重开页面」到底发生了什么。
// ══════════════════════════════════════════════════════════
if (process.argv.includes('--reboot-check')) {
  const { existsSync, readFileSync: rf } = await import('fs');
  const SNAP = process.env.HOME + '/seed-sync-gate-snapshot.json';
  if (!existsSync(SNAP)) { console.log('REBOOT_NO_SNAPSHOT'); process.exit(3); }
  const snap = JSON.parse(rf(SNAP, 'utf8'));
  for (const [k, v] of Object.entries(snap)) H.localStorage.setItem(k, v);

  const { Cult: C } = await import('../js/xiuxian/index.js');
  const { Bag: B, DAY: D } = await import('../js/xiuxian/items.js');
  const { CAMP: CA } = await import('../js/xiuxian/camp.js');
  const { Merchant: ME } = await import('../js/xiuxian/merchant.js');
  const { COMPANION: CO } = await import('../js/xiuxian/companion.js');
  const { CLOCK: CK } = await import('../js/xiuxian/clock.js');
  const { Profile: P, Seed: S } = await import('../js/xiuxian/profile.js');
  const { getMaster: gm } = await import('../js/xiuxian/seed.js');
  CK.load(); C.init(); B.load('xx_bag_v080'); CA.load(); D.load('xx_day_v080'); ME.load(); CO.load();
  P.load();                                              // main.js:549
  P.collect({ Cult: C, Nemesis: {}, Titles: {}, Bag: B, CAMP: CA, DAY: D, Merchant: ME, COMPANION: CO });
  const expected = process.env.REBOOT_EXPECT || '';
  if (expected && S.cur === expected && gm() === expected) console.log('REBOOT_SEED_OK:' + S.cur);
  else console.log(`REBOOT_SEED_LOST: 期望 ${JSON.stringify(expected)},实际 Seed.cur=${JSON.stringify(S.cur)}, getMaster=${JSON.stringify(gm())}`);
  process.exit(0);
}

let pass = 0, fail = 0; const failed = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};
const die2 = msg => { console.log(`\n❌ 门禁自身失效:${msg}`); process.exit(2); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════
// [G4] 反向自检 —— 用**合成样本**验判定函数本身
//
// 为什么放在最前面:下面的 G1 判定函数是一个自己写的标识符扫描器,
// 它如果写错了(把合法的当自由变量、或把自由变量当合法的),
// G1 会一直绿 —— 而且绿得像在验证。
// 所以先拿几段**人工构造、与本仓当前代码无关**的样本喂给它,
// 证明它该报的报、不该报的不报。注意这些样本是内联的字面量,
// 不读 ui.js、不依赖 ui.js 现在的状态,自检与被测状态完全解耦。
// ══════════════════════════════════════════════════════════
console.log('\n[G4] 判定函数反向自检(合成样本,与真实文件无关)');

/**
 * 扫出源码里的自由变量(既没在本文件任何作用域声明、也不是全局/关键字)。
 *
 * 实现要点(每一条都是踩出来的):
 *   · 用 codeMask 先把注释/字符串/模板串抹掉,否则注释里出现的名字会全被误判。
 *   · import 子句本身要在**扫描使用**之前抹掉:`ROOMS as TOMB_ROOMS` 里的
 *     `ROOMS` 是源侧名字,本模块没有绑定,不抹会永久误报。
 *   · 数字字面量也要抹:`0x6D2B79F5` 会被标识符扫描切成 `x6D2B79F5`。
 *   · 箭头函数参数表在 `=>` **左边**:`(rw)=>…`。规则写成 `\((…)\)\s*=>`,
 *     不能写成 `…\((…)\)(?:=>|\{)` —— 后者只匹配得到 `=>` 在括号前面的写法,
 *     `(rw)=>` 会整条漏掉,`rw` 于是被误判成自由变量。
 *   · `const xs = …, ys = …` 这种一条声明多个绑定:朴素的 `[^;=]*`
 *     在第一个 `=` 处就截断,`ys` 会漏成自由变量。
 *
 * @param {string} src
 * @returns {{declared:Set<string>, used:Set<string>, free:string[]}}
 */
function freeVars(src) {
  const code = codeMask(src).code;
  const declared = new Set();
  const addName = s => {
    const t = String(s).trim().replace(/^\.\.\./, '');
    if (/^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
  };
  /** 从解构/参数表里挖标识符:{a, b: c} → a,c ;(x, y) → x,y */
  function addList(s) {
    s = String(s).trim().replace(/^\.\.\./, '');
    const depth = []; let cur = '';
    for (const ch of s) {
      if ('{(['.includes(ch)) { depth.push(ch); cur += ch; continue; }
      if ('})]'.includes(ch)) { depth.pop(); cur += ch; continue; }
      // 只有**顶层**的 `=` / `,` 才是绑定分隔符,否则会把实参切碎
      if ((ch === '=' || ch === ',') && !depth.length) { addName(cur); cur = ''; continue; }
      cur += ch;
    }
    addName(cur);
    for (const m of s.matchAll(/[{[]([^}\]]*)[}\]]/g)) addList(m[1]);          // 嵌套解构
    for (const m of s.matchAll(/([{,])\s*([A-Za-z_$][\w$]*)\s*(?::|=)/g)) addName(m[2]);
  }
  for (const m of code.matchAll(/\bimport\s+([\s\S]*?)\s+from(?![\w$])/g)) {
    const c = m[1];
    const b = c.match(/\{([\s\S]*?)\}/);
    if (b) for (const p of b[1].split(',')) {
      const q = p.trim(); if (!q) continue;
      const a = q.split(/\s+as\s+/); addName((a[1] || a[0]).trim());          // 别名取**本地**名
    }
    const d = c.replace(/\{[\s\S]*?\}/g, '').replace(/,/g, ' ').replace(/\*\s+as\s+/g, ' ').trim();
    for (const n of d.split(/\s+/)) addName(n);
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([^;\n]*)/g)) addList(m[1]);      // 一条多个绑定
  for (const m of code.matchAll(/\b(?:const|let|var)\s+[{[]([\s\S]*?)[}\]]/g)) addList(m[1]);
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) addName(m[1]);
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) addName(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*([^)]*)\)/g)) addList(m[1]);
  for (const m of code.matchAll(/(?:function\s*\*?\s*[A-Za-z_$][\w$]*|=>|\b[A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?:=>|\{)/g)) addList(m[1]);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) addList(m[1]);                    // (a,b) =>
  for (const m of code.matchAll(/[({,]\s*([A-Za-z_$][\w$]*)\s*=>/g)) addName(m[1]);       // a =>
  for (const m of code.matchAll(/(?:^|[;{}\s])(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) addName(m[1]);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) addName(m[1]);
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([^;]*?)(?:;|of\b|in\b)/g)) addList(m[1]);

  const GLOBALS = new Set(`console window document localStorage sessionStorage Math JSON Object Array
String Number Boolean Date Promise Map Set WeakMap WeakSet Proxy Reflect Error TypeError RangeError
SyntaxError RegExp BigInt Symbol setTimeout clearTimeout setInterval clearInterval queueMicrotask
requestAnimationFrame cancelAnimationFrame navigator location history performance atob btoa escape
unescape encodeURIComponent decodeURIComponent encodeURI decodeURI Infinity NaN undefined null true
false isNaN isFinite parseInt parseFloat Intl URL URLSearchParams Blob File FileReader FormData
Headers Request Response fetch AbortController TextEncoder TextDecoder Audio AudioContext Image
OffscreenCanvas HTMLElement Element Node Event CustomEvent KeyboardEvent MouseEvent TouchEvent
devicePixelRatio globalThis alert confirm prompt structuredClone crypto WebSocket Worker Notification
speechSynthesis Screen VisualViewport matchMedia CSS ImageData Path2D CanvasGradient ImageBitmap
CanvasRenderingContext2D DOMParser XMLHttpRequest`.split(/\s+/).filter(Boolean));
  const KEYWORDS = new Set(`break case catch class const continue debugger default delete do else
export extends finally for function if import in instanceof let new return super switch this throw try
typeof var void while with yield async await of static get set from as`.split(/\s+/).filter(Boolean));

  // 数字字面量(含十六进制)先抹掉:`0x6D2B79F5` 会被切成 `x6D2B79F5`
  let sc = code
    .replace(/\b0[xX][0-9a-fA-F]+\b/g, m => ' '.repeat(m.length))
    .replace(/\b\d[\d_]*(\.[\d_]+)?([eE][+-]?\d+)?\b/g, m => ' '.repeat(m.length))
    .replace(/\bimport\s+[\s\S]*?\s+from\b[^\n]*/g, m => ' '.repeat(m.length));

  const used = new Set();
  for (const m of sc.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const n = m[0], i = m.index;
    if (sc[i - 1] === '.') continue;            // 属性名 obj.foo
    if (sc.slice(i - 1, i + 1) === '?.') continue;
    let j = i + n.length;
    while (sc[j] === ' ') j++;
    if (sc[j] === ':') {                        // 对象字面量键(后面不是 `::`)
      let k = j + 1; while (sc[k] === ' ') k++;
      if (sc.slice(k, k + 2) !== '::') continue;
    }
    used.add(n);
  }
  const free = [...used].filter(n => !declared.has(n) && !GLOBALS.has(n) && !KEYWORDS.has(n));
  return { declared, used, free };
}

{
  // 样本 1:一个**真的**自由变量 —— 长得和 ui.js 那个 bug 一模一样的形状
  const s1 = `const a = 1;\nfunction f(){ try { g(a); } catch (e) { warn(e); } }\n`;
  t('[G4] 样本1 抓到未声明的 g', freeVars(s1).free.includes('g'), JSON.stringify(freeVars(s1).free));

  // 样本 2:同名但**已声明** —— 判据不能只看名字在不在文本里
  const s2 = `const g = { n: 1 };\nfunction f(){ try { g.n; } catch (e) { warn(e); } }\n`;
  t('[G4] 样本2 已声明的 g 不误报', !freeVars(s2).free.includes('g'), JSON.stringify(freeVars(s2).free));

  // 样本 3:alias import —— `ROOMS as TOMB_ROOMS` 里的源侧名字不得被当成自由变量
  const s3 = `import { ROOMS as TOMB_ROOMS } from './t.js';\nconst x = TOMB_ROOMS.length;\n`;
  t('[G4] 样本3 alias import 不误报', freeVars(s3).free.length === 0, JSON.stringify(freeVars(s3).free));

  // 样本 4:箭头参数 / 括号箭头参数 / 一条声明多个绑定 / 十六进制 / 注释与字符串
  const s4 = `const xs = [1, 2], ys = [3, 4];\n// mods 这里出现在注释里\nconst s = "mods 在字符串里";\n`
          + `const h = 0x6D2B79F5;\nconst f = (rw) => rw + 1;\nconst g2 = (a, b) => a * b + xs[0] + ys[0] + h + f(1);\n`;
  t('[G4] 样本4 箭头参数/多绑定/十六进制/注释字符串都不误报', freeVars(s4).free.length === 0, JSON.stringify(freeVars(s4).free));

  // 样本 5:对象字面量键与属性访问不是自由变量
  const s5 = `const o = { mods: 1, f: 2 };\nconst v = o.mods + o?.f;\n`;
  t('[G4] 样本5 对象键/属性不误报', freeVars(s5).free.length === 0, JSON.stringify(freeVars(s5).free));
}

// ══════════════════════════════════════════════════════════
// [G3] 防退化 —— 先确认真解析到了目标代码
//
// 仓库里吃过两次「静默假通过」:一次是 indexOf 返回 -1,slice(-1) 取到
// 最后一个字符,长度检查照样过;一次是方法被拆到别的文件后 regex 匹配不到。
// 所以**先断言解析命中,再断言内容**,命中为 0 直接 exit 2。
// ══════════════════════════════════════════════════════════
console.log('\n[G3] 防退化:确认解析到目标代码');
const UI_SRC = readOne('js/xiuxian/ui.js');
const setseedIdx = UI_SRC.indexOf("case 'setseed'");
const actIdx = UI_SRC.indexOf('act(a, v, v2, slot)');
const collectIdx = UI_SRC.indexOf('Profile.collect(mods)');
const uiDeclared = freeVars(UI_SRC);
if (setseedIdx < 0 || actIdx < 0) {
  die2(`ui.js 里解析不到目标:case 'setseed'=${setseedIdx}, act(...)=${actIdx} —— 下面的断言一条都没跑,别信结论`);
}
t('[G3] setseed 分支存在', setseedIdx > 0, `index ${setseedIdx}`);
t('[G3] act() 签名存在', actIdx > 0, `index ${actIdx}`);
// 扫出零个自由变量**也可能**是扫描器坏了(比如 mask 全空)。用已知量兜住:
t('[G3] 扫描器确实在工作(识别到 >100 个标识符)',
  uiDeclared.used.size > 100, `used=${uiDeclared.used.size}, declared=${uiDeclared.declared.size}`);
t('[G3] 已识别的标识符里含 Seed / Profile(证明读的是 ui.js 本体)',
  uiDeclared.used.has('Seed') && uiDeclared.used.has('Profile'),
  `used=${[...uiDeclared.used].slice(0, 12).join(',')}`);

// ══════════════════════════════════════════════════════════
// [G1] 静态:ui.js 不得有未定义的自由变量
// ══════════════════════════════════════════════════════════
console.log('\n[G1] ui.js 不得出现未定义的自由变量');
t('[G1] ui.js 零自由变量', uiDeclared.free.length === 0,
  `自由变量: ${JSON.stringify(uiDeclared.free)}  —— 位置见下面的逐个定位`);
// 逐个点名,报出**行号** —— 只报数量不报位置,下一个人没法查
for (const n of uiDeclared.free) {
  const lines = UI_SRC.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) =>
    new RegExp(`(?<![.\\w$])${n}(?![\\w$])`).test(l.replace(/\/\/.*$/, '')));
  for (const [ln, l] of lines) console.log(`      ↳ ${n} 在 js/xiuxian/ui.js:${ln}  ${l.trim()}`);
}
t('[G1] mods 不再出现在 ui.js 里(专项:它就是本 bug 的名字)',
  !/\bmods\b/.test(UI_SRC.replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, '')),
  'ui.js 里还有 mods 的真实代码引用');
const UI_CODE = codeMask(UI_SRC).code;   // 抹掉注释与字符串:下面几条查的是**代码**,不是注释
t('[G1] ui.js 不再调用 Profile.collect(mods)(就是这一行在抛 ReferenceError)',
  !/Profile\.collect\s*\(\s*mods\s*\)/.test(UI_CODE));
t('[G1] 改用种子的真源(Profile.data.seed = Seed.cur + Profile.flush)',
  /Profile\.data\.seed\s*=\s*Seed\.cur/.test(UI_CODE) && /Profile\.flush\s*\(\s*\)/.test(UI_CODE));
// 循环依赖防线:不能为了拿到 mods 而从 main.js 反向 import
t('[G1] ui.js 没有从 main.js 反向 import(那会造出 ui.js ↔ main.js 环)',
  !/from\s+['"][^'"]*main\.js/.test(UI_SRC));

// ══════════════════════════════════════════════════════════
// [G2] 动态:换种子 → 走那条 UI 分支 → 存档里的种子真的变了
// ══════════════════════════════════════════════════════════
console.log('\n[G2] 动态:走真 UI 分支,种子同步真的发生');

const V = '?v=17';
let Cult, Bag, DAY, CAMP, Merchant, COMPANION, CLOCK, Hall, Profile, Seed, getMaster;
try {
  ({ Cult } = await import('../js/xiuxian/index.js'));
  ({ Bag, DAY } = await import('../js/xiuxian/items.js'));
  ({ CAMP } = await import('../js/xiuxian/camp.js'));
  ({ Merchant } = await import('../js/xiuxian/merchant.js'));
  ({ COMPANION } = await import('../js/xiuxian/companion.js'));
  ({ CLOCK } = await import('../js/xiuxian/clock.js'));
  ({ Hall } = await import('../js/xiuxian/ui.js'));
  ({ Profile, Seed } = await import('../js/xiuxian/profile.js'));
  ({ getMaster } = await import('../js/xiuxian/seed.js'));
  Cult.init();
} catch (e) {
  die2(`模块加载失败,下面的断言一条都没跑:\n     ${e.message}`);
}
Bag.load('xx_bag_v080'); CAMP.load(); DAY.load('xx_day_v080');
Merchant.load(); COMPANION.load(); CLOCK.load();

// 忠实复刻 main.js:549-560 的开机链路
Profile.load();
const mods = { Cult, Nemesis: {}, Titles: {}, Bag, CAMP, DAY, Merchant, COMPANION };
Profile.collect(mods);
Hall.open();

// 桩缺口:harness 的 getElementById 只查预置表,查不到 innerHTML 生成的面板节点
// (真实浏览器里是全树查找)。不补这条,`#xx-seed` 永远取不到 —— 门禁会
// 因为「取不到输入框」而假红,和被测代码无关。
if (!H.document.getElementById('xx-seed')) {
  const orig = H.document.getElementById;
  H.document.getElementById = id => orig(id) || H.document.querySelector('#' + id);
}
Hall.tab = 'sys';          // 种子输入框在「存档」页(dexsys.js 的 vSys)
Hall.render();
const input = H.document.getElementById('xx-seed');
if (!input) die2('「存档」页渲染后仍找不到 #xx-seed —— 门禁自身失效,下面的结论无效');
t('[G2] 存档页渲染出 #xx-seed 输入框', !!input);

const OLD_SEED = Seed.cur;
const NEW_SEED = '门禁-新一世';
input.value = NEW_SEED;

// 把被 try/catch 吞掉的告警抓出来 —— 这个 bug 的特征就是「只有 warn,没有红」
const warns = [];
const realWarn = console.warn;
console.warn = (...a) => warns.push(a.map(String).join(' '));
try {
  Hall.act('setseed');                      // 真的点一次「换 一 世」
} catch (e) {
  console.warn = realWarn;
  die2('Hall.act("setseed") 抛到外面来了,门禁无法继续:\n     ' + e.message);
}
console.warn = realWarn;

t('[G2] 换世过程中没有 ReferenceError 被 warn 吞掉',
  !warns.some(w => /ReferenceError/.test(w)),
  `warn: ${warns.map(w => w.split('\n')[0]).join(' | ')}`);
t('[G2] 换世过程中一条 warn 都没有', warns.length === 0,
  warns.map(w => w.split('\n')[0]).join(' | '));
t('[G2] Seed.cur 变成新种子', Seed.cur === NEW_SEED, `实际 ${JSON.stringify(Seed.cur)}`);
t('[G2] 种子的真源(getMaster)是新种子', getMaster() === NEW_SEED, `实际 ${JSON.stringify(getMaster())}`);
t('[G2] Profile.data.seed 是新种子 ← 这就是原来那一行要做的事',
  Profile.data.seed === NEW_SEED, `实际 ${JSON.stringify(Profile.data.seed)}`);

// 落盘检查:flush() 必须真的把新种子写进统一存档键
let stored = null;
try { stored = JSON.parse(H.localStorage.getItem('xx_profile_v081')); } catch {}
t('[G2] localStorage 统一存档键里的 seed 是新种子',
  stored && stored.seed === NEW_SEED, `实际 ${stored ? JSON.stringify(stored.seed) : '(读不出)'}`);

// 存档码:玩家复制出去的那串文字,解出来的必须是新种子
const decoded = (() => {
  try {
    const b = Profile.export().replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b))));
  } catch { return null; }
})();
t('[G2] 存档码解出来的 seed 是新种子',
  decoded && decoded.seed === NEW_SEED, `实际 ${decoded ? JSON.stringify(decoded.seed) : '(解不出)'}`);

// —— 重载存活:这是「只是显示旧名字」与「真丢档」的分界 ——
// 把当前 localStorage 落成快照,交给**第二个进程**按真实开机链路读回来。
// profile.js:101 的 `Seed.set(this.data.seed)` 会用存档里的种子盖回真源,
// 所以只要存档里没记下新种子,玩家一重开页面就回到旧世界。
const SNAP = process.env.HOME + '/seed-sync-gate-snapshot.json';
const snap = {};
for (const k of ['xx_seed_v081', 'xx_profile_v081', 'xx_cultivation_v077', 'xx_day_v080']) {
  const v = H.localStorage.getItem(k);
  if (v != null) snap[k] = v;
}
const { writeFileSync } = await import('fs');
writeFileSync(SNAP, JSON.stringify(snap));

// 新进程 = 新模块实例 + 只带 localStorage ≡ 玩家重开一次页面
const { spawnSync } = await import('child_process');
const child = spawnSync(process.execPath, [process.argv[1], '--reboot-check'],
  { encoding: 'utf8', env: { ...process.env, REBOOT_EXPECT: NEW_SEED } });
const out = ((child.stdout || '') + (child.stderr || '')).trim();
t('[G2] 重载子进程跑通(自己没崩)', child.status === 0, `status=${child.status}\n${out.slice(0, 400)}`);
t('[G2] 重开页面后种子活下来了(没被存档里的旧值盖回去)',
  out.includes('REBOOT_SEED_OK:' + NEW_SEED), out.slice(0, 400));
if (child.status !== 0 || !out.includes('REBOOT_SEED_OK:'))
  console.log(`      ↳ 子进程原话: ${out}`);

// ══════════════════════════════════════════════════════════
// 汇总
// ══════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(52)}`);
console.log(`通过 ${pass} · 不通过 ${fail} · 种子 ${OLD_SEED} → ${JSON.stringify(Seed.cur)}`);
if (fail) {
  console.log('\n失败明细:');
  for (const f of failed) console.log('  · ' + f);
  process.exit(1);
}
console.log('✅ 种子同步这条链接通了(静态无自由变量 + 真跑 UI 分支 + 重载存活)');
process.exit(0);