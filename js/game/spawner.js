// ===== ⚔️ 战斗agent 名下:刷怪导演(时间曲线 / 怪潮包围 / 环带刷怪 / 无尽模式) =====
import { spawnEnemy, ENEMY_TYPES, combatState } from './enemies.js?v=17';
import { Director, P } from './director.js';   // 生成预算导演(V0.99 工单 XX-SPAWN-001)

import { PAL } from '../core/palette.js';
import { modAt as _collatzMod } from './collatz.js';   // XX-MATH-001
const MAX_E = 180;          // 同屏普通怪上限(CONTRACT v2.1 §4:200→180,超过不刷普通怪)
const TAU = Math.PI * 2;

// —— XX-MATH-001:Collatz 难度调制 ——
//
// 局内难度原本是时间的**线性**函数(dmgMultAt = 1 + t/240)。加上这条之后,
// 曲线的形状变成「长长的收敛段 + 突然的爆发」,玩家的体感从「越来越难」
// 变成「正在收敛,或者正在爆发」—— 而且**可学习**:奇数步永远爆发。
//
// 🔒 **默认中性**:`_traj` 为 null 时系数恒为 1.0。
// 这不是偷懒,是它能安全接进来的前提 —— 不激活就等于没接,
// 现有每一个测试的行为都不受影响,回滚也只是把这一行删掉。
let _traj = null;
/** 由 ui.arrive() 在开局时按种子注入;传 null 即回到中性。 */
export function setCollatzTrajectory(t) { _traj = t || null; }
export function getCollatzTrajectory() { return _traj; }
/** 当前时刻的难度调制系数 ∈ [0.85, 1.25];未激活恒为 1。 */
export function collatzModAt(t) { return _traj ? _collatzMod(_traj, t) : 1; }

// 阶段刷怪池:[类型, 权重] —— 0-60s 纸妖/夜枭 → 120s 加骨卫/蛛妖 → 240s 加金刚力士/火药童子 → 360s 加铁甲龟/青灯鬼火
const POOLS = [
  [['slime', 6], ['bat', 3]],
  [['slime', 4], ['bat', 4], ['skeleton', 3]],
  [['slime', 3], ['bat', 3], ['skeleton', 4], ['spider', 3], ['qinglu', 1]],
  [['bat', 2], ['skeleton', 4], ['spider', 3], ['brute', 3], ['bomber', 3], ['qinglu', 2], ['mire', 1]],
  [['skeleton', 3], ['spider', 3], ['brute', 4], ['bomber', 3], ['turtle', 2], ['wisp', 3], ['qinglu', 2], ['mire', 2], ['summoner', 1]],
];
function poolIdx(t) { return t < 55 ? 0 : t < 120 ? 1 : t < 240 ? 2 : t < 360 ? 3 : 4; }

function pickWeighted(pool) {
  let tot = 0;
  for (let i = 0; i < pool.length; i++) tot += pool[i][1];
  let r = Math.random() * tot;
  for (let i = 0; i < pool.length; i++) { r -= pool[i][1]; if (r <= 0) return pool[i][0]; }
  return pool[0][0];
}

// 普通怪血量曲线：前期平缓，240s 后明显加压，避免后期低基础血量怪被一击清空。
// 采样点:0s×1.00 / 60s×1.35 / 120s×1.90 / 300s×6.50 / 600s×28.00。
const HP_POINTS = [[0, 1], [60, 1.35], [120, 1.9], [300, 6.5], [450, 15], [600, 28]];
// 精英单独走较缓曲线，再叠加精英自身×6，避免普通怪加压后精英膨胀到不可控。
const ELITE_HP_POINTS = [[0, 1], [60, 1.2], [120, 1.55], [300, 3.5], [450, 5.8], [600, 8]];
const NORMAL_HP_TAIL = 0.06; // 600s 后每秒继续增加 0.06 倍,无尽模式仍有成长
const ELITE_HP_TAIL = 0.018;

function curveAt(t, points, tail = 0) {
  const sec = Math.max(0, Number(t) || 0);
  if (sec >= points[points.length - 1][0]) {
    return points[points.length - 1][1] + (sec - points[points.length - 1][0]) * tail;
  }
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (sec <= t1) {
      const [t0, v0] = points[i - 1];
      const f0 = (sec - t0) / (t1 - t0);
      const f = f0 * f0 * (3 - 2 * f0); // smoothstep,避免阶段切换时血量跳变
      return v0 + (v1 - v0) * f;
    }
  }
  return points[points.length - 1][1];
}

