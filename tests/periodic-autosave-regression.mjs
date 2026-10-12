// ===== 周期自动存档门禁(V0.99.5)=====
//
// 运行: node tests/periodic-autosave-regression.mjs
// 退出码:0 通过 / 1 不通过 / 2 门禁自身失效(解析不到东西,后面全在空转)
//
// 【为什么需要这道门禁】
//   跨设备只读审计查出的事实(不是猜测):
//     · `CAMP.earn()` 的唯一调用点是 camp.js:252 的 offlineReport(),
//       由 main.js 进游戏时调一次 —— 局内 engine.addAlways 里没有 earn(),
//       局内营地数值是死的;
//     · profile.js 的 `auto(mods)` **全仓零调用方**(死代码);
//     · ui.js 里有一句「存档全靠 Profile.auto() 的节流自动存档兜着」的假承诺。
//   ⇒ 落盘点只剩 visibilitychange / pagehide / beforeunload 三个,
//     **全都只在玩家主动离开页面时触发**。崩掉 / 被系统杀进程 /
//     移动端后台回收,一个都不触发 —— 上次落盘之后的进度全丢。
//     owner 拍板的原话:「起码防止切后台回来又要重新开局玩」。
//
// 【本门禁盯的四件事】
//   [G1] 推进时间后,存档**真的更新了** —— 不是把开机快照原样重写一遍。
//   [G2] 节流生效:短时间内的重复调用不会重复写盘,且不会饿死(尾写仍在)。
//   [G3] 陈旧值不盖回去 —— XX-AUDIT-006 的同族,必须显式覆盖。
//   [G4] 既有三个钩子仍在,没有被周期落盘替换掉。
//   [G5] 防退化:真的跑到了产品函数;为 0 就 exit 2。
//   [G6] 反向自检:合成样本,不读真实文件、不与被测状态耦合。
//
// 【节流间隔是怎么定的(15000ms)】
//   复现本段实测:
//     node tests/periodic-autosave-regression.mjs --cost
//   实测结论:一次 Profile.collect() 写 **9 个键**(8 个老键 + 统一档)。
//   本机(in-memory Map)≈120μs/KB;真机 localStorage 是**同步** IPC + 落盘,
//   比这贵 —— 所以本机数字只能当**下限**看,不能当预算看。
//     · 15s = 每分钟 4 次 × 9 键 = 每分钟 36 次同步写。
//       60fps 下一分钟 3600 帧 ⇒ **每 100 帧才 1 次同步写**,帧预算上不可见。
//     · 2s(Profile.auto 原型值)是**事件合并**节流,对应「人手动作速率」
//       (各模块 commit 由点击/掉落触发)。当无条件定时器用 = 每分钟 270 次
//       主线程写,是 15s 方案的 7.5 倍,只换来把最坏丢失窗口 15s→2s。
//     · 代价侧:最坏丢失窗口 15s,不到最短一局的四分之一。
//   js/ui/screens.js bindTap 的 300ms 不作参考:那是防人连点,
//   单位是「一次手势」,不是「一次后台巡检」。
//
// ⚠️ 本机没有浏览器(harness.mjs 顶上写着:playwright 在 Android PRoot 上装不上,
//   且严禁安装)。这里验的是**真实产品模块 + 真实 localStorage 写入 + 自写假时钟 +
//   自写 DOM 桩**,不等于「浏览器里点过了」。真机触摸与页面生命周期由 CI 补。

import { install } from './harness.mjs';
import { ROOT, readOne, codeMask } from './lib-uimod.mjs';

// ══════════════════════════════════════════════════════════
// 成本实测(可选:`--cost`,不参与门禁判定)
// ══════════════════════════════════════════════════════════
if (process.argv.includes('--cost')) {
  const H = install();
  const B = ROOT + '/js/xiuxian/';
  const { Cult } = await import(B + 'index.js');
  const { Bag, DAY } = await import(B + 'items.js');
  const { CAMP } = await import(B + 'camp.js');
  const { Merchant } = await import(B + 'merchant.js');
  const { COMPANION } = await import(B + 'companion.js');
  const { Titles, Nemesis } = await import(B + 'relations.js');
  const { Profile } = await import(B + 'profile.js');
  Cult.init(); Bag.load('xx_bag_v080'); CAMP.load();
  DAY.load('xx_day_v080'); Merchant.load(); COMPANION.load(); Profile.load();
  const mods = { Cult, Nemesis, Titles, Bag, CAMP, DAY, Merchant, COMPANION };
  const row = (label, nItems) => {
    Bag.s.items = {};
    for (let i = 0; i < nItems; i++) Bag.s.items['k' + i] = (i % 90) + 1;
    Profile.collect(mods);
    let bytes = 0;
    for (const [k, v] of H.localStorage._mem) bytes += k.length + v.length;
    const N = 200;
    let writes = 0;
    const orig = H.localStorage.setItem;
    H.localStorage.setItem = (k, v) => { writes++; return orig(k, v); };
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) Profile.collect(mods);
    const t1 = process.hrtime.bigint();
    H.localStorage.setItem = orig;
    console.log(`${label.padEnd(10)} 档案 ${(bytes / 1024).toFixed(1).padStart(6)} KB · ` +
      `每次 collect 写 ${String(writes / N).padStart(2)} 键 · ${(Number(t1 - t0) / 1e6 / N).toFixed(3)} ms`);
  };
  console.log('\n一次 Profile.collect() 的真实成本(in-memory Map = 真机的下限):');
  row('空档', 0); row('小', 10); row('中', 100); row('大', 1000);
  process.exit(0);
}

