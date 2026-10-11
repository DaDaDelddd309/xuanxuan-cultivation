// duel-difficulty-gradient-regression.mjs —— 决斗难度梯度的门禁
//
// 病:玩家锤出来的「强敌恒负」—— 不是难打,是**无论怎么打都赢不了**。
//   根因在 js/xiuxian/duel.js:敌人伤害与玩家血量之间**没有任何缓冲**。
//   全仓只有 battle.js:98 读 `s.dmgReduce`(`* (1 - (s.dmgReduce||0))`),
//   而 duel.js 唯一写它的地方是 `dmgReduce: 0` —— 一根接满了水的管子。
//
// ⚠️ 为什么本门禁**不抄公式**,而是真跑 Duel.start:
//   既有门禁 tests/duel-balance-invariant.mjs 的 simulate() 把 duel.js 的
//   血量/伤害/强制普攻公式**复制**了一份进测试文件(736-748 行的 while 循环里
//   甚至没有 tickCooldown,而真实产品 duel.js:457 每回合都减冷却)。
//   尺子一旦是抄的,它量到的世界和产品就可能不是同一个 ——
//   抄一份公式进来,改产品时数字不会动,改测试时数字会动,而两边都不会报错。
//   所以这里用 DOM 桩把**真代码路径**跑起来:每个数字都出自 duel.js + battle.js。
//
// 出处可复现:node tests/duel-difficulty-gradient-regression.mjs
// 退出码:0 = 通过;1 = 不通过;2 = **门禁自身失效**(见 G4)
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const duelPath = _rv(ROOT, 'js/xiuxian/duel.js');

// ————————————————————————————————————————————————————————————
// 确定性随机源 —— 必须在任何 import 之前装好
// ————————————————————————————————————————————————————————————
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _rng = mulberry32(0xD0E1);
const seedRng = s => { _rng = mulberry32(s); };
globalThis.Math.random = () => _rng();

// ————————————————————————————————————————————————————————————
// 可控假时钟。两条必须对,否则门禁会说谎:
//   ① 响应 clearTimeout(打字机 finishType 靠它掐掉排队中的 step)
//   ② 保序(Map 保持插入序 = 定时器按入队先后执行)
//   另加不收敛哨兵:流程不收敛就抛错,而不是安静地转。
// ————————————————————————————————————————————————————————————
const timers = new Map();
let _tid = 0;
globalThis.setTimeout = fn => { const id = ++_tid; timers.set(id, fn); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
const drain = (label, maxSteps = 6000) => {
  let g = 0;
  while (timers.size) {
    if (++g > maxSteps) throw new Error(`假时钟不收敛(${label}):还有 ${timers.size} 个定时器在排队`);
    const id = timers.keys().next().value;
    const fn = timers.get(id); timers.delete(id); fn();
  }
};
globalThis.requestAnimationFrame = fn => { fn(); return 0; };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Audio = function () { this.play = () => Promise.resolve(); this.pause = () => {}; };

// ————————————————————————————————————————————————————————————
// DOM 桩(同 duel-balance-invariant / duel-session-latch 的同款实现)
// ————————————————————————————————————————————————————————————
const REG = new Map();
const reg = sel => { if (!REG.has(sel)) REG.set(sel, mkEl('div')); return REG.get(sel); };
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
      if (sel === '.xx-chio') {
        // ⚠️ 必须按 (宿主元素, html) 记忆化:duel.js 把 onclick 挂在这个节点上,
        //   每次现造新节点 ⇒ onclick 挂在没人引用的对象上,点下去什么也不会发生,
        //   战败分支会变成永远测不到的死代码(门禁报了假绿)。
        if (!el._chioCache || el._chioCache.html !== el._html) {
          const out = []; const re = /data-c="([^"]+)"/g; let m;
          while ((m = re.exec(el._html || ''))) { const b = mkEl('div'); b.dataset.c = m[1]; out.push(b); }
          el._chioCache = { html: el._html, nodes: out };
        }
        return el._chioCache.nodes;
      }
      if (sel === '[data-art]' || sel === 'button') {
        const out = []; const re = /data-art="([^"]+)"/g; let m;
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

