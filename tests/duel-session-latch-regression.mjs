// duel-session-latch-regression.mjs —— 工单 XX-DUEL-004 / XX-DUEL-005 的门禁
//
// 为什么有这两个工单:12 轮自动化、87 局,**一次都没打到过 Boss**。
// 于是「Boss 出场即进回合制 → 打一场 → 输 → 点战败四选项」这条链整体零覆盖。
// 第一次真跑,就跑出两个 P0——而且都不是崩溃,是**静默失效**:
//
// ── XX-DUEL-004(P0)战败四选项在 Boss 路径上是死 UI,点了直接把局卡死 ──
//   main.js:279  `onLose: () => { /* 交给 endRun 走死亡结算 */ }` —— 空函数。
//   玩家输掉 Boss 战 → Duel.lose() 渲染四个选项(抗/暂缓/赎金/认栽,各写各的代价)
//   → 点任意一个 → onLose(c) 什么都不做 → Duel.close() 把决斗层藏起来。
//   而 fromTurnBased(false)(main.js:297,**带着写好的死亡结算**
//   `p.takeDamage(999999)` 让局正常走 endRun)在**全仓只有一处调用点**,
//   写死 true、只在 s2give() 里、即只在**赢**的路径上(main.js:317)。
//   ⇒ fromTurnBased(false) 零调用点。输了之后:
//     inTurnBased 永远 true  → main.js:228 下一条 Boss 直接 early-return
//     engine.paused 永远 +1  → core/engine.js:90,整个 roguelite 循环停摆
//   局既不能继续也不能结束,只能刷新页面。这不是崩溃,是没有出口。
//
// ── XX-DUEL-005(P0)Duel.busy 是单向闩 —— 第一场决斗结束后,后面全点不动 ──
//   duel.js:358  resolvePlayer 置 busy = true。
//   全仓只有两处复位:duel.js:360(playerAct 返回 null 的早退)
//   和 duel.js:378(敌攻后**活下来**才走到)。
//   而赢(:363)和输(:376)两条终局路径都是**先 return**,根本到不了 :378。
//   close()(:198)只清了 S,没清 busy;start()(:115)也没重置。
//   技能栏的点击闸门是 duel.js:193 `if (b && !this.busy)`。
//   ⇒ 第一场决斗一结束(不论胜负),busy 永久 true,
//     第二场起按钮照常渲染、点击被无声吞掉:一场没打完的架。
//
// 本门禁不靠正则抠实现:在 node 里用 DOM 桩**真跑完整的两场决斗**。
// 出处可复现:node tests/duel-session-latch-regression.mjs
//
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

// ————————————————————————————————————————————
// 可控假时钟
// ————————————————————————————————————————————
// duel.js 满是 setTimeout(intro 1150ms / 打字机 26ms×字数 / 敌攻 780 / 终局 900),
// 用真时钟跑一场要好几秒,两场加一场败局 ≈ 20s,而且会 flaky。
//
// 这里自己实现 setTimeout/clearTimeout,但有两点必须对,否则门禁会说谎:
//   ① **必须真的响应 clearTimeout**。打字机 say() 的 finishType 里
//      clearTimeout(this._th) 是用来掐掉排队中的下一次 step 的。
//      不响应它 → step 会在 finishType 之后**再跑一次** → cb 被调两遍
//      → win()/lose() 被调两遍 → 测试看起来通过,实际在测一个不存在的世界。
//   ② **必须保序**。Map 保持插入序 = 定时器按到期先后执行。
//      (早先一版用数组下标当 id,而 drain 里 shift() 会让下标漂移,
//       clearTimeout 会掐掉错误的那一个 —— 已弃用。)
//
// 另加死循环哨兵:流程不收敛就抛错,而不是安静地转。
// 「度量工具自己出错比没有度量工具更危险」——这里防的是我自己。
const timers = new Map();
let _tid = 0;
globalThis.setTimeout = fn => { const id = ++_tid; timers.set(id, fn); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
/** 把当前所有定时器跑到空 */
const drain = (label) => {
  let guard = 0;
  while (timers.size) {
    if (++guard > 2000) throw new Error(`假时钟不收敛(${label}):还有 ${timers.size} 个定时器在排队`);
    const id = timers.keys().next().value;
    const fn = timers.get(id);
    timers.delete(id);
    fn();
  }
};
globalThis.requestAnimationFrame = fn => { fn(); return 0; };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };

