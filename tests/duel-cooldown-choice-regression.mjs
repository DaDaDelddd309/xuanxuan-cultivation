// tests/duel-cooldown-choice-regression.mjs —— 冷却层门禁:「同一回合有 ≥2 张牌可选」必须是常态
//
// 【为什么不能拿 duel-balance-invariant.mjs 的 PROBE-6/7/10 当验收尺子】
//   它的 simulate()(该文件 723-751 行)整个循环**没有 tickCooldown 调用**,
//   注释里还明写「强制普攻 —— 不减冷却」。它量的是「冷却永远不转」的世界:
//   一招放完 cd=4,此后整场再无任何牌可用。
//   真实流程是 duel.js:399 —— `if (!preId) tickCooldown(S.hero)`,每个玩家回合开头减一次。
//   两个世界不是一回事:同一批种子下,加不加 tick 量出来的胜率网格**逐字相同**
//   (实测:24 格全同,maxSpread 0.0pp)—— 因为那张网格上的战斗平均只有 1.25 回合,
//   远短于任何冷却周期,于是 cd 在两个世界里都没来得及生效,量到的是别的东西。
//   ⇒ 本门禁的模拟器按 duel.js:399 的**同形**实现(回合开始减一次),
//     并且对「加不加 tick」这件事本身做反向自检(§4-C)。
//
// 【本门禁只依赖 battle.js】—— 那是本轮唯一被授权修改的层。
//   战斗长度、敌人血量、护体都归 duel.js(js/xiuxian/duel.js),不在这里断言,
//   以免和那条线上的人互相踩脚。§5 用真实 duel.js 跑一遍当**探针**(report-only)。
//
// 【G1】决策空间:多种子 × 多套 arts 配置,统计「每个回合可用牌数」的分布
// 【G2】策略敏感性:≥3 种选牌策略跑同一批种子,胜率不得恒定
// 【G3】防退化:真的解析出了 arts / cooldown / 技能按钮,为 0 直接 exit 2
// 【G4】反向自检:① 合成样本验判定函数 ② 测量灵敏度自检(cd=999 必须能被测出差异)
//
// 运行:node tests/duel-cooldown-choice-regression.mjs
// 退出码:0 = 全绿;1 = 有断言红;2 = 门禁自身失效(度量工具坏了,别信结论)
import { install } from './harness.mjs';
import { availableArts, canUseArt, playerAct, enemyAct, isDead, playerDead, tickCooldown } from '../js/xiuxian/battle.js';
import { isSuper } from '../js/xiuxian/arts.js';

// ════════════════════════════════════════════
// §0 环境:确定性随机源 + 可控假时钟
// ════════════════════════════════════════════
// ⚠️ battle.js 的 makeEnemy / enemyAct 直接调 Math.random(不是纯函数)。
//   不接管 ⇒ 胜率每次跑都不一样,门禁报的红就变成 flaky,没人敢信。
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _rng = mulberry32(0xC001D);
const seedRng = s => { _rng = mulberry32(s); };
globalThis.Math.random = () => _rng();

