// tests/test-runcfg-loot-wiring.mjs —— XX-LINK-001 掉落侧的行为护栏
//
// 战斗侧见 test-runcfg-wiring.mjs(倍率作用于 spawnOptsFor 这个纯函数,好测)。
// 掉落侧不一样:逻辑挂在 Bus.on('enemy-death') 回调里,**没有可直接断言的纯函数**,
// 所以这里真的 emit 一批死亡事件、统计掉了什么 —— 而不是只断言系数被乘上去。
//
// 接入点:js/game/pickups.js 的 lootTune(模块级变量 + setter,不 import 局外)
// 接线点:js/main.js startRun() 里 setLootTune(getRunMod().loot)
//
// ⚠️ 本文件同时是 village 那个未决矛盾的「证据留档」:
//    断言 [5] 会如实记录 gemBias=0 时经验为 0,与「平稳开局」的注释意图冲突,
//    等待 owner 裁定(改 NODE_TUNING 取值,而不是改这里)。

import { NODE_TUNING, DEFAULT_TUNING } from '../js/xiuxian/runcfg.js';
import { setLootTune, getLootTune, initPickups } from '../js/game/pickups.js';
const { Bus } = await import('../js/core/engine.js?v=17');

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

// initPickups 会读 location.search（dev 分支），node 里没有这个全局，补一个空的
if (typeof globalThis.location === 'undefined') {
  globalThis.location = { search: '', hash: '', href: 'file:///test' };
}

// initPickups 会注册 updater/drawer/粒子等，本测试只关心 enemy-death 的掉落，
// 所以把 g 补成一张「什么都收下」的网，而不是逐个实现行为。
const NOOP = () => {};
const drops = [];
const fakeG = {
  addPickup: (p) => drops.push(p),
  addUpdater: NOOP, addDrawer: NOOP, addParticles: NOOP,
  spawnText: NOOP, shake: NOOP, remove: NOOP,
  inView: () => true,
  mjs: { w: 1920, h: 1080 },
  pickups: [], w: 1920, h: 1080,
  stats: { gold: 0, xp: 0 },
  player: { x: 0, y: 0, hp: 100, maxHp: 100, stats: { goldMult: 1, magnet: 1 } },
};
initPickups(fakeG);

/** 杀掉一批敌人,返回掉落统计 */
function killBatch(n, enemy) {
  drops.length = 0;
  for (let i = 0; i < n; i++) Bus.emit('enemy-death', enemy);
  const by = {};
  for (const d of drops) by[d.kind] = (by[d.kind] || 0) + 1;
  const gemXp = drops.filter(d => d.kind === 'gem').reduce((a, d) => a + (d.xp || 0), 0);
  return { by, gemXp, drops: drops.slice() };
}

const MOB = { x: 10, y: 10, xp: 4, coinP: 0.5, elite: false, boss: false };
const BOSS = { x: 10, y: 10, xp: 40, coinP: 1, elite: true, boss: true };

const cfgFor = (type) => {
  const x = NODE_TUNING[type] || DEFAULT_TUNING;
  return { spawn: { ...x.spawn }, loot: { ...x.loot } };
};

console.log('\n[1] 默认态必须与接线前逐位相同');
{
  setLootTune(null);
  const tune = getLootTune();
  t('未注入时四个 bias 全为 1',
    tune.gemBias === 1 && tune.coinBias === 1 && tune.meatBias === 1 && tune.chestBias === 1,
    JSON.stringify(tune));
  const r = killBatch(200, MOB);
  t('gem 经验总量 = 4 × 200（未被缩放）', r.gemXp === 800, String(r.gemXp));
}

console.log('\n[2] gemBias 作用于经验量（秘境 ×2）');
{
  setLootTune({ gemBias: 2 });
  const r = killBatch(200, MOB);
  t('gem 经验 = 800 × 2', r.gemXp === 1600, String(r.gemXp));

  setLootTune({ gemBias: 0.7 });   // 险地 meatBias 侧,这里验证 <1 也生效
  const r2 = killBatch(200, MOB);
  t('gemBias=0.7 时经验 = 560', Math.round(r2.gemXp) === 560, String(r2.gemXp));
}

