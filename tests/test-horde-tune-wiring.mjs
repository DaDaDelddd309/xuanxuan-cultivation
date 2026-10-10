// tests/test-horde-tune-wiring.mjs —— 真引擎级:怪潮也必须吃局外节点倾向
// 运行: node tests/test-horde-tune-wiring.mjs
//
// 为什么单开文件(不并进 test-runcfg-wiring.mjs):那个是静态 import 纯函数做数值
// 断言;这个要**驱动整个刷怪器** —— 造假游戏、装上 initSpawner 注册的 updater、
// 推时间到怪潮触发,然后逐只检查场上的怪。
//
// 为什么不用几何区分「怪潮怪 vs 普通怪」:doHorde 的环半径是 hypot(w,h)/2+60,
// 而 ringSpot 是 hypot(w,h)/2 + [50,200) —— **区间重叠**,靠半径分有 ~4% 撞车,
// 门禁不能靠概率。改用数值分:t=60 时 minOrdinaryHpAt(60)=0,保底项不生效,
// 怪潮(×0.75)与普通怪的 hpMult 互不相等,可逐只精确判定归属。
// (t>=180 不行:保底会托底,两种形式算出同一个值,分不开。)
//
// ⚠️ 这里踩过一次坑,记下来免得重犯:分类器最初只认「怪潮 / 普通」两种形态,
// 结果 2/3 的运行里有一只**第三形态**的怪落进空桶,断言在 0 只怪潮怪的情况下
// **恒真通过**(空数组 every/filt 皆真)。空断言比没断言更坏 ——
// 现在每组都先断言桶非空,认不出的怪一律进 unknown 并判失败。

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const S = await import('../js/game/spawner.js?v=18');
// enemies.js 必须跟 spawner.js 内部那句 import 同一个戳,否则拿到的是另一份模块实例,
// combatState.runActive 写不进去,updater 直接 return —— 场上 0 只怪。
// (这正是 tests/lint-module-identity.mjs 要拦的那类分裂,这里是被它咬过一口。)
const E = await import('../js/game/enemies.js?v=17');
const { setRunTune, setSpawnMode, initSpawner, spawnHpMultAt } = S;
const { combatState, ENEMY_MOD, ENEMY_TYPES } = E;

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const T = 60;
const TUNE = { hpMult: 1.4, dmgMult: 1.3, speedMult: 1.1, eliteRate: 1, hordeRate: 1 };

function mkG() {
  const g = {
    time: T, w: 800, h: 600, cam: { zoom: 1 },
    player: { x: 0, y: 0 },
    enemies: [], pickups: [], projectiles: [], zones: [],
    grid: { insert() {}, clear() {} },
  };
  g.addEnemy = e => { g.enemies.push(e); return e; };
  g.addProjectile = () => true;
  g.addZone = () => true;
  g.spawnText = () => {};
  g.addParticles = () => {};
  g.__spawnOpts = () => ({});
  g.addReset = () => {};
  let upd = null;
  g.addUpdater = fn => { upd = fn; };
  g.__tick = dt => upd(dt);
  return g;
}

/** 跑一拍,把场上每只怪归到 怪潮/普通/精英 三种形态之一 */
function runTick(tune) {
  const eff = { hpMult: 1, dmgMult: 1, speedMult: 1, eliteRate: 1, hordeRate: 1, ...(tune || {}) };
  setRunTune(tune);
  setSpawnMode('timed');        // 纯时间驱动:不靠导演压力,门禁不受玩家行为影响
  const g = mkG();
  initSpawner(g);
  combatState.runActive = true;
  g.time = T;
  g.__tick(50);                 // hordeT 初值 42 → 触发一次怪潮;同一拍还会出普通怪
  const b = { horde: [], normal: [], elite: [], unknown: [] };
  for (const e of g.enemies) {
    const forms = {
      horde:  spawnHpMultAt(e.type, T, { horde: true }),
      normal: spawnHpMultAt(e.type, T, {}),
      elite:  spawnHpMultAt(e.type, T, { elite: true }),
    };
    let kind = null;
    for (const k of ['horde', 'normal', 'elite']) {
      if (near(e.hpMult, forms[k] * eff.hpMult)) { kind = k; break; }
    }
    if (!kind) { b.unknown.push({ e, forms }); continue; }
    b[kind].push({ e, base: forms[kind] });
  }
  return { g, ...b, eff };
}

