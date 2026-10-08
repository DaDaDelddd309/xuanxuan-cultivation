// ===== 刷怪导演 · 生成预算(V0.99 · 工单 XX-SPAWN-001)=====
//
// 旧 spawner 是**纯时间驱动**的:间隔从 0.9s 收到 0.26s,600s 时每秒 3.8 只,
// 加上 45 秒一次的怪潮(最多 30 只)。后期爆炸是必然的 —— owner 的原话:
// 「后期都爆炸了」。而且它和玩家做什么完全无关:你站着不动,怪照样来。
//
// 这里换成**目标数量控制器**:
//
//   desired(目标怪量) = [保底 + 压力 × (上限 - 保底)] × 两道闸门 × 呼吸
//   rate  (生成速率) = clamp((desired - 实际) × 增益, 0, 上限)
//
// 负反馈 ⇒ 场面天然稳定在一个带里。不硬编码"什么时候刷",而是给一个
// **随玩家行为浮动的目标**,控制器去追 —— 这就是 owner 说的"动态计算"。
//
// 压力从哪来(两条独立燃料,都当场兑现 1~3 只同档位的怪):
//   · 捡起宝石  —— 想变强就得主动去捡。高级怪掉高级宝石,高级宝石刷高级怪。
//   · 击杀怪物  —— 站着打也能维持,但涨不上去。
//   只有宝石是燃料:金币不喂压力,否则捡一次钱就凭空出怪,规律会被摸出来。
//
// 关于"挂机":owner 明确纠正过一次 ——
//   「站着不动不是挂机,而是刷怪频率变低,然后还是有保底刷怪的,只是不再会一堆」
// 所以保底永远 > 0(desired 最低 MIN_ALIVE),站着不动回落到"零星几只",
// 但不叠加。少了"完全停刷"这个免费暂停,压迫感还在。
//
// 机制**不被看穿**:不硬编码、不写在脸上 —— 没有给玩家看的阈值文案,
// 不把内部状态挂 window。玩家只会感觉到"我不动的时候怪少一些"。
//
// 架构参考开源社区的 pressure-based director:导演只产出旋钮(desired / rate),
// 不直接决定生成;生成器读旋钮。职责分离,强度曲线也只有一份。

import { spawnEnemy, ENEMY_TYPES } from './enemies.js?v=17';

const TAU = Math.PI * 2;

// ————————————————————————— 昼夜护栏倍率 —————————————————————————
// 相对白天的基准。夜最大,白天最小。
export const WARD_BY_PHASE = {
  day:   118,   // 白天妖物弱,收小 —— 省燃料,也提示"白天不用靠火"
  dawn:  152,
  dusk:  172,
  night: 218,   // 夜里妖物最多,放到最大 —— 这时候火才是刚需
};

export function wardTarget(phaseKey) {
  return WARD_BY_PHASE[phaseKey] || WARD_BY_PHASE.day;
}

// ————————————————————————— 参数表 —————————————————————————
// 想调手感只改这一块。
export const P = {
  // —— 目标怪量带 ——
  MIN_ALIVE: 4,      // 保底:一直有零星几只(绝不归零)
  MAX_ALIVE: 92,     // 压力满时的目标带

  // —— 控制器 ——
  GAIN: 0.75,
  RATE_MAX: 7.5,     // 每秒最多补几只

  // —— 燃料:一颗宝石值多少压力 ——
  // 高级怪的宝石给更多压力 → 高级怪带来更高的目标带,也更难彻底静下来。
  fuel:      { gem_b: 0.055, gem_g: 0.085, gem_r: 0.14 },
  killFuel:  0.045,            // 杀一只怪补一点(owner 要的是"死一只刷几个")
  // 兑现概率:1 只起,34% +1,11% 再 +1
  extraChance: [0.34, 0.11],
  killSpawnChance: [0.42, 0.14],

  // —— 泄压 ——
  decaySlow: 0.022,  // 正常流动 → 满压力约 45 秒回落到保底
  decayFast: 0.075,  // 停下不动 6 秒后 ×3.4 → 约 13 秒
  idleGrace: 6,
  fuelCap:   0.32,   // 场上未捡宝石的存量燃料封顶(200 颗宝石也撑不起无限刷)

  // —— 两道闸门(乘在 desired 上,不是加在 rate 上)——
  popGatePow: 1.6,       // 场上怪越多,目标带压得越狠
  tierGateMax: 0.55,     // 档位太高时最多砍掉 55%(仍留 45% 保底)

  ringPad: 90,
  cap: 150,              // 硬顶,任何模式都不越过
};

/** 目标带的缓慢起伏:让妖物有"潮"的感觉,而不是一条直线。
 *  两个不同周期的正弦叠加 —— 连续但读不出周期。 */
