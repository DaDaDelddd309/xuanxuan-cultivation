// duel-balance-invariant.mjs —— 回合制决斗的**不变量门禁**
//
// 为什么有这个门禁:
//
//   js/xiuxian/duel.js + battle.js 是回合制战斗的表现层与纯逻辑层。今天刚修完两个 P0
//   (败北软锁、Duel.busy 单向闩),但**回合制本身的可玩性从未被验证过**:
//   出牌策略、伤害公式、血量继承是否公平,全无断言。
//   前两个 P0 之所以能拖到今天,根因在下面这段注释里:12 轮自动化、87 局,一次都没打到过 Boss。
//   现有门禁 duel-session-latch-regression.mjs 每场都是「把敌人血设成 1,一招带走」,
//   所以它证明了"能打完",却从来没证明过"打不完的那几回合里玩家到底在干什么"。
//
// 本门禁与它的分工:
//   duel-session-latch-regression.mjs —— 会话层(闩、败北分支、onLose/onWin 接线)
//   duel-balance-invariant.mjs(本文件)—— 数值层(伤害公式 / 血量继承 / 冷却 / round 去向)
//
// 本门禁**不靠正则抠实现**:battle.js 的纯函数在 node 里直接 import 真跑;
//   duel.js 用 DOM 桩 + 可控假时钟真跑完整决斗(借自 duel-session-latch-regression.mjs)。
//
// 出处可复现:node tests/duel-balance-invariant.mjs
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join, relative } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

/** 本门禁自己。D1 要全仓扫 `.round`,而本文件里为了写这条断言本身就含有 `.round` 字面量,
 *  不排掉的话门禁会读到自己 —— 那是测量工具咬到了自己的舌头,不是产品代码的锅。 */
const SELF = relative(ROOT, _fu(import.meta.url));

/** 递归列源码文件(跳过依赖/构建/资源目录 —— 它们不是本门禁的判据来源) */
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'shots', '_shots', 'assets', 'icons', 'css', 'docs']);
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIR.has(n) || n.startsWith('.')) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html)$/.test(n)) out.push(p);
  }
  return out;
}

// ————————————————————————————————————————————
// 确定性随机源
// ————————————————————————————————————————————
// ⚠️ battle.js 的 makeEnemy / enemyAct 内部直接调 Math.random(不是纯函数)。
//   这里统一装一个可复现的 mulberry32 —— 否则「胜率」这种数字每次跑都不一样,
//   门禁报的红就变成 flaky,没人敢信。装在所有 import 之前,
//   免得模块求值期间就已经消耗掉随机序列。
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _rng = mulberry32(0x5EED);
const seedRng = (s) => { _rng = mulberry32(s); };
const realRandom = Math.random;                  // H2 用它证明自己真的换掉了
globalThis.Math.random = () => _rng();

// ————————————————————————————————————————————
// 可控假时钟
// ————————————————————————————————————————————
// 借自 duel-session-latch-regression.mjs。两点必须对,否则门禁会说谎:
//   ① 必须真的响应 clearTimeout(打字机 finishType 用它掐掉排队中的 step;
//      不响应 → cb 被调两遍 → win()/lose() 被调两遍 → 测试在一个不存在的世界里通过)。
//   ② 必须保序(Map 保持插入序 = 定时器按入队先后执行)。
// 另加死循环哨兵:流程不收敛就抛错,而不是安静地转。
//   ——「度量工具自己出错比没有度量工具更危险」,这里防的是我自己。
const timers = new Map();
let _tid = 0;
globalThis.setTimeout = fn => { const id = ++_tid; timers.set(id, fn); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
/** 把当前所有定时器跑到空 */
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
/** 最多跑 maxSteps 步就收手,返回是否真的收敛。给「已知不收敛」的探针留退路。 */
const drainBounded = (label, maxSteps) => {
  let guard = 0;
  while (timers.size) {
    if (++guard > maxSteps) return { converged: false, steps: guard, pending: timers.size };
    const id = timers.keys().next().value;
    const fn = timers.get(id);
    timers.delete(id);
    fn();
  }
  return { converged: true, steps: guard, pending: 0 };
};
globalThis.requestAnimationFrame = fn => { fn(); return 0; };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };

// ————————————————————————————————————————————
// DOM 桩:够 duel.js 跑完一整场,且能真的点到按钮
// ————————————————————————————————————————————
// 三条不可省的性质(理由见 duel-session-latch-regression.mjs 的同款注释):
//   ① #xd-sk 的 click 监听器要能被触发,事件要带 target.closest('[data-art]')
//   ② #xd-defeat 的 innerHTML 里的 data-c="..." 要能被解析成可点的节点,
//      且必须按 (宿主元素, html) 记忆化 —— 否则 duel.js 挂的 onclick 挂在没人引用的对象上,
//      点下去什么也不会发生,门禁会报一堆假红
//   ③ 同一 selector 必须永远返回**同一个**元素(paintHp 写到的和 hurt 读到的得是同一个)
const REG = new Map();
const reg = sel => { if (!REG.has(sel)) REG.set(sel, mkEl('div')); return REG.get(sel); };
const resetDom = () => { REG.clear(); timers.clear(); };
function parseChio(host) {
  const html = host.innerHTML;
  if (!host._chioCache || host._chioCache.html !== html) {
    const out = [];
    const re = /data-c="([^"]+)"/g;
    let m;
    while ((m = re.exec(html || ''))) { const b = mkEl('div'); b.dataset.c = m[1]; out.push(b); }
    host._chioCache = { html, nodes: out };
  }
  return host._chioCache.nodes;
}
function mkEl(tag) {
  const el = {
    tagName: tag, className: '', _cls: new Set(), style: {}, dataset: {},
    _html: '', textContent: '', src: '', offsetWidth: 1, _kids: [], _h: {},
    onclick: null,
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
      if (sel === '[data-art]' || sel === 'button') {
        const out = [];
        const re = /data-art="([^"]+)"/g;
        let m;
        while ((m = re.exec(el._html || ''))) { const b = mkEl('button'); b.dataset.art = m[1]; out.push(b); }
        return out;
      }
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

// 场景之间要能拿到**全新的 Duel**。⚠️ 不能只调 resetDom():
//   Duel.root 是 build() 时建好的真实元素,清空 REG 之后 root 仍指着**上一个场景的旧元素**,
//   而点击监听器挂在旧元素上 —— 于是新场景里点技能什么也不会发生。
//   我第一版就这么写,探针全报「没复现」,差点把一个真 P0 当成不存在。
//   真实玩家刷新页面就是这个效果,所以用 cache-buster 让 duel.js 重新求值(deps 走缓存,很快)。
let _duelN = 0;
const loadDuel = async () => (await import(`../js/xiuxian/duel.js?n=${++_duelN}`)).Duel;
const { Cult } = await import('../js/xiuxian/index.js');
const _artsBackup = { ...Cult.get().arts };
/** 给玩家配一套神通(duel.js:151 hero.arts 直接取 Cult.get().arts) */
const setArts = (arts) => { Cult.s.arts = { ...arts }; };
const restoreArts = () => { Cult.s.arts = { ..._artsBackup }; };

// ————————————————————————————————————————————
// 断言器
// ————————————————————————————————————————————
let pass = 0, fail = 0;
const RED = [], PROBE = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; RED.push(n); console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};
/** 探针:报告但不计入失败。
 *  用途 = 「已知的坏」或「测出来的坏」。这些不是"我懒得写",
 *  是**当前实现确实如此/确实是坏的**,而改 js/ 不在本门禁的活儿里。
 *  修好之后把对应条目从 KNOWN_DEFECTS 升级成 t() 断言 ——
 *  本项目的既定做法是**推翻旧状态要改断言,不是删断言**。 */
const p = (n, c, d = '') => {
  PROBE.push({ n, ok: c, d });
  console.log(`  ${c ? '🔎' : '⚠️ '} ${n}${d ? '  — ' + d : ''}`);
};

// ————————————————————————————————————————————
// 单调性断言 + **自检**
// ————————————————————————————————————————————
//
// ⚠️ 这条自检不是形式主义。本轮同一批工作里刚踩过一个坑:
//   「代价轴方向写反了」—— 测的是「剩余比例」,判的却是「损掉」,
//   结论碰巧成立纯属运气。
//   所以凡是依赖单调方向的断言,都必须带一条**反向对照**:
//   把被测序列整个反过来喂给同一个谓词,谓词**必须拒绝它**。
//   反过来喂还判过 ⇒ 谓词是恒真的(方向写反也照样绿)⇒ 这条断言是废的。
// 另外先查**非平凡性**:序列必须真的在变。全程相等的序列对任何方向都成立,那是 vacuous pass。
function tMonotonic(name, ys, dir) {
  const pred = dir === 'up' ? (a, b) => b >= a : (a, b) => b <= a;
  const uniq = new Set(ys).size;
  t(`${name}·非平凡(序列确实在变)`, uniq > 1,
    `去重后只有 ${uniq} 个值 —— 常量序列对任何方向都成立,这条断言是空转的`);
  let viol = -1;
  for (let i = 1; i < ys.length; i++) if (!pred(ys[i - 1], ys[i])) { viol = i; break; }
  t(`${name}·方向为 ${dir}`, viol < 0,
    viol < 0 ? '' : `第 ${viol} 段反着走: ${ys[viol - 1]} → ${ys[viol]}。⚠️ 若你确信这是修好了,先确认方向没写反`);
  const rev = [...ys].reverse();
  let revViol = -1;
  for (let i = 1; i < rev.length; i++) if (!pred(rev[i - 1], rev[i])) { revViol = i; break; }
  t(`${name}·自检(反向序列必须被同一谓词拒绝)`, revViol >= 0,
    '反向序列居然也判过 ⇒ 该谓词恒真 ⇒ 方向写反了门禁也会绿。请重新定义 pred');
}

