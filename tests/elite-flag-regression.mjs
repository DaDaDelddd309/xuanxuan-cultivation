// tests/elite-flag-regression.mjs —— 精英身份标志必须真的传到 spawnEnemy(XX-LINK-004)
// 运行: node tests/elite-flag-regression.mjs
//
// 背景(2026-10-11 实测,自 7856c5e / V0.99 起):
//   `spawnOptsFor(type, t, o)` 原先只回 { hpMult, dmgMult, speedMult },
//   把调用方 `spawnOptsFor(et, t, { elite: true })` 传的 elite **吃掉了**。
//   于是 spawnEnemy 里 `const elite = !!o.elite` 恒为 false ——
//   ×6 血 / ×5 经验 / ×3 金币 / 1.3 倍体型 / 朱砂圈标记 / 精英必掉宝箱 /
//   掉落档位 stone_2 / 建筑击杀档位 onKillTier(1) **全部失效**。
//   而 eliteHpMultAt 单走一条比普通更缓的曲线(60s 处 1.2 vs 1.35),
//   于是「精英」实际**比普通怪更弱**。
//
// 为什么值得单开一个文件:
//   90+ 门禁一条都没覆盖这条路。修好 spawnOptsFor 之后,
//   全部测试 + legacy + rng + e2e + lint **一个都没红**。
//   门禁全绿 ≠ 接线是对的 —— 它们没碰过「精英身份标志」这件事。
//
// ×6 / ×5 / ×3 / 1.3 全部来自 ELITE_HP_POINTS 上方注释与 spawnEnemy 既有实现,
// 不是从 spawnOptsFor 的实现反推的(同源断言是假绿的头号来源)。

import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('\n[0] 自检:本文件用的戳必须与 main.js 一致');
// XX-AUDIT-027 / XX-LINK-003 的教训:测试侧与产品侧戳不一致 = 两份模块实例,
// 症状是「测试全绿但浏览器里是死的」。把一致性做成硬断言,而不是靠人记得。
//
// ⚠️ 这里原本是 `mSp[1] === '18'` —— 拿 main.js 的戳去比一个**硬编码字面量**。
//    升戳时它必然变红,而红的原因不在被测代码、在这个断言自己。
//    改成**自指**:拿 main.js 的戳和本文件自己 import 的戳比。
//    任何一处漏改都会被抓到,且不需要人来改这里的字面量。
{
  const mainSrc = readFileSync(_rv(ROOT, 'js/main.js'), 'utf8');
  const selfSrc = readFileSync(new URL(import.meta.url), 'utf8');
  const mSp = mainSrc.match(/from '\.\/game\/spawner\.js\?v=(\d+)'/);
  const mEn = mainSrc.match(/from '\.\/game\/enemies\.js\?v=(\d+)'/);
  const sSp = selfSrc.match(/spawner\.js\?v=(\d+)/);
  const sEn = selfSrc.match(/enemies\.js\?v=(\d+)/);
  const ok = mSp && mEn && sSp && sEn
    && mSp[1] === sSp[1] && mEn[1] === sEn[1];
  t(`本文件的戳与 main.js 一致（spawner=?v=${mSp?.[1]} / enemies=?v=${mEn?.[1]}）`, ok,
    ok ? '' : `本文件硬编码 spawner=?v=${sSp?.[1]} / enemies=?v=${sEn?.[1]},`
          + `main.js 是 spawner=?v=${mSp?.[1]} / enemies=?v=${mEn?.[1]} —— 版本号变了要一起改这里`);
  if (!ok) {
    console.log('\n❌ 戳不一致,继续跑只会得到假结果 —— 门禁自身失效,别信结论');
    process.exit(2);
  }
}

const S = await import('../js/game/spawner.js?v=19');
const E = await import('../js/game/enemies.js?v=17');
const { setRunTune, setSpawnMode, initSpawner, spawnOptsFor, eliteHpMultAt, spawnHpMultAt, hpMultAt } = S;
const { spawnEnemy, ENEMY_TYPES, ENEMY_MOD, combatState } = E;

