// 《像素幸存者》主入口:装配全部模块、场景流转
import { Engine, Bus } from './core/engine.js?v=17';
import { PAL } from './core/palette.js';
import { Camera } from './core/camera.js?v=17';
import { Input } from './core/input.js?v=17';
import { Save } from './core/save.js?v=17';
import { SFX } from './core/audio.js?v=17';
import { bake } from './sprites.js?v=17';
import { Player, CHARACTERS } from './game/player.js?v=17';
import { initMap } from './game/map.js?v=17';
import { initParticles } from './game/particles.js?v=17';
import { initCombat, combatState } from './game/enemies.js?v=17';
import { initSpawner, setEndless } from './game/spawner.js?v=17';
import * as Enemies from './game/enemies.js?v=17';
import { initBoss } from './game/boss.js?v=17';
import { initPickups } from './game/pickups.js?v=17';
import { rollChoices, applyChoice , runArtSync } from './game/upgrades.js?v=17';
// 装备数据层(XX-EQUIP-002/003)。这里只导入**读档用得到**的部分 ——
// loadoutBonus/GEAR 由 XX-EQUIP-004 接进结算时才真正参与计算,
// 现在接进来是为了存档字段有个权威入口,而不是留一个没人 import 的死模块
// (lint-deps 会把「写好了但没人用」直接判红)。
import { loadoutBonus } from './game/gear.js?v=17';
import { makeWeapon } from './game/weapons.js?v=17';
import { HUD } from './ui/hud.js?r=8';
import { Screens } from './ui/screens.js?v=17';
import { Joystick } from './ui/joystick.js?v=17';
import { Codex } from './ui/codex.js?v=17';
import { Bestiary } from './ui/bestiary.js?v=17';

const canvas = document.getElementById('game');
const engine = new Engine(canvas);
engine.save = Save;
window.__g = engine; // 调试句柄(测试/排查用)

// g0 必须住在**模块顶层**(XX-BUG-B)。
// 原来它定义在「开局装配」那个函数内部(第 485 行),而同为顶层函数的
// endRun() 在结算时也要用它(第 136 行 SPIRIT.settle(g0(), s))——
// 够不着,一局结束就 ReferenceError。表现为:气泡台词照常冒出来,
// engine.pause() 也执行了,但 Screens.showResult 从来没跑到,
// 玩家卡在暂停的局里,什么都点不动。
const g0 = () => window.__g || engine;
const cam = new Camera();
engine.cam = cam;

Save.load();
bake();
Input.init();
SFX.init();
Joystick.init(engine);
HUD.init(engine);
Screens.init(engine);
initParticles(engine);
initMap(engine);
initCombat(engine);
initSpawner(engine);
initBoss(engine);
initPickups(engine);

// 每帧即使暂停也刷新 HUD
engine.addAlways(() => HUD.update());
// 玩家绘制层(战斗模块只画敌人/弹幕)
engine.addDrawer('player', ctx => { if (engine.player) engine.player.draw(ctx); });

// 灵伴局内实体(V0.98 · 工单 XX-COMP-002)
// 她活在砍杀局里,不是修仙阁菜单里:会跟着走、会捡宝石、会挨打、会躲。
// 独立挂 updater + drawer,不改动原有循环 —— 万一出错也不影响主游戏。
const companion = new CompanionActor(engine);
engine.addUpdater(dt => companion.update(dt));
engine.addDrawer('player', ctx => companion.draw(ctx));

let inRun = false;
let lastChar = 'knight';

// ---------- 音效/反馈事件 ----------
Bus.on('sfx', name => SFX.play(name));
Bus.on('hurt', dmg => {
  SFX.play('hurt');
  if (Save.data.settings.shake) engine.shake(5, 0.25);
  const v = document.getElementById('vignette');
  v.classList.remove('hidden');
  clearTimeout(v._t); v._t = setTimeout(() => v.classList.add('hidden'), 220);
});
Bus.on('boss-spawn', ({ name }) => {
  SFX.play('boss');
  if (Save.data.settings.shake) engine.shake(8, 0.6);
  engine.spawnText(engine.player.x, engine.player.y - 60, name + ' 出现!', { color: PAL.crit, size: 24, life: 2 });
  // XX-COMBAT-001:Boss 出场即切入回合制。
  // 以前这里只有音效+震屏+飘字 —— 局内砍杀全程是实时弹幕,回合制只在修仙阁走大地图时才有。
  setTimeout(() => toTurnBased(name), 700);
});