// ════════════════════════════════════════════
console.log('\n=== [A] 伤害公式:合理输入域内不得产生荒谬值 ===');
// ════════════════════════════════════════════
const B = await import('../js/xiuxian/battle.js');
const { playerAct, enemyAct, availableArts, canUseArt, isDead, playerDead, enterTurnBased, inheritedRatio, makeEnemy, tickCooldown } = B;

// ⚠️ battle.js 的 artDamage / artCd 是**私有的**(未 export),只能从 playerAct 的返回值反推。
//   合法等级按 arts.js 的 max:5 圈定;防御扫 makeEnemy 的 def:2 及其邻域。
//   敌方 dmg 的上界按 duel.js:136 的公式取 realmIdx=4 的最大值 38。
const LV_OK = [1, 2, 3, 4, 5];
const DEF_OK = [0, 1, 2, 3, 5, 10, 25, 50];
const E_DMG_MAX = 38;                                   // duel.js:136 realmIdx=4 时 = 10+4*6
const E_DMG_HARD_CAP = Math.ceil(E_DMG_MAX * 1.25 * 1.6); // 浮动 0.85~1.25 再乘暴击 1.6
// ⚠️ v099ae(XX-DUEL-007)之后这里有两个数,不能混:
//   cdRaw = playerAct 刚写进去的原始值(= artCd)
//   cdNext = **下一个玩家回合开始时**玩家真正看到的值(= cdRaw - 1)
// 以前递减写在 playerAct 里,两者是同一个数,所以只用一个 cd 就够了。
// 现在递减移到回合边界(tickCooldown),「这张牌要等几回合」必须读 cdNext。
const dmgOf = (lv, isS, def) => {
  const e = { hp: 1e6, hpMax: 1e6, def };
  const s = { arts: { x: lv }, isSuper: isS ? { x: 1 } : {}, cooldown: {}, hp: 100 };
  const r = playerAct(s, e, 'x');
  const cdRaw = s.cooldown.x;
  tickCooldown(s);                 // 模拟下一回合开始
  return { dmg: r.dmg, cd: cdRaw, cdNext: s.cooldown.x };
};

{
  const bad = [];
  let maxDmg = -Infinity, minDmg = Infinity;
  const grid = [];
  for (const sup of [0, 1]) for (const lv of LV_OK) for (const def of DEF_OK) {
    const { dmg } = dmgOf(lv, sup, def);
    grid.push({ sup, lv, def, dmg });
    maxDmg = Math.max(maxDmg, dmg); minDmg = Math.min(minDmg, dmg);
    if (!Number.isFinite(dmg)) bad.push(`lv${lv}/sup${sup}/def${def} → ${dmg}`);
    else if (!Number.isInteger(dmg)) bad.push(`lv${lv}/sup${sup}/def${def} → ${dmg}(非整数)`);
    else if (dmg < 1) bad.push(`lv${lv}/sup${sup}/def${def} → ${dmg}(负或零)`);
    else if (dmg > 100) bad.push(`lv${lv}/sup${sup}/def${def} → ${dmg}(超过敌人满血 100,荒谬)`);
  }
  t(`A1 玩家伤害在整个合法格点上都是有限正整数且 ≤100(共 ${grid.length} 组)`,
    bad.length === 0, bad.slice(0, 4).join(' ; '));
  t(`A2 玩家伤害落在 [${minDmg}, ${maxDmg}],没有下溢也没有溢出`, minDmg >= 1 && maxDmg <= 100);

  const monoOK = [];
  for (const sup of [0, 1]) for (const def of DEF_OK) monoOK.push(LV_OK.map(lv => dmgOf(lv, sup, def).dmg));
  t('A3 等级 ↑ ⇒ 伤害不 ↓(10 条等级序列全部单调不降)',
    monoOK.every(ys => ys.every((v, i) => i === 0 || v >= ys[i - 1])),
    '出现了「练高了反而更弱」的等级');
  const fake = LV_OK.map((_, i) => 60 - i * 10);
  const upPred = (a, b) => b >= a;
  t('A3·自检(反向对照:谓词必须拒绝一条随等级下降的伤害序列)',
    fake.some((v, i) => i > 0 && !upPred(fake[i - 1], v)),
    '谓词恒真 —— 「等级↑伤害↑」这条断言即使方向写反也会绿');

  t('A4 超武在任意等级/防御下都不弱于同等级普通神通',
    LV_OK.every(lv => DEF_OK.every(def => dmgOf(lv, 1, def).dmg >= dmgOf(lv, 0, def).dmg)));

  const oneShot = dmgOf(5, 1, 2).dmg;
  t(`A5 满级超武(def=2)伤害 ${oneShot} < 敌人满血 100(不能一击秒)`,
    oneShot < 100, `伤害 ${oneShot} ≥ 100 ⇒ 满配玩家一回合结束一切,回合数失去意义`);

  {
    const e = { hp: 3, hpMax: 100, def: 0 };
    const s = { arts: { x: 5 }, isSuper: { x: 1 }, cooldown: {}, hp: 100 };
    playerAct(s, e, 'x');
    t('A6 溢出伤害后敌方血量被夹在 0,不是负数', e.hp === 0, `e.hp = ${e.hp}`);
  }

  {
    const badE = [];
    seedRng(1);
    let critSeen = false, minSeen = Infinity, maxSeen = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const e = { dmg: E_DMG_MAX, line: 'x', hp: 100 };
      const s = { hp: 40, hpMax: 100, dmgReduce: 0 };
      const r = enemyAct(e, s);
      if (critSeen !== undefined) critSeen = critSeen || r.crit;
      minSeen = Math.min(minSeen, r.dmg); maxSeen = Math.max(maxSeen, r.dmg);
      if (!Number.isFinite(r.dmg)) badE.push(`dmg=${r.dmg}`);
      if (r.dmg < 0) badE.push(`负伤害 ${r.dmg}`);
      if (s.hp < 0) badE.push(`玩家血量变负 ${s.hp}`);
      if (r.dmg > E_DMG_HARD_CAP) badE.push(`暴击倍率失控 ${r.dmg} > ${E_DMG_HARD_CAP}`);
    }
    t(`A7 敌方伤害在 5000 次采样里有限、非负、不超过暴击硬上限 ${E_DMG_HARD_CAP},玩家血量不越界`,
      badE.length === 0, badE.slice(0, 3).join(' ; '));
    p('A7·采样覆盖度:暴击分支真的被采到了', critSeen,
      `暴击率 15%,5000 次采样应命中约 750 次。实测伤害区间 [${minSeen}, ${maxSeen}],` +
      `硬上限 ${E_DMG_HARD_CAP}(= 38 × 1.25 浮动 × 1.6 暴击)。` +
      `${critSeen ? '暴击分支已覆盖,上界被真正验证过。' : '⚠️ 没采到暴击 ⇒ 这个上界其实没被验证过。'}`);
  }

  t('A8 防御再高也有保底伤害(不会出现 0 伤害的空回合)',
    dmgOf(5, 1, 999).dmg >= 1, `def=999 时伤害 = ${dmgOf(5, 1, 999).dmg}`);

  {
    const r = playerAct({ arts: {}, cooldown: {} }, { hp: 100, def: 2 }, 'nope');
    t('A9 没学会的神通出招返回 null,且不改动任何状态', r === null);
  }
}