// ————————————————————————————————————————————
// DOM 桩:够 duel.js 跑完一整场,且能**真的点到按钮**
// ————————————————————————————————————————————
// 关键点:桩不能只"不报错",还得还原 duel.js 真正依赖的三件事——
//   ① #xd-sk 的 click 监听器要能被触发,且事件要带上 target.closest('[data-art]')
//   ② #xd-defeat 的 innerHTML 里的 data-c="..." 要能被解析成 4 个可点的节点
//   ③ 同一 selector 必须永远返回**同一个**元素(否则 paintHp 写到的和 hurt 读到的不是同一个)
const REG = new Map();
const reg = sel => {
  if (!REG.has(sel)) REG.set(sel, mkEl('div'));
  return REG.get(sel);
};
/** 场景之间清干净 DOM,免得上一场的 innerHTML 漏进下一场 */
const resetDom = () => { REG.clear(); timers.clear(); };
/** 从 innerHTML 里抠出 data-art="x",还原技能按钮 */
function parseArt(html) {
  const out = [];
  const re = /data-art="([^"]+)"/g;
  let m;
  while ((m = re.exec(html || ''))) {
    const b = mkEl('button');
    b.dataset.art = m[1];
    b._art = true;
    out.push(b);
  }
  return out;
}
/** 从 innerHTML 里抠出 data-c="x",还原战败四选项。
 *  ⚠️ 必须按 (宿主元素, html) 记忆化:真实 DOM 里 querySelectorAll 每次返回
 *  **同一批活节点**,duel.js 挂的 el.onclick 得是下一次还能找到的那个。
 *  我第一版每次现造新节点,结果 duel.js:433 挂上去的 onclick 全挂在没人引用的
 *  对象上,点下去自然什么也没发生 —— 门禁报了 4 条红,而实际产品代码没毛病。
 *  (这正是「度量工具自己出错比没有度量工具更危险」:它会让我去改一段没坏的代码。) */
function parseChio(host) {
  const html = host.innerHTML;
  if (!host._chioCache || host._chioCache.html !== html) {
    const out = [];
    const re = /data-c="([^"]+)"/g;
    let m;
    while ((m = re.exec(html || ''))) {
      const b = mkEl('div');
      b.dataset.c = m[1];
      b._chio = true;
      out.push(b);
    }
    host._chioCache = { html, nodes: out };
  }
  return host._chioCache.nodes;
}
function mkEl(tag) {
  const el = {
    tagName: tag, className: '', _cls: new Set(), style: {}, dataset: {},
    _html: '', textContent: '', src: '', offsetWidth: 1, _kids: [], _h: {},
    onclick: null, _art: false, _chio: false,
    classList: {
      add: (...c) => c.forEach(x => el._cls.add(x)),
      remove: (...c) => c.forEach(x => el._cls.delete(x)),
      contains: c => el._cls.has(c),
    },
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = String(v); },
    appendChild(c) { el._kids.push(c); return c; },
    append(...c) { el._kids.push(...c); },
    addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
    querySelector(sel) { return reg(sel); },
    querySelectorAll(sel) {
      if (sel === '.xx-chio') return parseChio(el);
      if (sel === '[data-art]' || sel === 'button') return parseArt(el._html);
      return [];
    },
  };
  return el;
}
const app = mkEl('div');
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: t => mkEl(t),
  body: mkEl('div'), getElementById: id => (id === 'app' ? app : null),
};
globalThis.window = {};

// ————————————————————————————————————————————
// 断言器
// ————————————————————————————————————————————
let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