// ══════════════════════════════════════════════════════════
let pass = 0, fail = 0; const failed = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};
const die2 = msg => { console.log(`\n❌ 门禁自身失效:${msg}`); process.exit(2); };

// ══════════════════════════════════════════════════════════
// 判定器:一段回调体里有没有碰 UI / DOM
//
// 这是本门禁唯一的「判断」逻辑,所以它必须先被反向自检证伪过([G6])。
// 读的是 **codeMask 之后的代码** —— 注释与字符串里的 `Hall.render()`
// 不算碰 UI(那是注释,不是行为)。
// ══════════════════════════════════════════════════════════
const UI_TOKENS = [
  'getElementById', 'querySelector', 'innerHTML', 'textContent',
  'classList', 'className', 'style.cssText', 'appendChild', 'removeChild',
  'Hall.', 'Screens.', 'toast', 'render(', 'showLevelUp',
];

/**
 * @param {string} body 回调体源码(**含注释**,内部自己 mask)
 * @returns {string[]} 命中的 UI/DOM token
 */
function uiHits(body) {
  const code = codeMask(body).code;
  const hits = [];
  for (const tok of UI_TOKENS) if (code.includes(tok)) hits.push(tok);
  return hits;
}

/** 取 `anchor` 处开始、到第一对配平**括号**为止的调用体(用于 `setInterval(…)`) */
function callBody(code, anchor, from = 0) {
  const at = code.indexOf(anchor, from);
  if (at < 0) return null;
  let i = code.indexOf('(', at);
  if (i < 0) return null;
  let d = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '(') d++;
    else if (code[j] === ')') { d--; if (d === 0) return code.slice(at, j + 1); }
  }
  return null;
}

/**
 * 取方法定义的完整实现体(从签名到配平的 `}`)。
 *
 * ⚠️ 为什么不能拿 callBody 取 `auto(mods) {}`:锚点自己就带一对括号,
 *   配平会在锚点内部就结束,拿到 10 个字符的 `auto(mods)` ——
 *   非空、看起来合理,于是下面所有针对实现体的断言全在空转。
 *   方法体要按**花括号**配平。
 */
function methodBody(code, anchor) {
  const at = code.indexOf(anchor);
  if (at < 0) return null;
  let i = at, d = 0, close = -1;
  for (; i < code.length; i++) {                 // 先走过锚点自带的参数表
    if (code[i] === '(') d++;
    else if (code[i] === ')') { d--; if (d === 0) { close = i; break; } }
  }
  if (close < 0) return null;
  i = close + 1;
  while (i < code.length && /\s/.test(code[i])) i++;
  if (code[i] !== '{') return null;
  let b = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') b++;
    else if (code[j] === '}') { b--; if (b === 0) return code.slice(at, j + 1); }
  }
  return null;
}

/** 取出所有调用体里**含 needle** 的那些(用于在多个 setInterval 里挑对的那个) */
function callsContaining(code, anchor, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const b = callBody(code, anchor, from);
    if (!b) break;
    if (b.includes(needle)) out.push(b);
    from = code.indexOf(anchor, from) + anchor.length;
  }
  return out;
}

/**
 * 抹掉注释但**保留字符串字面量**。
 *
 * 为什么需要:codeMask 会把字符串整个抹成空格,而
 * `addEventListener('visibilitychange')` 的判据就在**字符串里** ——
 * 用 codeMask 查它恒为 false,三条钩子的断言会永远红(而不是永远绿,
 * 但同样说明判据本身是坏的)。结构性判断用 codeMask,事件名判断用这个。
 */
function codeKeepStrings(src) {
  const { code, strings } = codeMask(src);
  const out = code.split('');
  for (const s of strings) for (let i = s.start; i < s.end; i++) out[i] = src[i];
  return out.join('');
}

