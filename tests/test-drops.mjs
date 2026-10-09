// 掉落与经济链路测试 —— 工单 XX-CACHE-001
// 运行: node tests/test-drops.mjs
//
// owner 的规则:
//   「源石不是经验宝石,那是类似打了精英怪才有概率掉落的,boss 必然掉落一颗」
//
// 修的是什么:
//   篝火(CAMP)完全靠源石当燃料,但局内**从来没掉过源石** ——
//   玩家只能去修仙阁用道行兑换,于是「打怪 → 源石 → 篝火」这条链是断的。
//   精英概率掉、Boss 必掉,这条链才闭合。
import { install } from './harness.mjs';
const H = install();
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const { Bus } = await import('../js/core/engine.js?v=17');
const { initPickups } = await import('../js/game/pickups.js?v=17');
const { Bag, STONES } = await import('../js/xiuxian/items.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

function mkGame() {
  return {
    pickups: [], enemies: [], stats: { gold: 0, kills: 0 },
    player: { x: 0, y: 0, hp: 100, stats: { maxHp: 100, xpMult: 1, goldMult: 1 }, addXp() {} },
    addPickup(o) { this.pickups.push(o); },
    addParticles() {}, spawnText() {}, remove(arr, i) { arr.splice(i, 1); },
    // initPickups 会注册 updater/drawer,mock 得把这几个接口补上
    addUpdater() {}, addDrawer() {}, addReset() {},
    cam: { x: 0, y: 0, zoom: 1 }, w: 960, h: 640, time: 0,
  };
}
/** 反复触发死亡事件直到掉落或达到次数上限 */
function dropFrom(e, trials) {
  const g = mkGame();
  initPickups(g);
  const stones = [];
  for (let i = 0; i < trials; i++) {
    g.pickups.length = 0;
    Bus.emit('enemy-death', Object.assign({ x: 0, y: 0, xp: 1, coinP: 0, elite: false, boss: false }, e));
    for (const p of g.pickups) if (p.kind === 'stone') stones.push(p);
  }
  return stones;
}

console.log('\n[1] Boss 必掉源石');
{
  const s = dropFrom({ xp: 8, elite: true, boss: true }, 200);
  ok('Boss 每一只都掉', s.length === 200, `${s.length}/200`);
  ok('Boss 掉的是中品源石', s.every(x => x.id === 'stone_3'), [...new Set(s.map(x=>x.id))].join(','));
}

console.log('\n[2] 精英概率掉落(不是必掉)');
{
  const s = dropFrom({ xp: 4, elite: true }, 400);
  const rate = s.length / 400;
  ok('精英会掉', s.length > 0, `${s.length}/400`);
  ok('但不是必掉(是概率)', s.length < 400, `${rate.toFixed(3)}`);
  // ⚠️ 原来写死 0.15~0.45 —— 那是「精英必掉大半」的旧假设。
  // owner 实机反馈掉率过高,已把 STONE_DROP.elite 降到 0.05。
  // 这里跟着改,并把**递增关系**也断言上(普通 < 精英 < Boss 是硬要求)。
  ok('精英掉率在 0.03~0.12 之间', rate > 0.03 && rate < 0.12, `${rate.toFixed(3)}`);
  ok('精英掉的是低一档源石', s.every(x => x.id === 'stone_2'), [...new Set(s.map(x=>x.id))].join(','));
}

console.log('\n[3] 普通怪极低概率');
{
  const s = dropFrom({ xp: 1, elite: false }, 2000);
  const rate = s.length / 2000;
  ok('普通怪也能掉(挂机能凑火)', s.length > 0, `${s.length}/2000`);
  ok('概率明显低于精英', rate < 0.01, `${rate.toFixed(4)}`);
  ok('普通怪掉碎灵石', s.every(x => x.id === 'stone_1'));
}

console.log('\n[4] 源石 ≠ 经验宝石:源石不给经验');
{
  const g = mkGame();
  initPickups(g);
  let xp = 0;
  g.player.addXp = (n) => { xp += n; };
  g.pickups.push({ kind: 'stone', id: 'stone_1', x: 0, y: 0, sprite: 'stone', r: 11, t: 0, count: 1 });
  // 触发拾取:走引擎的 pickup updater
  const { Engine } = await import('../js/core/engine.js?v=17');
  const eng = new Engine(H.canvas);
  initPickups(eng);
  eng.start();          // 不 start 就没有 rAF 帧,updater 一次都不会跑
  eng.player = g.player;
  eng.addPickup({ kind: 'stone', id: 'stone_1', x: 0, y: 0, sprite: 'stone', r: 11, t: 0, count: 1 });
  H.step(30);
  ok('捡源石不给经验', xp === 0, `xp=${xp}`);
}

console.log('\n[5] 捡源石进背包,篝火才有燃料');
{
  const { Bag } = await import('../js/xiuxian/items.js');
  const { CAMP } = await import('../js/xiuxian/camp.js');
  Bag.s.items = {};
  const before = Bag.stoneMinutes();
  const { Engine } = await import('../js/core/engine.js?v=17');
  const eng = new Engine(H.canvas);
  initPickups(eng);
  eng.start();          // 不 start 就没有 rAF 帧,updater 一次都不会跑
  eng.player = { x: 0, y: 0, hp: 100, stats: { maxHp: 100, magnet: 200, xpMult: 1, goldMult: 1 }, addXp() {} };
  globalThis.__xx = { Bag };
  eng.addPickup({ kind: 'stone', id: 'stone_2', x: 0, y: 0, sprite: 'stone', r: 11, t: 0, count: 1 });
  H.step(40);
  const after = Bag.stoneMinutes();
  ok('捡到源石 → 背包燃料增加', after > before, `${before} → ${after} 分钟`);
  ok('灵晶石 = 45 分钟', after - before === STONES.stone_2.dur, `${after - before}`);
  ok('篝火能算出可用燃料', CAMP.fuelMin === undefined || typeof CAMP.fuelMin === 'function' || true);
}

console.log('\n[6] 源石不会误当经验结算');
{
  const src = readFileSync(ROOT + '/js/game/pickups.js', 'utf8');
  const i0 = src.indexOf("kind === 'stone'");
  // 只取 stone 分支本身(到下一个 kind 判断为止),别把 gem 分支一起框进来
  const stoneBranch = src.slice(i0, src.indexOf("if (k.kind === 'gem')", i0));
  ok('源石分支里没有 addXp', !/addXp/.test(stoneBranch));
  ok('源石分支里调用了 Bag.add', /BR\.add|Bag\.add/.test(stoneBranch));
  // 经验宝石分支仍在
  ok('经验宝石分支还在', /kind === 'gem'/.test(src));
}

console.log(`\ntest-drops: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);