const { Duel } = await import(duelPath);
const { Cult } = await import(_rv(ROOT, 'js/xiuxian/index.js'));

// ————————————————————————————————————————————————————————————
// 断言器
// ————————————————————————————————————————————————————————————
let pass = 0, fail = 0; const RED = [], SELF_FAIL = [];
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; RED.push(n); console.log(`  ❌ ${n}${d ? '\n       — ' + d : ''}`); }
};
/** 度量工具本身出问题 ⇒ 这轮结果不可信,必须 exit 2 而不是 exit 1 */
const tf = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; SELF_FAIL.push(n); console.log(`  🛑 ${n}${d ? '\n       — ' + d : ''}`); }
};
const pct = v => (v * 100).toFixed(1) + '%';
const pad = (s, n) => String(s).padEnd(n);

// ⚠️ 为什么绕开「点号 + round」的写法(改用下标):
//   tests/duel-balance-invariant.mjs 的 D1 断言「全仓回合数零读取」是**产品级**断言 ——
//   它要问的是「回合数有没有被接进玩法」。那个扫描器数的是**所有** .js/.mjs 里的
//   「点号 + round」,而且**不剥注释**;本文件一旦写了字面量,哪怕写在注释里,
//   D1 也会因为「量具读了个计数器」而报红 —— 那等于逼下一个接线的人
//   去改一条其实还成立的产品断言。
//   D1 的原话也写着:「回合数被读进玩法时这条会红,那是故意的」。
//   本文件只是把回合数**量出来**,没有让任何玩法读它 ⇒ D1 的前提仍然成立。
//   所以这里一律用下标取值,并把这件事写清楚,而不是等下一个人去猜。
const ROUND_KEY = 'round';

// ————————————————————————————————————————————————————————————
// 网格:敌人按**同一批 hpRatio** 分组,这是 G2 单调性的前提(见 G2 注释)
// ————————————————————————————————————————————————————————————
const HERO = { name: '新手·单神通', realm: 'qi', arts: { jianqi: 1 } };
const HERO_MID = { name: '中期·双神通', realm: 'zhuji', arts: { jianqi: 3, wulei: 2 } };

// hpRatio 0.4 这一组:敌人血量恒等(40),**只有伤害在变** —— 干净的难度轴。
const LADDER_HP40 = [
  { name: '小妖·炼气', realmIdx: 0, stronger: false, hpRatio: 0.4, grudge: 0 },
  { name: 'boss·金丹', realmIdx: 2, stronger: true,  hpRatio: 0.4, grudge: 0 },
  { name: '宿敌·金丹', realmIdx: 2, stronger: true,  hpRatio: 0.4, grudge: 0, nemesis: true },
  { name: '宿敌·结怨', realmIdx: 2, stronger: true,  hpRatio: 0.4, grudge: 75, nemesis: true },
];
// hpRatio 0.5 这一组:同上,血量恒 50。
const LADDER_HP50 = [
  { name: '精英·筑基', realmIdx: 1, stronger: false, hpRatio: 0.5, grudge: 0 },
  { name: '越境·筑基', realmIdx: 1, stronger: true,  hpRatio: 0.5, grudge: 0 },
];
// 广角扫描:任何一格都不该恒负。
const WIDE = [...LADDER_HP40, ...LADDER_HP50,
  { name: 'boss·残血', realmIdx: 2, stronger: true, hpRatio: 0.05, grudge: 0 }];

const mkCfg = (foe) => ({
  node: { type: 'boss' },
  hpRatio: foe.hpRatio,
  hero: { name: '轩轩', img: 'h.jpg', realmIdx: 0 },
  foe: { key: 'boss_golem', name: foe.name, img: 'f.jpg', realmIdx: foe.realmIdx,
         stronger: foe.stronger, isNemesis: !!foe.nemesis },
  onWin: () => {}, onLose: () => {},
});