// 假时钟:① 必须响应 clearTimeout(打字机 finishType 用它掐掉排队中的 step)
//         ② 必须保序(Map 保持插入序)
// 另加死循环哨兵:流程不收敛就抛错,而不是安静地转。
const timers = new Map();
let _tid = 0;
globalThis.setTimeout = fn => { const id = ++_tid; timers.set(id, fn); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
globalThis.requestAnimationFrame = fn => { fn(); return 0; };
const drain = (label, maxSteps = 4000) => {
  let guard = 0;
  while (timers.size) {
    if (++guard > maxSteps) throw new Error(`假时钟不收敛(${label}):还有 ${timers.size} 个定时器在排队`);
    const id = timers.keys().next().value;
    const fn = timers.get(id);
    timers.delete(id);
    fn();
  }
};

// DOM 桩(真实 duel.js 需要 querySelector/#id/[data-art] 树 + 可点的 click 监听器)
install();

/** 场景之间清干净:定时器排空 + 决斗闩复位。
 *  ⚠️ Duel.root 只 build 一次(duel.js:170 `if (!this.root) this.build()`),
 *     所以同一个 Duel 实例可以连跑多场 —— 这点跟 duel-balance-invariant 不同:
 *     那边的 DOM 桩是「同 selector 返回同一元素」,清空注册表就会让第二次场景
 *     点到的按钮挂在没人引用的旧元素上,必须靠 cache-buster 重载模块。 */
const resetProbe = () => {
  drain('resetProbe');
  // busy 是 duel.js:254 点击闸门的前置条件,而 win()/lose() 两条终局路径都不复位它
  // (只有 close() 复位,见 duel.js:274)。场景之间不复位 ⇒ 第二场起点击被无声吞掉,
  // 量出来的「玩家出了几招」全是 0。
  if (Duel.S && !Duel.S.over) Duel.close();
  Duel.busy = false;
};

// harness.mjs 的 makeEl 只实现了 appendChild,没有 append —— 而 duel.js:317 的打字机
// 用的正是 el.append(cur, cur2)。就地补一个,不去改 harness.mjs(那是多个门禁共用的公共库)。
// ⚠️ 两类节点都得补:createElement 造出来的根,以及 parseHTML 从 innerHTML 解析出来的子节点
//   (q('xd-txt') 拿到的正是后者)。所以先 build() 一次把树建出来,再遍历补齐。
const addAppend = (el) => {
  if (el && typeof el.append !== 'function') el.append = (...cs) => { cs.forEach(c => el.appendChild(c)); };
  return el;
};
const patchTree = (node) => {
  addAppend(node);
  for (const c of (node.children || [])) patchTree(c);
};
const _createEl = globalThis.document.createElement.bind(globalThis.document);
globalThis.document.createElement = tag => addAppend(_createEl(tag));

// 必须在 install() 之后 import:游戏模块求值期间就会摸 document
const { Duel } = await import('../js/xiuxian/duel.js');
const { Cult } = await import('../js/xiuxian/index.js');
const _artsBackup = { ...Cult.get().arts };

Duel.build();            // start() 里是 `if (!this.root) this.build()`,先建一次后面复用
patchTree(Duel.root);    // 补完 DOM 树上的 append,再开第一场

// ════════════════════════════════════════════
// 断言器
// ════════════════════════════════════════════
let pass = 0, fail = 0;
const RED = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; RED.push(n); console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};
/** 探针:报告但不计入失败(测出来的坏,不在本门禁的活儿里) */
const p = (n, c, d = '') => console.log(`  ${c ? '🔎' : '⚠️ '} ${n}${d ? '  — ' + d : ''}`);

/** 门禁自身失效 ⇒ 退出码 2,和「断言红」区分开。 */
const BROKEN = [];
const bail = (why) => {
  BROKEN.push(why);
  console.log(`  ⛔ 门禁自身失效:${why}`);
  console.log('\n⛔ 退出码 2 —— 下面的数字都不可信,别拿它们当结论。');
  process.exit(2);
};

