// 灵气/源石链路实测 —— 工单 XX-QA-003 / XX-QA-004
// 运行: node tests/xx-qa-003-spirit-stone-chain.mjs
//
// 回答的是 CI `browser` job 上这两条红的根因:
//   ❌ 灵气会被自动吸取并累计(ling=0)
//   ❌ 源石真的进背包了(0→0, ling=0)
//
// 方法论(项目铁律「度量工具自己出错比没有度量工具更危险」):
//   1. **固定随机源**:下面所有实跑都跑在同一个种子驱动的 Math.random 上。
//      不固定的话,8/9 的运行会假绿 —— 这正是「门禁自己撒谎」的一种。
//   2. **只钉结构性质**:钉「掉落会不会发生 / 记几次 / 进不进包」,
//      不钉「这一局必须恰好掉 N 颗」这种会被平衡改动误伤的具体数值。
//   3. **门禁自带反向注入**:第 [5] 节把生产模块在内存里改坏再导入,
//      证明这些断言真的会红 —— 否则「全绿」不能证明任何事。
//
// 复现步骤见文件末尾 README 段。
import { install } from './harness.mjs';
const H = install();
import { readFileSync } from 'fs';
import { fileURLToPath as _fu, pathToFileURL as _p2u } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n}${d ? '  ' + d : ''}`); }
};
const info = (...a) => console.log('   ·', ...a);

/** 确定性随机源:mulberry32(与 tests/mutation-regression.mjs 同一实现) */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 20261011;
const REAL_RND = Math.random;
Math.random = seeded(SEED);   // 必须早于任何 import:模块顶层也会掷骰

// —— 真实加载生产模块(与 main.js 用完全相同的 specifier,含 ?v=17)——
const V = '?v=17';
const { Bus } = await import('../js/core/engine.js' + V);
const { Engine } = await import('../js/core/engine.js' + V);
const { Camera } = await import('../js/core/camera.js' + V);
const { Input } = await import('../js/core/input.js' + V);
const { Save } = await import('../js/core/save.js' + V);
const { SFX } = await import('../js/core/audio.js' + V);
const { bake } = await import('../js/sprites.js' + V);
const { Player } = await import('../js/game/player.js' + V);
const { initMap } = await import('../js/game/map.js' + V);
const { initParticles } = await import('../js/game/particles.js' + V);
const { initCombat, combatState } = await import('../js/game/enemies.js' + V);
const { initSpawner } = await import('../js/game/spawner.js' + V);
const { initBoss } = await import('../js/game/boss.js' + V);
const { initPickups } = await import('../js/game/pickups.js' + V);
const { makeWeapon } = await import('../js/game/weapons.js' + V);
const { spawnOptsFor } = await import('../js/game/spawner.js' + V);
const { SPIRIT } = await import('../js/xiuxian/spirit.js');
const loot = await import('../js/xiuxian/loot.js');
const { Bag } = await import('../js/xiuxian/items.js');

const { CHARGE, GATE, gateDrop, gateProgress, resetGate } = loot;

// ════════════════════════════════════════════════════════════════
// [1] 掉落 → 磁吸 → 拾取 → 记账 → 入包:逐环用生产函数实跑
// ════════════════════════════════════════════════════════════════
console.log('\n[1] 逐环实跑(真实模块,固定随机)');

// —— 1.1 掉落环:门槛充能 ————————————————————————————————
// 结构性质:门槛门槛值必须能被「一局真实击杀量」跨过,且是加法模型。
{
  resetGate();
  ok('GATE.spirit 是正的有限数', Number.isFinite(GATE.spirit) && GATE.spirit > 0, `GATE.spirit=${GATE.spirit}`);
  ok('CHARGE 三档都是正数', CHARGE.normal > 0 && CHARGE.elite > CHARGE.normal && CHARGE.boss > CHARGE.elite,
     JSON.stringify(CHARGE));
  // 攒满一档要多少只普通怪 —— 这是「一局能不能出灵气」的**结构性**答案
  const need = Math.ceil(GATE.spirit / CHARGE.normal);
  info(`门槛:普通怪 ${CHARGE.normal}/只、精英 ${CHARGE.elite}/只、boss ${CHARGE.boss}/只,` +
       `spirit 门槛 ${GATE.spirit} → 纯普通怪需 ${need} 只`);
  ok('纯普通怪凑满门槛所需的击杀量在一局量级内(≤300)', need <= 300, `${need} 只`);
}

// —— 1.2 掉落环:一次死 n 只只跑一次加法,出货由内层权重决定 ——
{
  resetGate();
  // 用固定随机把 roll() 的结果也钉住:gateDrop 跨过几次门槛就该出几次货
  let batches = 0, drops = 0;
  Math.random = () => 0.0001;         // roll() 必中权重表第一档
  while (batches < 200 && drops === 0) {
    const r = gateDrop('spirit', 'normal', 8);
    batches++;
    drops += r.drops.length;
    if (r.forced > 1) break;
  }
  Math.random = seeded(SEED);
  const expectedBatches = Math.ceil(GATE.spirit / (8 * CHARGE.normal));
  ok('8 只一批的出货批数 = 门槛/每批充能(加法模型,可解析验证)',
     batches === expectedBatches, `实测 ${batches} 批,解析 ${expectedBatches} 批`);
  ok('跨过门槛就会出货(不是掷骰决定出不出)', drops > 0, `${expectedBatches} 批共出 ${drops} 颗`);
}

// —— 1.3 记账环 + 磁吸环 + 拾取环:真引擎跑帧,真吸真捡 ——————————
// 这里用真 Engine + 真 initPickups,不是 mock:g.pickups 的增删走的是生产代码。
{
  resetGate();
  SPIRIT.reset();
  const g = new Engine(H.canvas);
  const cam = new Camera(); g.cam = cam;
  g.w = 960; g.h = 640;
  initPickups(g);
  const p = new Player('knight');
  p.weapons.push(makeWeapon(p.char.weapon));
  g.player = p;
  const mag = p.stats.magnet;
  info(`磁吸半径 magnet=${mag},拾取判定 d<18`);
  g.start();   // 关键:不 start 就没有 rAF 帧,下面 H.step 什么也不会发生(第一版就栽在这)
  // 照 main.js:540 的接法把 tick 挂成 updater —— 手写调用会漏掉「掉与吸发生在同一帧」
  g.addUpdaterOnce('spirit-hud', () => SPIRIT.tick(g));

  // ① 远(磁吸范围外)+ 高帧数:必须**不被吸走、不被记账**
  SPIRIT.tick(g);                       // 先建快照,避免首帧把存量算成「刚消失」
  g.addPickup({ kind: 'gem', x: p.x + 400, y: p.y, sprite: 'gem_g', xp: 0, r: 10, t: 0, __spirit: 1 });
  H.step(30);
  ok('磁吸范围外的灵气不会被吸走', g.pickups.length === 1, `场上剩 ${g.pickups.length} 个`);
  ok('磁吸范围外的灵气不会被记账', SPIRIT.TALLY.ling === 0, `ling=${SPIRIT.TALLY.ling}`);

  // ② 场内滞留多帧:**不得**每帧重复计数(XX-BUG-D 的原事故)
  const far = g.pickups[0];
  const lingBeforeStay = SPIRIT.TALLY.ling;
  for (let i = 0; i < 60; i++) { SPIRIT.tick(g); }
  ok('灵气在场上滞留 60 帧不会被重复计数', SPIRIT.TALLY.ling === lingBeforeStay,
     `ling ${lingBeforeStay} → ${SPIRIT.TALLY.ling}`);

  // ③ 拖进磁吸范围 → 必须被吸到脚下、被收走、**恰好记一次**
  far.x = p.x + mag * 0.8; far.y = p.y;
  let frames = 0;
  while (g.pickups.includes(far) && frames < 600) { H.step(1); frames++; }
  ok('灵气会被磁吸拖过来并被拾取', !g.pickups.includes(far), `${frames} 帧后仍在场:${g.pickups.includes(far)}`);
  ok('被吸走的灵气恰好记一次', SPIRIT.TALLY.ling === 1, `ling=${SPIRIT.TALLY.ling}(期望 1)`);

  // ④ 继续跑 120 帧:不得因为「曾经在场」而二次记账
  H.step(120);
  ok('之后不再二次记账', SPIRIT.TALLY.ling === 1, `ling=${SPIRIT.TALLY.ling}`);
  g.running = false;   // 关掉:后面几节的 H.step 会把所有还活着的引擎一起跑,
}                       // 而 Bag/引擎是共享单例 —— 不关就会互相污染计数(第一版就栽在这)

// —— 1.4 XX-QA-004 端到端:精英死亡 → 掉 stone_2 → 进背包 ————————
// 这条链与灵气链**完全独立**:它走 pickups.js 的 kind:'stone' 分支,
// 靠 main.js 暴露的 window.__xx.Bag 进包,不经过 SPIRIT.TALLY。
// 所以「源石进背包」有两条互不相干的入口,CI 上挂的那条只和 ling 有关。
{
  resetGate();
  globalThis.__xx = { Bag };          // 镜像 main.js:528 的桥,不给它 pickup 会拒绝吞掉源石
  const g = new Engine(H.canvas);
  const cam = new Camera(); g.cam = cam; g.w = 960; g.h = 640;
  initPickups(g);
  const p = new Player('knight'); p.weapons.push(makeWeapon(p.char.weapon)); g.player = p;
  g.start();

  // 精英掉率 STONE_DROP.elite = 0.05 —— 固定随机源取一个必中的值,掷够次数直到出货
  const realRnd = Math.random;
  Math.random = () => 0.01;
  let found = null;
  for (let i = 0; i < 200 && !found; i++) {
    g.pickups.length = 0;
    Bus.emit('enemy-death', { x: p.x, y: p.y, xp: 5, coinP: 0, elite: true, boss: false });
    found = g.pickups.find(k => k.kind === 'stone') || null;
  }
  Math.random = realRnd;
  ok('精英死亡会掉源石', !!found, found ? `${found.id} @${found.x.toFixed(0)},${found.y.toFixed(0)}` : '200 次未出货');
  ok('精英掉的是中品 stone_2(不是 stone_1)', !!found && found.id === 'stone_2', found && found.id);

  const bag0 = Bag.count(found ? found.id : 'stone_2');
  if (found) {
    found.x = p.x; found.y = p.y;          // 放到脚下,跳过走位(本条只验「拾取→入包」这一环)
    let f = 0;
    while (g.pickups.includes(found) && f < 120) { H.step(1); f++; }
    const bag1 = Bag.count(found.id);
    ok('源石被拾取后从场上消失', !g.pickups.includes(found), `${f} 帧后仍在场:${g.pickups.includes(found)}`);
    ok('源石真的进了修仙阁背包(stone_2 +1)', bag1 === bag0 + 1, `stone_2 ${bag0} → ${bag1}`);
  }
  delete globalThis.__xx;
  g.running = false;
}

// —— 1.5 入包环:settle 把灵气换成功德与源石 ————————————————————
{
  // 直接用生产 settle,不看注释
  const bag0 = (Bag.s.items || {}).stone_1 || 0;
  SPIRIT.TALLY.ling = 100;
  const r = SPIRIT.settle({}, { kills: 50 });
  const bag1 = (Bag.s.items || {}).stone_1 || 0;
  ok('settle 返回结算对象', !!r, JSON.stringify(r));
  ok('settle 的源石数 = floor(ling/12) —— 与实现同式,不钉魔数',
     r && r.stones === Math.floor(100 / 12), `stones=${r && r.stones}`);
  ok('ling≥12 时源石真的进了背包', bag1 > bag0, `stone_1 ${bag0} → ${bag1}`);
  // ling=0 的情形(就是 CI 上那一帧的状态)
  SPIRIT.TALLY.ling = 0;
  const bag2 = (Bag.s.items || {}).stone_1 || 0;
  const r0 = SPIRIT.settle({}, { kills: 20 });
  const bag3 = (Bag.s.items || {}).stone_1 || 0;
  ok('ling=0 时 settle 不发源石(CI 上源石 0→0 的直接解释)',
     bag3 === bag2 && r0 && r0.stones === 0, `ling=0 → stones=${r0 && r0.stones}, 背包 ${bag2} → ${bag3}`);
}

// ════════════════════════════════════════════════════════════════
// [2] 端到端:照抄 audit-loop.py 的输入脚本,真跑一局
// ════════════════════════════════════════════════════════════════
console.log('\n[2] 端到端复现 audit-loop.py 的 34 秒窗口');
let E2E = null;
{
  resetGate();
  SPIRIT.reset();
  bake();
  const engine = new Engine(H.canvas);
  const cam = new Camera(); engine.cam = cam;
  Save.load(); Save.data.settings = Save.data.settings || {}; Save.data.settings.shake = false;
  Input.init(); SFX.init();
  initParticles(engine); initMap(engine); initCombat(engine);
  initSpawner(engine); initBoss(engine); initPickups(engine);
  SPIRIT.install(engine, engine);
  engine.addUpdaterOnce('spirit-hud', () => SPIRIT.tick(engine));

  const p = new Player('knight');
  p.weapons.push(makeWeapon(p.char.weapon));
  engine.player = p;
  engine.passiveLv = { might:0, cd:0, speed:0, hp:0, magnet:0, xp:0, gold:0, armor:0 };
  combatState.runActive = true;
  cam.snap(p.x, p.y);
  engine.start();

  // 观测器:按 tier 统计死亡数,用来核对充能量
  const death = { normal: 0, elite: 0, boss: 0 };
  Bus.on('enemy-death', e => { death[e.boss ? 'boss' : e.elite ? 'elite' : 'normal']++; });
  let spiritSeen = 0, maxOnField = 0;
  const probe = engine.addUpdaterOnce('probe', () => {
    const n = engine.pickups.filter(k => k.__spirit).length;
    if (n > maxOnField) maxOnField = n;
    spiritSeen += n;
  });

  // —— 照抄 audit-loop.py:48-53 ——
  //   45 × (D/W/A/S) @0.35s → 18 × Space @0.5s → 30 × (D/S/A/W) @0.3s
  const DIRS = ['KeyD', 'KeyW', 'KeyA', 'KeyS'];
  const press = (code, sec) => {
    Input.keys.add(code);
    H.step(Math.round(sec * 60));
    Input.keys.delete(code);
  };
  for (let i = 0; i < 45; i++) press(DIRS[i % 4], 0.35);
  for (let i = 0; i < 18; i++) press('Space', 0.5);
  for (let i = 0; i < 30; i++) press(['KeyD', 'KeyS', 'KeyA', 'KeyW'][i % 4], 0.3);
  void probe;

  const kills = death.normal + death.elite + death.boss;
  const charge = death.normal * CHARGE.normal + death.elite * CHARGE.elite + death.boss * CHARGE.boss;
  E2E = { kills, death, charge, ling: SPIRIT.TALLY.ling, maxOnField, spiritSeen, engineTime: engine.time, p };
  info(`窗口 ${engine.time.toFixed(1)}s:击杀 ${kills}(普通 ${death.normal}/精英 ${death.elite}/boss ${death.boss})`);
  info(`灵气门槛充能 ${charge}/${GATE.spirit} = ${(charge / GATE.spirit * 100).toFixed(1)}%`);
  info(`TALLY.ling=${SPIRIT.TALLY.ling},场上峰值灵气 ${maxOnField} 个,累计在场帧数 ${spiritSeen}`);
  ok('这一局真的杀到怪了(否则后面的结论都不成立)', kills > 0, `${kills} 只`);
  ok('引擎时间在推进', engine.time > 30, `${engine.time.toFixed(1)}s`);
}

// ════════════════════════════════════════════════════════════════
// [3] 判定:ling=0 是不是精英修复带来的时序变化?
// ════════════════════════════════════════════════════════════════
console.log('\n[3] 精英修复 ↔ 时序:证实还是证伪');
{
  // 3.1 精英标志现在真的透传了吗(修复是否在位)
  const withElite = spawnOptsFor('slime', 30, { elite: true });
  ok('spawnOptsFor 透传了 elite 标志(XX-ELITE-001 修复在位)', withElite.elite === true,
     JSON.stringify(withElite));
  ok('倍率仍由本函数计算(未被 o 覆盖)', typeof withElite.hpMult === 'number' && withElite.hpMult > 0,
     `hpMult=${withElite.hpMult}`);

  // 3.2 修复前后,精英对灵气门槛的贡献差多少
  //     修复前:{ elite:true } 被整包丢掉 → 死亡时 e.elite=false → tier 落到 normal
  const perEliteBefore = CHARGE.normal;   // 修复前精英按普通怪算
  const perEliteAfter = CHARGE.elite;     // 修复后按精英算
  ok('精英修复让每只精英的门槛充能变高(方向上只会更容易出货,不会更少)',
     perEliteAfter > perEliteBefore, `${perEliteBefore} → ${perEliteAfter}`);

  // 3.3 关键:CI 那一局里,精英到底死了多少?够不够跨门槛?
  const d = E2E.death;
  const chargeEliteOnly = d.elite * perEliteAfter;
  info(`CI 窗口内精英死亡 ${d.elite} 只 → 精英贡献充能 ${chargeEliteOnly}(门槛 ${GATE.spirit})`);
  if (d.elite === 0) {
    info('结论方向:该窗口内一只精英都没死 → 精英修复对这个断言**零影响**');
  } else {
    info(`结论方向:即便 ${d.elite} 只精英全算上,充能 ${E2E.charge}/${GATE.spirit},` +
         `仍差 ${(GATE.spirit - E2E.charge).toFixed(0)}`);
  }

  // 3.4 关键的反证:精英在这个窗口里**结构上**来不及贡献。
  //     spawner.js:254 `eliteCd = 16 + Math.random()*8` 是硬下限:
  //     两次精英出现至少隔 16s,所以 34 秒窗口里最多出现 ceil(34/16) 只。
  //     这条钉的是「速率上限 × 充能 < 门槛」这个结构关系,不钉具体掉落数。
  const WIN_SEC = 34, ELITE_CD_FLOOR = 16;
  const maxElites = Math.ceil(WIN_SEC / ELITE_CD_FLOOR);
  const eliteCap = maxElites * perEliteAfter;
  ok('精英在 34 秒窗口内的充能上界不足以单独跨过 spirit 门槛',
     eliteCap < GATE.spirit,
     `最多 ${maxElites} 只 × ${perEliteAfter} = ${eliteCap} < 门槛 ${GATE.spirit}`);
  info(`spawner.js:254 的 eliteCd 下限 ${ELITE_CD_FLOOR}s → 34s 窗口最多 ${maxElites} 只精英,` +
       `即使全死也只贡献 ${eliteCap}/${GATE.spirit}`);

  // 3.5 但反过来:普通怪的密度够不够?这才是决定 ling=0 的那一个
  const normalNeed = GATE.spirit / CHARGE.normal;
  ok('CI 窗口的击杀量不足以跨过 spirit 门槛 —— 这就是 ling=0 的结构性解释',
     E2E.charge < GATE.spirit,
     `窗口充能 ${E2E.charge} vs 门槛 ${GATE.spirit}(需 ${normalNeed} 只普通怪)`);
  ok('该窗口内根本没有出现过灵气拾取物(所以不是「掉了没被吸」)',
     E2E.maxOnField === 0, `场上峰值 ${E2E.maxOnField}`);
  // ling=0 与「场上从未出现过灵气」是同一件事的因果两面,钉在一起
  ok('ling=0 的原因是「没掉」,不是「掉了没吸到」',
     SPIRIT.TALLY.ling === 0 && E2E.maxOnField === 0 && E2E.charge < GATE.spirit,
     `ling=${SPIRIT.TALLY.ling},峰值在场=${E2E.maxOnField},充能 ${E2E.charge}/${GATE.spirit}`);
}

// ════════════════════════════════════════════════════════════════
// [4] 接线契约:钉住「改了就会静默失效」的那几处
// ════════════════════════════════════════════════════════════════
console.log('\n[4] 接线契约(静态,防「定义了但没人调用」)');
{
  const main = readFileSync(ROOT + '/js/main.js', 'utf8');
  const spirit = readFileSync(ROOT + '/js/xiuxian/spirit.js', 'utf8');
  ok('main.js 装了 SPIRIT', /SPIRIT\.install\s*\(/.test(main));
  ok('main.js 每帧调 SPIRIT.tick(不调就永远 ling=0,且不报错)',
     /SPIRIT\.tick\s*\(/.test(main));
  ok('main.js 局末调 SPIRIT.settle', /SPIRIT\.settle\s*\(/.test(main));
  ok('tick 用 addUpdaterOnce 而不是 addUpdater(否则一颗灵气每帧记 N 遍)',
     /addUpdaterOnce\s*\(\s*['"]spirit-hud/.test(main));
  ok('灵气的门槛来源是 loot.gateDrop,不是散落的字面量',
     /gateDrop\s*\(\s*['"]spirit/.test(spirit));
  // 结算公式:源石只由 ling 决定 —— 「kills 再多也不发源石」这条要钉住
  ok('源石数只由 ling 决定(floor(ling/12))', /Math\.floor\(\s*ling\s*\/\s*12\s*\)/.test(spirit));
  ok('ling<=0 时不发源石', /if\s*\(\s*stones\s*>\s*0\s*\)\s*Bag\.add/.test(spirit));
}

// ════════════════════════════════════════════════════════════════
// [5] 反向注入自检:把生产模块改坏,证明 [1]-[4] 会红
// ════════════════════════════════════════════════════════════════
console.log('\n[5] 反向注入自检(门禁必须能红)');
/** 读源文件 → 内存改写 → 把相对 import 换成绝对 file URL → data: URL 导入 */
async function importMutated(relPath, mutate) {
  const abs = ROOT + '/' + relPath;
  let src = mutate(readFileSync(abs, 'utf8'));
  src = src.replace(/from\s+'(\.[^']+)'/g, (m, spec) => `from '${new URL(spec, _p2u(abs).href).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
}