// ══════════════════════════════════════════════════════════
// [G6] 反向自检 —— 合成样本,不读任何真实文件
//
// 为什么放最前面:下面 G1~G5 的判定全建立在 uiHits() 上。
// 它如果恒返回空,「落盘不碰 UI」那条就会**永远绿**,而且绿得像在验证。
// 所以先拿几段**人工构造、与本仓当前代码无关**的样本喂它。
// 这些样本是内联字面量,不读 main.js、不依赖 main.js 现在的状态。
// ══════════════════════════════════════════════════════════
console.log('\n[G6] 判定器反向自检(合成样本,与真实文件无关)');
{
  // 样本 1:干净回调 —— 只碰 localStorage,与产品接线同形
  const s1 = `() => Profile.auto(mods)`;
  t('[G6] 样本1 只碰 localStorage 的回调判为不碰 UI',
    uiHits(s1).length === 0, JSON.stringify(uiHits(s1)));

  // 样本 2:碰 DOM —— 必须被抓到(方向写反时这里必须红)
  const s2 = `() => { Profile.collect(mods); document.getElementById('hud-xx').textContent = '已存档'; }`;
  t('[G6] 样本2 碰 getElementById 的回调被抓',
    uiHits(s2).includes('getElementById'), JSON.stringify(uiHits(s2)));

  // 样本 3:碰渲染层 —— 必须被抓到
  const s3 = `() => { Profile.auto(mods); Hall.render(); Screens.show(); }`;
  t('[G6] 样本3 碰 Hall/Screens 的回调被抓',
    uiHits(s3).includes('Hall.') && uiHits(s3).includes('Screens.'), JSON.stringify(uiHits(s3)));

  // 样本 4:UI 名字**只出现在注释和字符串里** —— 不得误报。
  //   这条是判据的方向性证明:判据读的是代码,不是文本。
  const s4 = `() => {\n  // 这里本来想调 Hall.render(),后来删了\n  Profile.auto(mods);\n  const note = 'innerHTML 不碰';\n}`;
  t('[G6] 样本4 注释/字符串里的 UI 名字不误报',
    uiHits(s4).length === 0, JSON.stringify(uiHits(s4)));
}
{
  // callBody 的反向自检:括号必须配平,注释里的括号不能骗它。
  const c1 = `setInterval(() => Profile.auto(mods), AUTO_EVERY)`;
  const g1 = callBody(c1, 'setInterval');
  t('[G6] callBody 取到完整的 setInterval 调用',
    g1 === c1, JSON.stringify(g1));
  const c2 = `// setInterval( 这里有个没闭合的括号\nsetInterval(() => Profile.auto(mods), AUTO_EVERY)`;
  const g2 = callBody(codeMask(c2).code, 'setInterval');
  t('[G6] callBody 不被注释里的括号骗(注释已抹掉)',
    g2 === 'setInterval(() => Profile.auto(mods), AUTO_EVERY)', JSON.stringify(g2));
  t('[G6] callBody 找不到锚点时返回 null(不给垃圾)',
    callBody(codeMask('const a = 1;').code, 'setInterval') === null);

  // methodBody 的反向自检:必须按花括号取到**整个**实现体,
  // 也不能被锚点自带的那对括号骗到(踩过一次:配平在锚点内部就结束,
  // 拿到 10 个字符的 `auto(mods)`,非空、看着合理,断言全在空转)。
  const m1 = `auto(mods) {\n  if (mods) this._mods = mods;\n  if (!this._mods) return false;\n  this.collect(this._mods);\n  return true;\n}`;
  t('[G6] methodBody 取到整个实现体(不是只截签名)',
    methodBody(codeMask(m1).code, 'auto(mods)') === m1,
    JSON.stringify(methodBody(codeMask(m1).code, 'auto(mods)')));
  t('[G6] methodBody 取到的长度显著大于锚点本身',
    methodBody(codeMask(m1).code, 'auto(mods)').length > m1.length / 2);
  const m2 = `auto(mods) {\n  // 注释里有个 { 和一个 )\n  const s = "字符串里的 }";\n  this.collect(this._mods);\n}`;
  // 注意:methodBody 吃的是**mask 过**的代码,所以比对对象也要是 mask 后的
  //   —— 比原始文本等于在测「codeMask 有没有保留字符串」,那是另一回事。
  const m2c = codeMask(m2).code;
  const got2 = methodBody(m2c, 'auto(mods)');
  t('[G6] methodBody 不被注释里的 { 骗(不提前截断)',
    got2 !== null && got2.includes('this.collect(this._mods);'),
    JSON.stringify(got2));
  t('[G6] methodBody 不被字符串里的 } 骗(不提前截断)',
    got2 === m2c, JSON.stringify(got2));
  t('[G6] methodBody 找不到锚点时返回 null',
    methodBody(codeMask('const a = 1;').code, 'auto(mods)') === null);
}