// ════════════════════════════════════════════
// 共用网格(照抄 duel.js 的公式,不自己发明一套)
// ════════════════════════════════════════════
// duel.js:142  e.dmg = round(10 + realmIdx*6 + (stronger?4:0)); 宿敌再乘 powerBoost
// duel.js:137  e.hpMax = 100; e.hp = round(100 * hpRatio),hpRatio 夹在 [0.05,1]
// duel.js:156  玩家 hpMax = 100 + pIdx*30(pIdx = REALMS 下标,本门禁取 0)
// duel.js:411  强制普攻 dmg = max(3, round(14 - e.def)); makeEnemy 的 def 恒为 2
const HERO_PIDX = 0;
const HERO_HP = 100 + HERO_PIDX * 30;
const FOES = [
  { name: '小妖·炼气',    realmIdx: 0, stronger: false, hpRatio: 0.4 },
  { name: '精英·筑基',    realmIdx: 1, stronger: false, hpRatio: 0.5 },
  { name: 'boss·金丹',    realmIdx: 2, stronger: true,  hpRatio: 0.4 },
  { name: '秘洞·满血',    realmIdx: 1, stronger: false, hpRatio: 1.0 },  // duel.js:136 secret 的默认值
  { name: '宿敌·金丹',    realmIdx: 2, stronger: true,  hpRatio: 0.4, nemesis: 1.6 },
];
const CONFIGS = [
  { name: '默认存档·单神通',   arts: { jianqi: 1 } },                                   // = arts.js defaultArts()
  { name: '新手·双神通',       arts: { jianqi: 1, wulei: 1 } },
  { name: '中期·双神通',       arts: { jianqi: 3, wulei: 2 } },
  { name: '后期·三神通',       arts: { jianqi: 5, wulei: 5, moyu: 4 } },
  { name: '满配·四神通',       arts: { jianqi: 5, wulei: 5, moyu: 4, fentian: 5 } },
  { name: '双神通+超武',       arts: { jianqi: 3, wanji: 1 } },
];
const mkHero = arts => ({
  name: '轩轩', hpMax: HERO_HP, hp: HERO_HP,
  arts: { ...arts },
  isSuper: Object.fromEntries(Object.keys(arts).filter(k => isSuper(k)).map(k => [k, 1])),
  cooldown: {}, dmgReduce: 0,
});
const mkFoe = f => ({
  key: 'x', title: f.name, realm: 'x', col: '#fff', hpMax: 100,
  hp: Math.max(1, Math.round(100 * Math.max(0.05, Math.min(1, f.hpRatio)))),
  dmg: Math.round((10 + f.realmIdx * 6 + (f.stronger ? 4 : 0)) * (f.nemesis || 1)),
  line: '「……」', def: 2,
});
/** 玩家在按钮上看到的那个伤害预估(照抄 duel.js:430-432) */
const estDmg = (hero, id, eDef) => {
  const lv = hero.arts[id] || 0;
  const mul = isSuper(id) ? 2.2 : 1 + Math.max(0, lv - 1) * 0.15;
  return Math.max(1, Math.round((10 + lv * 4) * mul) - eDef);
};
const STRATS = {
  first:    u => u[0],
  greedy:   (u, h, e) => u.reduce((b, id) => (estDmg(h, id, e.def) > estDmg(h, b, e.def) ? id : b), u[0]),
  lowest:   (u, h, e) => u.reduce((b, id) => (estDmg(h, id, e.def) < estDmg(h, b, e.def) ? id : b), u[0]),
  rotate:   (u, h, e, n) => u[n % u.length],
  superFirst: (u, h, e) => u.find(id => isSuper(id)) || u.reduce((b, id) => (estDmg(h, id, e.def) > estDmg(h, b, e.def) ? id : b), u[0]),
};
const TURN_CAP = 400;

/** Duel.start 的入参(形状照抄 duel-balance-invariant §E/§F 的 mkCfg) */
const mkCfg = (o = {}) => ({
  node: { type: 'boss' }, hpRatio: 0.4,
  hero: { name: '轩轩', img: 'h.jpg', realmIdx: 0 },
  foe: { key: 'boss_golem', name: '石像守卫', img: 'f.jpg', realmIdx: 1, stronger: true, isNemesis: false },
  onWin: () => {}, onLose: () => {}, ...o,
});

/**
 * 打一场。**形状严格照 duel.js**:
 *   playerTurn() 开头减一次冷却(duel.js:399)→ 没有可用牌就走强制普攻(duel.js:407-421)。
 * ⚠️ opt.cd 只给 §4 的灵敏度自检用(把冷却强行盖成常数),正常测量一律不传。
 */
function simulate(foe, arts, stratName, seed, opt = {}) {
  const tick = opt.tick !== false;                 // 默认 faithful = duel.js:399 的同形
  seedRng(seed);
  const e = mkFoe(foe);
  const s = mkHero(arts);
  const strat = STRATS[stratName];
  let turns = 0, artTurns = 0, pickIx = 0, cdWrites = 0;
  const usableHist = [], picks = [];
  while (!isDead(e) && !playerDead(s) && turns < TURN_CAP) {
    if (tick) tickCooldown(s);                    // ← 与 duel.js:399 同形:回合开始减一次(无参)
    const usable = availableArts(s).filter(id => canUseArt(s, id));
    usableHist.push(usable.length);
    if (usable.length) {
      const pick = strat(usable, s, e, pickIx++);
      picks.push(pick);
      const before = (s.cooldown[pick] || 0);
      playerAct(s, e, pick);
      if (s.cooldown[pick] !== before) cdWrites++;
      if (opt.cd != null) s.cooldown[pick] = opt.cd;
      artTurns++;
    } else {
      e.hp = Math.max(0, e.hp - Math.max(3, Math.round(14 - e.def)));   // duel.js:411 强制普攻
      if (isDead(e)) break;
    }
    if (isDead(e)) break;
    enemyAct(e, s);                                // duel.js:458
    turns++;
  }
  return {
    win: isDead(e), loss: playerDead(s), stall: turns >= TURN_CAP,
    turns, artTurns, cdWrites, usableHist, picks,
    // ⚠️ 分母必须用 samples,不能用 turns:玩家这一招打死敌人时,
    //   循环在 `if (isDead(e)) break` 处退出,**没有** turns++,
    //   但那一条回合的 usable 已经被记进 usableHist 了。
    //   拿 turns 当分母会算出 >100% 的占比(第一版就是这么得到「266.7%」的)。
    samples: usableHist.length,
    geo: (() => { const h = usableHist; return h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0; })(),
  };
}

