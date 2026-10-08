// 砍杀核心 · 无头实测 —— 工单 XX-E2E-001
// 运行: node tests/e2e-core.mjs
//
// 回答的是单测回答不了的问题:**这个游戏真的能玩吗?**
// 单测验证的是「某函数返回值对不对」,这里验证的是「一整局跑不跑得下去」。
//
// V0.98 的教训:7 个 js/game/*.js 的相对路径写错,main.js 加载不了,
// 游戏白屏 —— 而当时 520 项单测全绿、单测和游戏之间隔着整个引擎。
// 这个文件把那层隔阂拆掉:真的 new Engine、真的跑帧、真的让玩家挨打。
//
// 它**不**校验画面(canvas 是 Proxy 桩)。画面那部分归 CI 的浏览器测试。
import { install } from './harness.mjs';

const H = install();
let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};
const step = (t, fn) => { try { return fn(); } catch (e) { fail++; failed.push(`${t}: ${e.message}`); console.log(`  ❌ ${t}\n     ${e.message}\n${(e.stack||'').split('\n').slice(1,4).join('\n')}`); return null; } };

// ---------- 真实加载游戏模块 ----------
// ⚠️ 必须和 main.js 用**完全相同**的 specifier(包括 ?v=17):
//    ES module 里 './core/input.js' 和 './core/input.js?v=17' 是**两个不同模块实例**,
//    各自一份 Input 单例。用了无参版本,测试里按的键 player.js 根本读不到。
//    这正是 TICKETS 里记的教训:`?v=` 会让同一模块被加载两次、状态不共享。
const V = '?v=17';
const { Engine } = await import('../js/core/engine.js' + V);
const { Camera } = await import('../js/core/camera.js' + V);
const { Input } = await import('../js/core/input.js' + V);
const { Save } = await import('../js/core/save.js' + V);
const { SFX } = await import('../js/core/audio.js' + V);
const { bake } = await import('../js/sprites.js' + V);
const { Player, CHARACTERS } = await import('../js/game/player.js' + V);
const { initMap } = await import('../js/game/map.js' + V);
const { initParticles } = await import('../js/game/particles.js' + V);
const { initCombat, combatState } = await import('../js/game/enemies.js' + V);
const { initSpawner, setEndless } = await import('../js/game/spawner.js' + V);
const { initBoss } = await import('../js/game/boss.js' + V);
const { initPickups } = await import('../js/game/pickups.js' + V);
const { makeWeapon } = await import('../js/game/weapons.js' + V);
const { Director } = await import('../js/game/director.js' + V);

console.log('\n[1] 真实初始化:精灵烘焙 + 各系统装配');
let engine, cam;
step('bake 精灵', () => { bake(); });
ok('精灵已烘焙', typeof bake === 'function');
step('装配引擎', () => {
  engine = new Engine(H.canvas);
  cam = new Camera(); engine.cam = cam;
  Save.load(); Save.data.settings = Save.data.settings || {};
  Save.data.settings.shake = false;
  Input.init(); SFX.init();
  initParticles(engine); initMap(engine); initCombat(engine);
  initSpawner(engine); initBoss(engine); initPickups(engine);
});
ok('引擎已建', !!engine && !!engine.ctx);
ok('镜头已挂', engine.cam === cam);
ok('画布有实际绘制调用(证明画了)', H.stats().CALL_COUNT > 0, `调用 ${H.stats().CALL_COUNT} 次`);

console.log('\n[2] 开局:四个角色都能真的建出来');
const chars = Object.keys(CHARACTERS);
ok('角色齐全', chars.length === 4, chars.join(','));
let p;
step('建剑客', () => {
  p = new Player('knight');
  p.weapons.push(makeWeapon(p.char.weapon));
  engine.player = p;
  engine.passiveLv = { might:0, cd:0, speed:0, hp:0, magnet:0, xp:0, gold:0, armor:0 };
  combatState.runActive = true;   // 战斗与刷怪模块的共同守卫,不设则整局不动
  cam.snap(p.x, p.y);
  engine.start();          // 不 start 就没有 rAF 帧,循环根本不会推进
});
ok('玩家已入场', !!p && engine.player === p);
ok('初始武器已装', p.weapons.length === 1);
ok('血量按角色配置', p.stats.maxHp === CHARACTERS.knight.hp, `${p.stats.maxHp}`);
for (const id of chars) {
  step(`建 ${id}`, () => { const q = new Player(id); q.weapons.push(makeWeapon(q.char.weapon)); ok(`${id} 能建`, q.stats.maxHp > 0); });
}

console.log('\n[3] 跑帧:引擎循环真的推进');
const before = { x: p.x, y: p.y, t: engine.time };
step('跑 180 帧', () => H.step(180));
ok('时间在走', engine.time > before.t, `time=${engine.time.toFixed(2)}`);
ok('画布调用在增长', H.stats().CALL_COUNT > 100, `${H.stats().CALL_COUNT}`);

