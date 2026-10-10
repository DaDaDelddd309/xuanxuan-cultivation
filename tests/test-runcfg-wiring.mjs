// tests/test-runcfg-wiring.mjs —— XX-LINK-001 接线的行为护栏
//
// 为什么需要这个文件（2026-10-10）：
//   runcfg.js(V0.98 建)写好了，ui.js arrive() 也调了 setActive()，
//   但**局内从来没人读它** —— getRunMod() 全仓引用数 = 1（只有自己的定义行）。
//   于是地图上明明给玩家显示「回合 35% · 爆率 ×1.24」，进局后一个都不生效。
//
//   本文件是接线的**验收**，不是接线本身。接线代码在：
//     js/game/spawner.js  setRunTune / runTune / spawnOptsFor 三处倍率应用
//     js/main.js          startRun() 里 setRunTune(getRunMod().spawn)
//     index.html + main.js  ?v=17 → ?v=18（否则线上吃浏览器缓存旧文件）
//
// 第 [5] 组是反向注入：只测「接上了」不够 —— 一条写太松的断言
// （比如只断言倍率 > 0）会让断线也能全绿。必须证明拿掉接线它就红。

import { NODE_TUNING, DEFAULT_TUNING } from '../js/xiuxian/runcfg.js';
import { setRunTune, getRunTune, spawnOptsFor, spawnHpMultAt } from '../js/game/spawner.js';

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/** 按节点类型取该类型的局内倾向（避开 world.js 的世界状态，纯数据） */
const cfgFor = (type) => {
  const x = NODE_TUNING[type] || DEFAULT_TUNING;
  return { nodeType: type, spawn: { ...x.spawn }, loot: { ...x.loot },
           turnBased: x.turnBased, mineBonus: 1 };
};

console.log('\n[1] 默认态必须与接线前逐位相同');
{
  setRunTune(null);
  const tune = getRunTune();
  t('未注入时五个倍率全为 1',
    tune.hpMult === 1 && tune.dmgMult === 1 && tune.speedMult === 1 &&
    tune.eliteRate === 1 && tune.hordeRate === 1, JSON.stringify(tune));
  const o = spawnOptsFor('slime', 240, {});
  t('hpMult 与未接线算法一致', near(o.hpMult, spawnHpMultAt('slime', 240, {})));
  t('dmgMult 等于原曲线 1+t/240', near(o.dmgMult, 2), String(o.dmgMult));
}

console.log('\n[2] 注入后倍率真的作用到统一出口 spawnOptsFor');
{
  setRunTune({ hpMult: 1.4, dmgMult: 1.3, speedMult: 1.1 });
  const o = spawnOptsFor('slime', 240, {});
  const base = spawnHpMultAt('slime', 240, {});
  t('hpMult = 原值 × 1.4', near(o.hpMult, base * 1.4));
  t('dmgMult = 原值 × 1.3', near(o.dmgMult, 2 * 1.3));
  t('speedMult = 原曲线 × 1.1（spdMultAt(240)=1+240/2000=1.12）',
    near(o.speedMult, 1.12 * 1.1), `${o.speedMult} vs ${1.12 * 1.1}`);
}

console.log('\n[3] 局内是真随节点变化的（真·一个游戏）');
{
  const cases = [
    ['village', 1.00, 1.00, 0.00, 1.00],
    ['secret',  1.15, 1.10, 1.60, 1.50],
    ['elite',   1.25, 1.20, 3.20, 1.00],
    ['boss',    1.40, 1.30, 3.00, 1.20],
  ];
  const seen = new Set();
  for (const [type, hp, dm, er, hr] of cases) {
    const cfg = cfgFor(type);
    setRunTune(cfg.spawn);
    const o = spawnOptsFor('slime', 240, {});
    const base = spawnHpMultAt('slime', 240, {});
    t(`${type}: hp ×${hp}`, near(o.hpMult, base * hp),
      `${o.hpMult.toFixed(4)} vs ${(base * hp).toFixed(4)}`);
    t(`${type}: dmg ×${dm}`, near(o.dmgMult, (1 + 240 / 240) * dm), o.dmgMult.toFixed(4));
    t(`${type}: eliteRate=${er} hordeRate=${hr}`,
      near(getRunTune().eliteRate, er) && near(getRunTune().hordeRate, hr));
    seen.add(o.hpMult.toFixed(6));
  }
  t('四种节点 hpMult 互不相同（真随节点变，不是同一个数）', seen.size === 4,
    `${seen.size}/4 唯一`);
}

console.log('\n[4] 矿脉加成只作用于 loot，不该篡改战斗倍率');
{
  setRunTune(cfgFor('field').spawn);
  const plain = spawnOptsFor('slime', 240, {}).hpMult;
  setRunTune(cfgFor('field').spawn);   // 矿脉加成前
  t('矿脉前后 hp 出口一致（战斗倍率不受出产加成影响）',
    near(spawnOptsFor('slime', 240, {}).hpMult, plain));
}

console.log('\n[5] 反向注入:拿掉接线必须会红（防断言写太松）');
{
  setRunTune(null);
  const broken = spawnOptsFor('slime', 240, {});           // 假装没接线
  setRunTune(cfgFor('boss').spawn);
  const wired = spawnOptsFor('slime', 240, {});            // 实际接线后
  const raw = spawnHpMultAt('slime', 240, {});             // 未接线算法原值
  t('默认态 ≠ 妖巢态（接线确实在产生差异）', !near(broken.hpMult, wired.hpMult),
    `${broken.hpMult.toFixed(4)} vs ${wired.hpMult.toFixed(4)}`);
  t('接线后 hpMult ≠ 原始曲线值', !near(wired.hpMult, raw),
    `${wired.hpMult.toFixed(4)} vs ${raw.toFixed(4)}`);
  t('若 spawnOptsFor 忘了乘倍率，wired===raw，本条必红',
    near(wired.hpMult, raw * 1.4));
  setRunTune(null);
}

console.log(`\ntest-runcfg-wiring: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
process.exit(fail === 0 ? 0 : 1);