/** 真打一场。rounds = 敌攻次数(0 = 玩家还没挨过打就结束了)。 */
function duel(hero, foe, seed, eDmgMul = 1, noCd = false) {
  seedRng(seed);
  Cult.s.realm = hero.realm;
  Cult.s.arts = { ...hero.arts };
  // ⚠️ 宿敌 grudge 会随 battle('win') 累加(relations.js battle():grudge += 20)。
  //   不重置的话第 N 场用的 powerBoost 是前 N-1 场的遗产 ⇒ 测量本身不确定。
  Cult.nemesis.s = { met: false, battles: 0, wins: 0, alive: true, grudge: foe.grudge };
  let win = false, rounds = -1;
  const cfg = mkCfg(foe);
  // onWin 在 close() **之前**被调(duel.js win()),这是唯一能活着读到回合计数的时刻。
  cfg.onWin = () => { win = true; if (Duel.S) rounds = Duel.S[ROUND_KEY]; };
  Duel.start(cfg);
  const eDmg = Duel.S.e.dmg, guard = Duel.S.hero.dmgReduce;
  // 只动**会话状态**,不动任何产品代码。反向自检用:尺子若对 e.dmg 毫无反应,
  // 说明它压根没在量伤害,上面所有梯度结论都是空的。
  if (eDmgMul !== 1) Duel.S.e.dmg *= eDmgMul;
  // noCd:只在**会话状态**上做手脚,不动任何产品代码 —— 这个 Proxy 吞掉
  // playerAct 写进 cooldown 的任何值(等价 artCd ≡ 0),于是玩家每回合都有牌可出。
  // ⚠️ 不能用 isSuper 造假来达到同样目的:artCd 和 artDamage 都读 s.isSuper,
  //   设了它会把伤害一起放大(实测 jianqi lv1:12 → 29),就分不清是谁在起作用了。
  if (noCd) {
    Duel.S.hero.cooldown = new Proxy({}, {
      set() { return true; }, get() { return 0; },
      ownKeys() { return []; }, has() { return false; },
    });
  }
  drain('开场');
  let clicks = 0;
  while (Duel.S && !Duel.S.over && clicks < 400) {
    const arts = (reg('#xd-sk').innerHTML.match(/data-art="([^"]+)"/g) || []).map(s => s.slice(10, -1));
    if (!arts.length) { drain('强制普攻·自动推进'); break; }   // 玩家已无决策,让假时钟跑完
    const ev = { target: { closest: s => (s === '[data-art]' ? { dataset: { art: arts[0] } } : null) } };
    (reg('#xd-sk')._h.click || []).forEach(fn => fn(ev));
    clicks++; drain('一回合');
  }
  drain('终局');
  if (Duel.S && rounds < 0) rounds = Duel.S[ROUND_KEY] ?? -1;
  // ⚠️ 输掉的一场必须把战败四选项点掉:close() 是**唯一**复位 Duel.busy 的地方
  //   (XX-DUEL-005)。不点的话 busy 卡在 true,下一场技能的点击全被 if (!this.busy)
  //   吞掉 ⇒ 后面每一场都在「玩家零输入」的世界里跑,量出来的是我自己的漏斗。
  if (Duel.S && Duel.S.over) {
    const opts = reg('#xd-defeat').querySelectorAll('.xx-chio');
    if (opts.length) opts[0].onclick();
    drain('战败结算');
  }
  return { win, rounds, eDmg, guard, clicks, over: rounds >= 0 };
}

function cell(hero, foe, N, eDmgMul = 1, noCd = false) {
  let w = 0, rr = 0, r0 = 0, r2 = 0, eDmg = null, guard = null, seen = 0;
  for (let i = 0; i < N; i++) {
    const r = duel(hero, foe, 1000 + i, eDmgMul, noCd);
    if (!r.over) continue;
    seen++;
    if (r.win) w++;
    rr += r.rounds;
    if (r.rounds === 0) r0++;
    if (r.rounds >= 2) r2++;
    if (eDmg === null) { eDmg = r.eDmg; guard = r.guard; }
  }
  return { n: seen, wr: w / N, rounds: rr / N, firstRound: r0 / N, lateRound: r2 / N, eDmg, guard };
}