const T = 60;
function mkG() {
  const g = { time: T, w: 800, h: 600, cam: { zoom: 1 }, player: { x: 0, y: 0 },
    enemies: [], pickups: [], projectiles: [], zones: [], grid: { insert() {}, clear() {} } };
  g.addEnemy = e => { e.__bornAt = g.time; g.enemies.push(e); return e; };
  g.addProjectile = () => true; g.addZone = () => true;
  g.spawnText = () => {}; g.addParticles = () => {};
  g.__spawnOpts = () => ({}); g.addReset = () => {};
  let upd = null; g.addUpdater = fn => { upd = fn; }; g.__tick = dt => upd(dt);
  return g;
}

console.log('\n[1] 前置:基准不是从被测代码反推的');
{
  t('ENEMY_MOD 三项均为 1', ENEMY_MOD.hp === 1 && ENEMY_MOD.dmg === 1 && ENEMY_MOD.spd === 1,
    JSON.stringify(ENEMY_MOD));
  t('精英曲线在 60s 处比普通曲线缓（这正是当初精英更弱的原因）',
    eliteHpMultAt(60) < hpMultAt(60), `elite ${eliteHpMultAt(60)} vs normal ${hpMultAt(60)}`);
  const B = ENEMY_TYPES.slime;
  t('基准怪 slime 字段可读', !!B && B.hp > 0, JSON.stringify({ hp: B.hp, r: B.r, xp: B.xp, coinP: B.coinP }));
}

console.log('\n[2] 身份标志必须透传（原来被吃掉的那一半）');
{
  const eo = spawnOptsFor('slime', T, { elite: true });
  t('spawnOptsFor(type,t,{elite:true}) 返回值带 elite=true', eo.elite === true, JSON.stringify(eo));
  t('普通调用不带 elite 键（spawnEnemy 默认 false，行为不变）', !('elite' in spawnOptsFor('slime', T, {})));
  t('三个倍率仍在（修复没把它们弄丢）',
    near(eo.hpMult, spawnHpMultAt('slime', T, { elite: true })) &&
    typeof eo.dmgMult === 'number' && typeof eo.speedMult === 'number', JSON.stringify(eo));
}

console.log('\n[3] 走真实生产路径，逐字段核对（slime, t=60）');
{
  const g = mkG(); const B = ENEMY_TYPES.slime;
  spawnEnemy(g, 'slime', 0, 0, spawnOptsFor('slime', T, {}));
  spawnEnemy(g, 'slime', 0, 0, spawnOptsFor('slime', T, { elite: true }));
  const [n, e] = g.enemies;
  t('精英的 e.elite 为 true', e.elite === true, String(e.elite));
  t(`精英血量 = 基础 ${B.hp} × elite曲线 ${eliteHpMultAt(T)} × 6`,
    near(e.hp, B.hp * eliteHpMultAt(T) * 6), `${e.hp} vs ${B.hp * eliteHpMultAt(T) * 6}`);
  t('精英血量确实高于同刻普通怪（不能反成更弱）', e.hp > n.hp, `${e.hp} vs ${n.hp}`);
  t('精英经验 = 普通 ×5', e.xp === n.xp * 5, `${e.xp} vs ${n.xp}`);
  t('精英 coinP = 普通 ×3', near(e.coinP, Math.min(1, n.coinP * 3)), `${e.coinP} vs ${n.coinP}`);
  t('精英体型 = 普通 ×1.3', near(e.r, n.r * 1.3), `${e.r} vs ${n.r}`);
  t('精英伤害 = 普通 ×1.5', near(e.dmg, n.dmg * 1.5), `${e.dmg} vs ${n.dmg}`);
}