// 5.1 回退「门槛加法模型」:把 GATE.spirit 抬到本局永远够不到的高度
{
  const M = await importMutated('js/xiuxian/loot.js', s =>
    s.replace('spirit: 125', 'spirit: 125000'));
  const n = 125000 / CHARGE.normal;
  M.resetGate();
  const charge = E2E.charge;                      // 复用 [2] 实测的真实充能量
  const drops = M.gateDrop('spirit', 'normal', E2E.kills);
  ok('[注入] 门槛抬到 125000 后,CI 窗口的击杀量不再出货(注入有效)',
     drops.drops.length === 0 && charge < n, `出货 ${drops.drops.length}`);
}

// 5.2 回退「记账」:去掉状态转移记账,ling 恒为 0
{
  const M = await importMutated('js/xiuxian/spirit.js', s =>
    s.replace('TALLY.ling += v;', '/* 注入:记账被摘掉 */'));
  const g2 = new Engine(H.canvas);
  const cam2 = new Camera(); g2.cam = cam2; g2.w = 960; g2.h = 640;
  initPickups(g2);
  const p2 = new Player('knight'); p2.weapons.push(makeWeapon(p2.char.weapon)); g2.player = p2;
  M.SPIRIT.install(g2, g2);
  M.SPIRIT.tick(g2);
  g2.addPickup({ kind: 'gem', x: p2.x, y: p2.y, sprite: 'gem_g', xp: 0, r: 10, t: 0, __spirit: 1 });
  H.step(6);
  M.SPIRIT.tick(g2);
  ok('[注入] 摘掉记账后 ling 恒为 0(注入有效,且 [1.3] 的断言会红)',
     M.SPIRIT.TALLY.ling === 0, `注入后 ling=${M.SPIRIT.TALLY.ling}`);
}