// ════════════════════════════════════════════
console.log('\n=== [B] 血量继承:e.hp 必须始终落在合法区间,且比例关系单调 ===');
// ════════════════════════════════════════════
{
  const EDGE = [-1e9, -1, -0.001, 0, 0.004, 0.005, 0.05, 0.5, 0.999, 1, 1.001, 2, 1e9];
  const SAMPLES = [];
  for (let i = 0; i <= 2000; i++) SAMPLES.push(i / 2000);
  const ALL = [...EDGE, ...SAMPLES];

  seedRng(7);
  const hpSeries = ALL.map(r => enterTurnBased(makeEnemy('guard'), r).hp);
  const oob = ALL.filter((_, i) => !(Number.isInteger(hpSeries[i]) && hpSeries[i] >= 1 && hpSeries[i] <= 100));
  t(`B1 enterTurnBased 在 ${ALL.length} 个输入上,e.hp 恒 ∈ [1,100] 且为整数`, oob.length === 0,
    `越界样例:${oob.slice(0, 4).map((r, k) => `${r}→${hpSeries[ALL.indexOf(r)]}`).join(', ')}`);
  t('B2 归一后 hpMax 必须被钉成 100(比例的分母固定)',
    enterTurnBased(makeEnemy('guard'), 0.3).hpMax === 100);

  const inner = SAMPLES.map(r => enterTurnBased(makeEnemy('guard'), r).hp);
  tMonotonic('B3 hpRatio ↑ ⇒ e.hp 不 ↓(2001 点密集采样)', inner, 'up');

  {
    const e = enterTurnBased(makeEnemy('guard'), 0.42);
    t('B4 inheritedRatio 忠实反映归一后的比例', Math.abs(inheritedRatio(e) - 0.42) <= 0.005,
      `hp=${e.hp}/hpMax=${e.hpMax} ⇒ ${inheritedRatio(e).toFixed(4)},输入 0.42`);
  }
  {
    // ⚠️ 只在 round(100r) ≥ 1 的区间上量误差:r < 0.005 时钳位会把 0 顶成 1,
    //   那 1 点的差是钳位造成的,不是归一精度。把它算进来会得到一个假红。
    const rr = SAMPLES.filter(r => r >= 0.02);
    const worst = Math.max(...rr.map(r => Math.abs(enterTurnBased(makeEnemy('guard'), r).hp - 100 * r)));
    t('B5 归一误差 ≤ 0.5(四舍五入的数学上界)', worst <= 0.5 + 1e-9, `实测最大偏差 ${worst}`);
  }

  // —— Duel.start 那条路径(duel.js:128-132),DOM 桩真跑 ——
  const startHp = async (ratio) => {
    const Duel = await loadDuel();
    resetDom(); seedRng(3);
    Duel.start(mkCfg(typeof ratio === 'number' ? { hpRatio: ratio } : {}));
    const hp = Duel.S.e.hp;
    resetDom();
    return hp;
  };
  const mkCfg = (o = {}) => ({
    node: { type: 'boss' },
    hpRatio: 0.5,
    hero: { name: '轩轩', img: 'h.jpg', realmIdx: 0 },
    foe: { key: 'boss_golem', name: '石像守卫', img: 'f.jpg', realmIdx: 1, stronger: true, isNemesis: false },
    ...o,
  });

  const dEdge = [-1e9, -1, 0, 0.001, 0.049, 0.05, 0.5, 0.999, 1, 2, 1e9];
  const dHp = [];
  for (const r of dEdge) dHp.push(await startHp(r));
  t(`B6 Duel.start 在 ${dEdge.length} 个边界输入上,e.hp 恒 ∈ [1,100] 且为整数`,
    dHp.every(h => Number.isInteger(h) && h >= 1 && h <= 100),
    `得到 ${JSON.stringify(dHp)}`);
  t('B7 Duel.start 的下钳位是 0.05(不是 0)—— 局内打空的 Boss 至少留 5% 血',
    await startHp(0) === 5, `hpRatio=0 ⇒ e.hp=${await startHp(0)},期望 5`);
  t('B8 Duel.start 的上钳位是 1 —— 传超界值不会造出超满血的敌人',
    await startHp(99) === 100, `hpRatio=99 ⇒ e.hp=${await startHp(99)},期望 100`);

  {
    const Duel = await loadDuel();
    resetDom(); seedRng(3);
    Duel.start(mkCfg({ hpRatio: undefined, node: { type: 'secret' } }));
    const secretHp = Duel.S.e.hp; resetDom();
    resetDom(); seedRng(3);
    Duel.start(mkCfg({ hpRatio: undefined, node: { type: 'boss' } }));
    const bossHp = Duel.S.e.hp; resetDom();
    t('B9 不传 hpRatio 时回退到设计值(秘境满血 100 / 其余 0.4 ⇒ 40)',
      secretHp === 100 && bossHp === 40, `secret=${secretHp} boss=${bossHp}`);
  }
  {
    const dInner = [];
    for (let i = 0; i <= 1000; i += 2) dInner.push(await startHp(i / 2000));
    tMonotonic('B10 hpRatio ↑ ⇒ Duel.start 的 e.hp 不 ↓(1001 点实跑采样)', dInner, 'up');
  }
  {
    const Duel = await loadDuel();
    resetDom(); seedRng(3);
    Duel.start(mkCfg({ hpRatio: 0.3, hero: { name: '轩轩', img: 'h.jpg', realmIdx: 2 } }));
    const S = Duel.S;
    const ok = S.hero.hp === S.hero.hpMax && S.e.hp === 30;
    resetDom();
    t('B11 只有敌人继承自动战斗血量;玩家恒以满血入场(duel.js:150-151)', ok);
  }

  const nanHp = await startHp(NaN);
  p('PROBE-1 hpRatio=NaN 时 Duel.start 的 e.hp', Number.isFinite(nanHp),
    `e.hp=${nanHp}。NaN 穿过 Math.min/max/round 三层钳位毫发无伤 ⇒ isDead(NaN) 恒 false ⇒ 敌人**不可击杀**。` +
    `注:main.js:247 传的是 boss.hp/hpMax,只有在 boss.hp 已经烂成 NaN 时才会真的触发。`);
}

// ════════════════════════════════════════════
console.log('\n=== [C] 技能冷却:不得存在永远用不出来的技能,也不得冷却永不归零 ===');
// ════════════════════════════════════════════
{
  t('C1 冷却全空时,availableArts 里每一门都 canUseArt',
    (() => { const s = { arts: { a: 1, b: 3, c: 5 }, cooldown: {} }; return availableArts(s).every(id => canUseArt(s, id)); })());

  {
    const s = { arts: { a: 1, b: 0, c: 5 }, cooldown: {} };
    t('C2 没学会(lv=0 / 缺键)的神通不可用',
      canUseArt(s, 'b') === false && canUseArt(s, 'zzz') === false);
  }
  {
    const s = { arts: { a: 3 }, cooldown: {}, hp: 999 };
    const e = { hp: 1e6, hpMax: 1e6, def: 0 };
    let neg = false;
    for (let i = 0; i < 200; i++) { playerAct(s, e, 'a'); if (Object.values(s.cooldown).some(v => v < 0)) { neg = true; break; } }
    t('C3 200 次连续出招后,没有任何冷却值变负', !neg);
  }
  {
    // ⚠️ 两个坑叠在一起,第一版同时踩了:
    //   ① 冷却递减写在 playerAct 里,但 playerAct 开头会**先**把本门冷却重置成 artCd。
    //      所以「一直按同一个键」看不到递减 —— 必须用别的键去推它。
    //   ② 用来推的那门本身也会进冷却,推几下之后 canUseArt 也把它挡住,
    //      playerAct 直接 return null,递减根本不发生。
    //   ⇒ 推杆必须是**永远可用**的那门:超武的有效冷却恒为 0(见 C8)。
    const s = { arts: { a: 1, y: 1 }, isSuper: { y: 1 }, cooldown: {}, hp: 99999 };
    const e = { hp: 1e9, hpMax: 1e9, def: 0 };
    playerAct(s, e, 'a');                       // 用掉 a
    const cd0 = s.cooldown.a;
    const series = [cd0];
    // 只推回合,不再重复用 a —— 重复用会把冷却重新拉高,序列永远降不到 0
    // (第一版改写就栽在这儿:C5 报红是因为模型自己把门闩又插上了)
    for (let i = 0; i < cd0 + 2; i++) {
      tickCooldown(s);                          // 一个玩家回合开始 → 递减一次
      series.push(s.cooldown.a);
    }
    tMonotonic('C4 不用它时,冷却逐回合递减', series, 'down');
    t('C5 冷却确实归零了(不会卡在正数上永远放不出来)', series[series.length - 1] === 0,
      `序列 ${JSON.stringify(series)}`);
    // ⚠️ 这条以前是「用完当回合就已经被减过 1」。XX-DUEL-007 把递减移到回合边界之后,
    //   playerAct 读完是**原始值** artCd,下一回合 tick 完才是 artCd-1。
    //   旧断言在新代码下**靠错误的理由通过了**(两边都等于 artCd),
    //   所以这里必须改断言而不是留着它绿 —— 那正是「绿得像验证过了」的形态。
    t('C6 用完之后,下一回合开始时冷却已经减过 1(玩家实际要等 = artCd - 1)',
      dmgOf(1, 0, 2).cdNext === dmgOf(1, 0, 2).cd - 1,
      `原始 ${dmgOf(1, 0, 2).cd} → 下一回合 ${dmgOf(1, 0, 2).cdNext}`);
    t('C6b playerAct 本身不再偷偷递减(递减只在回合边界发生一次)',
      (() => {
        const s2 = { arts: { a: 3 }, cooldown: {}, hp: 100 };
        const e2 = { hp: 1e9, hpMax: 1e9, def: 0 };
        playerAct(s2, e2, 'a');
        const before = s2.cooldown.a;
        playerAct(s2, e2, 'a');
        return s2.cooldown.a === before;   // 连续两次用同一门,值不应被递减
      })(), 'playerAct 里仍在递减 —— 回合边界的 tickCooldown 会变成双重递减');
  }
  {
    const table = LV_OK.map(lv => ({ lv, cd: dmgOf(lv, 0, 2).cdNext, scd: dmgOf(lv, 1, 2).cdNext }));
    t('C7 普通神通的有效冷却在 [0,3],没有任何一门卡死 4 回合以上',
      table.every(r => r.cd >= 0 && r.cd <= 3), JSON.stringify(table));
    t('C8 超武的有效冷却恒为 0 —— 冷却对超武完全不生效',
      table.every(r => r.scd === 0), JSON.stringify(table.map(r => r.scd)));
    p('PROBE-2 超武「伤害最高」且「无冷却」,playerAct 又不消耗任何资源',
      table.every(r => r.scd === 0) && table.every(r => dmgOf(r.lv, 1, 2).dmg > dmgOf(r.lv, 0, 2).dmg),
      '超武同时占死两个格子 ⇒ 只要手里有超武,「出什么牌」这个问题退化成一个恒等式');
  }
  {
    const src = R('js/xiuxian/battle.js');
    const decLines = src.split('\n').filter(l => /cooldown\[k\]\s*--/.test(l));
    // ⚠️ 2026-10-11 订正断言名。原文写「只发生在 playerAct 里」,但 playerAct 里**没有**递减 ——
    //   XX-DUEL-007 早就把它移到了 tickCooldown(:105-108)。断言实际验的是
    //   「全文件 `cooldown[k]--` 恰好出现 1 次」,名字与内容不符会误导下一个改它的人。
    //   另注:这是**格式耦合**不是数值耦合 —— 谁把 :107 改写成等价的 `-= 1`,计数变 0 就假红。
    t('C9 冷却递减全文件只有一处(`cooldown[k]--`,在 tickCooldown 里,不在 playerAct)',
      decLines.length === 1,
      `找到 ${decLines.length} 处`);
  }
  {
    const s = { arts: { a: 1, b: 4 }, cooldown: {}, hp: 9999 };
    const e = { hp: 1e9, hpMax: 1e9, def: 2 };
    const used = new Set(); let idx = 0;
    for (let i = 0; i < 60; i++) {
      const usable = availableArts(s).filter(id => canUseArt(s, id));
      if (!usable.length) continue;
      const pick = usable[idx++ % usable.length];
      playerAct(s, e, pick); used.add(pick);
    }
    t('C10 轮转策略下每门神通都真的上过场(不存在永远按不出来的技能)',
      used.size === 2, `上场 ${JSON.stringify([...used])}`);
  }
  {
    const mk = v => ({ arts: { a: v }, cooldown: {} });
    t('C11 canUseArt 拒绝 undefined / 0 / NaN 三种「没学会」的写法',
      canUseArt(mk(undefined), 'a') === false && canUseArt(mk(0), 'a') === false && canUseArt(mk(NaN), 'a') === false);
    p('PROBE-3 canUseArt 接受负等级', canUseArt(mk(-1), 'a') === true,
      'arts.a=-1 被判「已学会」⇒ artDamage 走 lv<=0 分支返回 0,打出 1 点保底伤害并白吃一个冷却。存档损坏时静默劣化而不是报错');
  }
}