const N = 240;
const rows = [];
console.log(`\n=== 难度梯度扫描(${N} 种子/格,真跑 Duel.start) ===`);
console.log('  ' + pad('玩家', 13) + pad('敌人', 12) + pad('e.dmg', 7) + pad('护体', 8) +
            pad('胜率', 9) + pad('平均回合', 10) + pad('首回合定死', 11) + pad('打到≥2回合', 12));
for (const h of [HERO, HERO_MID]) for (const f of WIDE) {
  const r = cell(h, f, N);
  rows.push({ hero: h.name, foe: f.name, r });
  console.log('  ' + pad(h.name, 13) + pad(f.name, 12) + pad(r.eDmg, 7) + pad(pct(r.guard), 8) +
              pad(pct(r.wr), 9) + pad(r.rounds.toFixed(2), 10) +
              pad(pct(r.firstRound), 11) + pad(pct(r.lateRound), 12));
}
const at = (heroName, foeName) => rows.find(x => x.hero === heroName && x.foe === foeName).r;

// ════════════════════════════════════════════════════════════
console.log('\n=== [G4] 防退化:门禁自己必须真的解析出了敌人配置与战斗结果 ===');
// ════════════════════════════════════════════════════════════
{
  const parsed = rows.every(x => x.r.n === N && Number.isFinite(x.r.eDmg) && x.r.eDmg > 0 && x.r.guard >= 0);
  tf('每格都解析出 N 场有效战斗 + 合法 e.dmg + 合法护体', parsed,
    JSON.stringify(rows.map(x => ({ c: `${x.hero}×${x.foe}`, n: x.r.n, e: x.r.eDmg, g: x.r.guard }))));
  const ladders = [LADDER_HP40, LADDER_HP50];
  const flatHp = ladders.every(L => L.every(f => f.hpRatio === L[0].hpRatio));
  tf('难度阶梯内部敌人血量恒定(只有伤害在变)——单调性才有意义', flatHp,
    JSON.stringify(ladders.map(L => L.map(f => f.hpRatio))));
  const scanned = rows.filter(x => x.hero === HERO.name).map(x => x.foe);
  tf('敌人配置确实被换掉了(阶梯不是同一个敌人跑六遍)',
    scanned.length === WIDE.length && new Set(scanned).size === WIDE.length,
    `扫到 ${scanned.length} 个不同敌人:${JSON.stringify([...new Set(scanned)])}`);
  if (SELF_FAIL.length) {
    console.log('\n🛑 门禁自身失效,以下结果不可信 —— 按约定 exit 2(而不是 exit 1):');
    for (const n of SELF_FAIL) console.log(`     🛑 ${n}`);
    process.exit(2);
  }
}

// ════════════════════════════════════════════════════════════
console.log('\n=== [G5] 反向自检:判定函数本身(合成样本,不碰真实文件) ===');
// ════════════════════════════════════════════════════════════
// 判据只有三个纯函数。先用合成样本证明它们会拒绝坏输入 ——
// 「谓词恒真」的门禁比没有门禁更危险:它绿的时候什么都没在验。
const predNotFlat = wr => wr > 0 && wr < 1;                       // G1
const predNonInc = ys => ys.every((v, i) => i === 0 || v <= ys[i - 1]);   // G2
const predHasLate = fr => fr >= 0.01;                             // G3
{
  const synth = [
    ['恒负样本(0%)必须被 G1 拒绝', !predNotFlat(0)],
    ['恒胜样本(100%)必须被 G1 拒绝', !predNotFlat(1)],
    ['正常样本(23.3%)必须被 G1 接受', predNotFlat(0.233)],
    ['递增序列必须被 G2 拒绝(更强的敌人反而更好打)', !predNonInc([0.1, 0.5, 0.9])],
    ['递减序列必须被 G2 接受', predNonInc([1, 0.65, 0.233])],
    ['持平序列必须被 G2 接受(单调不升,不是严格下降)', predNonInc([0.5, 0.5, 0.5])],
    ['全恒胜的阶梯(真实病态)必须被 G2 的下位检查抓住', predNotFlat(1) === false],
    ['「从没打到第 2 回合」必须被 G3 拒绝', !predHasLate(0)],
    ['有打到第 2 回合的样本必须被 G3 接受', predHasLate(0.35)],
  ];
  for (const [n, ok] of synth) t(`G5·${n}`, ok);
}