// 场景之间要能拿到**全新的 Duel**:真实玩家刷新页面就是这个效果。
// 用 cache-buster 让 ESM 重新求值 duel.js(deps 走缓存,很快)。
// ⚠️ 不能靠「手动把 Duel.busy 改回 false」来隔离场景——那等于把待测的 bug 修掉再测。
const loadDuel = async (n) => (await import(`../js/xiuxian/duel.js?n=${n}`)).Duel;

/** 点一个技能按钮:走 duel.js:191 注册的那个真实监听器,不绕过点击闸门 */
function clickArt(artId) {
  const sk = reg('#xd-sk');
  const btns = parseArt(sk.innerHTML);
  const b = btns.find(x => x.dataset.art === artId);
  if (!b) return false;
  const ev = { target: { closest: s => (s === '[data-art]' ? b : null) } };
  (sk._h.click || []).forEach(fn => fn(ev));
  return true;
}
/** 点一个战败选项:走 duel.js:433 挂上的真实 onclick */
function clickDefeat(choice) {
  const box = reg('#xd-defeat');
  const opts = parseChio(box);
  const el = opts.find(x => x.dataset.c === choice);
  if (!el || typeof el.onclick !== 'function') return false;
  el.onclick();
  return true;
}
const mkCfg = (o = {}) => ({
  node: { type: 'boss' },
  hpRatio: 0.5,
  hero: { name: '轩轩', img: 'h.jpg', realmIdx: 0 },
  foe: { key: 'boss_golem', name: '石像守卫', title: '妖  ·  本  局', img: 'f.jpg', realmIdx: 1, stronger: true, isNemesis: false },
  ...o,
});

console.log('\n=== [1] 实跑:败北 → 战败四选项 → 四个点都得真的调 onLose(带对的值) ===');
{
  // 放在最前面跑:XX-DUEL-005 的 busy 闩一旦发作,后面就再也点不动任何按钮,
  // 败北路径也就再也走不到 —— 那一节的四条断言会变成测不出东西的废话。
  const Duel = await loadDuel(1);
  const got = [];
  Duel.start(mkCfg({ onWin: () => {}, onLose: c => got.push(c) }));
  drain('败北场·开场');
  const art = Object.keys(Duel.S.hero.arts)[0];
  Duel.S.hero.hp = 1;                     // 吃一下就死
  clickArt(art);
  drain('败北场·终局');

  // ⚠️ 这里**不能**用 classList.contains('hidden') 判断面板有没有出来:
  //   桩里新建元素的类集合本来就是空的,那句会恒为 true —— 我第一版就是这么写错的,
  //   跑出一个「玩家确实被打死了」的假绿。判据只能是"选项真的渲染出来了"。
  const opts = parseChio(reg('#xd-defeat'));
  t('玩家确实被打死了(战败面板真的渲染出来了)', opts.length > 0,
    '一个选项都没有 —— lose() 没走到,后面全是空测');
  t('战败面板渲染出四个选项', opts.length === 4, `实际 ${opts.length} 个`);
  t('四个选项的 data-c 互不相同', new Set(opts.map(o => o.dataset.c)).size === 4,
    '有重复的 data-c —— 点下去分不出是哪条路');
  for (const o of opts) {
    const before = got.length;
    const ok = clickDefeat(o.dataset.c);
    t(`点「${o.dataset.c}」会带着这个值调 onLose`,
      ok && got.length === before + 1 && got[got.length - 1] === o.dataset.c,
      `onLose 实收 ${JSON.stringify(got)}`);
  }
}