// ---------- 升级三选一(含 1 次免费刷新) ----------
Bus.on('levelup', () => {
  SFX.play('levelup');
  engine.pause();
  showLevelUpOnce(false);
});
function showLevelUpOnce(rerolled) {
  let choices;
  try { choices = rollChoices(engine); }
  catch (err) { console.error('[升级] 选项生成失败,跳过本次升级', err); skipLevelUp(); return; }
  try {
    Screens.showLevelUp(choices, c => {
      try { applyChoice(engine, c); }
      catch (err) { console.error('[升级] 应用失败,已忽略', err); }
      engine.player.pendingLevels--;
      if (engine.player.pendingLevels > 0) showLevelUpOnce(false);
      else { Screens.hide(); engine.resume(); }
    }, () => {
      if (rerolled) return; // 每次升级仅 1 次刷新
      showLevelUpOnce(true);
    });
  } catch (err) { // 面板异常时自愈:跳过升级,绝不把游戏锁死在暂停态
    console.error('[升级] 面板渲染失败,跳过本次升级', err);
    skipLevelUp();
  }
}
function skipLevelUp() {
  if (engine.player) engine.player.pendingLevels = 0;
  Screens.hide();
  engine.resume(); // 与 Bus('levelup') 里的 pause() 配对,消除软锁
}

// ---------- 结算 ----------
Bus.on('runend', ({ victory }) => endRun(victory));

function endRun(victory) {
  if (!inRun) return;
  inRun = false;
  // —— 灵伴收尾(V0.98):年表记一笔,累计生死 ——
  // 台词仍走 say():受「每局 ≤2 句」预算约束,不绕过规则。
  COMPANION.markRun({ deaths: victory ? 0 : 1, picks: COMPANION.s.run.picked, present: companion.present });
  if (victory) {
    COMPANION.onRunClear();
    runEventLines('noDeath3', { say: t => Bond.bubble(t) });
  } else {
    COMPANION.onPlayerDeath();
  }
  engine.pause();
  HUD.show(false); // 隐藏局内HUD,避免“满血倒下”的矛盾观感
  SFX.play(victory ? 'victory' : 'death');
  const s = engine.stats, d = Save.data;
  d.gold += s.gold;
  d.totalRuns++; d.totalKills += s.kills;
  const runTime = Math.floor(engine.time);
  if (runTime > d.best.time) d.best.time = runTime;
  if (s.kills > d.best.kills) d.best.kills = s.kills;
  if (engine.player.level > d.best.level) d.best.level = engine.player.level;
  if (victory) d.best.victory = true;
  Save.commit();
  // 神通回流(XX-ARCH-006 / owner 选 A):局内参悟的等级带回修仙阁。
  // 这一步之前从来没接过 —— Cult.syncArt 0 调用,于是修仙阁的悟道永远凑不满两门满级。
  try {
    for (const [id, , lv] of runArtSync(g0())) { Cult.syncArt(id, lv); }
    Cult.commit();
  } catch (e) { console.warn('[art-sync]', e); }
  // 修为结算(XX-BAL-001):砍杀**必须**给修为。
  // Cult.settle() 一直存在、一直被调好公式,但**全项目没有任何调用点** ——
  // 局末只走 SPIRIT.settle(道行+源石)。所以一局砍杀打完,修为一点没涨,
  // 修仙阁只能靠吐纳/荒野/回合制慢慢磨 → 化神期数学上不可达。
  // 这不是曲线太平,是主线根本没接。
  let cult = null;
  try {
    const s2 = Cult.get();
    const ridx = Math.max(0, REALMS.findIndex(r => r.id === s2.realm));
    cult = Cult.settle({
      kills: s.kills, time: runTime,
      realmLayer: s2.layer, realmIdx: ridx,
    });
  } catch (e) { console.warn('[cult-settle]', e); }
  // 灵气结算:砍杀的产出回流到修仙阁(道行 + 源石)
  const sp = SPIRIT.settle(g0(), s);
  if (sp && cult) sp.exp = cult.exp;
  // ⚠️ 结算层必须包 try/catch,否则抛异常会把玩家锁死在暂停的局里。
  //   症状描述见本文件第 34 行的注释:「engine.pause() 也执行了,
  //   但 Screens.showResult 从来没跑到,玩家卡在暂停的局里,什么都点不动」。
  //   那个 bug 当年是靠修 g0 的作用域解决的,**但这条路径本身没关掉** ——
  //   将来 showResult 内部任何一处抛异常,同样的软锁会原样复现。
  //   对照:showLevelUp 有双层 try/catch + skipLevelUp() 自愈(见第 108 行),
  //   注释写着「绝不把游戏锁死在暂停态」。**升级防了,结算没防。**
  //   这里补上同等自愈:渲染不出来就退回主菜单,保证玩家永远能继续操作。
  try {
    Screens.showResult({ time: runTime, kills: s.kills, level: engine.player.level,
      gold: s.gold, spirit: sp }, {
      victory,
    endless: victory,
    onAgain: () => startRun(lastChar),
    onEndless: () => { setEndless(engine); inRun = true; HUD.show(true); Screens.hide(); engine.resume(); },
    onMenu: () => { engine.reset(); showMenu(); },
    });
  } catch (err) {
    console.error('[结算] 结算层渲染失败,退回主菜单', err);
    // 自愈:绝不能把玩家留在「已 pause 但没有任何可点界面」的状态。
    try { engine.reset(); } catch (e2) { console.warn('[结算] reset 也失败', e2); }
    HUD.show(false);
    showMenu();
  }
}