console.log('\n[3] coinBias / meatBias 作用于掉率（统计验证,非固定值）');
{
  // coin: 基础掉率 0.5,bias=2 应显著高于 bias=0.5
  setLootTune({ coinBias: 1 });
  const a = killBatch(4000, MOB).by.coin || 0;
  setLootTune({ coinBias: 2 });
  const b = killBatch(4000, MOB).by.coin || 0;
  setLootTune({ coinBias: 0 });
  const c = killBatch(4000, MOB).by.coin || 0;
  t('coinBias=0 → 一枚不掉', c === 0, `掉了 ${c}`);
  t('coinBias=2 明显多于 coinBias=1', b > a * 1.4, `×2=${b} vs ×1=${a}`);

  // meat: 普通怪基础 0.018,bias=3 应明显变多
  setLootTune({ meatBias: 1 });
  const m1 = killBatch(6000, MOB).by.meat || 0;
  setLootTune({ meatBias: 4 });
  const m2 = killBatch(6000, MOB).by.meat || 0;
  t('meatBias=4 明显多于 meatBias=1', m2 > m1, `×4=${m2} vs ×1=${m1}`);
}

console.log('\n[4] chestBias 作用于 Boss 宝箱数,且不把宝箱吃掉');
{
  setLootTune({ chestBias: 1 });
  const base = killBatch(1, BOSS).by.chest || 0;
  setLootTune({ chestBias: 2 });
  const two = killBatch(1, BOSS).by.chest || 0;
  setLootTune({ chestBias: 0.2 });   // 向下:倍率不该把 Boss 宝箱清零
  const low = killBatch(1, BOSS).by.chest || 0;
  t(`默认 Boss 掉 ${base} 个箱`, base === 2, String(base));
  t('chestBias=2 → 4 个箱', two === 4, String(two));
  t('chestBias=0.2 → 仍保底 1 个（倍率不吃掉 Boss 箱）', low === 1, String(low));
}

// [5] 原来这一组是「未决矛盾留档」——它把 gemBias=0 这个**bug 状态**钉住了,
//     断言「村庄局经验确实是 0」。2026-10-11 该值判定为笔误并修正后,
//     钉子自然崩了。改成断言**修复后**的行为,并自带反向注入证明断言有牙。
console.log('\n[5] village 是固定起点,倍率必须是 1（0 = 整局无法升级）');
{
  const v = cfgFor('village');
  t('NODE_TUNING.village.loot.gemBias = 1', v.loot.gemBias === 1, String(v.loot.gemBias));
  t('且 coinBias = 1', v.loot.coinBias === 1, String(v.loot.coinBias));
  setLootTune(v.loot);
  const r = killBatch(300, MOB);
  t('实测：村庄局 300 只怪 → 经验 > 0（能升级）', r.gemXp > 0, String(r.gemXp));
  t('且铜钱掉落数 > 0（killBatch 返回的是 by.coin 计数,不是金额）',
    (r.by.coin || 0) > 0, JSON.stringify(r.by));
  t('村庄的产出低于秘境（倍率确实起作用,不是恒为 1）', r.gemXp < 4800, String(r.gemXp));

  // 反向注入:若 gemBias 回到 0,经验必须归零 —— 证明上面那条不是恒真
  setLootTune({ ...v.loot, gemBias: 0, coinBias: 0 });
  const bad = killBatch(300, MOB);
  t('注入 gemBias=0 → 经验确实归零（故上面那条有牙）', bad.gemXp === 0, String(bad.gemXp));
  setLootTune(v.loot);
  console.log('  ℹ️  这条曾以「未决矛盾留档」的形式存在,钉的是 bug 状态。');
  console.log('     判定依据:runcfg 开头「数值是相对倍率」、village 自己的 note「一切照常」、');
  console.log('     兄弟节点 field 四项全 1 —— 且 0×1.5(mineBonus)=0,矿脉加成盖不住。');
}

console.log('\n[6] 局内四种节点掉落画像应互不相同（真·一个游戏）');
{
  const sig = new Set();
  for (const type of ['village', 'field', 'elite', 'secret', 'boss']) {
    setLootTune(cfgFor(type).loot);
    const r = killBatch(600, MOB);
    const key = [r.gemXp, r.by.coin || 0, r.by.meat || 0, r.by.chest || 0].join('/');
    sig.add(key);
    console.log(`     ${type.padEnd(8)} gemXp=${String(r.gemXp).padEnd(6)} coin=${String(r.by.coin || 0).padEnd(4)} meat=${String(r.by.meat || 0).padEnd(4)} chest=${r.by.chest || 0}`);
  }
  t('五种节点的掉落画像互不相同', sig.size === 5, `${sig.size}/5 唯一`);
}

console.log(`\ntest-runcfg-loot-wiring: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
process.exit(fail === 0 ? 0 : 1);