// XX-MATH-001:曲线形状 × Collatz 调制系数(未激活时系数=1,行为不变)
export function hpMultAt(t) { return curveAt(t, HP_POINTS, NORMAL_HP_TAIL) * collatzModAt(t); }
export function eliteHpMultAt(t) { return curveAt(t, ELITE_HP_POINTS, ELITE_HP_TAIL) * collatzModAt(t); }

// 低基础血量怪的后期保底:600s 时至少 735HP,保证进化武器单发也不能随手秒掉。
export function minOrdinaryHpAt(t) {
  return Math.max(0, (Number(t) || 0) - 180) * 1.75;
}

export function spawnHpMultAt(typeId, t, { elite = false, horde = false } = {}) {
  const type = ENEMY_TYPES[typeId];
  if (!type) return 1;
  const normalCurve = hpMultAt(t);
  const floor = minOrdinaryHpAt(t) / Math.max(1, type.hp);
  if (elite) return Math.max(eliteHpMultAt(t), floor);
  const curve = normalCurve * (horde ? 0.75 : 1);
  return Math.max(curve, floor);
}
function dmgMultAt(t) { return (1 + t / 240) * collatzModAt(t); }   // XX-MATH-001
function spdMultAt(t) { return 1 + Math.min(0.3, t / 2000); }

let endless = false;

/**
 * 生成模式(V0.99)
 *
 *   'budget' —— 默认。生成速率由**玩家行为**决定:捡宝石才加油,站着不动就停刷。
 *               普通探索走这个,能挂机。
 *   'timed'  —— 旧的**纯时间驱动**:强度只跟本局时长走,和玩家做什么无关。
 *               保留给「幻境」「副本」「限时挑战」这类**规则应该由计时器说了算**
 *               的场合 —— 那种玩法里玩家就是要被节奏推着走,不能因为站着不动就消停。
 *
 * owner 明确要求过这套别删,它是后面做幻境的地基。
 */
let spawnMode = 'budget';
export function getSpawnMode() { return spawnMode; }
export function setSpawnMode(m) {
  if (m !== 'budget' && m !== 'timed') return false;
  spawnMode = m;
  return true;
}
// 复用的刷怪坐标(热路径零分配)
const SP = { x: 0, y: 0 };

// 视野外缘环带上取点
function ringSpot(g, p) {
  const zoom = g.cam ? g.cam.zoom : 1;
  const R = Math.hypot(g.w, g.h) / (2 * zoom) + 50 + Math.random() * 150;
  const a = Math.random() * TAU;
  SP.x = p.x + Math.cos(a) * R;
  SP.y = p.y + Math.sin(a) * R;
}

/** 统一的强度曲线出口。导演的「宝石兑现」也走这里,避免两份血量公式各走各的 */
export function spawnOptsFor(type, t, o = {}) {
  const dmgM = dmgMultAt(t), spdM = spdMultAt(t);
  return { hpMult: spawnHpMultAt(type, t, o), dmgMult: dmgM, speedMult: spdM };
}

