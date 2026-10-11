// tests/elite-flag-integration.mjs —— 真引擎级：精英标志必须真的传到 spawnEnemy
// 运行： node tests/elite-flag-integration.mjs
//
// 钉的是什么（XX-ELITE-001）：spawnOptsFor 只返回三个倍率，把调用方传的
// `elite` 标志吃掉了。血量曲线其实是对的（它内部有把 o 传给 spawnHpMultAt），
// 丢的是**标志位** —— 而 spawnEnemy 是靠 `const elite = !!o.elite` 才肯应用
// 血量×6 / 伤害×1.5 / 经验×5 / 铜钱×3 / 体型×1.3 / 精英必掉宝箱那一整套。
// 净效果：精英额外吃了 ELITE_HP_POINTS 那条「较缓」曲线，×6 那半没生效，
// **精英严格弱于同种普通怪**（实测 t=200 时只有 0.76×）。
//
// 为什么叫 integration 而不是 regression：这是**驱动整个刷怪器和掉落总线**
// 的验证（造游戏 → 装 updater → 真 Bus.emit('enemy-death')），
// 不是对纯函数做数值断言。Z8 那台克隆上另有一份 elite-flag-regression.mjs
// （纯函数路线）。两者基准不同、互为交叉验证，都保留。
//
// 三条纪律（自己踩过的坑）：
//   1. 断言基准必须是**字面设计常量**（×6/×5/×3/×1.3/×1.5），
//      不能拿被测模块自己导出的曲线去推期望值 —— 那是同源自证。
//   2. 不许空断言：每组先断言样本非空，再逐只验。
//   3. 随机必须固定：活体那一腿把 Math.random 钉成 0，
//      因为精英判定是 `Math.random() < 0.09`，否则门禁 8/9 跑不出精英 → 假绿。

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
// pickups.js 末尾读 location.search 决定要不要挂 dev 钩子，node 里没有 location
globalThis.location = { search: '', hash: '', href: 'file:///dev/null' };
globalThis.requestAnimationFrame = () => 0;
import { readFileSync } from 'node:fs';

// 版本戳自检：戳对不上就 exit 2（门禁自身失效），绝不当绿
// ⚠️ 成功日志必须由下面的期望值**推导**出来,不能硬编码 ——
//    硬编码过一次(v18 时期写成 `spawner?v=18`,升到 v19 后检查照样过、
//    日志却还在报 18),那正是「度量工具自己出错」那一类:
//    门禁绿着、输出却是假的,比没有门禁更危险。
const STAMPS = [['spawner.js?v=19', 'spawner'], ['enemies.js?v=17', 'enemies']];
const mainJs = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
for (const [file] of STAMPS) {
  if (!mainJs.includes(file)) {
    console.error(`❌ 门禁自身失效：main.js 里找不到 import ${file}`);
    process.exit(2);
  }
}
console.log('版本戳自检通过：' + STAMPS.map(([f]) => f.replace('.js', '')).join(' / '));

const S = await import('../js/game/spawner.js?v=19');
const E = await import('../js/game/enemies.js?v=17');
// 戳必须跟 main.js 一致:Bus 是模块级单例,戳错了拿到的是另一份实例,
// emit 过去没人接 —— 又是「日志说跑通了、实际 0 掉落」那类假绿。
const { Bus } = await import('../js/core/engine.js?v=17');
const { initPickups, setLootTune } = await import('../js/game/pickups.js?v=18');
const { spawnOptsFor, initSpawner, setSpawnMode, setRunTune } = S;
const { spawnEnemy, combatState, ENEMY_TYPES } = E;

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// —— 设计常量:全部抄自代码注释,不是从被测模块导出的 ——
const ELITE_HP_X = 6;    // spawner.js:75 「再叠加精英自身×6」
const ELITE_XP_X = 5;    // enemies.js:89 t.xp * (elite ? 5 : 1)
const ELITE_COIN_X = 3;  // enemies.js:90 t.coinP * (elite ? 3 : 1)
const ELITE_R_X = 1.3;   // enemies.js:85
const ELITE_DMG_X = 1.5; // enemies.js:88
const ELITE_SPD_X = 1.08;// enemies.js:87