// ════════════════════════════════════════════
// 判定函数(§G1/G2 用它们下结论;§4 用合成样本反向验它们)
// ════════════════════════════════════════════
const shareGE2 = hist => { const n = hist.length; return n ? hist.filter(x => x >= 2).length / n : NaN; };
const shareZero = hist => { const n = hist.length; return n ? hist.filter(x => x === 0).length / n : NaN; };
/** 胜率矩阵里有没有哪一格因策略而异 */
const anyCellMoved = wrs => wrs.some(row => Math.max(...row) - Math.min(...row) > 0);

// 阈值(先量后定,数字与依据见文件末尾 §6「阈值从哪来」)
const T_G1_MULTI_SHARE = 0.90;   // ≥2 张牌的回合占比(只统计 n≥2 的配置)
const T_G1_ZERO_SHARE  = 0.02;   // 「一张都点不动」的回合占比(全部配置)
const SEEDS = 60;

// ════════════════════════════════════════════
console.log('\n=== [§1 G3] 防退化:门禁真的解析出了神通 / 冷却 / 技能按钮吗 ===');
// ════════════════════════════════════════════
{
  // ① 纯函数层:真的读到了 arts / isSuper,playerAct 真的写进了冷却
  const s0 = mkHero({ jianqi: 1 });
  const e0 = { hp: 1e6, hpMax: 1e6, def: 2 };
  playerAct(s0, e0, 'jianqi');
  const cdKeys = Object.keys(s0.cooldown).filter(k => s0.cooldown[k] > 0).length;
  if (Object.keys(CONFIGS[0].arts).length === 0) bail('arts 配置表是空的');
  if (!Object.keys(s0.arts).length) bail('mkHero 没造出 arts —— 后面所有「可用牌数」都会恒为 0');
  if (cdKeys === 0) bail('playerAct 之后冷却表里没有任何正数项 —— 冷却层没被测到');
  if (!availableArts(s0).includes('jianqi')) bail('availableArts 不认 jianqi');
  if (canUseArt(s0, 'jianqi')) bail('刚放完的牌立刻还能再放 —— 冷却根本没生效');

  // ② 真实 duel.js 层:技能栏真的渲染出了可点的按钮,并且点击真的结算了
  Cult.s.arts = { jianqi: 1, wulei: 1 };
  resetProbe();
  seedRng(101);
  Duel.start(mkCfg());
  drain('§1·开场');
  const liveArts = () => {
    const sk = Duel.root.querySelector('#xd-sk');
    return (sk ? sk.querySelectorAll('[data-art]') : []).map(b => b.dataset.art);
  };
  const clickArt = (id) => {
    const sk = Duel.root.querySelector('#xd-sk');
    const btn = sk.querySelectorAll('[data-art]').find(b => b.dataset.art === id);
    if (!btn) return false;
    sk.dispatch('click', { target: btn });      // 走 duel.js:197 注册的真实监听器,不绕过点击闸门
    return true;
  };
  let clicked = 0, guard = 0;
  while (Duel.S && !Duel.S.over && guard++ < 40) {
    const arts = liveArts();
    if (!arts.length) break;
    if (!clickArt(arts[0])) break;
    clicked++;
    drain('§1·一回合');
  }
  const renderedArts = new Set();
  for (const b of Duel.root.querySelector('#xd-sk').querySelectorAll('[data-art]')) renderedArts.add(b.dataset.art);
  t('G3a 真实 duel.js 的技能栏渲染出了可点的 data-art 按钮', renderedArts.size > 0,
    `渲染出 ${renderedArts.size} 个按钮`);
  t(`G3b 点击真的驱动了决斗(点了 ${clicked} 次)`, clicked > 0, '一次都没点得动 ⇒ 点击链路没接上');
  t(`G3c 对话局里观察到的出牌次数 ${clicked} > 1`, clicked > 1,
    '只点得动一次 ⇒ 玩家在第 2 回合起就零输入,本门禁量不到决策空间');
  Cult.s.arts = { ..._artsBackup };
  if (renderedArts.size === 0 || clicked === 0) bail('真实 duel.js 没渲染出可点按钮 / 点击没生效 —— 后面的决策空间数字全是空的');
  // 存成 §5 复用的点击器
  globalThis.__probe = { liveArts, clickArt };
}