export function initSpawner(g) {
  // 导演要用同一套强度曲线算宝石兑现出来的怪
  g.__spawnOpts = spawnOptsFor;
  Director.reset();
  let acc = 0, hordeT = 42, eliteCd = 15;
  g.addReset(() => {
    acc = 0; hordeT = 42; eliteCd = 15; endless = false;
    spawnMode = 'budget';
    g._finalBoss = false; g._endless = false;
    combatState.runActive = false;
  });

  g.addUpdater(dt => {
    const p = g.player;
    if (!p || !combatState.runActive) return;
    const t = g.time;
    // 先让导演跑一拍:它要算出压力/存量燃料/两道闸门,后面都用它的读数
    const s_read = Director.tick(dt, g);
    // 600s 后交给 Boss 流程(最终 Boss 期间停刷);无尽模式解除限制
    if (!endless && (t >= 600 || g._finalBoss)) return;
    // 前 120s 玩家尚在成长期,刷怪密度与同屏上限下调 15%,2 分钟后恢复原曲线
    const early = !endless && t < 120;
    const cap = early ? (MAX_E * 0.85) | 0 : MAX_E;

    // 怪潮:每 45~60s 一圈同种怪环形包围
    // 怪潮:budget 模式下压力足够才来(站着不动不会被包抄);
    // timed 模式保持原样 —— 幻境就该按时间表走。
    if (spawnMode === 'timed' || s_read.rate >= 0.6) {
      hordeT -= dt;
      if (hordeT <= 0) {
        hordeT = (endless ? 38 : 46) + Math.random() * 14;
        doHorde(g, p, t, early);
      }
    } else {
      hordeT = Math.min(hordeT, 12);     // 冷却别攒太久,压力回来就能来
    }

    // 持续小怪:间隔随时间缩短(0.9s → 360s 时 0.504s → 600s 时 0.348s);360s 后收缩放缓(后期密度增长放缓,
    // 旧曲线 600s 收缩至 0.24s);前 120s 间隔 ×1/0.85(密度 -15%);无尽 0.15s 下限
    eliteCd -= dt;
    // V0.99:两种模式在这里分叉。
    //   budget:速率 = 时间曲线(难度) × 生成压力(行为) × 两道闸门(存量)
    //          站着不动 → 压力泄到 0 → rate=0 → 完全不刷 → 可以挂机。
    //   timed :旧的纯时间间隔(0.9s → 0.26s),给幻境/副本用。
    const perSec = spawnMode === 'timed'
      ? 1 / Math.max(endless ? 0.15 : 0.26,
          0.9 - Math.min(t, 360) * 0.0011 - Math.max(0, t - 360) * 0.00065)
          * (early ? 1 / 0.85 : 1)
      : Director.rate(g, t) * (early ? 0.85 : 1);
    acc += dt * perSec;
    let budget = acc | 0;
    acc -= budget;
    if (budget > 6) budget = 6;          // 单帧上限再压一档:别让补帧一口气吐一片
    if (budget <= 0) return;
    const pool = POOLS[poolIdx(t)];
    for (let i = 0; i < budget; i++) {
      if (g.enemies.length >= cap) break;
      ringSpot(g, p);
      // 精英:冷却好了有小概率出现(最小间隔 ~16-24s);360s 后可能出黑无常
      if (eliteCd <= 0 && Math.random() < 0.09) {
        const et = (t >= 360 && Math.random() < 0.4) ? 'reaper' : pickWeighted(pool);
        spawnEnemy(g, et, SP.x, SP.y, spawnOptsFor(et, t, { elite: true }));
        eliteCd = 16 + Math.random() * 8;
        continue;
      }
      const type = pickWeighted(pool);
      spawnEnemy(g, type, SP.x, SP.y, spawnOptsFor(type, t));
    }
  });
}

// 怪潮:一圈同种怪包围玩家(血量 ×0.75;数量随时间增加但 360s 后放缓:
// 14+8@360s → 24@600s(旧曲线 27);前期数量 -15%)
function doHorde(g, p, t, early) {
  if (g.enemies.length > (early ? 145 : 165)) return;
  const type = pickWeighted(POOLS[poolIdx(t)]);
  const zoom = g.cam ? g.cam.zoom : 1;
  const R = Math.hypot(g.w, g.h) / (2 * zoom) + 60;
  let n = 14 + ((Math.min(t, 360) / 45) | 0) + ((Math.max(0, t - 360) / 90) | 0);
  if (n > 30) n = 30;
  if (early) n = (n * 0.85) | 0;
  const off = Math.random() * TAU;
  const dmgM = dmgMultAt(t), spdM = spdMultAt(t);
  for (let i = 0; i < n; i++) {
    if (g.enemies.length >= MAX_E) break;
    const a = off + (i / n) * TAU + (Math.random() - 0.5) * 0.15;
    spawnEnemy(g, type, p.x + Math.cos(a) * R, p.y + Math.sin(a) * R, {
      hpMult: spawnHpMultAt(type, t, { horde: true }), dmgMult: dmgM, speedMult: spdM,
    });
  }
  g.spawnText(p.x, p.y - 70, '怪潮来袭!', { color: PAL.cinnabar, size: 20, life: 1.6 });
}

// 通关后无尽模式:继续刷怪且强度随时间继续增长
export function setEndless(g) {
  endless = true;
  g._endless = true;
  g._finalBoss = false;
}