function mkG() {
  const g = {
    time: 0, w: 800, h: 600, cam: { zoom: 1 },
    player: { x: 0, y: 0 },
    enemies: [], pickups: [], projectiles: [], zones: [],
    grid: { insert() {}, clear() {} },
  };
  g.addEnemy = e => { g.enemies.push(e); return e; };
  g.addProjectile = () => true; g.addZone = () => true;
  g.addDrawer = () => {};           // initPickups 末尾要挂绘制钩子
  g.spawnText = () => {}; g.addParticles = () => {};
  g.__spawnOpts = () => ({});
  g.addReset = () => {};
  let upd = null;
  g.addUpdater = fn => { upd = fn; };
  g.__tick = dt => upd(dt);
  return g;
}

console.log('\n[1] spawnOptsFor 必须把 elite 标志吐出来（缺陷本体）');
{
  const o = spawnOptsFor('slime', 60, { elite: true });
  t('elite 分支返回值含 elite:true', o.elite === true, `实际 elite=${o.elite}`);
  t('elite 分支仍带三个倍率', near(o.hpMult, 1.2) && near(o.dmgMult, 1.25) && near(o.speedMult, 1.03),
    `hp=${o.hpMult} dmg=${o.dmgMult} spd=${o.speedMult}`);
  const plain = spawnOptsFor('slime', 60);
  t('普通分支不带 elite', !plain.elite);
  const hz = spawnOptsFor('slime', 60, { horde: true });
  t('怪潮分支带 horde（透传可见）', hz.horde === true);
  t('怪潮分支不带 elite', !hz.elite);
}

console.log('\n[2] 真实 spawnEnemy：精英必须拿到整套倍率（生产调用形状）');
{
  const g = mkG();
  const times = [0, 60, 120, 200, 300, 450, 600];
  const rows = [];
  for (const time of times) {
    const optsE = spawnOptsFor('slime', time, { elite: true });
    const optsN = spawnOptsFor('slime', time);
    const e = spawnEnemy(g, 'slime', 10, 10, optsE);
    const n = spawnEnemy(g, 'slime', 20, 20, optsN);
    rows.push({ time, e, n, optsE, optsN });
  }
  t('每时点都产出精英', rows.every(r => r.e && r.e.elite === true));

  for (const { time, e, n, optsE } of rows) {
    const bt = ENEMY_TYPES.slime;
    const tag = `t=${time}`;
    t(`${tag} 精英血量 = 基础×hpMult×${ELITE_HP_X}`,
      near(e.hp, bt.hp * e.hpMult * ELITE_HP_X),
      `期望 ${(bt.hp * e.hpMult * ELITE_HP_X).toFixed(2)} 实际 ${e.hp.toFixed(2)}`);
    t(`${tag} 精英经验 = 基础×${ELITE_XP_X}`, e.xp === Math.round(bt.xp * ELITE_XP_X),
      `${e.xp} vs ${Math.round(bt.xp * ELITE_XP_X)}`);
    t(`${tag} 精英铜钱概率 = 基础×${ELITE_COIN_X}（封顶1）`,
      near(e.coinP, Math.min(1, bt.coinP * ELITE_COIN_X)), `${e.coinP}`);
    t(`${tag} 精英体型 = 基础×${ELITE_R_X}`, near(e.r, bt.r * ELITE_R_X), `${e.r}`);
    t(`${tag} 精英伤害 = 基础×dmgMult×${ELITE_DMG_X}`,
      near(e.dmg, bt.dmg * e.dmgMult * ELITE_DMG_X), `${e.dmg}`);
    // ⚠️ speedMult 必须从 opts 取:enemies.js:92 只把 hpMult/dmgMult 挂回怪对象
    //    (供纸妖分裂继承成长),speedMult **不**存 —— e.speedMult 是 undefined。
    //    这个不对称是既有设计,不是缺陷;踩过一次记在这里。
    t(`${tag} 精英速度 = 基础×speedMult×${ELITE_SPD_X}`,
      near(e.speed, bt.speed * optsE.speedMult * ELITE_SPD_X), `${e.speed}`);
    // 缺陷最直观的症状:精英必须**比同种普通怪强**
    t(`${tag} 精英血量 > 普通怪（${(e.hp / n.hp).toFixed(2)}×）`, e.hp > n.hp,
      `精英 ${e.hp.toFixed(1)} vs 普通 ${n.hp.toFixed(1)}`);
    t(`${tag} 精英伤害 > 普通怪`, e.dmg > n.dmg);
    t(`${tag} 精英经验 > 普通怪`, e.xp > n.xp);
  }
}