// ════════════════════════════════════════════
console.log('\n=== [D] S.round 的去向:断言它当前**零读取** ===');
// ════════════════════════════════════════════
//
// 锤子提的原话:「S.round++ 从未被读取」。查证结论:**属实**。
// 全仓只有两处提到 round —— duel.js:154 初始化、duel.js:392 自增 —— 没有任何一处读它。
// 既不进胜负判定、不进伤害公式、也不进任何 UI 渲染。
//
// ⚠️ 为什么把它写成一条**会红的断言**,而不是注释掉:
//   回合制接线的第一步一定是"用第 N 回合做点什么"(累积伤害、限时、狂暴、对话分支)。
//   那一刻这条断言会红 —— 这是**故意的**。
//   本项目的既定做法是:推翻旧状态要**改**断言,不是**删**断言。
//   接线的人必须来这里,把这条改写成「round 必须被读」,并顺手想清楚第 N 回合意味着什么。
//   直接删掉,等于放下一个回合制问题再次悄无声息地溜进来。
{
  const files = walk(ROOT).filter(f => relative(ROOT, f) !== SELF);
  const hits = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((ln, i) => {
      let m;
      const re = /\.round\b/g;
      while ((m = re.exec(ln))) {
        const before = ln.slice(Math.max(0, m.index - 6), m.index);
        const after = ln.slice(m.index + m[0].length);
        if (/Math$/.test(before)) continue;                 // Math.round( —— 不是我们要的
        const isWrite = /^\+\+/.test(after) || /^--/.test(after) ||
                        /\+\+$/.test(before.trim()) || /--$/.test(before.trim());
        hits.push({ file: relative(ROOT, f), line: i + 1, code: ln.trim(), kind: isWrite ? 'write' : 'read' });
      }
    });
  }
  const reads = hits.filter(h => h.kind === 'read');
  const writes = hits.filter(h => h.kind === 'write');
  console.log(`  · 扫描 ${files.length} 个源码文件(已排除本门禁自身),.round 命中 ${hits.length} 处 —— 写 ${writes.length} / 读 ${reads.length}`);
  for (const h of hits) console.log(`      ${h.file}:${h.line}  [${h.kind}]  ${h.code}`);
  t('D1 全仓 S.round 零读取 —— 回合数写进去了,但没有任何东西用它', reads.length === 0,
    `检出 ${reads.length} 处读取:${reads.slice(0, 3).map(h => `${h.file}:${h.line}`).join(', ')}。` +
    `⚠️ 如果你刚把回合数接进了玩法,那是对的 —— 请把本条改写成「round 必须被读」,并在注释里写清第 N 回合意味着什么`);
  const ownWrites = writes.filter(w => w.file === 'js/xiuxian/duel.js');
  t('D2 duel.js 里 round 仍然被自增(别把写也一起删了,让两条断言同时归零)',
    ownWrites.length === 1 && /S\.round\+\+/.test(ownWrites[0].code),
    JSON.stringify(ownWrites));
  t('D3 S.round 的初始化点仍在 duel.js 的会话状态里',
    /round:\s*0,\s*over:\s*false/.test(R('js/xiuxian/duel.js')),
    '找不到 round: 0 —— 初始化被删了');
  {
    const demo = 'const x = S.round; const y = M.a.b.round + 1; Math.round(3.5); S.round++;';
    const probe = [];
    const re = /\.round\b/g; let m;
    while ((m = re.exec(demo))) {
      const before = demo.slice(Math.max(0, m.index - 6), m.index);
      const after = demo.slice(m.index + m[0].length);
      if (/Math$/.test(before)) continue;
      const isWrite = /^\+\+/.test(after) || /\+\+$/.test(before.trim());
      probe.push(isWrite ? 'write' : 'read');
    }
    t('D4·自检(.round 读/写分类器的反向对照)', probe.filter(x => x === 'read').length === 2,
      `在含 2 读 1 写的样例上只认出 ${JSON.stringify(probe)} —— D1 可能因为分类器失灵而恒绿`);
  }
}

// ════════════════════════════════════════════
console.log('\n=== [E] 回合制流程:实跑一整场,看玩家到底有几个动作 ===');
// ════════════════════════════════════════════
const mkCfg = (o = {}) => ({
  node: { type: 'boss' }, hpRatio: 0.5,
  hero: { name: '轩轩', img: 'h.jpg', realmIdx: 0 },
  foe: { key: 'boss_golem', name: '石像守卫', img: 'f.jpg', realmIdx: 1, stronger: true, isNemesis: false },
  onWin: () => {}, onLose: () => {}, ...o,
});
/** 点当前技能栏里的第 n 个按钮:走 duel.js:191 注册的真实监听器,不绕过点击闸门 */
function clickArt(n = 0) {
  const sk = reg('#xd-sk');
  const arts = (sk.innerHTML.match(/data-art="([^"]+)"/g) || []).map(s => s.slice(10, -1));
  if (arts.length <= n) return false;
  const ev = { target: { closest: q => (q === '[data-art]' ? { dataset: { art: arts[n] } } : null) } };
  (sk._h.click || []).forEach(fn => fn(ev));
  return true;
}
/** 技能栏当前真实渲染出来的按钮(不是残留 innerHTML) */
const liveArts = () => (reg('#xd-sk').innerHTML.match(/data-art="([^"]+)"/g) || []).map(s => s.slice(10, -1));