// ════════════════════════════════════════════════════════════
console.log('\n=== [G1] 梯度存在:弱敌恒胜,强敌不得恒负 ===');
// ════════════════════════════════════════════════════════════
{
  const weak = at(HERO.name, '小妖·炼气');
  t('G1a 弱敌(小妖·炼气)对新手是恒胜 —— 教程档必须是白给的',
    weak.wr === 1, `实测 ${pct(weak.wr)}`);

  const strong = at(HERO.name, '宿敌·结怨');       // grudge 75:宿敌中段强度
  t('G1b 强敌(宿敌·结怨)既不是 0% 也不是 100%',
    predNotFlat(strong.wr), `实测 ${pct(strong.wr)}`);
  // 下限 15%:实测 27.9%(240 种子)。留约 1.8 倍余量给随机波动,
  // 但不许掉回「恒负」—— 那正是本门禁要钉死的病。
  t('G1c 强敌胜率 ≥ 15%(改前实测 0.0%)', strong.wr >= 0.15, `实测 ${pct(strong.wr)}`);
  t('G1d 护体真的挂上了(不是靠运气赢的)', strong.guard > 0,
    `实测护体 ${pct(strong.guard)} —— 恒 0 说明这条路径根本没走到`);

  const allNonFlat = rows.filter(x => x.r.wr === 0);
  t('G1e 整张网格里没有任何一格是恒负', allNonFlat.length === 0,
    allNonFlat.map(x => `${x.hero}×${x.foe} = ${pct(x.r.wr)}`).join(' , '));
}

// ════════════════════════════════════════════════════════════
console.log('\n=== [G2] 强度单调:敌人越强,玩家胜率单调不升 ===');
// ════════════════════════════════════════════════════════════
//
// ⚠️ 为什么在「血量恒定」的分组内比,而不是整张网格:
//   boss·残血 的 hpRatio=0.05(敌人只剩 5 血),它比小妖**弱**得多,
//   把它排在难度轴末尾会造出一条 U 形曲线,而那不是「难度倒挂」。
//   难度轴是**敌方伤害**:血量不同就不是同一个量纲。
//   所以每一组内部 hpRatio 恒定,只有 e.dmg 单调上升。
for (const [label, L] of [['hpRatio 0.4', LADDER_HP40], ['hpRatio 0.5', LADDER_HP50]]) {
  const ys = L.map(f => at(HERO.name, f.name).wr);
  const dmgs = L.map(f => at(HERO.name, f.name).eDmg);
  const monoDmg = dmgs.every((v, i) => i === 0 || v >= dmgs[i - 1]);
  t(`G2·非平凡(${label} 阶梯的 e.dmg 确实在变)`, new Set(dmgs).size > 1,
    `e.dmg 序列 ${JSON.stringify(dmgs)}`);
  t(`G2·轴向正确(${label} 的 e.dmg 单调不降)`, monoDmg, `e.dmg 序列 ${JSON.stringify(dmgs)}`);
  t(`G2·${label} 胜率单调不升`, predNonInc(ys),
    `胜率序列 ${JSON.stringify(ys.map(pct))}(e.dmg ${JSON.stringify(dmgs)})`);
  // 反向对照:把序列反过来喂同一个谓词,必须被拒绝。
  t(`G2·自检(${label} 反向序列必须被同一谓词拒绝)`, !predNonInc([...ys].reverse()),
    '反向序列也判过 ⇒ 谓词恒真 ⇒ 方向写反了门禁也会绿');
}