// ══════════════ 局内 → 回合制(XX-COMBAT-001)══════════════
//
// owner 要求:「回合制记得弄好强制进入或者碰撞进入或者特定剧情进入,
// 过场动画也要有,立绘别忘了」。
//
// 立绘和对话 Duel 里已经有了(卷轴 + say() + turnFlash/intro),
// 这里接的是**入口与出口**:水墨过场 → 暂停局内 → Duel.start → 打完还回去。
//
// 触发方式现役:**Boss 出场即进**(强制进入)。碰撞/剧情触发留接口,
// 因为那两处要改 spawner 的行为,风险比这个大。
let inTurnBased = false;

/** 播放水墨过场。dir: 'in'(盖满) | 'out'(退开) */
function wash(dir, caption) {
  const el = document.getElementById('tb-wash');
  if (!el) return 0;
  const cap = document.getElementById('tb-cap');
  if (cap && caption) cap.textContent = caption;
  el.classList.remove('in', 'out');
  void el.offsetWidth;              // 强制回流,否则连续调用不会重放动画
  el.classList.add('on', dir);
  // CSS 时长:in .46s / out .40s,留一点余量
  return dir === 'in' ? 520 : 460;
}

/** 局内 Boss → 回合制 */
function toTurnBased(bossName) {
  if (inTurnBased || !inRun) return;
  inTurnBased = true;
  const g = engine, p = g.player;
  const boss = g.boss;
  if (!p || !boss) { inTurnBased = false; return; }

  const wait = wash('in', bossName);
  engine.pause();
  SFX.stop && SFX.stop();

  setTimeout(() => {
    if (!Duel) { inTurnBased = false; engine.resume(); return; }
    try {
      // D-01:血量继承。局内已经把 boss 砍掉的血要带进回合制,
      // 否则玩家打了那么久等于白打(boss 永远满血进回合制)。
      // hpRatio = 当前剩余 / 最大。
      const bhp = boss.hpMax ? Math.max(0.05, Math.min(1, boss.hp / boss.hpMax)) : 1;
      Duel.start({
        node: { type: 'boss' },
        hpRatio: bhp,          // ← Duel 内部会走 enterTurnBased 归一到 0~100
        hero: {
          name: '轩轩', img: PORTRAIT.hero,
          realmIdx: Math.max(0, REALMS.findIndex(r => r.id === Cult.get().realm)),
        },
        foe: {
          // ⚠️ XX-PLAY-005:原来这里是 key: 'moying' 写死的,
          //   于是**任何** boss 进回合制都在演墨影 —— 屏幕上是墨影的立绘、
          //   说的是墨影的台词「你不该来。」。owner 报「石像守卫叫你不该来」即此。
          //   现在把真实类型 id(boss_golem / boss_overlord)传下去。
          //   ⚠️ 立绘仍是 PORTRAIT.foe(墨影):6 张反派立绘里没有石像守卫/无常尊者
          //     —— 它们是 roguelike sprite,不是修仙阁反派。这是**资产缺口**,
          //     要么补画、要么接受通用图;不猜哪个反派长得像石头人。见 TICKETS.md XX-PLAY-005。
          key: boss.type || 'boss_unknown',
          name: boss.name,
          title: '妖  ·  本  局',
          // XX-PLAY-008:立绘跟 boss 类型走。原来写死 PORTRAIT.foe(墨影)——
          //   台词对了、脸还是墨影的:打石像守卫时屏幕上站着墨影。
          //   bossPortrait() 有专属图就用专属,没有才退回通用反派图。
          img: bossPortrait(boss.type),
          realmIdx: Math.max(0, REALMS.findIndex(r => r.id === Cult.get().realm)) + 1,
          stronger: true, isNemesis: false,
        },
        onWin: (r) => {
          // 赢:把这条 Boss 从场上清掉,然后交还局内
          const i = g.enemies.indexOf(boss);
          if (i >= 0) g.enemies.splice(i, 1);
          if (g.boss === boss) g.boss = null;
          Cult.titles.track('challenge', 1);
          if (Cult.nemesis && Cult.nemesis.s.alive) Cult.titles.track('nemesis_win', 0);
          s2give(r);
        },
        onLose: () => { /* 交给 endRun 走死亡结算 */ },
      });
      // ⚠️ 墨盖满之后必须**退开**,否则 #tb-wash(z-index 300)会一直压着
      // .xx-duel(z-index 80) —— 回合制开了但立绘和战场全被墨挡着。
      // 先留 700ms 让玩家看清 Boss 名,再退。
      setTimeout(() => { const el = document.getElementById('tb-wash');
        if (el) { el.classList.remove('in'); wash('out'); } }, 700);
    } catch (e) {
      console.warn('[turn-based]', e);
      inTurnBased = false;
      engine.resume();
      return;
    }
    // 回合制进行中:局内保持暂停
  }, wait);
}