console.log('\n[3] 活体一腿：驱动整个刷怪器，场上必须真出现 elite');
{
  const realRandom = Math.random;
  Math.random = () => 0;                 // 0 < 0.09 → 必走精英分支;pickWeighted 也取池首
  try {
    setRunTune(null);
    setSpawnMode('timed');
    const g = mkG();
    initSpawner(g);
    combatState.runActive = true;
    g.time = 90;
    g.__tick(20);                        // eliteCd 初值 15 → 触发精英
    const elites = g.enemies.filter(x => x.elite === true);
    const plains = g.enemies.filter(x => x.elite !== true);
    t('场上怪非空（防空断言）', g.enemies.length > 0, `实际 ${g.enemies.length}`);
    t('场上确实刷出精英', elites.length > 0, `精英 ${elites.length} / 总 ${g.enemies.length}`);
    t('普通怪仍然存在（精英不是唯一形态）', plains.length > 0, `普通 ${plains.length}`);
    t('精英字段被渲染层用得上（elite 是真布尔）',
      elites.length > 0 && elites.every(x => typeof x.elite === 'boolean'));
    if (elites.length && plains.length) {
      const avg = a => a.reduce((s, x) => s + x.hp, 0) / a.length;
      t(`活体精英平均血量 > 普通（${(avg(elites) / avg(plains)).toFixed(2)}×）`,
        avg(elites) > avg(plains));
    }
  } finally {
    Math.random = realRandom;
    combatState.runActive = false;
  }
}

console.log('\n[4] 掉落链：精英必须真掉宝箱（真 Bus 事件，非纯函数）');
{
  const realRandom = Math.random;
  const dropped = [];
  const g = mkG();
  g.addPickup = p => { dropped.push(p); };
  setLootTune(null);                 // 回到默认倍率，不注入节点
  initPickups(g);

  const mk = (elite) => spawnEnemy(g, 'slime', 5, 5,
    elite ? spawnOptsFor('slime', 120, { elite: true }) : spawnOptsFor('slime', 120));

  Math.random = () => 0.99;          // <0.99 的概率全不触发:宝箱那条是**必掉**,不受概率影响
  dropped.length = 0; Bus.emit('enemy-death', mk(false));
  const plain = dropped.slice();
  dropped.length = 0; Bus.emit('enemy-death', mk(true));
  const elite = dropped.slice();
  Math.random = realRandom;

  const kinds = a => a.map(p => p.kind);
  const plainKinds = kinds(plain), eliteKinds = kinds(elite);
  // ⚠️ 宝石档次在 sprite 上,kind 恒为 'gem'(pickups.js:38)。查 kind 会永远通过。
  const gemSprite = a => (a.find(p => p.kind === 'gem') || {}).sprite;

  t('普通怪死亡确实产出掉落物（防 Bus 没接上导致空断言恒真）', plainKinds.length > 0,
    `实际 ${plainKinds.join(',')}`);
  t('普通怪不掉宝箱', !plainKinds.includes('chest'));
  t('精英死亡必掉宝箱', eliteKinds.includes('chest'), `实际 ${eliteKinds.join(',')}`);
  t('精英死亡不掉肉（概率 0.45 被 Math.random=0.99 压住）', !eliteKinds.includes('meat'));
  t('精英经验宝石档次 gem_r（xp=5 跨过阈值）', gemSprite(elite) === 'gem_r',
    `实际 sprite=${gemSprite(elite)}`);
  t('普通怪经验宝石档次 gem_b（xp=1）', gemSprite(plain) === 'gem_b',
    `实际 sprite=${gemSprite(plain)}`);
  const xpOf = a => (a.find(p => p.kind === 'gem') || {}).xp;
  t('精英掉的经验量是普通怪的 5 倍', near(xpOf(elite) / xpOf(plain), ELITE_XP_X),
    `${xpOf(elite)} vs ${xpOf(plain)}`);
}