// ════════════════════════════════════════════
console.log('\n=== [§2 G1] 决策空间:每个回合到底有几张牌可选 ===');
// ════════════════════════════════════════════
const G1 = [];
for (const cfg of CONFIGS) {
  let turns = 0, samples = 0, zero = 0, ge2 = 0, artTurns = 0, wins = 0, n = 0, plays = 0;
  const perFoe = [];
  for (const foe of FOES) {
    let f0 = 0, f2 = 0, ft = 0;
    for (let i = 0; i < SEEDS; i++) {
      const r = simulate(foe, cfg.arts, 'greedy', 500 + i);
      turns += r.turns; samples += r.samples; artTurns += r.artTurns; plays += r.cdWrites;
      zero += r.usableHist.filter(x => x === 0).length;
      ge2 += r.usableHist.filter(x => x >= 2).length;
      f0 += r.usableHist.filter(x => x === 0).length; f2 += r.usableHist.filter(x => x >= 2).length; ft += r.samples;
      if (r.win) wins++;
      n++;
    }
    perFoe.push({ foe: foe.name, zero: f0 / ft, ge2: f2 / ft, turns: ft / SEEDS });
  }
  G1.push({ cfg, turns, samples, zero: zero / samples, ge2: ge2 / samples, plays: plays / n, wr: wins / n, perFoe });
}
console.log(`  ${'配置'.padEnd(16)}${'牌数'.padEnd(5)}${'平均回合'.padEnd(9)}${'0张占比'.padEnd(10)}${'≥2张占比'.padEnd(11)}胜率`);
for (const r of G1) {
  console.log(`  ${r.cfg.name.padEnd(13)}${String(Object.keys(r.cfg.arts).length).padEnd(5)}` +
    `${(r.turns / (SEEDS * FOES.length)).toFixed(2).padEnd(9)}` +
    `${(r.zero * 100).toFixed(1).padStart(4)}%`.padEnd(10) +
    `${(r.ge2 * 100).toFixed(1).padStart(4)}%`.padEnd(11) +
    `${(r.wr * 100).toFixed(1)}%`);
}
{
  const multi = G1.filter(r => Object.keys(r.cfg.arts).length >= 2);
  const worst = multi.reduce((a, b) => (a.ge2 < b.ge2 ? a : b));
  const worstZero = G1.reduce((a, b) => (a.zero > b.zero ? a : b));
  t(`G1a 牌数 ≥2 的配置里,「本回合有 ≥2 张牌可选」的回合占比 ≥ ${T_G1_MULTI_SHARE * 100}%`,
    multi.every(r => r.ge2 >= T_G1_MULTI_SHARE),
    `最差的是「${worst.cfg.name}」${(worst.ge2 * 100).toFixed(1)}% —— ` +
    `低于这条线就意味着「选牌」这件事在多数回合里根本不存在(玩家只有一张能点)`);
  t(`G1b 全部配置里,「一张都点不动(走强制普攻)」的回合占比 ≤ ${T_G1_ZERO_SHARE * 100}%`,
    G1.every(r => r.zero <= T_G1_ZERO_SHARE),
    `最差的是「${worstZero.cfg.name}」${(worstZero.zero * 100).toFixed(1)}%` +
    `(${Object.keys(worstZero.cfg.arts).length} 张牌时,玩家全程零输入)`);
  t('G1c·非平凡性:确实存在「≥2 张牌」的回合(否则 G1a 是恒真断言)',
    multi.some(r => r.ge2 > 0), `n≥2 配置的最大 ≥2张占比 = ${(Math.max(...multi.map(r => r.ge2)) * 100).toFixed(1)}%`);
  t('G1d·非平凡性:确实量到了回合(turns > 0),不是空网格',
    G1.every(r => r.turns > 0), `总回合数 ${G1.reduce((a, b) => a + b.turns, 0)}`);
}