/** 回合制打完 → 交还局内 */
function fromTurnBased(win) {
  setTimeout(() => {
    wash('out');
    inTurnBased = false;
    engine.resume();
    if (!win) {
      // 输了:走正式死亡结算,别让玩家卡在暂停的局里(XX-BUG-B 那类)
      const p = engine.player;
      if (p) { p.iframes = 0; p.takeDamage(999999); }
    }
  }, 60);
}

function s2give(r) {
  const st = Cult.get();
  st.dao += r.dao || 0;
  st.totalKills += 1;
  if (r.pill) st.pills[r.pill] = (st.pills[r.pill] || 0) + 1;
  addExp(st, r.exp || 60);
  Cult.commit();
  fromTurnBased(true);
}

// ---------- 场景 ----------
function showMenu() {
  inRun = false;
  HUD.show(false);
  Screens.buildMenu({
    onPlay: () => {
      SFX.play('click');
      Screens.buildSelect({
        onPick: (id, unlocked) => { if (unlocked) startRun(id); else SFX.play('no'); },
        onBack: () => showMenu(),
      });
    },
    onToggle: (k, v) => applySetting(k, v),
  });
}

function startRun(charId) {
  SFX.play('click');
  lastChar = charId;
  engine.reset();
  resetEmber();          // 上一局的余烬不能漏进这一局
  Director.setMateMods(TAVERN.mods());   // 同伴(XX-META-003):他改变这一局的规则,不是纯数值
  const p = new Player(charId);
  p.weapons.push(makeWeapon(p.char.weapon));
  // 装备加成(XX-EQUIP-003 接存档 → XX-EQUIP-004 接战斗的桥):
  // 这里只做**挂载与重算**,不改任何伤害公式 ——
  // 吸血/反噬怎么在结算里生效是桌面侧 XX-EQUIP-004 的活,且必须反向验证。
  // 放在 startRun 而不是 loadGear,是保证「每局重置」不会把上一局的装备加成带过来。
  p.gearBonus = loadoutBonus(Save.loadout());   // 唯一真源:Save 自己那套清洗规则
  p.recalc();
  engine.player = p;
  combatState.runActive = true;
  engine.passiveLv = { might: 0, cd: 0, speed: 0, hp: 0, magnet: 0, xp: 0, gold: 0, armor: 0 };
  cam.snap(p.x, p.y);
  // 灵伴随本局开始:重置局内状态(连死 3 次 → 本局她不出场)
  companion.begin();
  // 广播条一并清场(XX-AUDIT-031)。它的 root 元素是**整页只建一次**的,
  // 且从来没有被移除过 —— 所以上一局最后两句会留在 DOM 里。
  // 中途 HUD 被 .hidden 藏住看不见,玩家一开新局 HUD 恢复,
  // 旧台词会先于本局任何台词出现,还被当成「刚说完的」那一行。
  clearBroadcast();
  // 开场台词:满血起手,本局最多 2 句,同一表现必出同一句
  runEventLines('fullHp', { say: t => Bond.bubble(t) });
  inRun = true;
  Screens.hide();
  HUD.show(true);
  engine.resume();
  engine.start();
  engine.spawnText(0, -50, '活下来!', { color: PAL.gold, size: 26, life: 2 });
}

// 组合图鉴与怪物图鉴入口(主菜单)
document.getElementById('btn-codex').addEventListener('click', () => {
  SFX.play('click');
  Codex.open();
});
document.getElementById('btn-bestiary').addEventListener('click', () => {
  SFX.play('click');
  Bestiary.open();
});

function applySetting(k, v) {
  Save.data.settings[k] = v; Save.commit();
  if (k === 'sfx') SFX.setSfx(v);
  if (k === 'music') SFX.setMusic(v);
  if (k === 'lowgfx') engine.setDprCap(v ? 1 : Math.min(2, window.devicePixelRatio || 1)); // 流畅画质:降采样保帧率
  if (k === 'fpsShow') engine.setFpsShow(v);
}

// ---------- 暂停按钮 / 失焦自动暂停 ----------
function openPause() {
  engine.pause();
  Screens.buildPause({
    onResume: () => { Screens.hide(); engine.resume(); },
    onQuit: () => endRun(false),
    onToggle: applySetting,
  });
}
document.getElementById('btn-pause').addEventListener('click', () => {
  if (!inRun || engine.paused > 0) return;
  SFX.play('click');
  openPause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && inRun && engine.paused === 0) openPause();
});