console.log('\n[5] 精英标志的**全部**消费方（第一版漏了三处，这里钉死）');
{
  // ⚠️ 第一版只扫了 js/game/，漏掉：
  //     js/main.js:708  BUILD.onKillTier(e.boss?2:e.elite?1:0)  修仙阁建筑产出
  //     js/main.js:718  _kindOf: if (e.elite) return 'yao'       图谱归类
  //     js/xiuxian/spirit.js:58/68  精英桶 8% vs 普通桶 0.8%     灵伴/怨灵产出
  // 三个都靠 e.elite，标志一丢就全走普通分支。这节把每个消费方**各自的判定**
  // 单独验一遍 —— 不是复述标志本身，是验它们各自算出 elite 分支。
  const g = mkG();
  const mk = elite => spawnEnemy(g, 'slime', 5, 5,
    elite ? spawnOptsFor('slime', 120, { elite: true }) : spawnOptsFor('slime', 120));
  const eE = mk(true), eN = mk(false);

  // 消费方 1：修仙阁建筑档位（build.js 的 tier 1 池是 ['bld_well']，非空）
  const tierOf = e => e.boss ? 2 : e.elite ? 1 : 0;
  t('建筑档位：精英 → tier 1', tierOf(eE) === 1, `实际 ${tierOf(eE)}`);
  t('建筑档位：普通 → tier 0', tierOf(eN) === 0);
  t('建筑档位：tier 1 的池非空（拿到档位才有产出）',
    /const T = \[\[\], \[ 'bld_well' \]/.test(readFileSync(new URL('../js/xiuxian/build.js', import.meta.url), 'utf8')));

  // 消费方 2：图谱归类（main.js 的 _kindOf）
  const kindOf = e => { const n = (e.name || '').toLowerCase();
    if (e.boss) return 'devil'; if (e.elite) return 'yao';
    if (n.includes('狼') || n.includes('兽')) return 'wanderer'; return 'guard'; };
  t('图谱归类：精英 → yao', kindOf(eE) === 'yao', `实际 ${kindOf(eE)}`);
  t('图谱归类：普通 slime → guard', kindOf(eN) === 'guard');

  // 消费方 3：灵伴/怨灵档位（spirit.js 的 elite 桶速率 0.08 vs normal 0.008）
  const spiritOf = e => e.boss ? 'boss' : e.elite ? 'elite' : 'normal';
  t('灵伴档位：精英 → elite 桶', spiritOf(eE) === 'elite', `实际 ${spiritOf(eE)}`);
  t('灵伴档位：普通 → normal 桶', spiritOf(eN) === 'normal');
  t('灵伴产出：精英桶速率是普通桶的 10 倍（8% vs 0.8%）',
    /精英 8%/.test(readFileSync(new URL('../js/xiuxian/spirit.js', import.meta.url), 'utf8'))
    && /普通 0\.8%/.test(readFileSync(new URL('../js/xiuxian/spirit.js', import.meta.url), 'utf8')));

  // 消费方 4：掉落档位（pickups.js 的 stone_2）
  const stoneOf = e => e.boss ? 'stone_3' : e.elite ? 'stone_2' : 'stone_1';
  t('源石档位：精英 → stone_2', stoneOf(eE) === 'stone_2', `实际 ${stoneOf(eE)}`);
}

console.log(`\n独立验证: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
process.exit(fail === 0 ? 0 : 1);