console.log('\n=== [2] 实跑:一场决斗打完之后,busy 必须复位 ===');
{
  const Duel = await loadDuel(2);
  resetDom();
  const seen = { win: 0 };
  Duel.start(mkCfg({ onWin: () => { seen.win++; }, onLose: () => {} }));
  drain('第一场');
  const art = Object.keys(Duel.S.hero.arts)[0];
  Duel.S.e.hp = 1;                       // 一下带走,直接走 win()
  clickArt(art);
  drain('第一场·终局');
  t('第一场确实打赢并交还了控制权', seen.win === 1, `onWin 调了 ${seen.win} 次`);
  t('【XX-DUEL-005】close() 之后 busy 必须复位',
    Duel.busy === false,
    `busy 停在 ${Duel.busy} —— 这是单向闩,后面每一场决斗的技能栏都点不动`);
  t('决斗层已收起', Duel.S === null && Duel.root.classList.contains('hidden'));

  // ↓ 同一个 Duel 接着打第二场。**不能**在这里重置模块 ——
  //   「打完第一场之后还能不能打第二场」正是本门禁要问的问题。
  console.log('\n=== [3] 实跑:第二场决斗的技能按钮必须真的能按 ===');
  const seen2 = { win: 0 };
  Duel.start(mkCfg({ onWin: () => { seen2.win++; }, onLose: () => {} }));
  drain('第二场开场');
  const art2 = Object.keys(Duel.S.hero.arts)[0];
  const btns = parseArt(reg('#xd-sk').innerHTML);
  t('第二场技能栏渲染出来了', btns.length > 0,
    '没渲染技能 = 玩家看到的是一个空回合');
  // ⚠️ 留住 foe 的引用再点:一旦这一场真打完了,close() 会把 Duel.S 置 null,
  //   之后再回头读 Duel.S.e.hp 就是读一个已被回收的状态(我第一版就是这么崩的)。
  const foe = Duel.S.e;
  foe.hp = 1;
  clickArt(art2);
  drain('第二场·出招');
  const dealt = 1 - foe.hp;
  t('第二场技能栏确实渲染出了可点的按钮', btns.some(b => b.dataset.art === art2));
  t('【XX-DUEL-005】点第二场的技能真的结算了伤害',
    dealt > 0 || seen2.win === 1,
    `敌方血量没动(1→${foe.hp}),点击被 busy 静默吞掉 —— 一场永远打不完的架`);
  t('【XX-DUEL-005】第二场能正常打完', seen2.win === 1, `onWin 调了 ${seen2.win} 次`);
}

console.log('\n=== [4] main.js:败北不能是空函数,fromTurnBased(false) 必须有活人调 ===');
{
  const { codeMask } = await import('./lib-uimod.mjs');
  const CODE = codeMask(R('js/main.js')).code;   // 剥注释:注释里写「交给 endRun」是合法的

  // ④-1 onLose 不得是空壳
  const seg = CODE.slice(CODE.indexOf('onLose:'), CODE.indexOf('onLose:') + 200);
  t('【XX-DUEL-004】boss 的 onLose 不再是空函数',
    !!seg && !/onLose:\s*\(\s*\)\s*=>\s*\{\s*\}/.test(seg),
    'onLose 是空的 → 四个选项点了等于没点,局卡在暂停里出不来');

  // ④-2 fromTurnBased 必须被以 false 调用过(那一支才有死亡结算)
  //   注意允许第二个参数:败北要顺带把玩家选的那条战败路带下去。
  t('【XX-DUEL-004】fromTurnBased(false) 有调用点',
    /fromTurnBased\(\s*false\s*[,)]/.test(CODE),
    'fromTurnBased(false) 里写好了 takeDamage(999999) 的死亡结算,却没人调它 —— 输了走不出局');

  // ④-3 inTurnBased / engine.pause 必须有配对的复位
  t('【XX-DUEL-004】败北分支会解除 inTurnBased',
    /inTurnBased\s*=\s*false/.test(CODE),
    'inTurnBased 永不复位 → main.js:228 之后每条 Boss 都 early-return');

  // ④-4 四选项的数据模型要能落到 Boss 路径(不是只有秘境那一路用)
  t('【XX-DUEL-004】战败选项的值(resist/installment/ransom/ruin)在 duel.js 里存在',
    ['resist', 'installment', 'ransom', 'ruin'].every(k =>
      new RegExp(`data-c="${k}"`).test(R('js/xiuxian/duel.js'))));
}

if (fail === 0) {
  console.log(`\n✅ XX-DUEL-004/005 通过:${pass} 项(决斗不再单向闩,败北不再把局卡死)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 打到 Boss 的那条链上还有洞`);
  process.exit(1);
}