console.log('\n[4] 真引擎端到端：跑刷怪器 updater 必须刷出 e.elite=true');
{
  setRunTune({ hpMult: 1, dmgMult: 1, speedMult: 1, eliteRate: 3.2, hordeRate: 1 });
  setSpawnMode('timed');
  const g = mkG(); initSpawner(g);
  combatState.runActive = true; g.time = T;
  for (let i = 0; i < 40 && !g.enemies.some(x => x.elite === true); i++) { g.time += 20; g.__tick(20); }
  const elites = g.enemies.filter(x => x.elite === true);
  t('eliteRate=3.2 时刷出了精英', elites.length > 0, `场上精英 ${elites.length} / 总 ${g.enemies.length}`);
  if (elites.length === 0) {
    t('[4] 组数据存在（否则下面都是空断言）', false, '一只精英都没有，本组无法验');
  } else {
    // 期望值独立重述两条规则，两侧分支都要覆盖：
    //   A 曲线 eliteHpMultAt(出生时刻)   B 保底 minOrdinaryHpAt = max(0,t-180)×1.75 ÷ 基础血
    const minOrd = x => Math.max(0, x - 180) * 1.75;
    const want = (id, at) => {
      const b = ENEMY_TYPES[id].hp;
      return b * Math.max(eliteHpMultAt(at), minOrd(at) / Math.max(1, b)) * 6;
    };
    const bad = elites.filter(x => !near(x.hp, want(x.type, x.__bornAt)));
    t(`${elites.length} 只精英血量都 = 基础 × max(曲线, 保底) × 6（按各自出生时刻）`,
      bad.length === 0,
      bad.length ? `type=${bad[0].type} bornAt=${bad[0].__bornAt} hp=${bad[0].hp} 期望 ${want(bad[0].type, bad[0].__bornAt)}` : '');
    const onCurve = elites.filter(x => eliteHpMultAt(x.__bornAt) >= minOrd(x.__bornAt) / Math.max(1, ENEMY_TYPES[x.type].hp));
    t('其中至少一只走的是「曲线」分支（不是只被保底兜住）', onCurve.length > 0, `曲线分支 ${onCurve.length} 只`);
    t('普通怪没有被误标成精英', g.enemies.some(x => x.elite !== true));
    t('精英数量远少于普通怪（不是把所有怪都标成精英）', elites.length < g.enemies.length / 2,
      `精英 ${elites.length} / 总 ${g.enemies.length}`);
  }
  setRunTune(null);
}

console.log('\n[5] 精英也吃 minOrdinaryHpAt 保底 —— 设计语义，钉住它');
{
  // [4] 第一版只验「曲线」分支，被 bat 在 t=200 的保底项打红过。
  // 那不是代码错，是断言写窄了：minOrdinaryHpAt 的注释写的是「低基础血量**怪**的后期保底」，
  // 但 spawnHpMultAt 里它对 elite 也生效。低基础血的怪从某个时刻起保底会盖过精英曲线。
  const B = ENEMY_TYPES.bat.hp;
  const cross = [];
  for (let x = 180; x <= 400; x += 20) if ((x - 180) * 1.75 / B >= eliteHpMultAt(x)) cross.push(x);
  t('bat 的保底项确实会在某个时刻盖过精英曲线', cross.length > 0, `起始 t=${cross[0] ?? '未发生'}`);
  const g = mkG();
  spawnEnemy(g, 'bat', 0, 0, spawnOptsFor('bat', 200, { elite: true }));
  t('t=200 的 bat 精英 = 基础 9 × 保底 (20×1.75/9) × 6 = 210（不是曲线值）',
    near(g.enemies[0].hp, 210), String(g.enemies[0].hp));
  t('但它仍远强于同刻普通 bat（×6 照常叠加）',
    g.enemies[0].hp > B * hpMultAt(200), `${g.enemies[0].hp} vs ${B * hpMultAt(200)}`);
}

console.log('\n[6] 反向注入：拿掉 ...o 必须变红');
{
  const legacy = { hpMult: spawnHpMultAt('slime', T, { elite: true }), dmgMult: 1, speedMult: 1 };
  t('老写法返回值里没有 elite 键', !('elite' in legacy), JSON.stringify(legacy));
  const g = mkG();
  spawnEnemy(g, 'slime', 0, 0, legacy);
  t('老写法喂进去，e.elite 必为 false', g.enemies[0].elite === false);
  t('老写法下精英比普通怪更弱 —— 这就是修复前的真实状况',
    g.enemies[0].hp < ENEMY_TYPES.slime.hp * hpMultAt(T),
    `${g.enemies[0].hp} vs ${ENEMY_TYPES.slime.hp * hpMultAt(T)}`);
  t('因此 [3] 的「精英血量 > 普通怪血量」正是防老写法的',
    ENEMY_TYPES.slime.hp * eliteHpMultAt(T) * 6 > ENEMY_TYPES.slime.hp * hpMultAt(T));
}

console.log(`\nelite-flag-regression: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
process.exit(fail ? 1 : 0);