SFX.setSfx(Save.data.settings.sfx);
SFX.setMusic(Save.data.settings.music);
engine.setDprCap(Save.data.settings.lowgfx ? 1 : Math.min(2, window.devicePixelRatio || 1));
engine.setFpsShow(!!Save.data.settings.fpsShow);
showMenu();
engine.start();

// 调试:?cheat 快速获得经验 ?fast 时间加速(测试升级/Boss/通关流程用)
if (location.search.includes('dev')) {
  function trapErr(t) {
    let d = document.getElementById('err-trap');
    if (!d) {
      d = document.createElement('div');
      d.id = 'err-trap';
      d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:rgba(60,0,0,.92);color:#fff;font-size:11px;max-width:90vw;white-space:pre-wrap;padding:4px 6px;';
      document.body.appendChild(d);
    }
    d.textContent += t + '\n';
    if (d.textContent.length > 4000) d.textContent = d.textContent.slice(-4000);
  }
  window.addEventListener('error', e => {
    trapErr('ERR: ' + e.message + ' @line' + e.lineno);
  });
  const oe = console.error;
  console.error = (...a) => {
    oe(...a);
    try { trapErr('CERR: ' + a.map(x => (x && x.stack) ? x.stack.slice(0, 260) : String(x)).join(' ').slice(0, 400)); } catch (e2) {}
  };
}
if (location.search.includes('cheat')) {
  setInterval(() => {
    if (inRun && engine.player && engine.paused === 0) engine.player.addXp(10 + engine.player.level * 3);
  }, 1000);
}
if (location.search.includes('fast')) {
  setInterval(() => {
    if (inRun && engine.paused === 0) engine.time += 1.2;
  }, 100);
}

// PWA:注册 Service Worker(file:// 或 ?dev 下跳过)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !location.search.includes('dev')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ===== 修仙层入口(V0.78)=====
import { Cult } from './xiuxian/index.js';
import { REALMS, addExp } from './xiuxian/realms.js';
// 回合制过场要立绘(XX-COMBAT-001)。
// ⚠️ 2026-10-10(XX-AUDIT-005):原来这里另有一份只含 hero/foe 的 PORTRAIT,
// 和 ui.js 里那份同名不同容 —— 改一处忘一处就会画错人。
// 现在统一从 ui/portrait.js 取(那份文件很轻,不会把整个 ui 拉进主循环)。
import { PORTRAIT, bossPortrait } from './xiuxian/ui/portrait.js';
import { Duel } from './xiuxian/duel.js';
import { Hall } from './xiuxian/ui.js';
import { Bag, DAY } from './xiuxian/items.js';
import { CAMP, offlineReport } from './xiuxian/camp.js';
import { Merchant } from './xiuxian/merchant.js';
import { COMPANION } from './xiuxian/companion.js';
import { CompanionActor, runEventLines } from './xiuxian/companion-actor.js';
import { installSpine } from './xiuxian/spine.js';
import { CLOCK } from './xiuxian/clock.js';
import { TAVERN } from './xiuxian/tavern.js';   // V0.99 酒馆同伴
import { Director, stepWard, resetWard, resetEmber, tickEmber, emberPoints } from './game/director.js';
import { MOUNT } from './xiuxian/mount.js';
import { SPIRIT } from './xiuxian/spirit.js';
import { NAGER, installNagger } from './xiuxian/nag.js';
import { Ritual } from './xiuxian/ritual.js';
import { Bond } from './xiuxian/bond.js';
import { clearBroadcast } from './xiuxian/companion-broadcast.js';
import { Profile, Seed } from './xiuxian/profile.js';
import { Titles, Nemesis } from './xiuxian/relations.js';
import { FAMILY } from './xiuxian/family.js';
import { CHRONICLE } from './xiuxian/chronicle.js';
import { BUILD } from './xiuxian/build.js';
import { STORY } from './xiuxian/story.js';
import { QUEST } from './xiuxian/quest.js';
import { Ambience, phaseChime } from './xiuxian/ambience.js';
import { WORLD } from './xiuxian/world.js';
import { setMomocha } from './xiuxian/camp.js';
import { BESTIARY } from './xiuxian/bestiary.js';

