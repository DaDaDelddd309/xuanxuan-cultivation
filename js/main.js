// 《像素幸存者》主入口:装配全部模块、场景流转
import { Engine, Bus } from './core/engine.js?v=17';
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
import { rollChoices, applyChoice } from './game/upgrades.js?v=17';
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
  engine.spawnText(engine.player.x, engine.player.y - 60, name + ' 出现!', { color: '#e43b44', size: 24, life: 2 });
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
  // 灵气结算:砍杀的产出回流到修仙阁(道行 + 源石)
  const sp = SPIRIT.settle(g0(), s);
  Screens.showResult({ time: runTime, kills: s.kills, level: engine.player.level,
    gold: s.gold, spirit: sp }, {
    victory,
    endless: victory,
    onAgain: () => startRun(lastChar),
    onEndless: () => { setEndless(engine); inRun = true; HUD.show(true); Screens.hide(); engine.resume(); },
    onMenu: () => { engine.reset(); showMenu(); },
  });
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
  const p = new Player(charId);
  p.weapons.push(makeWeapon(p.char.weapon));
  engine.player = p;
  combatState.runActive = true;
  engine.passiveLv = { might: 0, cd: 0, speed: 0, hp: 0, magnet: 0, xp: 0, gold: 0, armor: 0 };
  cam.snap(p.x, p.y);
  inRun = true;
  Screens.hide();
  HUD.show(true);
  engine.resume();
  engine.start();
  engine.spawnText(0, -50, '活下来!', { color: '#fee761', size: 26, life: 2 });
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
import { Hall } from './xiuxian/ui.js';
import { Bag, DAY } from './xiuxian/items.js';
import { CAMP, offlineReport } from './xiuxian/camp.js';
import { Merchant } from './xiuxian/merchant.js';
import { COMPANION } from './xiuxian/companion.js';
import { MOUNT } from './xiuxian/mount.js';
import { SPIRIT } from './xiuxian/spirit.js';
import { NAGER, installNagger } from './xiuxian/nag.js';
import { Ritual } from './xiuxian/ritual.js';
import { Bond } from './xiuxian/bond.js';
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
    let _bondT = 0, _idleT = 0, _lastPhase = null, _lastDayMul = 1, _ghostMod = null;
    Cult.init();
    Bag.load('xx_bag_v080');
    CAMP.load();
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
    window.__xx = { Profile, Seed, mods, FAMILY, CHRONICLE, BUILD, COMPANION,
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
    engine.addUpdater(dt => {
      SPIRIT.tick(g0());
      // HUD:灵气数 + 篝火加成提示
      const el = document.getElementById('hud-xx-ling');
      if (el) {
        const n = SPIRIT.TALLY.ling;
        if (el.textContent !== String(n)) {
          el.textContent = n;
          const box = document.getElementById('hud-xx');
          if (box && n > 0) { box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); }
        }
        const f = document.getElementById('hud-xx-fire');
        if (f) f.hidden = !CAMP.burning();
      }
    });
    // 篝火在烧时局内灵气更浓,视觉上给个提示
    engine.addUpdater(dt => {
      const p0 = g0().player;
      if (!p0) return;
      const on = CAMP.burning();
      if (on !== p0._xxSpiritGlow) {
        p0._xxSpiritGlow = on;
        p0.stats.xpMult = on ? (p0.stats.xpMult || 1) * 1.08 : (p0.stats.xpMult || 1) / 1.08;
      }
    });

    // 增益条:把「修仙阁带来的东西」在局内列出来
    engine.addUpdater(dt => {
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
    engine.addUpdater(dt => {
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
    // 护栏圈:让玩家看见自己站在安全区里(V0.96 可见性)
    engine.addUpdater(dt => {
      const g1 = g0(), p1 = g1.player;
      const w = document.getElementById('hud-ward');
      if (!w) return;
      const r = COMPANION.wardRadius();
      if (!r || !p1) { w.hidden = true; return; }
      w.hidden = false;
      const d = r * 2;
      w.style.width = d + 'px'; w.style.height = d + 'px';
      w.style.left = (p1.x - r) + 'px';
      w.style.top  = (p1.y - r) + 'px';
      w.style.transform = 'none';
    });

    // 篝火护栏:火在时,怪不能进圈
    engine.addUpdater(dt => {
      const ward = COMPANION.wardRadius();
      if (!ward || !g0().enemies) return;
      const p = g0().player;
      if (!p) return;
      for (const e of g0().enemies) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < ward && d > 0) {
          // 硬推出护栏:源石护栏内绝对安全
          e.x = p.x + dx / d * ward;
          e.y = p.y + dy / d * ward;
        }
      }
    });
    function g0() { return window.__g || engine; }
    setTimeout(() => Ritual.start(false), off && off.dao > 0 ? 2600 : 700);
    // 建筑真实掉落:敌人死亡时掷建材
    Bus.on('enemy-death', e => {
      const kind = _kindOf(e);
      const g1 = BUILD.onKill(kind) || BUILD.onKillTier(e.boss ? 2 : e.elite ? 1 : 0);
      if (g1 && engine.player) {
        engine.spawnText(engine.player.x, engine.player.y - 44,
          g1.icon + ' 获得 ' + g1.name, { color:'#c9a227', size: 14, life: 2.2 });
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
      _bondT += dt; _idleT += dt;
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
      if (_idleT > 24) {
        _idleT = 0;
        if (COMPANION.canHug()) Bond.showHug();
        else Bond.idle();
      }
      // 自动拾取(kiss 路线):一次一个,效率不高
      if (COMPANION.s.pick.on && engine.player && engine.pickups) {
        for (let i = engine.pickups.length - 1; i >= 0; i--) {
          const k = engine.pickups[i];
          const d = Math.hypot(engine.player.x - k.x, engine.player.y - k.y);
          if (COMPANION.autoPick(dt, d)) {
            const p = engine.player;
            if (k.kind === 'gem') p.addXp(k.xp);
            else if (k.kind === 'coin') engine.stats.gold += Math.round(k.gold * p.stats.goldMult);
            else if (k.kind === 'meat') { p.hp = Math.min(p.stats.maxHp, p.hp + k.heal);
              engine.spawnText(p.x, p.y-30, '+' + k.heal + ' 气血', { color:'#63c74d', size:14 }); }
            else if (k.kind === 'chest') { p.addXp(60); engine.stats.gold += 45;
              p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp*0.3);
              engine.spawnText(p.x, p.y-36, '宝宝帮你开了箱', { color:'#ffd319', size:14 }); }
            engine.remove(engine.pickups, i);
            break;   // 一次只捡一个
          }
        }
      }
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