// ══════════════════════════════════════════════════════════
// [G3a] 防退化 —— 先确认真解析到了目标代码
//
// 仓库里吃过两次「静默假通过」:一次是 indexOf 返回 -1、slice(-1) 截到
// 最后一个字符而长度检查照样过;一次是方法被拆到别的文件后 regex 匹配不到。
// 所以先断言解析命中,再断言内容。命中为 0 直接 exit 2。
// ══════════════════════════════════════════════════════════
console.log('\n[G3a] 防退化:确认解析到目标代码');
const MAIN_SRC = readOne('js/main.js');
const PROF_SRC = readOne('js/xiuxian/profile.js');
const MAIN_CODE = codeMask(MAIN_SRC).code;      // 抹掉注释与字符串:下面查的是**代码**
const MAIN_KEEP = codeKeepStrings(MAIN_SRC);   // 只抹注释:事件名在字符串里,得留住
const PROF_CODE = codeMask(PROF_SRC).code;

const idxImport = MAIN_CODE.indexOf('AUTO_EVERY');
const idxSetInt = MAIN_CODE.indexOf('setInterval');
const idxVis = MAIN_KEEP.indexOf("addEventListener('visibilitychange'");
const idxPage = MAIN_KEEP.indexOf("addEventListener('pagehide'");
const idxUnload = MAIN_KEEP.indexOf("addEventListener('beforeunload'");
// ⚠️ main.js 里**不止一个** setInterval(?cheat / ?fast 两个调试定时器在前)。
//   直接 `indexOf('setInterval')` 会抓到 ?cheat 那个 1000ms 的加经验定时器 ——
//   它当然没有 Profile.auto。必须挑「体内含 AUTO_EVERY」的那一个,
//   否则判据跟着文件里调试开关的顺序漂移(这正是本仓吃过的静默假通过)。
const timerCalls = callsContaining(MAIN_CODE, 'setInterval', 'AUTO_EVERY');
if (idxImport < 0 || idxSetInt < 0) {
  die2(`main.js 里解析不到目标:AUTO_EVERY=${idxImport}, setInterval=${idxSetInt} —— 下面的断言一条都没跑,别信结论`);
}
t('[G3a] main.js 从 profile.js 引入了 AUTO_EVERY', idxImport > 0, `index ${idxImport}`);
t('[G3a] main.js 里有 setInterval 落盘接线', idxSetInt > 0, `index ${idxSetInt}`);
t('[G3a] 全文件里**恰好一个** setInterval 的间隔是 AUTO_EVERY(没多接也没漏接)',
  timerCalls.length === 1, `找到 ${timerCalls.length} 个:${JSON.stringify(timerCalls)}`);
// ⚠️ 周期落盘被删掉 = **产品回归**,不是门禁 malfunction。
//   这里必须报红(EXIT=1),不能 die2(EXIT=2):EXIT=2 的意思是
//   「我连门禁自己都跑不动了」,把它用在这上面会掩盖真正的回归,
//   也会让「移除周期落盘」看起来像门禁坏了而不是产品坏了。
//   解析不到**产品模块**才配 exit 2(见下方 die2 与 [G5] 末尾)。
const timerCall = timerCalls[0] || '';
t('[G3a] profile.js 导出了 AUTO_EVERY',
  /export\s+const\s+AUTO_EVERY\s*=/.test(PROF_CODE));
const autoBody = methodBody(PROF_CODE, 'auto(mods)');
if (!autoBody) die2('profile.js 里解析不到 auto(mods) 的实现体 —— 下面的断言一条都没跑,别信结论');
t('[G3a] profile.js 的 auto() 实现体取到了(按花括号配平)',
  autoBody.length > 100, `长度 ${autoBody.length}`);
t('[G3a] 实现体确实取到了收尾的大括号(不是只截了签名)',
  autoBody.trimEnd().endsWith('}'), autoBody.slice(-40));

// ══════════════════════════════════════════════════════════
// [G4] 既有三个钩子仍在
// ══════════════════════════════════════════════════════════
console.log('\n[G4] 既有三个真落盘点未被替换');
t('[G4] visibilitychange 钩子仍在', idxVis > 0, `index ${idxVis}`);
t('[G4] pagehide 钩子仍在', idxPage > 0, `index ${idxPage}`);
t('[G4] beforeunload 钩子仍在', idxUnload > 0, `index ${idxUnload}`);
t('[G4] 三个钩子共用同一个 autosave 落盘函数(不是三份各自实现)',
  /const\s+autosave\s*=\s*\(\)\s*=>\s*Profile\.collect\(mods\)/.test(MAIN_CODE) &&
  /if\s*\(\s*document\.hidden\s*\)\s*autosave\(\)/.test(MAIN_CODE) &&
  /addEventListener\('pagehide',\s*autosave\s*\)/.test(MAIN_KEEP) &&
  /addEventListener\('beforeunload',\s*autosave\s*\)/.test(MAIN_KEEP),
  '三个钩子没有共用同一个 autosave');