function breathe(t) {
  return 1 + 0.10 * Math.sin(t / 7.3) + 0.06 * Math.sin(t / 2.9 + 1.7);
}

// 宝石 sprite → 该档怪池
const TIER_POOL = {
  gem_b: ['slime', 'bat', 'skeleton', 'spider'],
  gem_g: ['wisp', 'qinglu', 'brute', 'mire', 'summoner'],
  gem_r: ['turtle', 'reaper'],
};

/** 场上怪的档位均值:1=低 2=中 3=高 */
function avgTier(g) {
  const es = g.enemies;
  if (!es || !es.length) return 1;
  let sum = 0;
  for (let i = 0; i < es.length; i++) {
    const t = ENEMY_TYPES[es[i].type];
    sum += t ? Math.max(1, Math.min(3, Math.round(t.xp / 2.5))) : 1;
  }
  return sum / es.length;
}

// ————————————————————————— 状态 —————————————————————————
const s = {
  pressure: 0.30,     // 开局给一点,不至于第一秒空场
  lastPickupAt: 0,
  started: false,
  read: { fuel: 0, popGate: 1, tierGate: 1, idleT: 0, rate: 0, desired: 0 },
};

export const Director = {
  s,

  reset() {
    s.pressure = 0.30;
    s.lastPickupAt = 0;
    s.started = false;
    s.read = { fuel: 0, popGate: 1, tierGate: 1, idleT: 0, rate: 0, desired: 0 };
  },

  /** 场上未被捡走的宝石折算出的"存量燃料" */
  pendingFuel(g) {
    if (!g.pickups) return 0;
    let f = 0;
    for (let i = 0; i < g.pickups.length; i++) {
      const k = g.pickups[i];
      if (k && k.kind === 'gem') f += P.fuel[k.sprite] || P.fuel.gem_b;
    }
    return Math.min(f, P.fuelCap);
  },

  /** 当前场上应该有多少只怪 —— 整个机制的核心 */
  desiredAlive(g, t) {
    const eff = Math.max(s.pressure, s.read.fuel || 0);      // 行为 → 压力
    const gate = (s.read.popGate ?? 1) * (s.read.tierGate ?? 1);
    const band = P.MIN_ALIVE + eff * (P.MAX_ALIVE - P.MIN_ALIVE);
    return Math.max(0, Math.min(P.cap, band * gate * breathe(t)));
  },

  /** 捡起一颗宝石:加油 + 当场兑现同档位的怪 */
  onGemPickup(g, k) {
    const sprite = (k && k.sprite) || 'gem_b';
    s.pressure = Math.min(1, s.pressure + (P.fuel[sprite] || P.fuel.gem_b));
    s.lastPickupAt = g.time;
    if (!s.started) { s.started = true; s.lastPickupAt = g.time; }
    return this._pay(g, TIER_POOL[sprite] || TIER_POOL.gem_b, P.extraChance);
  },

  /** 杀掉一只怪:也补一点压力并可能兑现 */
  onKill(g, enemy) {
    const t = enemy && enemy.type;
    const xp = t && ENEMY_TYPES[t] ? ENEMY_TYPES[t].xp : 1;
    const sprite = xp >= 5 ? 'gem_r' : xp >= 2 ? 'gem_g' : 'gem_b';
    s.pressure = Math.min(1, s.pressure + P.killFuel);
    return this._pay(g, TIER_POOL[sprite], P.killSpawnChance);
  },

  /** 兑现:按概率刷 1~3 只同档怪,视野外环带 */
  _pay(g, pool, chances) {
    const p = g.player;
    if (!p) return 0;
    let n = 1;
    for (const c of (chances || [])) if (Math.random() < c) n++;
    const zoom = g.cam ? g.cam.zoom : 1;
    const R = Math.hypot(g.w, g.h) / (2 * zoom) + P.ringPad;
    const off = Math.random() * TAU;
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      if (g.enemies.length >= P.cap) break;
      const a = off + (i / n) * TAU;
      // 强度曲线走生成器自己的钩子 —— 别复制第二份血量公式,
      // 两份必然对不上,弱的那边先崩。
      const type = pool[Math.floor(Math.random() * pool.length)];
      const o = g.__spawnOpts ? g.__spawnOpts(type, g.time) : {};
      spawnEnemy(g, type, p.x + Math.cos(a) * R, p.y + Math.sin(a) * R, o);
      spawned++;
    }
    return spawned;
  },

  /** 每帧推进:泄压 + 两道闸门 */
  tick(dt, g) {
    if (!s.started) { s.started = true; s.lastPickupAt = g.time; }
    const idleT = Math.max(0, g.time - s.lastPickupAt);
    const decay = idleT > P.idleGrace ? P.decayFast : P.decaySlow;
    s.pressure = Math.max(0, s.pressure - decay * dt);

    const fuel = this.pendingFuel(g);
    const n = g.enemies ? g.enemies.length : 0;

    // 闸门 1:场上怪越多,目标带压得越狠(连续函数,不是硬阈值)
    const ratio = Math.min(1, n / P.MAX_ALIVE);
    const popGate = Math.max(0.12, 1 - Math.pow(ratio, P.popGatePow));

    // 闸门 2:场上怪档位太高 → 收手,别把玩家淹死
    const at = avgTier(g);
    const over = Math.max(0, at - 1.6) / 1.4;
    const tierGate = Math.max(1 - P.tierGateMax, 1 - Math.min(1, over));

    s.read = { fuel, popGate, tierGate, idleT, avgTier: at, enemies: n };
    return s.read;
  },

  /** 生成速率(只/秒)。**永不为 0** —— 站着不动也有保底的那几只 */
  rate(g, t) {
    const desired = this.desiredAlive(g, t);
    const actual = g.enemies ? g.enemies.length : 0;
    const deficit = desired - actual;
    const r = Math.max(0, Math.min(P.RATE_MAX, deficit * P.GAIN));
    s.read.desired = desired; s.read.rate = r;
    return r;
  },
};