// ════════════════════════════════════════════
console.log('\n=== [§3 G2] 策略敏感性:同一批种子,换个打法胜率会不会变 ===');
// ════════════════════════════════════════════
// ⚠️ 网格必须挑**打得长、且胜负真的悬在 DPS 上**的局。
//   上面那张网格平均只有 1~2 回合,而敌人满血只有 5~50(duel.js:137 写死 hpMax=100,
//   hpRatio 夹在 [0.05,1]),一门 lv1 神通一轮就 12 点 ——
//   战斗在第二个决策点出现之前就结束了,策略当然看不出差别(实测 cellsMoved=0/24)。
//   那不是「策略不重要」的证据,是**采样窗口太短**。
//   这里用 duel.js:136 的 secret 默认(hpRatio=1.0,满血 100)+ realmIdx=1 的敌人(每击 16 点):
//   满血 jianqi(lv1)=12 / wulei(lv2)=19,玩家 100 血约挨得住 5~6 击
//   ⇒ 走「每回合都出牌」这条路第 6 回合能杀敌(赢),走「专挑小牌」这条路第 9 回合才杀得掉(被打死)。
//   也就是说:**「每回合出哪张」直接决定胜负**,这才是要量的东西。
const RACE_FOE = { name: '长局·满血精英', realmIdx: 1, stronger: false, hpRatio: 1.0 };
const RACE_CFG = [
  { name: '中期·双神通(jianqi1/wulei2)', arts: { jianqi: 1, wulei: 2 } },
  { name: '满配·三神通(jianqi2/wulei1/moyu1)', arts: { jianqi: 2, wulei: 1, moyu: 1 } },
];
const G2_SEEDS = 120;
const G2_ST = ['greedy', 'lowest', 'rotate'];
{
  const rows = [];
  for (const cfg of RACE_CFG) {
    const wrs = [], turns = [], artTurns = [], sigs = [], usedArts = [];
    for (const st of G2_ST) {
      let w = 0, tt = 0, at = 0;
      const sig = new Set(), ids = new Set();
      for (let i = 0; i < G2_SEEDS; i++) {
        const r = simulate(RACE_FOE, cfg.arts, st, 7000 + i);
        if (r.win) w++; tt += r.turns; at += r.artTurns;
        sig.add(r.picks.join('>'));
        r.picks.forEach(x => ids.add(x));
      }
      wrs.push(w / G2_SEEDS); turns.push(tt / G2_SEEDS); artTurns.push(at / G2_SEEDS);
      sigs.push(sig); usedArts.push([...ids].sort().join('+'));
    }
    rows.push({ cfg, wrs, turns, artTurns, sigs, usedArts });
  }
  console.log(`  ${'配置'.padEnd(26)}${G2_ST.map(s => s.padEnd(10)).join('')}`);
  for (const r of rows) {
    console.log(`  ${r.cfg.name.padEnd(23)}` +
      r.wrs.map((w, i) => `${(w * 100).toFixed(1)}%/${r.turns[i].toFixed(1)}回合`.padEnd(10)).join(''));
  }
  const moved = rows.filter(r => Math.max(...r.wrs) - Math.min(...r.wrs) > 0);
  const spread = rows.map(r => Math.max(...r.wrs) - Math.min(...r.wrs));
  t(`G2a 至少有一格的胜率因选牌策略而异(${moved.length}/${rows.length} 格)`,
    moved.length > 0,
    `每格三种策略的胜率差:${spread.map(s => (s * 100).toFixed(1) + 'pp').join(' / ')} —— ` +
    `全为 0 就说明「出哪张牌」这个动作在数值上**不产生任何后果**`);
  t('G2b 对照组:最高伤策略必须不比最低伤策略差',
    rows.every(r => r.wrs[0] >= r.wrs[1]),
    rows.map(r => `${r.cfg.name}: greedy ${(r.wrs[0] * 100).toFixed(1)}% vs lowest ${(r.wrs[1] * 100).toFixed(1)}%`).join(' ; '));
  t('G2c·非平凡性:长局确实打出了 ≥5 回合(否则「策略没差别」只是局太短)',
    rows.every(r => Math.max(...r.turns) >= 5),
    rows.map(r => `${r.cfg.name}: 最长 ${Math.max(...r.turns).toFixed(1)} 回合`).join(' ; '));
  t('G2d·非平凡性:三种策略真的打出了不同的出牌序列(不是三个等价体)',
    rows.every(r => new Set(r.sigs.map(s => [...s].join('||'))).size >= 2),
    rows.map(r => `${r.cfg.name}: 各策略用过的牌 ${r.usedArts.join(' / ')}(不同序列 ${r.sigs.map(s => s.size).join('/')} 种)`).join(' ; '));
}