t('[G4] 三个钩子仍然直接调 Profile.collect(未被改成走节流)',
  (MAIN_CODE.match(/Profile\.collect\s*\(\s*mods\s*\)/g) || []).length >= 2,
  `出现 ${(MAIN_CODE.match(/Profile\.collect\s*\(\s*mods\s*\)/g) || []).length} 次`);

// ══════════════════════════════════════════════════════════
// [G1-静] 周期落盘走的是 collect,不是 flush —— 静态
//
// ⚠️ 这条是本门禁最要紧的一条。flush() 写的是 this.data(上一次 collect 的快照)。
//   周期落盘若调 flush(),就是每 15 秒把开机快照原样重写一遍 ——
//   与 XX-AUDIT-006 把 d.base 原样写回是**同一个动作**。
// ══════════════════════════════════════════════════════════
console.log('\n[G1-静] 周期落盘必须走 collect,绝不能退回 flush');
t('[G1-静] 定时器回调调的是 Profile.auto(mods)',
  /Profile\.auto\s*\(\s*mods\s*\)/.test(timerCall), timerCall);
t('[G1-静] 定时器回调**没有**直接调 Profile.flush()',
  !/Profile\.flush\s*\(/.test(timerCall), timerCall);
t('[G1-静] 定时器间隔取自 AUTO_EVERY(不写魔法数)',
  /,\s*AUTO_EVERY\s*\)\s*;?\s*$/.test(timerCall.trim()), timerCall);
t('[G1-静] profile.js 的 auto() 内部走的是 collect()',
  /this\.collect\s*\(\s*this\._mods\s*\)/.test(autoBody));