(function bootCult() {
  const bind = () => {
    let _bondT = 0, _lastPhase = null, _lastDayMul = 1, _ghostMod = null;
    Cult.init();
    Bag.load('xx_bag_v080');
    CAMP.load();
    // 主线骨架(V0.99):把修仙阁与局内的进度汇到一处。
    // 必须在 Cult/CAMP 都 load 完之后 —— 它要读这两处的状态来对齐阶段。
    installSpine(Cult.s, CAMP);
    DAY.load('xx_day_v080');
    Merchant.load();
    // 离线收益:进游戏先结算篝火
    const off = offlineReport();
    if (off && off.dao > 0) setTimeout(() => Hall.showOffline(off), 900);
    // 开局仪式:未命名 → 弹
    COMPANION.load();
    Bond.init();
    Profile.load();
    FAMILY.load();
    CHRONICLE.load();
    BUILD.load();
    STORY.load();
    QUEST.load();
    Ambience.init();
    setMomocha(!!FAMILY.momocha());
    BUILD.setWorld(WORLD);
    // 统一存档:进游戏先收集,页面隐藏/关闭时落盘
    const mods = { Cult, Nemesis, Titles, Bag, CAMP, DAY, Merchant, COMPANION };
    Profile.collect(mods);
    const autosave = () => Profile.collect(mods);
    document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
    window.addEventListener('pagehide', autosave);
    window.addEventListener('beforeunload', autosave);
    // 暴露给 UI(存档码/换种子)
    window.__xx = { Profile, Seed, mods, FAMILY, CHRONICLE, BUILD, COMPANION, Bag, CLOCK,
                    get ward(){ return COMPANION.wardRadius(); } };

    // —— 怨灵附身:通过 enemies.js 的官方钩子强化全场怪 ——
    _ghostMod = COMPANION.possessing()
      ? { hp: COMPANION.hostBuff(), dmg: COMPANION.hostDmg(), spd: COMPANION.hostSpd() } : null;
    Enemies.setEnemyMod(_ghostMod);
    // 每局重置打扰预算
    NAGER.newRun();
    try { Bond._bubBudget = 6; } catch {}
    // —— 灵气(V0.96):砍杀 ↔ 修仙阁 的连接 ——
    SPIRIT.install(engine, g0());
    engine.addUpdaterOnce('spirit-hud', dt => {
      SPIRIT.tick(g0());
      // HUD:灵气数 + 篝火加成提示
      const el = document.getElementById('hud-xx-ling');
      if (el) {
        const n = SPIRIT.TALLY.ling;
        if (el.textContent !== String(n)) {
          el.textContent = n;
          // ⚠️ 实测 8 秒内灵气数变了 274 次(34 次/秒)。原来每变一次就重放 pop 动画,
          // 于是整个 HUD 一直在抖 —— owner 实机报「头顶冒烟加加加」。
          // 数字该变就变(那是信息),但动画**必须限流**,不然动画本身变成噪音。
          const box = document.getElementById('hud-xx');
          const now = performance.now();
          if (box && n > 0 && now - (this._lastPop || 0) > 600) {
            this._lastPop = now;
            box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
          }
        }
        // 局内灵气是个抽象数字,玩家不知道它能干什么。
        // ⚠️ 这里必须用 SPIRIT.settle 的**完整**公式 dao=(ling*0.5+kills*1.2)*boost。
        // 我第一版只折 ling 的那半,结果击杀多、灵气少的时候(正常对局就是 8 杀 1 灵气),
        // HUD 常年显示「≈ 道行 +0」—— 显示比实际少了一个数量级,比不显示还糟。
        const de = document.getElementById('hud-xx-dao');
        if (de) {
          const k = (g0().stats && g0().stats.kills) || 0;
          const boost = CAMP.burning() ? 1.25 : 1;
          const approx = Math.round((n * 0.5 + k * 1.2) * boost);
          de.textContent = approx > 0 ? `≈ 道行 +${approx}` : '';
        }
        const f = document.getElementById('hud-xx-fire');
        if (f) f.hidden = !CAMP.burning();
      }
    });
    // 篝火在烧时局内灵气更浓,视觉上给个提示
    engine.addUpdaterOnce('spirit-glow', dt => {
      const p0 = g0().player;
      if (!p0) return;
      const on = CAMP.burning();
      if (on !== p0._xxSpiritGlow) {
        p0._xxSpiritGlow = on;
        p0.stats.xpMult = on ? (p0.stats.xpMult || 1) * 1.08 : (p0.stats.xpMult || 1) / 1.08;
      }
    });

    // 增益条:把「修仙阁带来的东西」在局内列出来
    engine.addUpdaterOnce('buff-bar', dt => {
      const box = document.getElementById('hud-xx-buf');
      if (!box) return;
      const sig = [];
      const e = MOUNT.eff();
      if (e.ward > 0)   sig.push(`<span><b>坐骑</b> 护栏 +${e.ward}</span>`);
      if (e.speed > 1)  sig.push(`<span><b>坐骑</b> 移速 +${Math.round((e.speed-1)*100)}%</span>`);
      if (e.pickup > 1) sig.push(`<span><b>坐骑</b> 拾取 ×${e.pickup.toFixed(2)}</span>`);
      if (e.atk > 0)    sig.push(`<span><b>随行</b> 攻击 +${e.atk}%</span>`);
      if (COMPANION.possessing()) sig.push('<span style="border-color:rgba(181,52,42,.5)"><b style="color:#e8a99c">怨灵</b>附身中</span>');
      const key = sig.join('|');
      if (box._sig !== key) { box._sig = key; box.innerHTML = sig.join(''); box.hidden = !sig.length; }
    });

    // —— 坐骑/宠物(V0.91):开局把加成落到局内 player 上 ——
    // 只在开局设一次,不是每帧改(每帧改会盖掉局内其他来源)
    MOUNT.load();
    installNagger();
    engine.addUpdaterOnce('mount-on', dt => {
      const p0 = g0().player;
      if (!p0 || p0._xxMountOn) return;
      p0._xxMountOn = true;
      const e = MOUNT.eff();
      if (e.pickup !== 1) p0.stats.magnet = Math.round(p0.stats.magnet * e.pickup);
      if (e.speed !== 1)   p0.stats.speed  = Math.round(p0.stats.speed * e.speed);
      if (e.atk)           p0.stats.might  = (p0.stats.might || 1) * (1 + e.atk / 100);
      // 记一份到 window,方便 UI 显示和测试核对(玩家也能量化看到自己骑了什么)
      window.__xxMount = { eff:e, magnet:p0.stats.magnet, speed:p0.stats.speed,
                           might:p0.stats.might };
    });
    // 同伴(XX-META-003):属性类的 mods 落到 player 上。
    // 只在开局设一次 —— 每帧改会盖掉局内其他来源(和坐骑同一个理由)。
    engine.addUpdaterOnce('tavern-mate', () => {
      const p0 = g0().player;
      if (!p0 || p0._xxMateOn) return;
      p0._xxMateOn = true;
      const m = TAVERN.mods();
      if (m.might)  p0.stats.might  = (p0.stats.might || 1) * m.might;
      if (m.magnet) p0.stats.magnet = Math.round(p0.stats.magnet + m.magnet);
      if (m.xpMult) p0.stats.xpMult = (p0.stats.xpMult || 1) * m.xpMult;
      if (m.hp) { p0.stats.maxHp += m.hp; p0.hp += m.hp; }
      window.__xxMate = { name: (TAVERN.active() || {}).name || '无', mods: m };
    });
    // 篝火余烬(V0.99 · 工单 XX-SPAWN-007):夜里人物身上缠着灰烬火星。
    // 闪烁频率随夜色推进变化 —— 玩家只靠肉眼就知道现在是夜里第几段。
    // 快天亮时闪三下,提醒"这炉快烧完了,要续源石"。那是决策点,不是惩罚。
    const EMBER_PTS = emberPoints(7);
    engine.addUpdaterOnce('day-phase', () => {
      const g1 = g0(), p1 = g1.player;
      if (!p1) return;
      let phaseKey = 'day';
      try { const ph = DAY.phase(); if (ph && ph.key) phaseKey = ph.key; } catch (e) { /* DAY 未就绪 */ }
      const burning = CAMP.burning();
      const now = Date.now();
      const e = burning ? tickEmber(g1, now, phaseKey) : { on: false };
      g1._ember = e;
    });
    // 余烬绘制:走在玩家层,跟着镜头
    engine.addDrawer('player', ctx => {
      const g1 = g0(), p1 = g1.player;
      const e = g1._ember;
      if (!p1 || !e || !e.on) return;
      const cam = g1.cam;
      const x = p1.x - (cam ? cam.x : 0);
      const y = p1.y - (cam ? cam.y : 0);
      const t = Date.now() / 1000;
      ctx.save();
      // 将熄三连闪:短暂整圈金线 + 亮度加倍
      const flash = e.flick > 0 && (Math.floor(Date.now() / 130) % 2 === 0);
      const baseA = flash ? 0.95 : e.alpha;
      for (let i = 0; i < EMBER_PTS.length; i++) {
        const q = EMBER_PTS[i];
        const wob = Math.sin(t * (2.1 + i * 0.37) + i);
        const px = x + q.dx + wob * 3;
        const py = y - 12 + q.dy + Math.sin(t * 1.6 + i * 2) * 4 - (t * 9 % 26);
        const a = Math.max(0, baseA * (0.55 + 0.45 * wob));
        if (a <= 0.02) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = flash ? PAL.paper : PAL.gold;
        ctx.beginPath();
        ctx.arc(px, py, q.sz, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // 篝火护栏(V0.99):圈 + 推怪合并成一个 updater。
    // 半径 = COMPANION.wardRadius() 给的目标(它读昼夜相位和坐骑加成),
    // 这里用 stepWard 平滑跟过去 —— 昼夜切换时护栏是"慢慢"变大变小,不是跳变。
    engine.addUpdaterOnce('camp-ward', dt => {
      const g1 = g0(), p1 = g1.player;
      if (!p1) return;
      // 把局内真实拾取半径传进去 —— 护栏跟着它走,两者永远差那 8%
      const pr = p1.stats ? p1.stats.magnet : 0;
      const ward = stepWard(dt, COMPANION.wardRadius(pr, TAVERN.mods().wardBonus || 0));
      const el = document.getElementById('hud-ward');
      if (el) {
        if (!ward) el.hidden = true;
        else {
          el.hidden = false;
          el.style.width  = (ward * 2) + 'px';
          el.style.height = (ward * 2) + 'px';
          el.style.left   = (p1.x - ward) + 'px';
          el.style.top    = (p1.y - ward) + 'px';
          el.style.transform = 'none';
        }
      }
      // 圈内绝对安全:硬推出去
      if (!ward || !g1.enemies) return;
      for (const e of g1.enemies) {
        const dx = e.x - p1.x, dy = e.y - p1.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < ward) { e.x = p1.x + dx / d * ward; e.y = p1.y + dy / d * ward; }
      }
    });
    setTimeout(() => Ritual.start(false), off && off.dao > 0 ? 2600 : 700);
    // 建筑真实掉落:敌人死亡时掷建材
    // 击杀兑现(V0.99 · XX-SPAWN-001):死一只补一点压力,并可能刷出同档位的怪。
    // 和"捡宝石"是两条独立的燃料来源 —— 玩家站着打(捡不到宝石)
    // 依然能让场面维持在高位,但强度涨不上去;想变强就得去捡。
    Bus.on('enemy-death', e => {
      try { Director.onKill(engine, e); } catch (err) { console.warn('[director]', err); }
      const kind = _kindOf(e);
      const g1 = BUILD.onKill(kind) || BUILD.onKillTier(e.boss ? 2 : e.elite ? 1 : 0);
      if (g1 && engine.player) {
        engine.spawnText(engine.player.x, engine.player.y - 44,
          g1.icon + ' 获得 ' + g1.name, { color:PAL.gold, size: 14, life: 2.2 });
      }
    });
    // 原版敌人 typeId → 修仙图谱 key
    function _kindOf(e) {
      const n = (e.name || '').toLowerCase();
      if (e.boss) return 'devil';
      if (e.elite) return 'yao';
      if (n.includes('狼') || n.includes('兽')) return 'wanderer';
      return 'guard';
    }
    // 灵伴/怨灵/篝火守卫:每帧推进
    engine.addAlways(dt => {
      _bondT += dt;
      if (_bondT > 1.2) { _bondT = 0; Bond.tickGhost(); Bond.tickWarden();
        if (BUILD.s.placed.length) BUILD.tickAll();
        setMomocha(!!FAMILY.momocha());
        FAMILY._cap = BUILD.popCap();   // 议事堂扩容
        // 昼夜:转场音效 + 氛围
        const ph = Ambience.phase();
        if (ph.key !== _lastPhase) {
          if (_lastPhase) phaseChime(_lastPhase, ph.key);
          _lastPhase = ph.key;
          Ambience.apply(true);
        }
        // 叙事推进
        if (Math.random() < 0.02) STORY.tick();
        // 昼夜怪物强度(独立于怨灵)
        const dayMul = Ambience.mobMul();
        if (dayMul !== _lastDayMul) {
          _lastDayMul = dayMul;
          Enemies.setEnemyMod(_ghostMod ? Object.assign({},_ghostMod,{hp:dayMul*(_ghostMod.hp||1)}) : {hp:dayMul});
        }
        // 怨灵附身状态同步到敌人模块
        _ghostMod = COMPANION.possessing()
          ? { hp: COMPANION.hostBuff(), dmg: COMPANION.hostDmg(), spd: COMPANION.hostSpd() } : null;
        Enemies.setEnemyMod(_ghostMod);
      }
      // V0.98:这里原来有两块都删了 ——
      //   1) 24 秒 hug 计时器(canHug → Bond.showHug)
      //      它是 owner 反复抱怨的「每隔几十秒弹窗」的来源之一。
      //   2) kiss 路线的自动拾取(靠 COMPANION.s.pick.on,靠路线解锁)
      //      现在由 companion-actor 接管:她会自己跑过去捡,玩家看得见。
      // 灵伴的台词改由「本局表现」触发,每局 ≤2 句,不再定时弹。
    });
    const b = document.getElementById('btn-cult');
    if (b && !b._bound) {
      b._bound = true;
      b.onclick = () => Hall.open();
    }
    // 菜单统计补一行境界
    const st = document.getElementById('menu-stats');
    if (st && !st._xx) {
      st._xx = true;
      try { Cult.load(); } catch {}
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