const bad = list => list.filter(x => !near(x.e.hpMult, x.base * TUNE.hpMult));

console.log('\n[1] 前置:门禁自己的基准成立');
{
  t('ENEMY_MOD 三项均为 1(否则 opts 会被二次放大,基准失真)',
    ENEMY_MOD.hp === 1 && ENEMY_MOD.dmg === 1 && ENEMY_MOD.spd === 1, JSON.stringify(ENEMY_MOD));
  const r = runTick(TUNE);
  t('没有认不出的怪(三种形态之外不该有第四种来源)', r.unknown.length === 0,
    r.unknown.length ? `type=${r.unknown[0].e.type} hpMult=${r.unknown[0].e.hpMult}` : '');
  t('怪潮怪 ≥ 5 只(推 50s 必触发)', r.horde.length >= 5, `实际 ${r.horde.length}`);
  t('普通怪 ≥ 1 只(证明本测试不是只盯怪潮的自证)', r.normal.length >= 1, `实际 ${r.normal.length}`);
}

console.log('\n[2] 怪潮逐只吃满节点倾向(这正是接线前漏掉的那条路)');
{
  const r = runTick(TUNE);
  if (r.horde.length === 0) {
    t('怪潮桶非空', false, '桶空了,下面所有断言都会空转 —— 必须先判这条');
  } else {
    t(`怪潮 ${r.horde.length} 只 hpMult 全部 = horde 基准 ×${TUNE.hpMult}`,
      bad(r.horde).length === 0,
      bad(r.horde).length ? `${bad(r.horde)[0].e.hpMult} ≠ ${bad(r.horde)[0].base * TUNE.hpMult}` : '');
    const badD = r.horde.filter(x => !near(x.e.dmgMult, (1 + T / 240) * TUNE.dmgMult));
    t(`怪潮 dmgMult 全部 = (1+t/240) ×${TUNE.dmgMult}`, badD.length === 0, String(badD[0] && badD[0].e.dmgMult));
    const baseSpd = (1 + Math.min(0.3, T / 2000)) * TUNE.speedMult;
    const badS = r.horde.filter(x => !near(x.e.speed, ENEMY_TYPES[x.e.type].speed * baseSpd));
    t(`怪潮 speed 全部 = 原速 ×${TUNE.speedMult}`, badS.length === 0, String(badS[0] && badS[0].e.speed));
    const s = r.horde[0];
    t(`样本:基准 ${s.base.toFixed(4)} → 实际 ${s.e.hpMult.toFixed(4)}(应为 ${(s.base * TUNE.hpMult).toFixed(4)})`,
      near(s.e.hpMult, s.base * TUNE.hpMult));
  }
}

console.log('\n[3] 反向注入:doHorde 退回老路(手搓 opts 不乘倍率)必须会红');
{
  const r = runTick(TUNE);
  // 老代码那一行:hpMult: spawnHpMultAt(type, t, { horde: true }) —— 少了 * runTune.hpMult
  const unscaled = r.horde.filter(x => near(x.e.hpMult, x.base));
  t('本组先证明怪潮桶非空(否则这组是空断言)', r.horde.length >= 5, `实际 ${r.horde.length}`);
  t('若 doHorde 改回手搓 opts,这些怪会落进 unknown 或基准桶,[2] 立刻变红',
    unscaled.length === 0, `${unscaled.length} 只仍等于未放大基准`);
  t('接线后的值确实不等于未放大基准(否则倍率根本没生效)',
    r.horde.length > 0 && r.horde.every(x => !near(x.e.hpMult, x.base)));
}

console.log('\n[4] 默认态必须与接线前逐位相同(没设节点就等于没接)');
{
  const r = runTick(null);
  const bH = r.horde.filter(x => !near(x.e.hpMult, x.base));
  const bN = r.normal.filter(x => !near(x.e.hpMult, x.base));
  t('未注入时怪潮怪 hpMult = 原基准(零行为变化)', r.horde.length > 0 && bH.length === 0,
    bH.length ? `${bH[0].e.hpMult} vs ${bH[0].base}` : '');
  t('未注入时普通怪同样逐位不变', r.normal.length > 0 && bN.length === 0,
    bN.length ? `${bN[0].e.hpMult} vs ${bN[0].base}` : '');
}

console.log(`\ntest-horde-tune-wiring: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
process.exit(fail ? 1 : 0);