// ————————————————————————— 篝火 ↔ 拾取:可投入的成长线 —————————————————————————
//
// owner 的完整意图:
//   「这样子才会促进玩家选了这个拾取技能后,可以选择是否升级投入更多源石增加篝火
//     范围来匹配技能…例如不想自动拾取了,就砸进去源石,升级篝火,护栏范围大了,
//     技能的拾取范围比护栏小,就可以安逸挂机了」
//
// 这不是平衡问题,是让玩家**有得选**:
//   · 拾取撑大、篝火没投 → 护栏跟不上 → 自动拾取在火圈外沿也在发生 → 有代价
//   · 砸源石升篝火     → 护栏涨得比拾取快 → 护栏 ⊃ 拾取 → 安逸挂机
// 谁涨得快由玩家决定。硬约束只有两条:护栏不能形同虚设(有下限),
// 也不能无限大到没有取舍(有上限)。
// 数值是这么定的(按 owner 的取舍推,不是随手):
//   篝火 5 级 + 白天 + 大拾取(800)→ 保护 > 800 ⇒ 能挂机
//   篝火 1 级 + 白天 + 大拾取(800)→ 保护 < 800 ⇒ 追不上,外沿有代价
//   篝火 1 级 + 小拾取(120)      → 保底也够盖住 ⇒ 新手不会被自动拾取坑到
const WARD_BASE = 130;           // 篝火 1 级的护栏基准
const WARD_PER_LV = 175;         // 每升一级 +175:5 级累计 830,配白天倍率能追过 800 的大拾取
const WARD_PICKUP_FLOOR = 0.55;  // 护栏至少是拾取的 55%
const WARD_PICKUP_CEIL  = 2.60;  // 也不能超过拾取的 2.6 倍

/**
 * 护栏半径 —— 唯一入口。UI / 局内推怪 / HUD 全部走它,避免三处各算一套。
 * @param {object} o
 * @param {number} o.campLv  篝火等级 1..5
 * @param {string} o.phase   day/dawn/dusk/night
 * @param {boolean} o.mount  坐骑加成
 * @param {number} o.pickup  局内拾取半径
 */
export function computeWard({ campLv = 1, phase = 'day', mount = false, pickup = 0 } = {}) {
  const base = WARD_BASE + (Math.max(1, campLv) - 1) * WARD_PER_LV;
  const phaseMul = wardTarget(phase) / WARD_BY_PHASE.day;
  const mountMul = mount ? 1.28 : 1;
  let w = base * phaseMul * mountMul;
  if (pickup > 0) {
    const clamped = Math.max(pickup * WARD_PICKUP_FLOOR, Math.min(pickup * WARD_PICKUP_CEIL, w));
    w = Math.max(w, clamped);
  }
  return Math.round(Math.max(48, w));
}

/** 护栏外沿还能捡到的那一圈(玩家看得见的"越界收益");0 = 已完全护住 */
export function wardSlack(ward, pickup) {
  if (!ward) return 0;
  return Math.max(0, Math.round(pickup - ward));
}

/** 这套护栏能不能让玩家挂机:护栏完全盖住拾取范围,且篝火等级够高 */
export function wardSafe(campLv, pickup) {
  return Math.max(1, campLv) >= 3 && wardSlack(computeWard({ campLv, pickup }), pickup) === 0;
}