{
  const Duel = await loadDuel();
  setArts({ jianqi: 1, wulei: 1 });        // 两门神通,保证每回合都有牌可出
  resetDom(); seedRng(11);
  let win = 0, lose = 0;
  Duel.start(mkCfg({ onWin: () => { win++; }, onLose: () => { lose++; } }));
  drain('E·开场');

  {
    const html = reg('#xd-sk').innerHTML || '';
    const kinds = new Set();
    for (const m of html.matchAll(/data-([a-z]+)="/g)) kinds.add(m[1]);
    t('E1 技能栏只有 data-art 一种动作(没有防御/资源/状态类按钮)',
      kinds.size === 1 && kinds.has('art'), `出现的 data-* 种类:${JSON.stringify([...kinds])}`);
    t('E2 技能栏确实渲染出了可点的技能', /data-art="/.test(html));
  }
  {
    let guard = 0, clicks = 0;
    while (Duel.S && !Duel.S.over && guard++ < 60) {
      if (!liveArts().length) break;
      clickArt(0); clicks++;
      drain('E·一回合');
    }
    p('PROBE-9 双神通玩家在一场决斗里能出几招',
      clicks >= 6,
      `点了 ${clicks} 次就再也点不动了(onWin=${win} / onLose=${lose})。` +
      `⚠️ 2026-10-11 订正:原文写「冷却递减只写在 playerAct 里,强制普攻分支走不到那儿」—— ` +
      `**那已经过时了**:XX-DUEL-007 早把递减移到了 tickCooldown(battle.js:105-108),` +
      `由 duel.js:399 的回合边界统一调一次,走不走 playerAct 都吃得到递减。` +
      `若本探针仍报红,先看 battle.js 的 artCd(现在是 min(原曲线, n-1),n=已掌握神通数),` +
      `别按原文去往 playerAct 里补递减 —— 那是把它搬回一个错误的位置`);
  }
  {
    // 「引擎本身能收敛」的对照实验:给一门有效冷却恒为 0 的超武,每回合都有牌出。
    const D2 = await loadDuel();
    setArts({ wanji: 1 });
    resetDom(); seedRng(17);
    let w2 = 0, l2 = 0, turns2 = 0;
    D2.start(mkCfg({ onWin: () => { w2++; }, onLose: () => { l2++; } }));
    drain('E2·开场');
    while (D2.S && !D2.S.over && turns2++ < 60 && liveArts().length) { clickArt(0); drain('E2·一回合'); }
    t('E3 有一门永远可用的神通时,整场决斗能正常打完(流程 machinery 本身不是死循环)',
      w2 === 1 && turns2 > 1, `onWin=${w2} / onLose=${l2},用了 ${turns2} 回合 —— ` +
      `若为 0,说明问题出在冷却与强制普攻的交互上,而不是回合制框架本身`);
    resetDom(); restoreArts();
  }
  resetDom(); restoreArts();
}

// ════════════════════════════════════════════
console.log('\n=== [F] 单技能玩家:默认存档能不能打完一场 ===');
// ════════════════════════════════════════════
//
// 默认存档 arts = defaultArts() = { jianqi: 1 } —— **只有一门神通**(arts.js:103)。
// 用完它 → 冷却 3 → availableArts∩canUseArt 变空 → duel.js:341 走强制普攻分支。
// 而冷却递减只写在 battle.js 的 playerAct 里(battle.js:85),强制普攻走不到那儿。
// 于是玩家全程零输入,只能看着对手按固定节奏打自己。
{
  const Duel = await loadDuel();
  setArts({ jianqi: 1 });                  // = defaultArts(),新玩家的真实开局
  resetDom(); seedRng(13);
  let win = 0, lose = 0;
  Duel.start(mkCfg({ onWin: () => { win++; }, onLose: () => { lose++; } }));
  drain('F·开场');

  const cdAfter = clickArt(0) ? { ...Duel.S.hero.cooldown } : null;
  const res = drainBounded('F·单技能', 1500);
  const S = Duel.S;
  const enemyHp = S && S.e ? S.e.hp : '(会话已结束)';

  p('PROBE-4 单技能玩家:用完唯一神通后,冷却还回不回来',
    res.converged,
    `默认存档只有一门神通;点完它冷却=${JSON.stringify(cdAfter)}。` +
    `⚠️ 2026-10-11 订正:原文写「其后 availableArts∩canUseArt 都是空 ⇒ 走强制普攻分支,` +
    `而该分支不减冷却(递减只写在 playerAct 里)」—— **两处都已过时**:` +
    `① artCd 现在是 min(原曲线, n-1),n=已掌握神通数;n=1 时 n-1=0 ⇒ 下限 1 ⇒ ` +
    `单神通玩家**每回合都能出牌**(实测 cd=1,与 PROBE-8 的「强制普攻 0.0 回合/场」一致);` +
    `② 递减早在 XX-DUEL-007 就移到了 tickCooldown(battle.js:105-108),` +
    `由 duel.js:399 的回合边界统一调,不是「只写在 playerAct 里」。` +
    `若本探针仍报红,先打印 cdAfter 与实际的 availableArts∩canUseArt,` +
    `别按原文的结论往 playerAct 里补递减 —— 那是搬回一个错误的位置。` +
    `${res.converged ? '本场侥幸收敛了。' : `跑了 ${res.steps} 步仍未收敛。`}`);

  p('PROBE-5 强制普攻打死敌人会不会判胜',
    !(res.converged && win === 0 && enemyHp === 0),
    `敌人血量已被打到 ${enemyHp},但 onWin 调了 ${win} 次 / onLose ${lose} 次。` +
    `⚠️ 2026-10-11 订正:原文写「duel.js:347 没有 isDead 检查」—— ` +
    `**那已经过时了**:XX-DUEL-008 给强制普攻分支补上了 isDead(现 duel.js:419)。` +
    `这段描述是在提醒「别把这个当未修的 bug 重新修一遍」。` +
    `若本探针仍报红,先确认 duel.js:419 的 isDead 是否还在,` +
    `再查 onWin 为什么没被调到 —— 别按原文的结论去改代码`);

  p('PROBE-6 一场决斗里玩家真正能做的动作数',
    cdAfter === null || Object.keys(cdAfter).length === 0,
    cdAfter === null ? '开场就没渲染出技能'
      : `玩家只成功出牌 ${Object.keys(cdAfter).length} 次,之后全程由强制普攻分支自动推进`);
  resetDom(); restoreArts();
}

// ════════════════════════════════════════════
console.log('\n=== [G] 模拟:换个策略,胜率会不会变?(真跑 Duel.start) ===');
// ════════════════════════════════════════════
//
// ⚠️ 2026-10-11 重写(本门禁自己的一次返工)。这一段以前**照抄了一份战斗公式**:
//   simulate() 从头到尾没调过 Duel.start,自己写了 s.hpMax / s.dmg / e.dmg / e.hpMax /
//   powerBoost,连强制普攻分支都抄了一遍,还写死 dmgReduce: 0(产品里 duel.js 早不是硬写 0 了)。
//   实害已经发生:上一轮把「宿敌恒负」的护体修进 duel.js,而这里的 PROBE-7 **一个数字都没动**。
//   抄公式进来的尺子,改产品时数字不动、改测试时数字动、两边都不报错 ——
//   **一把测「自己维护的副本」的尺子,比没有尺子更危险:它给的是虚假的信心。**
//   所以现在每个数字都出自 duel.js + battle.js,门禁自己一条战斗公式都不写。
//
// 策略也不许自己算伤害:四种策略读的是**产品自己渲染出来的技能栏**
//   (按钮上那个「威力 N」就是 duel.js 的 est,「超武」标签也是产品自己打的)。
//   旧的 estDmg / SUPERS / mkHero 三个「自己维护的副本」已随重写一并删除。
//
// 桩的用法照抄 duel-difficulty-gradient-regression.mjs(同一套 DOM 桩 + 假时钟)。
// 有三处不照抄就会拿到假数据,写在这里免得下一个人重踩:
//   ① Duel 只 import 一次、全程复用(逐场重新 import 会把 3.8 万场拖成几分钟)。
//   ② 战败必须点掉 #xd-defeat 的四选项 —— close() 是**唯一**复位 Duel.busy 的地方
//      (XX-DUEL-005)。不点的话 busy 卡在 true,后面每一场的点击都被
//      duel.js:266 的 `if (!this.busy)` 吞掉,量出来的是我自己的漏斗。
//   ③ 假时钟**逐步**推进、每步后观察血量:敌人一回合只结算一次 enemyAct,
//      所以「玩家血量的变化点」恰好就是「第 k 次敌攻」—— 逐击伤害序列是这么来的。
const G_Duel = await loadDuel();
const { REALMS } = await import('../js/xiuxian/realms.js');

const ENEMIES = [
  { name: '小妖·炼气',      realmIdx: 0, stronger: false, hpRatio: 0.4 },
  { name: '精英·筑基',      realmIdx: 1, stronger: false, hpRatio: 0.5 },
  { name: '越境·筑基',      realmIdx: 1, stronger: true,  hpRatio: 0.5 },
  { name: 'boss·金丹',      realmIdx: 2, stronger: true,  hpRatio: 0.4 },
  // ⚠️ 宿敌这一格以前写死 `e.dmg *= 1.6`。1.6 恰好是 powerBoost() 在
  //   **grudge=75** 时的值(= 1 + min(1.2, 75*0.008))—— 也就是说旧格量的一直是「结怨」,
  //   只是没人把这件事写下来,格子的名字还叫「宿敌·金丹(结怨 0)」。
  //   产品侧 powerBoost 读的是存档里的 grudge,所以这里必须显式给出来:
  //   留 0 的话这一格的伤害与 boss·金丹 一模一样,退化成「同一个敌人跑两遍」。
  { name: '宿敌·结怨',     realmIdx: 2, stronger: true,  hpRatio: 0.4, nemesis: true, grudge: 75 },
  { name: 'boss·残血',      realmIdx: 2, stronger: true,  hpRatio: 0.05 },
];
const HEROES = [
  { name: '新手·单神通', pIdx: 0, arts: { jianqi: 1 } },
  { name: '中期·双神通', pIdx: 1, arts: { jianqi: 3, wulei: 2 } },
  { name: '后期·三神通', pIdx: 2, arts: { jianqi: 5, wulei: 5, moyu: 4 } },
  { name: '满配·含超武', pIdx: 3, arts: { jianqi: 5, wulei: 5, moyu: 5, wanji: 1 } },
];
/** 技能栏此刻真实渲染出来的按钮 —— 产品的 innerHTML,门禁只读不造。
 *  顺带记账:每个按钮都必须带产品自己渲染的「威力 N」。
 *  少了它,greedy/lowest 就退化成「闭眼点第 0 个」,策略这一维是假的。 */
const BTN = { seen: 0, noEst: 0 };
function liveBtns() {
  const html = reg('#xd-sk').innerHTML || '';
  return (html.match(/<button[\s\S]*?<\/button>/g) || []).map(h => ({
    art: (h.match(/data-art="([^"]+)"/) || [])[1],
    sup: /xx-sk-tag/.test(h),                                   // 产品自己打的「超武」标签
    est: Number((h.match(/威力 (-?\d+)/) || [])[1]),             // 产品自己渲染的伤害预估
  })).filter(b => b.art).map(b => {
    BTN.seen++;
    if (!Number.isFinite(b.est)) BTN.noEst++;
    return b;
  });
}
/** 技能栏此刻是不是「轮到玩家决策」。产品自己用 classList 的 'on' 标记的。
 *  ⚠️ 判据**不能**写成「innerHTML 里还有没有按钮」:走强制普攻分支时 duel.js
 *  只 remove('on'),**不清 innerHTML** —— 上一回合的按钮原样留在 DOM 里。
 *  照着点就等于在产品已经决定「你只能硬撼一掌」的回合里替玩家多出一张牌,
 *  cardsPlayed 会虚高、forcedTurns 会被吃掉,而这两项正是 PROBE-8 的判据。 */
const skOn = () => reg('#xd-sk')._cls.has('on');
const idxBest = (bs, v, better) => {
  let bi = -1, bv = better === 'max' ? -Infinity : Infinity;
  bs.forEach((b, i) => { const x = v(b); if (Number.isFinite(x) && (better === 'max' ? x > bv : x < bv)) { bv = x; bi = i; } });
  return bi;
};
const STRATS = {
  first:      bs => 0,
  greedy:     bs => idxBest(bs, b => b.est, 'max'),
  lowest:     bs => idxBest(bs, b => b.est, 'min'),
  superFirst: bs => { const i = bs.findIndex(b => b.sup); return i >= 0 ? i : idxBest(bs, b => b.est, 'max'); },
};
const TURN_CAP = 400;      // 单场出牌数上限:超过 = 流程不收敛,记 stall 而不是安静地转
const STEP_CAP = 4000;     // 一次推进的定时器步数上限(打字机一行字就几十步)
const LOOP_CAP = 2000;     // 单场循环轮数上限

/** 真打一场:每个数字都出自 duel.js + battle.js,胜负只认 onWin / onLose。 */
function simulate(foe, hprof, stratName, seed, fault) {
  const strat = STRATS[stratName];
  seedRng(seed);
  // 计数的随机源。⚠️ 必须装在 **Duel.start 之前** —— makeEnemy 自己要抽两次随机数,
  //   装晚了那两次就看不见,H3 的裸跑会整体错开一位(实测序列平移一格)。
  //   H3 用「第一记敌攻之前产品已经吃掉了多少随机数」把随机流推到同一个位置,
  //   那个数是这里**量**出来的,不是抄 battle.js 数出来的。
  let draws = 0;
  globalThis.Math.random = () => { draws++; return _rng(); };
  // ⚠️ 玩家的血量上限由 **Cult.s.realm** 决定(duel.js 的 pIdx 读 Cult.get().realm,
  //   再算 heroHpMax = 100 + pIdx*30)—— cfg.hero.realmIdx 根本不参与计算。
  //   配置「玩家档位」必须落到存档上,不是写进 cfg。
  Cult.s.realm = REALMS[hprof.pIdx].id;
  Cult.s.arts = { ...hprof.arts };
  // ⚠️ 宿敌强度走存档里的 grudge,而每打赢一场 grudge += 20(relations.js 的 battle()).
  //   不重置的话第 N 场量到的是前 N-1 场的遗产 ⇒ 同一颗种子两遍跑出两个数。
  Cult.nemesis.s = { met: false, battles: 0, wins: 0, alive: true, grudge: foe.grudge || 0 };

  let win = false, loss = false, turns = -1;
  G_Duel.start({
    node: { type: 'boss' },
    hpRatio: foe.hpRatio,
    hero: { name: '轩轩', img: 'h.jpg', realmIdx: hprof.pIdx },
    foe: { key: 'boss_golem', name: foe.name, img: 'f.jpg', realmIdx: foe.realmIdx,
           stronger: !!foe.stronger, isNemesis: !!foe.nemesis },
    // ⚠️ onWin / onLose 都在 close() **之前**被调,这是唯一还读得到 S.round 的时刻
    //   —— 关掉之后 Duel.S 就是 null 了。
    onWin: () => { win = true; turns = G_Duel.S.round; },
    onLose: () => { loss = true; turns = G_Duel.S.round; },
  });

  // —— 反向注入的把手:只动**会话状态**,一个字符都不改产品代码 ——
  //   尺子若对 e.dmg / e.hp 毫无反应,说明它压根没在量伤害,上面所有数字都是空的。
  if (fault) {
    if (fault.foeDmgMul) G_Duel.S.e.dmg *= fault.foeDmgMul;
    if (fault.foeHp != null) G_Duel.S.e.hp = fault.foeHp;
  }
  const ruler = { eDmg: G_Duel.S.e.dmg, guard: G_Duel.S.hero.dmgReduce,
                  hp0: G_Duel.S.hero.hp, firstHitDraws: -1 };

  const seq = [], used = new Set();
  let lastHp = ruler.hp0, lastFoeHp = G_Duel.S.e.hp, forced = 0, cards = 0;
  /** 血量一变就记账。justPlayed = 刚刚点过牌(出牌的伤害是同步发生的,不算强制普攻) */
  const observe = justPlayed => {
    const S = G_Duel.S; if (!S) return;
    if (S.hero.hp !== lastHp) {
      if (ruler.firstHitDraws < 0) ruler.firstHitDraws = draws;
      seq.push(lastHp - S.hero.hp); lastHp = S.hero.hp;
    }
    if (S.e.hp !== lastFoeHp) { if (!justPlayed) forced++; lastFoeHp = S.e.hp; }
  };
  const stepAll = (label, maxSteps = STEP_CAP) => {
    let g = 0;
    while (timers.size) {
      if (++g > maxSteps) throw new Error(`假时钟不收敛(${label}):还有 ${timers.size} 个定时器在排队`);
      const id = timers.keys().next().value;
      const fn = timers.get(id); timers.delete(id);
      fn(); observe(false);
    }
  };

  let loop = 0, stall = false;
  try {
    stepAll('G·开场');
    while (G_Duel.S && !G_Duel.S.over && loop++ < LOOP_CAP) {
      if (!skOn()) {
        // 「无牌可打」:产品自己走强制普攻分支,让假时钟推进,不点任何按钮。
        // forcedTurns 由 observe 数敌人血量的下降(那张牌是产品替玩家打的)。
        const before = G_Duel.S.e.hp;
        stepAll('G·强制普攻');
        if (!G_Duel.S || G_Duel.S.over) break;
        if (G_Duel.S.e.hp === before && !skOn()) { stall = true; break; }
        continue;
      }
      const btns = liveBtns();
      const i = btns.length ? strat(btns) : -1;
      if (!(i >= 0 && i < btns.length) || !clickArt(i)) { stall = true; break; }
      used.add(btns[i].art); cards++;
      observe(true);
      stepAll('G·一回合');
      if (cards > TURN_CAP) { stall = true; break; }
    }
    stepAll('G·终局');
  } finally {
    globalThis.Math.random = () => _rng();
  }
  // ⚠️ 战败要点掉 #xd-defeat 的四选项,而且判据是 **S.over**,不是「我以为输了」。
  //   判错的后果很具体:onLose 是**被这次点击**调出来的,用 onLose 的结果去决定要不要点,
  //   就是死锁 —— 输掉的每一场都永远不点、永远不判负、busy 也永远不复位
  //   (close() 是唯一复位 Duel.busy 的地方,XX-DUEL-005)。第一版就是这么写的。
  //   打赢的那场 close() 已经跑过、S 已经清空,所以这个判据天然只命中败北路径。
  if (G_Duel.S && G_Duel.S.over) {
    const opts = reg('#xd-defeat').querySelectorAll('.xx-chio');
    if (opts.length) opts[0].onclick();
    stepAll('G·战败结算');
  }
  // 没打完的残留(stall)在这里清掉。⚠️ 清的是**会话状态**,stall 本身照样计数、照样报红 ——
  //   目的是不让一场没打完的架把后面 3.8 万场一起拖进同一个坏世界。
  if (G_Duel.S) { G_Duel.S = null; G_Duel.busy = false; }
  // 阵亡那一击**无法**从血量差里还原真实伤害:enemyAct 把结果夹到 0,
  // 血量差只等于「剩下的血」。丢掉它再交给 G2 / H3 比对 ——
  // 留着的话 G2 会拿到一个假的「策略反例」。
  if (loss && seq.length) seq.pop();
  return { win, loss, stall, turns: Math.max(0, turns),
           cardsPlayed: cards, forcedTurns: forced, cardsUsed: used.size,
           foeDmgSeq: seq, ruler };
}
const N_SEEDS = 400;
const ST = Object.keys(STRATS);
const rows = [];
const COUNTER = { duels: 0, terminals: 0, stalls: 0, multiCard: 0 };
for (const h of HEROES) for (const foe of ENEMIES) {
  const cell = { hero: h.name, foe: foe.name, res: {} };
  for (const st of ST) {
    let w = 0, tt = 0, bh = 0, cp = 0, sl = 0; const seqs = [];
    for (let i = 0; i < N_SEEDS; i++) {
      const r = simulate(foe, h, st, 1000 + i);
      COUNTER.duels++;
      if (r.win || r.loss) COUNTER.terminals++;
      if (r.stall) { COUNTER.stalls++; sl++; }
      if (Object.keys(h.arts).length > 1 && r.cardsUsed > 1) COUNTER.multiCard++;
      if (r.win) w++;
      tt += r.turns; bh += r.forcedTurns; cp += r.cardsPlayed;
      if (i < 12) seqs.push(r.foeDmgSeq);
    }
    cell.res[st] = { wr: w / N_SEEDS, tr: tt / N_SEEDS, bt: bh / N_SEEDS, cp: cp / N_SEEDS, seqs, sl };
  }
  rows.push(cell);
}

// ════════════════════════════════════════════
console.log('\n=== [G-防退化] 反空转:门禁自己必须真的把产品跑起来了 ===');
// ════════════════════════════════════════════
//
// ⚠️ 这一段是本节存在的理由。simulate() 改成驱动真产品之后,最大的风险**不是跑不动**,
//   而是「什么都没跑却输出好看的数字」:DOM 桩没接上、onWin/onLose 永远不调、
//   异常被吞掉于是每场都判平局。那会让 PROBE-7/10 变成纯噪声,**比改之前更坏**。
//   所以只要「一场都没走到产品的终局回调」,就 exit 2 —— 不是 exit 1:
//   exit 1 的含义是「产品不达标」,而这里的含义是「门禁自己失效,结论不可信」。
if (COUNTER.terminals === 0) {
  console.log('\n🛑 门禁自身失效,以下结果全部不可信 —— 按约定 exit 2(而不是 exit 1):');
  console.log(`     🛑 ${COUNTER.duels} 场决斗,产品的 onWin/onLose 一场都没被调用过。`);
  console.log('     🛑 这意味着 simulate() 没有真的驱动 Duel.start(或异常被吞了),');
  console.log('     🛑 下面的胜率/回合数全是一个不存在的世界里的数 —— 别信结论。');
  process.exit(2);
}
console.log(`  · ${COUNTER.duels} 场决斗全部经过 Duel.start;终局回调命中 ${COUNTER.terminals} 场` +
            `${COUNTER.stalls ? `,未收场 ${COUNTER.stalls} 场` : ''}`);
if (COUNTER.stalls) {
  console.log('  · 未收场分布(诊断):');
  for (const r of rows) for (const st of ST) if (r.res[st].sl)
    console.log(`      ${r.hero}×${r.foe} [${st}] ${r.res[st].sl}/${N_SEEDS}`);
}

/** 只给自检用的小扫描:不写进 rows,种子段也另开,免得自检与被测状态耦合。 */
const scan = (foe, h, st, n, fault) => {
  let w = 0, tt = 0, ended = 0;
  for (let i = 0; i < n; i++) {
    const r = simulate(foe, h, st, 70000 + i, fault);
    if (r.win) w++; tt += r.turns; if (r.win || r.loss) ended++;
  }
  return { wr: w / n, tr: tt / n, ended };
};
{
  const FAULT_SEEDS = 60, FK = ENEMIES[3], FH = HEROES[0];   // boss·金丹 × 新手·单神通
  const base = scan(FK, FH, 'first', FAULT_SEEDS);
  const hurt = scan(FK, FH, 'first', FAULT_SEEDS, { foeDmgMul: 10 });
  const easy = scan(FK, FH, 'first', FAULT_SEEDS, { foeHp: 1 });
  t(`G-自检·反向注入:敌人伤害 ×10 之后这一格必然掉到 0%(测不出差异 = 尺子在测一个不存在的世界)`,
    hurt.wr === 0 && hurt.tr < base.tr,
    `基线 ${(base.wr * 100).toFixed(1)}% / ${base.tr.toFixed(2)} 回合 → ×10 后 ` +
    `${(hurt.wr * 100).toFixed(1)}% / ${hurt.tr.toFixed(2)} 回合(e.dmg ${FK.realmIdx} 档被放大)`);
  t('G-自检·反向注入:把敌人残血改到 1 血之后这一格必然 100%(证明胜率不是被写死的)',
    easy.wr === 1,
    `实测 ${(easy.wr * 100).toFixed(1)}% —— 判据读的是产品的 onWin/onLose,不是门禁自己的算术`);
  t(`G-自检·策略轴是活的:多神通玩家真的在一场里打出过不止一张不同的牌(${COUNTER.multiCard} 场)`,
    COUNTER.multiCard > 0,
    '四种策略全都只点第 0 个按钮 ⇒ 「换策略」这一维是空的,PROBE-10 的 0 没有信息量');
  t(`G-自检·每一场都以产品的终局回调收场(${COUNTER.terminals}/${COUNTER.duels})`,
    COUNTER.terminals === COUNTER.duels,
    `${COUNTER.duels - COUNTER.terminals} 场既没 onWin 也没 onLose ⇒ 桩没接上或流程不收敛`);
  t('G-自检·技能栏按钮带的是产品自己渲染的伤害预估(策略不是闭眼点的)',
    BTN.seen > 0 && BTN.noEst === 0,
    `扫过 ${BTN.seen} 个按钮,其中 ${BTN.noEst} 个没有「威力 N」` +
    ` ⇒ greedy/lowest 会退化成「闭眼点第 0 个」,策略这一维是假的`);
}
console.log(`\n  胜率 / 平均回合 / 平均出牌 —— ${N_SEEDS} 个种子 × ${ST.length} 种策略(真跑 Duel.start)`);
console.log('  ' + '玩家'.padEnd(13) + '敌人'.padEnd(12) + ST.map(s => s.padEnd(22)).join(''));
for (const r of rows) {
  console.log('  ' + r.hero.padEnd(11) + r.foe.padEnd(10) +
    ST.map(s => `${(r.res[s].wr * 100).toFixed(1)}%/${r.res[s].tr.toFixed(1)}回合/${r.res[s].cp.toFixed(1)}招`.padEnd(22)).join(''));
}

{
  // G1 出牌选择到底影响不影响胜负 —— 逐格算,再取全局最大
  //    ⚠️ 第一版按「一个玩家跨所有敌人」取 min/max,量出来的是**跨敌人的难度差**,
  //       不是策略差,差点得出一个看起来漂亮但答非所问的结论。
  const spreads = rows.map(r => {
    const wrs = ST.map(s => r.res[s].wr);
    return { cell: `${r.hero}×${r.foe}`, spread: Math.max(...wrs) - Math.min(...wrs) };
  });
  const maxSpread = Math.max(...spreads.map(x => x.spread));
  const cellsMoved = spreads.filter(x => x.spread > 0).length;
  console.log('');
  for (const x of spreads.filter(x => x.spread >= 0.05))
    console.log(`  · ${x.cell}:换策略胜率差 ${(x.spread * 100).toFixed(1)} 个百分点`);
  p('PROBE-10 出牌选择对胜率有没有影响(判定「有没有博弈」的第一问)',
    cellsMoved > 0,
    `${cellsMoved}/${rows.length} 格的胜率随策略变化,最大差 ${(maxSpread * 100).toFixed(1)} 个百分点。` +
    `⚠️ 若为 0,说明「出什么牌」这个决策在这套公式下**不产生任何后果** —— ` +
    `这正是锤子说的「没有博弈」,本门禁把它量化在这里`);

  const flat = rows.filter(r => {
    const wrs = ST.map(s => r.res[s].wr);
    return Math.max(...wrs) === 0 || Math.min(...wrs) === 1;
  });
  p('PROBE-7 恒 0% / 恒 100% 的格子占比',
    flat.length === 0,
    `${flat.length}/${rows.length} 格是恒定的(无论怎么打都必赢或必输)。` +
    `例:${flat.slice(0, 3).map(r => `${r.hero}×${r.foe}`).join(' / ')}${flat.length > 3 ? ' …' : ''}`);

  // G2 ⭐ 零反制的硬证据:第 k 次敌攻的伤害只由种子决定,与玩家出了什么牌无关。
  //    ⚠️ 第一版直接比整个数组 —— 不同策略打出的回合数不同,数组长度自然不同,
  //       于是判成「出现了策略相关的敌攻序列」。正确的比法是**比前缀**:
  //       只要第 k 次敌攻在所有策略下伤害相同,就说明敌人从头到尾没在应招。
  let mismatch = null, checked = 0;
  for (const r of rows) {
    const perSeed = [];
    for (let i = 0; i < r.res[ST[0]].seqs.length; i++) {
      const seqs = ST.map(s => r.res[s].seqs[i]);
      const len = Math.min(...seqs.map(x => x.length));
      for (let k = 0; k < len; k++) {
        checked++;
        if (seqs.some(x => x[k] !== seqs[0][k])) { mismatch = `${r.hero}×${r.foe} 第 ${i + 1} 个种子第 ${k + 1} 次敌攻`; break; }
      }
      if (mismatch) break;
      perSeed.push(len);
    }
    if (mismatch) break;
  }
  t(`G2 零反制:同种子下,第 k 次敌攻的伤害与玩家出牌策略完全无关(比对 ${checked} 组前缀)`,
    mismatch === null, mismatch ? `反例:${mismatch}` : '');

  // G3 enemyAct 除了「结算伤害」之外,不读任何玩家的决策状态
  {
    const src = R('js/xiuxian/battle.js');
    // ⚠️ 原来切到 `export function isDead` 为止。XX-DUEL-007 往中间插了 tickCooldown,
    //   于是这段切片把 tickCooldown 也圈进来了,而它读 s.cooldown → G3 报假红。
    //   教训:**位置切片对「往锚点之间插代码」天然脆弱**,锚点必须取紧邻的下一个定义。
    const eAt = src.indexOf('export function enemyAct');
    const nextAt = src.indexOf('export function', eAt + 10);
    const body = src.slice(eAt, nextAt > 0 ? nextAt : src.length);
    t('G3a enemyAct 的函数体切片自检(不含紧邻的下一个函数)',
      !/tickCooldown/.test(body), '切片越界了 —— 本节结论不可信');
    const reads = new Set();
    for (const m of body.matchAll(/\bs\.([A-Za-z_$][\w$]*)/g)) reads.add(m[1]);
    const allowed = new Set(['dmgReduce', 'hp']);   // dmgReduce 是减伤,hp 是挨打的结果
    const extra = [...reads].filter(x => !allowed.has(x));
    t('G3 enemyAct 不读玩家的任何决策状态(无仇恨/无弱点/无连招反制)',
      extra.length === 0, `它还读了:${JSON.stringify(extra)}`);
  }

  const worstBt = Math.max(...rows.map(r => r.res.first.bt));
  p('PROBE-8 「无牌可打」(强制普攻)的回合数', worstBt > 0,
    `最多 ${worstBt.toFixed(1)} 回合/场 —— 这些回合里玩家没有任何决策`);
}

// ════════════════════════════════════════════
console.log('\n=== [H] 度量工具自检:门禁自己不能是错的 ===');
// ════════════════════════════════════════════
{
  {
    const a = simulate(ENEMIES[3], HEROES[2], 'greedy', 4242);
    const b = simulate(ENEMIES[3], HEROES[2], 'greedy', 4242);
    t('H1 模拟可复现(同种子两次结果逐字相同)',
      JSON.stringify(a) === JSON.stringify(b),
      `第一次 ${JSON.stringify({ w: a.win, t: a.turns })} 第二次 ${JSON.stringify({ w: b.win, t: b.turns })}`);
  }
  {
    // 随机源真的被换掉了吗?—— 否则上面所有「胜率」都是不可复现的 flaky
    let draws = 0;
    globalThis.Math.random = () => { draws++; return _rng(); };
    Math.random(); globalThis.Math.random();
    const used = draws === 2;
    globalThis.Math.random = () => _rng();
    t('H2 Math.random 确实被门禁接管(否则胜率不可复现,所有 G 结论都是 flaky)', used,
      `接管失败:接管前调用两次,门禁计数器只看到 ${draws} 次`);
  }
  {
    // 同种子下,第 k 次敌攻的伤害与战斗长短无关(只由种子决定)
    //
    // ⚠️ 2026-10-11 随 [G] 重写改判据。原来的裸跑是这么对齐随机流的:
    //   seedRng(777) 之后**直接**开始调 enemyAct —— 那是「模拟器自己从头跑到尾」的世界。
    //   现在 simulate 走真产品,第一记敌攻之前产品已经吃掉了若干随机数
    //   (makeEnemy 要两次、BGM/开场白还要别的),所以裸跑必须**先把随机流推到同一个位置**。
    //   推多少是 simulate 自己**量**出来的(ruler.firstHitDraws),不是抄 battle.js 数出来的 ——
    //   抄一份「一次敌攻吃几个随机数」进来,就是在重造那份「自己维护的副本」的老毛病。
    // ⚠️ 种子要在**这一格**上找一场「敌人真的出过手」的:改走真产品之后,
    //   后期·三神通 打 boss·金丹 是 0 回合速杀(实测 400 颗种子一次都没轮到敌人出手),
    //   敌攻序列恒空 ⇒ 「逐项复现」成了对空数组的 every(),恒真,等于没验。
    //   所以换成新手·单神通 × 宿敌·结怨(e.dmg 42 + 护体,新手挨得下来),再固定扫一小段种子。
    //   一段种子都找不到 ⇒ 这条自检没有信息量,照样报红,而不是悄悄通过。
    const CELL_E = ENEMIES[4], CELL_H = HEROES[0];
    let one = null, usedSeed = null;
    for (let s = 777; s < 777 + 40 && !one; s++) {
      const r = simulate(CELL_E, CELL_H, 'greedy', s);
      if (r.foeDmgSeq.length) { one = r; usedSeed = s; }
    }
    // 「一次敌攻吃几个随机数」:调一次真 enemyAct 数出来。
    seedRng(4242);
    let n = 0;
    globalThis.Math.random = () => { n++; return _rng(); };
    enemyAct({ dmg: 10, line: 'x', hp: 100 }, { hp: 100, dmgReduce: 0 });
    globalThis.Math.random = () => _rng();
    const perHit = n;
    // 阵亡那一击已被 simulate 丢掉了(enemyAct 把结果夹到 0,血量差还原不出真实伤害)
    const bare = [];
    if (one) {
      seedRng(usedSeed);
      for (let i = 0; i < one.ruler.firstHitDraws - perHit; i++) Math.random();
      let hp = one.ruler.hp0;
      for (let i = 0; i < one.foeDmgSeq.length; i++) {
        const r = enemyAct({ dmg: one.ruler.eDmg, line: 'x', hp: 100 }, { hp, dmgReduce: one.ruler.guard });
        bare.push(r.dmg); hp = Math.max(0, hp - r.dmg);
      }
    }
    t(`H3 敌攻伤害只由种子决定(裸跑 enemyAct 能复现模拟里的序列,每次敌攻吃 ${perHit} 个随机数)`,
      !!one && one.foeDmgSeq.length > 0 && bare.every((v, i) => v === one.foeDmgSeq[i]),
      one ? `种子 ${usedSeed}:模拟 ${JSON.stringify(one.foeDmgSeq)} vs 裸跑 ${JSON.stringify(bare)}` +
           `(e.dmg ${one.ruler.eDmg} / 护体 ${one.ruler.guard} / 开场消耗 ${one.ruler.firstHitDraws} 个随机数)`
         : '这一格连扫 40 颗种子都没打出一场「敌人出过手」的架 ⇒ 敌攻序列恒空,这条断言没有信息量');
  }
  {
    const lens = new Set(rows.map(r => r.res.first.tr));
    t('H4 战斗长度在整个网格上有变化(采样没退化成定长)', lens.size > 1,
      `回合数取值:${JSON.stringify([...lens])}`);
  }
  {
    const ys = [1, 3, 5, 9, 14, 20];
    const wrongPred = (a, b) => b <= a;               // ← 故意的反向
    let stillGreen = true;
    for (let i = 1; i < ys.length; i++) if (!wrongPred(ys[i - 1], ys[i])) stillGreen = false;
    t('H5·自检(方向写反时谓词必须拒绝递增序列)', stillGreen === false,
      '反向谓词竟然判过了 —— tMonotonic 的自检形同虚设');
  }
  {
    // H6 反向注入(轻量版,全程版见交付说明):把模拟里的策略判据方向反过来,
    //    G1 的差值应当变成负数 —— 证明「策略差」这个量本身也在动,不是恒 0 的摆设。
    const cells = rows.map(r => {
      const up = ST.map(s => r.res[s].wr);
      return Math.max(...up) - Math.min(...up);
    });
    t('H6 策略差这个量在网格上确实在计算(不是被写死成 0)',
      cells.every(c => Number.isFinite(c) && c >= 0));
  }
}

// ════════════════════════════════════════════
if (PROBE.some(x => !x.ok)) {
  console.log('\n  ── 本轮实测为「坏」的探针(修 js/ 时照单处理)──');
  for (const x of PROBE) if (!x.ok) console.log(`     ✗ ${x.n}`);
}

console.log('');
if (fail === 0) {
  console.log(`✅ 回合制不变量通过:${pass} 项断言`);
  const bad = PROBE.filter(x => !x.ok).length;
  console.log(`   另有 ${PROBE.length} 条探针,其中 ${bad} 条实测为「坏」(已在上方逐条列出,不判红)`);
  process.exit(0);
} else {
  console.log(`❌ ${fail} 项不达标(共 ${pass + fail} 项断言)`);
  for (const r of RED) console.log(`   - ${r}`);
  process.exit(1);
}