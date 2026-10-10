// 吸血 / 回春 接进战斗测试 —— 工单 XX-EQUIP-004
// 运行: node tests/gear-combat-regression.mjs
//
// 背景:`main.js` 算完 `loadoutBonus()` 挂在 `p.gearBonus` 上,
// 但 `recalc()` 全程只读 `this.bonuses` —— **gearBonus 在 player.js 出现 0 次**,
// 整套装备的加成(含全部词条)全部悬空,一件都没生效。
// 症状极隐蔽:数据层、存档、UI 全正常,只是战斗里的数字不变。
//
// 本工单把它接上,并断言:
// 1. 装备加成真的进了 player.stats(不是只挂了个字段)
//  2. 吸血真的在伤害结算里回血,且 **DoT 不触发**
//  3. recalc() 反复调用**不会**把加成叠一遍
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

// player.js 只依赖少量环境,直接 import 真实实现 —— 不做桩,免得测了个假的
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.requestAnimationFrame = fn => { try { fn(0); } catch {} };

const { Player } = await import('../js/game/player.js');
const { GEAR, loadoutBonus } = await import('../js/game/gear.js');

/** 找到一件带吸血/回春的装备 id */
const withAffix = (a) => Object.keys(GEAR).find(id => (GEAR[id].affixes || {})[a]);
const lifestealId = withAffix('lifesteal');
const regenId     = withAffix('regen');

ok('装备表里有吸血词条装备', !!lifestealId, 'lifestealId=' + lifestealId);
ok('装备表里有回春词条装备', !!regenId, 'regenId=' + regenId);

// ————— 1. 加成真的进了 stats —————
{
  const p = new Player('knight');
  const bare = { might: p.stats.might, regen: p.stats.regen, lifestealPct: p.stats.lifestealPct };

  const slot = Object.keys(GEAR[lifestealId].affixes || {}) && Object.entries(GEAR[lifestealId].affixes || {})[0] ? null : null;
  // 装到它该在的槽位
  const { SLOTS } = await import('../js/game/gear.js');
  const lo = {};
  for (const s of SLOTS) if ((GEAR[lifestealId].affixes || {})[s.key]) { lo[s.key] = lifestealId; break; }
  // gear 的槽位与 SLOTS 的 key 未必同名,直接按 affix 找得到的那件装到第一个槽
  lo[SLOTS[0].key] = lifestealId;

  p.gearBonus = loadoutBonus(lo);
  p.recalc();

  ok('吸血词条进了 stats.lifestealPct', p.stats.lifestealPct > bare.lifestealPct,
     `${bare.lifestealPct} → ${p.stats.lifestealPct}`);
  ok('未装备时 lifestealPct 为 0', bare.lifestealPct === 0);
}

// ————— 2. 加法类叠加、乘法类相乘 —————
{
  const { SLOTS } = await import('../js/game/gear.js');
  const p1 = new Player('knight');
  p1.gearBonus = loadoutBonus({ [SLOTS[0].key]: lifestealId });
  p1.recalc();
  const one = p1.stats.lifestealPct;

  const p2 = new Player('knight');
  p2.gearBonus = loadoutBonus({ [SLOTS[0].key]: lifestealId, [SLOTS[1].key]: lifestealId });
  p2.recalc();
  ok('两件同词条装备会叠加', p2.stats.lifestealPct > one, `${one} → ${p2.stats.lifestealPct}`);
  ok('叠加是线性的(两件 = 两倍量级)', Math.abs(p2.stats.lifestealPct / one - 2) < 0.01,
     `比值 ${(p2.stats.lifestealPct / one).toFixed(4)}`);
}

// ————— 3. recalc() 反复调用不得重复累加(最容易出的膨胀 bug) —————
{
  const { SLOTS } = await import('../js/game/gear.js');
  const p = new Player('knight');
  p.gearBonus = loadoutBonus({ [SLOTS[0].key]: lifestealId });
  p.recalc();
  const after1 = p.stats.lifestealPct;
  for (let i = 0; i < 20; i++) { p.level = (p.level || 1) + 1; p.recalc(); }
  ok('连调 20 次 recalc 加成不变(不膨胀)', Math.abs(p.stats.lifestealPct - after1) < 1e-9,
     `${after1} → ${p.stats.lifestealPct}`);

  const r1 = new Player('knight');
  r1.gearBonus = loadoutBonus({ [SLOTS[0].key]: regenId });
  r1.recalc();
  const regen1 = r1.stats.regen;
  for (let i = 0; i < 20; i++) r1.recalc();
  ok('回春同理不膨胀', Math.abs(r1.stats.regen - regen1) < 1e-9, `${regen1} → ${r1.stats.regen}`);
  ok('回春确实进了 stats.regen', regen1 > 0, 'regen=' + regen1);
}