// ————————————————————————— 护栏平滑跟随 —————————————————————————
// 昼夜换算和投入换算都在 computeWard 里,这里只负责"慢慢变过去"。
// 直接跳变会让护栏像在呼吸;平滑收缩才是"天亮了,妖物退远了"的自然感。
// 每秒最多 24px。
const ward = { cur: 0 };

export function stepWard(dt, target) {
  const t = Math.max(0, target || 0);
  if (t === 0) { ward.cur = 0; return 0; }
  const maxDelta = 24 * dt;
  const d = t - ward.cur;
  ward.cur += Math.abs(d) <= maxDelta ? d : Math.sign(d) * maxDelta;
  return ward.cur;
}

export function wardNow() { return ward.cur; }
export function resetWard() { ward.cur = 0; }

// ————————————————————————— 篝火余烬 · 昼夜可视反馈 —————————————————————————
//
// owner 的要求:
//   「篝火晚上的时候,人物要有类似二阶段,火焰缠身那种特效…有点像灰烬燃烧的点点,
//     或者闪烁也行,起码肉眼判断目前是黑夜第几个阶段,
//     然后快要白天了,就闪烁一下就等于结束了源石篝火,需要继续投入源石」
//
// 拆成两件事:
//   1. **烧了一整夜的余烬** —— 人物身上缠着灰烬火星,闪烁频率随夜色推进而变。
//      玩家只靠肉眼就能知道"现在是夜里第几段",不用看时钟。
//   2. **将熄的预告** —— 快到白天时先闪三下,提醒"这炉快烧完了,要不要续源石"。
//      这是一个**决策点**,不是惩罚。
//
// 全是纯函数 + 状态,不碰 canvas —— 绘制在 main.js 里做。

const EMBER = {
  started: false,
  nightStart: 0,     // 进入夜晚的时刻
  lastPhase: null,   // 上一次见到的相位(用于检测跨相位的瞬间)
  flick: 0,          // >0 表示正在演"将熄"的三连闪
  flickAt: 0,
  warnFired: false,  // 本夜是否已经预警过
};

/**
 * 每帧推进余烬状态。
 * @returns {object} 供绘制层读取的读数(不直接画)
 */
export function tickEmber(g, now, phaseKey) {
  const E = EMBER;
  if (!E.started || (phaseKey !== 'night' && E.lastPhase === 'night')) {
    // 进入夜晚 → 开始计时
    if (phaseKey === 'night' && (!E.started || E.lastPhase !== 'night')) {
      E.started = true; E.nightStart = now; E.warnFired = false;
    } else if (phaseKey !== 'night' && E.lastPhase === 'night') {
      // 天亮了 → 余烬结束
      E.started = false; E.flick = 0; E.warnFired = false;
    }
  }
  E.lastPhase = phaseKey;
  if (!E.started) return { on: false };

  const age = Math.max(0, now - E.nightStart);
  // 夜段进度 0..1(按 4.5 分钟一夜估,实际以相位切换为准)
  const prog = Math.min(1, age / 270);

  // 闪烁频率:夜里一开始最旺(余烬刚添),越接近天亮越弱(快烧完了)
  const hz = 3.2 - prog * 2.4;
  const t = now / 1000;
  // 两层不同频率叠加 → 看着像"灰烬点点",不像节拍器
  const f = Math.sin(t * hz * Math.PI * 2) * 0.6 + Math.sin(t * (hz * 2.7) * Math.PI * 2) * 0.4;
  const alpha = Math.max(0.12, (1 - prog) * 0.75 + f * 0.22);

  // 将熄预告:后 22% 的夜里闪三下
  const warnZone = prog > 0.78;
  if (warnZone && !E.warnFired) {
    E.warnFired = true;
    E.flick = 3; E.flickAt = now;
  }
  if (E.flick > 0 && now - E.flickAt > 260) { E.flick--; E.flickAt = now; }

  return { on: true, prog, alpha, flick: E.flick, dying: warnZone };
}

export function resetEmber() {
  const E = EMBER;
  E.started = false; E.nightStart = 0; E.lastPhase = null;
  E.flick = 0; E.flickAt = 0; E.warnFired = false;
}

/** 灰烬粒子的稳定分布(种子化,避免每帧乱跳) */
export function emberPoints(n = 7) {
  const out = [];
  for (let i = 0; i < n; i++) {
    // 黄金角散布:均匀绕开又不重叠,看着像随机飘的灰烬
    const a = i * 2.39996;                 // ≈137.5°
    const r = 13 + (i % 3) * 6;
    out.push({
      dx: +(Math.cos(a) * r).toFixed(3),
      dy: +(Math.sin(a) * r * 0.62).toFixed(3),
      sz: +(1.1 + (i % 2) * 0.8).toFixed(3),
    });
  }
  return out;
}