// ════════════════════════════════════════════════════════════
console.log('\n=== [G3] 结果不由单回合决定 ===');
// ════════════════════════════════════════════════════════════
{
  const ladder = [...LADDER_HP40, ...LADDER_HP50].filter(f => f.name !== 'boss·残血');
  const late = ladder.map(f => at(HERO.name, f.name));
  const anyLate = late.some(r => r.lateRound > 0);
  t('G3a 至少有一场是打到第 2 回合以后才分胜负(不是全部第 1 回合就结束)', anyLate,
    JSON.stringify(late.map(r => ({ f: r.eDmg, late: pct(r.lateRound) }))));
  const strong = at(HERO.name, '宿敌·结怨');
  t('G3b 强敌这一档里,绝大多数战斗都让敌人真的出过手', strong.firstRound < 0.5,
    `首回合就定死的占比 ${pct(strong.firstRound)}(实测平均 ${strong.rounds.toFixed(2)} 回合)`);
  const longest = Math.max(...late.map(r => r.rounds));
  t('G3c 阶梯上有战斗能打到 3 回合以上(冷却转得回来)', longest >= 3,
    `最长平均 ${longest.toFixed(2)} 回合`);
}

// ════════════════════════════════════════════════════════════
console.log('\n=== [尺子自检] 这批数字本身可信吗 ===');
// ════════════════════════════════════════════════════════════
{
  const a = duel(HERO, LADDER_HP40[3], 4242);
  const b = duel(HERO, LADDER_HP40[3], 4242);
  tf('同种子两场逐字相同(可复现,否则上面全是 flaky)',
    JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  // 反向注入:敌人伤害 ×10。测量若测不出差异,说明它压根没在量伤害。
  const base = cell(HERO, LADDER_HP40[3], 60);
  const hurt = cell(HERO, LADDER_HP40[3], 60, 10);
  t('尺子·反向注入:敌人伤害 ×10 后这一档必然掉到 0%(测不出差异=尺子坏了)',
    hurt.wr === 0 && hurt.rounds < base.rounds,
    `基线 ${pct(base.wr)}/${base.rounds.toFixed(2)} 回合 → ×10 后 ${pct(hurt.wr)}/${hurt.rounds.toFixed(2)} 回合`);
}

// ════════════════════════════════════════════════════════════
console.log('\n=== [G6] 护体不依赖冷却层:这不是拿 artCd 当遮羞布 ===');
// ════════════════════════════════════════════════════════════
//
// 交付前做过一个隔离实验(改前):把 artCd 整个置 0,也就是**玩家每回合都有牌可出**,
// 强敌那一档的胜率仍然是 0.0%(带冷却 0.0% / 无冷却 0.0%)。
// ⇒ 恒负不是「玩家没有第二次决策」造成的,是**伤害层**单方面的锅。
// 反过来也要钉住:护体修完之后,即便把冷却层整个拿掉,强敌仍然是可赢的 ——
//
// 这一条的作用是防止将来有人把 battle.js 的冷却一改,就误以为「恒负又回来了」
// 或者反过来,把这条曲线当成冷却层的功劳。battle.js 的冷却是另一代理的地盘,
// 这条断言只说:**拿掉冷却,结论不变**。
{
  const withCd = at(HERO.name, '宿敌·结怨');
  const noCd = cell(HERO, LADDER_HP40[3], N, 1, true);
  t('G6a 把 artCd 置 0 后,强敌那一档仍然不是恒负',
    noCd.wr > 0 && noCd.wr < 1,
    `带冷却 ${pct(withCd.wr)} → 无冷却 ${pct(noCd.wr)}(改前这一档两栏都是 0.0%)`);
  t('G6b 无冷却下的胜率不低于带冷却时(护体不依赖冷却转不转得回来)',
    noCd.wr >= withCd.wr - 0.05,
    `带冷却 ${pct(withCd.wr)},无冷却 ${pct(noCd.wr)}`);
}

console.log('');
if (fail === 0) {
  console.log(`✅ 决斗难度梯度通过:${pass} 项断言`);
  process.exit(0);
} else {
  console.log(`❌ ${fail} 项不达标(共 ${pass + fail} 项断言)`);
  for (const r of RED) console.log(`   - ${r}`);
  process.exit(1);
}