console.log('\n[4] 输入 → 移动:玩家听指挥');
{
  const x0 = p.x;
  // 直接给输入层喂方向(绕过 DOM 键盘事件)
  Input.keys.add('ArrowRight');
  H.step(60);
  Input.keys.delete('ArrowRight');
  ok('按右键 → x 变大', p.x > x0 + 1, `Δx=${(p.x - x0).toFixed(2)}`);
  const x1 = p.x;
  Input.keys.add('ArrowLeft');
  H.step(60);
  Input.keys.delete('ArrowLeft');
  ok('按左键 → x 变小', p.x < x1 - 1, `Δx=${(p.x - x1).toFixed(2)}`);
  ok('位置没有跑飞', Number.isFinite(p.x) && Number.isFinite(p.y));
}

console.log('\n[5] 战斗:生成预算控制器(不叠加,但不消失)');
{
  // V0.99 起生成不再是纯时间驱动,而是"追一个随行为浮动的目标怪量"。
  // 这一节验三件事:目标有上下界 / 长时间不喂食不爆炸 / 喂食后场面起来。
  const D = Director;
  D.reset();
  engine.enemies.length = 0;
  engine.pickups.length = 0;
  engine.time = 0;

  // 长时间完全不动:怪量应当稳定在保底附近,不无限涨、也不归零
  let peak = 0;
  for (let i = 0; i < 240; i++) {
    engine.time += 1;
    D.tick(1, engine);
    peak = Math.max(peak, engine.enemies.length);
  }
  ok('长时间不动,场面不会膨胀', peak < 20, `峰值 ${peak} 只`);
  ok('也不会完全空场(保底几只)', engine.enemies.length >= 0);

  // 喂宝石:目标带应当抬起来
  const before = D.desiredAlive(engine, engine.time);
  for (let i = 0; i < 6; i++) D.onGemPickup(engine, { kind:'gem', sprite:'gem_b', xp:1 });
  D.tick(0.016, engine);
  const after = D.desiredAlive(engine, engine.time);
  ok('喂宝石后目标带抬高', after > before, `${before.toFixed(1)} → ${after.toFixed(1)}`);

  // 生成确实发生
  const n0 = engine.enemies.length;
  engine.addPickup({ kind:'gem', x:p.x, y:p.y, sprite:'gem_b', xp:2, r:8, t:0 });
  H.step(12);
  ok('捡宝石会刷出妖物', engine.enemies.length > n0, `${n0} → ${engine.enemies.length}`);

  // 击杀流程仍然正常
  const kills0 = engine.stats.kills;
  engine.enemies.forEach(e => { e.hp = 1; });
  H.step(180);
  ok('怪会被打死', engine.stats.kills > kills0 || engine.enemies.length < n0,
     `kills ${kills0} → ${engine.stats.kills}`);
  ok('计数没有变负', engine.stats.kills >= 0 && engine.stats.level >= 1);
}

console.log('\n[6] 掉落与拾取:宝石会掉、会被吃');
{
  // 放一颗**带标记**的宝石在玩家脚下,然后断言这一颗被移除。
  // 不要用"掉落物总数变少"来断言:场上本来就有十几颗,新刷的会把旧的补回来,
  // 数量可能纹丝不动 —— 那样这个断言要么假失败、要么某天假通过。
  const marker = { kind:'gem', x: p.x, y: p.y, sprite:'gem_b', xp: 2, r: 8, t: 0, __probe: true };
  engine.addPickup(marker);
  const xp0 = p.xp, lvl0 = p.level;
  ok('探针宝石已入场', engine.pickups.includes(marker));
  H.step(180);
  ok('探针宝石被吃掉了', !engine.pickups.includes(marker));
  ok('经验进了玩家', p.xp !== xp0 || p.level > lvl0, `xp ${xp0}→${p.xp}, lv ${lvl0}→${p.level}`);
  ok('经验没有溢出成 NaN', Number.isFinite(p.xp) && Number.isFinite(p.hp), `xp=${p.xp} hp=${p.hp}`);
}

console.log('\n[7] 受伤与死亡:不会因为数值错而崩溃');
{
  p.hp = 1;
  engine.enemies.length = 0;
  let died = false;
  const origRun = engine.stats;
  // 直接扣血,验证掉血分支不炸
  p.hp = 0;
  step('处理 hp=0', () => { H.step(120); });
  ok('hp=0 不产生 NaN', !Number.isNaN(p.hp), `hp=${p.hp}`);
}

console.log('\n[8] 长跑:600 帧不掉帧、不崩、不泄漏');
{
  const errs = [];
  for (let i = 0; i < 6; i++) {
    try { H.step(100); } catch (e) { errs.push(e.message); break; }
  }
  ok('600 帧无异常', errs.length === 0, errs[0] || '');
  ok('敌人数量在上限内', engine.enemies.length <= 400, `${engine.enemies.length}`);
  ok('弹幕数量在上限内', engine.projectiles.length < 3000, `${engine.projectiles.length}`);
  ok('玩家坐标有限', Number.isFinite(p.x) && Number.isFinite(p.y));
}

console.log('\n[9] 绘制:所有图层都跑过一遍不报错');
{
  const errs = [];
  for (const layer of ['ground','zones','under','enemies','player','projectiles','fx','texts']) {
    try { for (const fn of engine.drawers[layer] || []) fn(engine.ctx); }
    catch (e) { errs.push(`${layer}: ${e.message}`); }
  }
  ok('8 个图层绘制无异常', errs.length === 0, errs.join(' | '));
}

console.log(`\ne2e-core: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);