// 5.3 回退「重复计数修复」(XX-BUG-D 的老写法):一颗灵气在场 N 帧记 N 次
{
  const M = await importMutated('js/xiuxian/spirit.js', s =>
    s.replace('if (now.has(k)) continue;', '/* 注入:老写法,只看在不在场 */'));
  const g3 = new Engine(H.canvas);
  const cam3 = new Camera(); g3.cam = cam3; g3.w = 960; g3.h = 640;
  initPickups(g3);
  const p3 = new Player('knight'); p3.weapons.push(makeWeapon(p3.char.weapon)); g3.player = p3;
  M.SPIRIT.install(g3, g3);
  M.SPIRIT.tick(g3);
  g3.addPickup({ kind: 'gem', x: p3.x + 400, y: p3.y, sprite: 'gem_g', xp: 0, r: 10, t: 0, __spirit: 1 });
  for (let i = 0; i < 60; i++) M.SPIRIT.tick(g3);
  ok('[注入] 摘掉状态转移后,滞留 60 帧的灵气被反复计数(注入有效)',
     M.SPIRIT.TALLY.ling > 1, `注入后 ling=${M.SPIRIT.TALLY.ling}(滞留 60 帧)`);
}

// 5.4 回退「入包」:settle 不再 Bag.add
{
  const M = await importMutated('js/xiuxian/spirit.js', s =>
    s.replace("if (stones > 0) Bag.add('stone_1', stones);", '/* 注入:不发源石 */'));
  M.SPIRIT.TALLY.ling = 100;
  const b0 = (Bag.s.items || {}).stone_1 || 0;
  const r = M.SPIRIT.settle({}, { kills: 50 });
  const b1 = (Bag.s.items || {}).stone_1 || 0;
  ok('[注入] 摘掉 Bag.add 后背包不再增长(注入有效,且 [1.4] 的断言会红)',
     b1 === b0 && r && r.stones > 0, `注入后背包 ${b0} → ${b1},stones=${r && r.stones}`);
}

// 5.5 回退「精英标志透传」:spawnOptsFor 重新把 o 丢掉
{
  const M = await importMutated('js/game/spawner.js', s =>
    s.replace('return { ...o,', 'return {'));
  const o = M.spawnOptsFor('slime', 30, { elite: true });
  ok('[注入] 回退精英透传后 opts.elite 消失(注入有效,且 [3.1] 的断言会红)',
     o.elite === undefined, JSON.stringify(o));
}

Math.random = REAL_RND;
console.log(`\n灵气/源石链路护栏: ${pass} 通过, ${fail} 失败`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
console.log(`
复现步骤:
  node tests/xx-qa-003-spirit-stone-chain.mjs
  · [1] 逐环:掉落/磁吸/拾取/记账/入包,每环单独实跑
  · [2] 端到端:真 Engine + 真 spawner/pickups,照抄 audit-loop.py:48-53 的输入脚本
  · [3] 精英时序判定:对比 spawnOptsFor 修复前后的门槛充能
  · [5] 反向注入:在内存里改坏生产模块再导入,证明断言会红
`);
process.exit(fail ? 1 : 0);