t('[G1-静] profile.js 的 auto() **没有**退回 flush() 的分支',
  !/this\.flush\s*\(/.test(autoBody));

// ══════════════════════════════════════════════════════════
// [G4b] 落盘不刷 UI(需求④)
// ══════════════════════════════════════════════════════════
console.log('\n[G4b] 落盘全程不碰 UI(玩家看不到任何东西)');
const timerHits = uiHits(timerCall);
t('[G4b] 定时器回调零 DOM/UI 调用', timerHits.length === 0,
  `命中: ${JSON.stringify(timerHits)} —— ${timerCall}`);
const autoHits = uiHits(autoBody);
t('[G4b] auto() 实现体零 DOM/UI 调用', autoHits.length === 0,
  `命中: ${JSON.stringify(autoHits)}`);
t('[G4b] 落盘链路里没有 toast / 提示语之类的可见反馈',
  !/toast|alert\s*\(|confirm\s*\(|showOffline|弹/.test(timerCall + autoBody));

// ══════════════════════════════════════════════════════════
// 下面开始真跑产品代码
// ══════════════════════════════════════════════════════════
const H = install();

// —— 假时钟 ——
// ⚠️ AUTONOMY.md §3 铁律:假时钟**必须响应 clearTimeout**。
//   不响应的话,auto() 里那个「合并成一次尾写」的定时器会被调两遍,
//   G2 就在测一个不存在的世界。
const realDateNow = Date.now.bind(Date);
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
function fakeClock(start) {
  let now = start, seq = 0;
  const timers = new Map();
  globalThis.Date.now = () => now;
  globalThis.setTimeout = (fn, ms = 0) => {
    const id = ++seq;
    timers.set(id, { at: now + Math.max(0, ms | 0), fn });
    return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  return {
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let pick = null;
        for (const [id, tm] of timers) {
          if (tm.at <= target && (!pick || tm.at < pick.at)) pick = { id, ...tm };
        }
        if (!pick) break;
        timers.delete(pick.id);                 // ⚠️ 触发前先摘掉(真定时器也是这个语义)
        now = Math.max(now, pick.at);
        pick.fn();
      }
      now = target;
    },
    pending: () => timers.size,
    now: () => now,
    restore() {
      globalThis.Date.now = realDateNow;
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

let Cult, Bag, DAY, CAMP, Merchant, COMPANION, Titles, Nemesis, CLOCK, Profile, Seed, AUTO_EVERY;
try {
  ({ Cult } = await import('../js/xiuxian/index.js'));
  ({ Bag, DAY } = await import('../js/xiuxian/items.js'));
  ({ CAMP } = await import('../js/xiuxian/camp.js'));
  ({ Merchant } = await import('../js/xiuxian/merchant.js'));
  ({ COMPANION } = await import('../js/xiuxian/companion.js'));
  ({ Titles, Nemesis } = await import('../js/xiuxian/relations.js'));
  ({ CLOCK } = await import('../js/xiuxian/clock.js'));
  ({ Profile, Seed, AUTO_EVERY } = await import('../js/xiuxian/profile.js'));
} catch (e) {
  die2(`模块加载失败,下面的断言一条都没跑:\n     ${e.message}\n${e.stack}`);
}
if (typeof AUTO_EVERY !== 'number') die2('AUTO_EVERY 不是数字,门禁无法判定节流间隔');

// ————————————————————————————————————————————
// [G3] 陈旧值不盖回去 —— XX-AUDIT-006 的同族
//
// 造一个「存档里有旧值、内存里有新值」的现场:
//   · 统一档 xx_profile_v081 里 cult.qi = 111(旧)
//   · pxs_save 里 gold = 30 / totalRuns = 1(V0.77 迁移快照,就是被盖回去的那个)
//   · 内存里 Cult.s.qi = 999(新)
// 落盘后必须:① cult.qi 是 999;② pxs_save 原封不动。
// ————————————————————————————————————————————
console.log('\n[G3] 陈旧值不盖回去(XX-AUDIT-006 同族)');

const KEY = 'xx_profile_v081';
H.localStorage.setItem(KEY, JSON.stringify({
  v: 1, seed: '旧存档的种子',
  cult: { qi: 111, dao: 7 }, nemesis: null, titles: null,
  bag: { items: { old: 1 }, demon: 0, charter: false },
  camp: { lit: false, fuelEnd: 0, totalSec: 0 }, day: { actions: 0 },
  merch: { visits: 0, lastAt: 0 }, companion: null,
  // ⚠️ 这一行就是 XX-AUDIT-006 的形状:存档里带着一份**从未被消费**的
  //   迁移快照。周期落盘每 15 秒重写一次整个档,必须确认它不会
  //   把这份陈旧快照原样盖回活档。
  base: { gold: 30, totalRuns: 1 },
  savedAt: 1,
}));
// core/save.js 的**活**键:玩家继续玩,金币和局数都涨了
H.localStorage.setItem('pxs_save', JSON.stringify({ gold: 8888, totalRuns: 12 }));

CLOCK.load(); Cult.init(); Bag.load('xx_bag_v080'); CAMP.load();
DAY.load('xx_day_v080'); Merchant.load(); COMPANION.load();
Titles.load(); Nemesis.load();
Profile.load();

t('[G3] 内存里的 Profile.data 是存档里的旧值 111', Profile.data.cult.qi === 111,
  `实际 ${JSON.stringify(Profile.data.cult.qi)}`);

// —— 造一次「局内变化」:8 个模块各改一处,好逐个确认落盘 ——
Cult.s.dao = 999;                 // cult:道行推进了
Bag.s.items = { xi_sui: 42, fu_yin: 7 };   // bag:捡到了东西
CAMP.s.fuelEnd = 424242;          // camp:篝火点着了
CAMP.s.totalSec = 606;
DAY.s.actions = 12;               // day:行动次数
Merchant.s.visits = 5;            // merch:逛了商人
COMPANION.s.name = '小雀';        // companion:起了名字
Titles.s.flags = { '走过的路': 3 };       // titles:称号标记
Titles.s.active = ['走过的路'];
Nemesis.s.battles = 4;            // nemesis:打过了怨灵
Nemesis.s.grudge = 88;

const mods = { Cult, Nemesis, Titles, Bag, CAMP, DAY, Merchant, COMPANION };

// —— 计数:真机 localStorage 的写次数就是「刷了几次盘」——
//   门禁自己包一层 setItem,只记数,不改行为。
let WRITES = 0;
const KEYS_WRITTEN = [];
const origSet = H.localStorage.setItem.bind(H.localStorage);
const origGet = k => H.localStorage.getItem(k);
H.localStorage.setItem = (k, v) => { WRITES++; KEYS_WRITTEN.push(k); return origSet(k, v); };
const writesTo = k => KEYS_WRITTEN.filter(x => x === k).length;

const clk = fakeClock(1_700_000_000_000);
Profile._lastWrite = 0;           // 门禁自己接管节流状态,不看真实挂钟
Profile._mods = null;             // 从「还没记住模块表」开始,验 auto() 的记忆

// [G3] 拿不到模块表时,auto() 必须**不写**,而不是退回 flush()
const before0 = WRITES;
const noModsResult = Profile.auto();
t('[G3] auto() 拿不到模块表时返回 false 且一盘都不写',
  noModsResult === false && WRITES === before0, `返回 ${noModsResult}, 写了 ${WRITES - before0} 次`);

// 正常周期落盘:把 main.js 的定时器搬过来 —— setInterval(AUTO_EVERY) 每次触发即 auto(mods)
let booted = false;
const startPeriodic = () => { booted = true; Profile.auto(mods); };
startPeriodic();                  // ≡ 进游戏时那一次收集
Profile._lastWrite = 0;           // 归零,让下面从「已落过一次盘」开始算节流
const afterBoot = WRITES;
t('[G3a-动态] 进游戏那一次收集真的落了盘(门禁自检:9 个键)',
  writesTo(KEY) === afterBoot / 9, `统一档被写了 ${writesTo(KEY)} 次, 共 ${afterBoot} 次写`);
console.log(`  ℹ️ 一次 collect() 写 ${afterBoot} 个键(8 个老键 + 统一档)`);

const stored0 = JSON.parse(origGet(KEY));
t('[G3] 落盘后 cult 是**内存里的新值 999**,不是存档里的旧值 111',
  stored0.cult && stored0.cult.dao === 999,
  `实际 cult=${JSON.stringify(stored0.cult)}`);

// ══════════════════════════════════════════════════════════
// [G1] 推进时间后,存档真的更新了(逐模块)
// ══════════════════════════════════════════════════════════
console.log('\n[G1] 推进 AUTO_EVERY 后,存档真的更新了');
{
  const mark = WRITES;
  // 再造一次局内变化
  Cult.s.dao = 5555;
  Bag.s.items.xi_sui = 999;
  CAMP.s.totalSec = 1234;
  DAY.s.actions = 31;
  Merchant.s.visits = 8;
  COMPANION.s.name = '小雀改名';
  Titles.s.active = ['走过的路', '第二称号'];
  Nemesis.s.wins = 2;

  clk.advance(AUTO_EVERY);       // ← 推进一个周期
  startPeriodic();               // ≡ 定时器到点

  t('[G1] 推进一个周期后确实发生了写盘(不是空转)', WRITES > mark,
    `周期前后写次数 ${mark} → ${WRITES}`);

  const s = JSON.parse(origGet(KEY));
  const rows = [
    ['cult(道行)', s.cult && s.cult.dao, 5555],
    ['bag(背包)', s.bag && s.bag.items && s.bag.items.xi_sui, 999],
    ['camp(营地)', s.camp && s.camp.totalSec, 1234],
    ['day(日行动)', s.day && s.day.actions, 31],
    ['merch(商人)', s.merch && s.merch.visits, 8],
    ['companion(灵伴)', s.companion && s.companion.name, '小雀改名'],
    ['titles(称号)', JSON.stringify(s.titles && s.titles.active), JSON.stringify(['走过的路', '第二称号'])],
    ['nemesis(怨灵)', s.nemesis && s.nemesis.wins, 2],
  ];
  for (const [name, got, want] of rows) {
    t(`[G1] 落盘含最新 ${name}`, got === want,
      `期望 ${JSON.stringify(want)},实际 ${JSON.stringify(got)}`);
  }
  t('[G1] 种子也跟着落盘', s.seed === Seed.cur,
    `期望 ${JSON.stringify(Seed.cur)},实际 ${JSON.stringify(s.seed)}`);

  // —— XX-AUDIT-006 的正面断言:老快照不得盖回活档 ——
  const pxs = JSON.parse(origGet('pxs_save'));
  t('[G3] pxs_save 活档没被覆盖(gold 仍是 8888,没回滚成 30)',
    pxs.gold === 8888, `实际 gold=${pxs.gold}`);
  t('[G3] pxs_save 活档没被覆盖(totalRuns 仍是 12,没回滚成 1)',
    pxs.totalRuns === 12, `实际 totalRuns=${pxs.totalRuns}`);

  // —— 同族的另一半:存档里那份「只进不出的 base 快照」不得**外溢**到别的键 ——
  const leaked = KEYS_WRITTEN.filter(k => k !== KEY && (origGet(k) || '').includes('"totalRuns":1'));
  t('[G3] 存档里那份陈旧 base 快照没有被写进任何其他键',
    leaked.length === 0, `泄漏到: ${JSON.stringify(leaked)}`);

  // —— 同族的第三种形态:周期落盘不得把 cult 盖回存档里的旧值 ——
  t('[G3] 周期落盘后 cult 仍是最新的 5555(没被 111/999 盖回去)',
    JSON.parse(origGet(KEY)).cult.dao === 5555,
    `实际 ${JSON.parse(origGet(KEY)).cult.dao}`);
}

// ══════════════════════════════════════════════════════════
// [G2] 节流生效
// ══════════════════════════════════════════════════════════
console.log('\n[G2] 节流生效:突发调用只落一次,且请求不被丢掉');
{
  // 归零:让第一次调用落在硬间隔**之外**,窗口才谈得上「只放行一个」
  Profile._lastWrite = clk.now() - 5000;
  const mark = WRITES;
  const returns = [];
  for (let i = 0; i < 20; i++) returns.push(Profile.auto(mods));   // 20 次突发
  const afterBurst = WRITES;
  t('[G2] 20 次突发调用里只有第一次返回 true', returns.filter(Boolean).length === 1,
    `返回 true 的有 ${returns.filter(Boolean).length} 次`);
  t('[G2] 20 次突发只落了 1 次盘(9 次写),没被刷成 20 次',
    afterBurst - mark === 9, `写次数 ${mark} → ${afterBurst}(差 ${afterBurst - mark},期望 9)`);
  t('[G2] 突发请求被合并成**恰好一个**尾写定时器(clearTimeout 生效)',
    clk.pending() === 1, `待触发定时器 ${clk.pending()} 个`);

  clk.advance(1999);
  t('[G2] 尾写之前不再写盘', WRITES === afterBurst, `写次数 ${afterBurst} → ${WRITES}`);
  clk.advance(2);
  t('[G2] 硬间隔走完后尾写补上(请求没被丢掉 = 不会饿死)', WRITES > afterBurst,
    `写次数 ${afterBurst} → ${WRITES}`);
  t('[G2] 尾写也只落 1 次盘', WRITES - afterBurst === 9,
    `写次数 ${afterBurst} → ${WRITES}(差 ${WRITES - afterBurst},期望 9)`);

  // 稳定态:按 AUTO_EVERY 跑 4 个周期,写盘次数应当 ≈ 4 次,而不是 20 次
  Profile._lastWrite = clk.now();
  const mark2 = WRITES;
  for (let i = 0; i < 20; i++) { clk.advance(AUTO_EVERY); Profile.auto(mods); }
  const grew = WRITES - mark2;
  t('[G2] 20 个周期只落 20 次盘,没有额外放大', grew === 20 * 9,
    `20 个周期写了 ${grew} 次(期望 ${20 * 9} = 20 次 collect × 9 键)`);

  // 节流不得把周期落盘**饿死** —— 间隔必须大于硬间隔
  t('[G2] AUTO_EVERY 大于硬间隔(周期落盘不会被节流挡掉)',
    AUTO_EVERY > 2000, `AUTO_EVERY=${AUTO_EVERY}, 硬间隔=2000`);
}

// ══════════════════════════════════════════════════════════
// [G5] 防退化 —— 真的跑到了产品函数
//
// 本仓吃过两次「静默假通过」:解析命中为 0 之后照样跑完整篇并 EXIT=0。
// 所以命中为 0 一律 exit 2,**不允许**降级成一条普通红条。
// ══════════════════════════════════════════════════════════
console.log('\n[G5] 防退化:确认真跑到了产品函数');
{
  t('[G5] 真的写进了 localStorage', WRITES > 0, `WRITES=${WRITES}`);
  t('[G5] 真的调到了 Profile.collect(统一档被写)', writesTo(KEY) >= 10,
    `统一档被写 ${writesTo(KEY)} 次`);
  t('[G5] 真的走的是产品函数 Profile.auto(节流状态被维护)',
    typeof Profile._lastWrite === 'number' && Profile._lastWrite > 0,
    `_lastWrite=${Profile._lastWrite}`);
  t('[G5] 真的记住了模块表', !!Profile._mods);
  t('[G5] fakeClock 真的被驱动过(时间推进了)',
    clk.now() > 1_700_000_000_000, `now=${clk.now()}`);

  const productWrites = WRITES;
  if (productWrites === 0) {
    die2('全程 0 次产品写盘 —— 门禁在一个不存在的世界里空转,所有绿条都不作数');
  }
  console.log(`  ℹ️ 本次共驱动 ${productWrites} 次 localStorage 写 · ` +
    `统一档 ${writesTo(KEY)} 次 · AUTO_EVERY=${AUTO_EVERY}ms`);
}

clk.restore();

// ══════════════════════════════════════════════════════════
// 汇总
// ══════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(52)}`);
console.log(`通过 ${pass} · 不通过 ${fail}`);
if (fail) {
  console.log('\n失败明细:');
  for (const f of failed) console.log('  · ' + f);
  process.exit(1);
}
console.log('✅ 周期落盘这条兜底通了:真写盘 + 真节流 + 不盖陈旧值 + 不替换原三钩子');
process.exit(0);