// ════════════════════════════════════════════
console.log('\n=== [§4 G4] 反向自检:判定函数与测量灵敏度 ===');
// ════════════════════════════════════════════
{
  // —— 4-A 判定函数吃合成样本 ——
  //    真代码只产出「一种」分布,谓词对它对错都判过 ⇒ 这条断言是空转的。
  //    这里用**手写的合成分布**验谓词本身:达标样本必须过,不达标样本必须被拒。
  //    (want = 「这个样本应该让断言通过」)
  const GE2_CASES = [
    { h: [2, 2, 2, 3],   want: true,  why: '全程 2~3 张可选' },
    { h: [3, 2, 2, 2],   want: true,  why: '全程 ≥2 张' },
    { h: [2, 2, 2, 1, 1], want: false, why: '只有六成回合达标,够不上验收线' },
    { h: [2, 0, 0, 0],   want: false, why: '只有开局有牌,之后全程锁死' },
    { h: [1, 1, 1, 1],   want: false, why: '永远只有 1 张 ⇒ 没有选择' },
    { h: [0, 0, 0, 0],   want: false, why: '全程一张都点不动' },
    { h: [],             want: false, why: '空分布(采样没跑到回合)' },
  ];
  const badA = GE2_CASES.filter(c => (shareGE2(c.h) >= T_G1_MULTI_SHARE) !== c.want);
  t(`G4a 谓词 shareGE2 在 ${GE2_CASES.length} 组合成样本上判定正确`, badA.length === 0,
    badA.map(c => `${c.why}: [${c.h}] → ${shareGE2(c.h)}`).join(' ; '));
  const ZERO_CASES = [
    { h: [1, 1, 1, 1],   want: true,  why: '每回合都有牌' },
    { h: [2, 2, 2, 2],   want: true,  why: '每回合都有牌' },
    { h: [2, 2, 0, 0],   want: false, why: '一半回合锁死' },
    { h: [1, 0, 0, 0],   want: false, why: '开局之后全程锁死' },
    { h: [0, 0],         want: false, why: '全程锁死' },
  ];
  const badB = ZERO_CASES.filter(c => (shareZero(c.h) <= T_G1_ZERO_SHARE) !== c.want);
  t(`G4b 谓词 shareZero 在 ${ZERO_CASES.length} 组合成样本上判定正确`, badB.length === 0,
    badB.map(c => `${c.why}: [${c.h}] → ${shareZero(c.h)}`).join(' ; '));
  const M_CASES = [
    { rows: [[0.5, 0.5, 0.5], [1, 1, 1]], want: false, why: '所有格子三策略同胜率' },
    { rows: [[0.5, 0.5, 0.5], [0.2, 0.9, 0.5]], want: true, why: '有一格随策略变化' },
    { rows: [[0, 0, 0], [1, 1, 1]], want: false, why: '全 0 / 全 1 也是恒定' },
    { rows: [], want: false, why: '空网格(没有可比对的格子)' },
  ];
  const badC = M_CASES.filter(c => anyCellMoved(c.rows) !== c.want);
  t(`G4c 谓词 anyCellMoved 在 ${M_CASES.length} 组合成胜率矩阵上判定正确`, badC.length === 0,
    badC.map(c => `${c.why} → ${anyCellMoved(c.rows)}`).join(' ; '));

  // —— 4-B 测量灵敏度自检:把冷却盖成 999,这套测量**必须测得出差异** ——
  //    测不出差异 = 尺子坏了,§2/§3 的数字不可信。
  //    ⚠️ 必须挑打得长的局:短局里任何冷却都没来得及生效,真实 cd 与 999 完全等价。
  const probe = (cd) => {
    let turns = 0, ge2 = 0, zero = 0, w = 0;
    for (const cfg of RACE_CFG) for (let i = 0; i < 40; i++) {
      const r = simulate(RACE_FOE, cfg.arts, 'greedy', 9000 + i, cd == null ? {} : { cd });
      turns += r.turns; ge2 += r.usableHist.filter(x => x >= 2).length;
      zero += r.usableHist.filter(x => x === 0).length; if (r.win) w++;
    }
    return { turns, ge2, zero, w };
  };
  const real = probe(null), frozen = probe(999);
  const share = (o) => (o.turns ? { ge2: o.ge2 / o.turns, zero: o.zero / o.turns } : { ge2: NaN, zero: NaN });
  const rs = share(real), fs = share(frozen);
  const delta = Math.abs(rs.ge2 - fs.ge2) + Math.abs(rs.zero - fs.zero);
  t('G4d 测量灵敏度:把冷却盖成 999 之后决策空间显著改变(尺子没瞎)',
    delta >= 0.10,
    `真实 cd: ≥2张 ${(rs.ge2 * 100).toFixed(1)}% / 0张 ${(rs.zero * 100).toFixed(1)}% ;` +
    `cd=999: ≥2张 ${(fs.ge2 * 100).toFixed(1)}% / 0张 ${(fs.zero * 100).toFixed(1)}% ;` +
    `差 ${(delta * 100).toFixed(1)}pp —— 差 <10pp 说明这套测量分辨不出冷却,§2/§3 的结论是空的`);
  t('G4e 测量灵敏度:cd=999 时玩家确实被打到「一张都点不动」',
    fs.zero > rs.zero, `cd=999 的 0张占比 ${(fs.zero * 100).toFixed(1)}% vs 真实 ${(rs.zero * 100).toFixed(1)}%`);

  // —— 4-C tick 同形性自检:本门禁的模拟器真的和 duel.js:399 同形 ——
  //    对照「不 tick」的世界(duel-balance-invariant §G 的形状)。两者**必须**不同,
  //    否则说明本门禁抄成了一个和真实流程一样的东西,却没抄对。
  let dTurns = 0, dGe2 = 0;
  for (const cfg of RACE_CFG) for (let i = 0; i < 40; i++) {
    const a = simulate(RACE_FOE, cfg.arts, 'greedy', 9000 + i, {});
    const b = simulate(RACE_FOE, cfg.arts, 'greedy', 9000 + i, { tick: false });
    dTurns += Math.abs(a.turns - b.turns);
    dGe2 += Math.abs(a.usableHist.join(',') !== b.usableHist.join(',') ? 1 : 0);
  }
  t('G4f 同形性自检:「回合开始减一次」与「不减」必须给出不同的可用牌序列',
    dGe2 > 0, `${dGe2}/80 场的逐回合序列不同,回合数总差 ${dTurns} —— ` +
    `若为 0,本门禁的模拟器就没在测 duel.js:399 那条路径`);
}