// ————— 4. 吸血真的在伤害结算里回血 —————
{
  const { damageEnemy } = await import('../js/game/enemies.js');
  const p = new Player('knight');
  p.stats.lifestealPct = 0.1;          // 10% 直接设定,绕开装备表
  p.hp = 50;
  const e = { x:0, y:0, r:10, hp:1000, maxHp:1000, dead:false, kbMult:1, pcol:'#fff',
              status:{}, burnT:0, hitT:0, flashT:0, kx:0, ky:0 };
  const g = {
    player: p, stats: { dmg: 0 }, cam:{ follow(){} },
    spawnText(){}, addParticles(){}, shake(){}, killEnemy(){},
    bus: { emit(){} },
  };
  // ⚠️ 必须钉死 `crit:false`,否则这条断言是**掷骰的**。
  //    damageEnemy(g,e,amount,o) 里 `o.crit === undefined` 会走
  //    `Math.random() < st.crit` 并把伤害乘 critDmg —— knight 的 crit=0.12、critDmg=1.6,
  //    所以约 12% 的运行里 100 伤害变 160,吸血 10 变 16,本条必红。
  //    这不是产品 bug(暴击 ×1.6 伤害 → ×0.1 吸血 = 16,数值自洽),
  //    是断言没把与被测项无关的随机源摁住。
  damageEnemy(g, e, 100, { crit: false });
  ok('打 100 伤害回 10 血', Math.abs(p.hp - 60) < 1e-6, 'hp=' + p.hp);
}

// ————— 5. DoT 不得触发吸血(否则站桩挨灼烧比主动开打更优) —————
{
  const { damageEnemy } = await import('../js/game/enemies.js');
  const p = new Player('knight');
  p.stats.lifestealPct = 0.1;
  p.hp = 50;
  const e = { x:0, y:0, r:10, hp:1000, maxHp:1000, dead:false, kbMult:1, pcol:'#fff',
              status:{}, burnT:0, hitT:0, flashT:0, kx:0, ky:0 };
  const g = { player:p, stats:{dmg:0}, cam:{follow(){}}, spawnText(){}, addParticles(){},
              shake(){}, killEnemy(){}, bus:{emit(){}} };
  damageEnemy(g, e, 100, { dot: 1, crit: false });
  ok('DoT 伤害不回血', Math.abs(p.hp - 50) < 1e-6, 'hp=' + p.hp);

  // 但联动伤害(synergy)算玩家主动触发,应回血
  const p2 = new Player('knight');
  p2.stats.lifestealPct = 0.1; p2.hp = 50;
  const g2 = { player:p2, stats:{dmg:0}, cam:{follow(){}}, spawnText(){}, addParticles(){},
               shake(){}, killEnemy(){}, bus:{emit(){}} };
  damageEnemy(g2, e, 100, { synergy: 1, crit: false });
  // 钉死 crit 后才有资格断言精确值。原来写的是 `> 50`:
  // 它能抓住「完全不回血」(hp=50 不过 >50),但**抓不住量级错误** ——
  // 暴击回 16、回血系数写错、忘了乘 GEAR_POWER 衰减,全都照样过。
  // 精确到 60 才能把「回血是对的」和「回血是多错的」分开。
  ok('联动伤害回血(玩家主动触发)', Math.abs(p2.hp - 60) < 1e-6, 'hp=' + p2.hp);
}

// ————— 6. heal() 的边界 —————
{
  const p = new Player('knight');
  p.hp = p.stats.maxHp - 5;
  ok('回血不超过上限', p.heal(999) === 5, '实际回 ' + p.heal(0) + ' / 上限处');
  const p2 = new Player('knight');
  p2.hp = 0;
  ok('死了不回血', p2.heal(100) === 0 && p2.hp === 0);
  const p3 = new Player('knight');
  ok('负数/NaN 回血无效', p3.heal(-10) === 0 && p3.heal(NaN) === 0);
}

// ————— 7. 源码契约:别把实现挪回 main.js(那是 UI 接线层) —————
{
  const ps = readFileSync(ROOT + '/js/game/player.js', 'utf8');
  const es = readFileSync(ROOT + '/js/game/enemies.js', 'utf8');
  const ms = readFileSync(ROOT + '/js/main.js', 'utf8');
  ok('player.js 有 bonusesBase(防重复累加)', /bonusesBase/.test(ps));
  ok('player.js 把 gearBonus 并进 bonuses', /this\.gearBonus/.test(ps));
  ok('player.js 导出 heal()', /^\s*heal\(amount\)/m.test(ps));
  ok('enemies.js 的吸血挂在唯一伤害入口', /damageEnemy[\s\S]{0,2500}lifestealPct/.test(es));
  ok('吸血显式排除 DoT', /!o\.dot/.test(es));
  ok('main.js 只做赋值不写公式(公式在 player/enemies)',
     !/lifesteal/.test(ms));
}

console.log(`\n吸血/回春接战斗: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('失败项:\n  - ' + failed.join('\n  - ')); process.exit(1); }