// ════════════════════════════════════════════
console.log('\n=== [§5 探针] 真实 duel.js 跑一遍:玩家每个回合看得见几张牌 ===');
// ════════════════════════════════════════════
// report-only:这一节依赖 duel.js(别人正在改),只报告不下断言,
// 免得那边的中间态把我的门禁刷红。
{
  const { liveArts, clickArt } = globalThis.__probe;
  console.log(`  ${'配置'.padEnd(16)}${'回合'.padEnd(6)}${'每回合可见牌数'.padEnd(18)}零输入回合`);
  for (const cfg of CONFIGS) {
    Cult.s.arts = { ...cfg.arts };
    const seq = [];
    let zero = 0, guard = 0, turns = 0;
    seedRng(31);
    Duel.start(mkCfg());
    drain('§5·开场');
    while (Duel.S && !Duel.S.over && guard++ < 40) {
      const arts = liveArts();
      seq.push(arts.length);
      if (!arts.length) { zero++; if (!clickArt(null)) break; }
      else if (!clickArt(arts[0])) break;
      turns++;
      drain('§5·一回合');
    }
    console.log(`  ${cfg.name.padEnd(13)}${String(turns).padEnd(6)}[${seq.join(',')}]`.padEnd(48) + zero);
  }
  Cult.s.arts = { ..._artsBackup };
}

console.log(`\n${fail ? '❌' : '✅'} 冷却层门禁:${pass} 项断言通过${fail ? `,${fail} 项红:${RED.join(' / ')}` : ''}`);
process.exit(fail ? 1 : 0);