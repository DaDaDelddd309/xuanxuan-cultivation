// ===== 灵伴 · 独立拾取系统(XX-COMPANION-004)=====
//
// owner 要的东西,一句话:**她捡到的东西必须亲手送到你手上。**
//
// 旧行为(companion-actor.js 的 _findGem/_pick)是:
//   她看到宝石 → 从世界里删掉 → 经验**立刻**进玩家身上。
// 那不是"帮忙",那是**替玩家按了拾取键** —— 玩家的手没动,东西已经到了。
// owner 的原话是「不是拾取了直接到玩家身上」,要的是**过程**。
//
// 所以这一套的核心不是"她会捡",是**递送要看得见**:
//   锁定(红外线扫到)→ 走过去(慢) → 捡起来 → 走回你身边(慢)
//   → 伸触手 → 触手慢慢够到你 → 才交付
// 玩家只要看见触手伸出来,就知道"她要把东西给我了"。这句话是设计的验收标准。
//
// 三条硬约束(都是从 owner 的话里拆出来的,不是我自己加的):
//   1. 扫描范围**上限 = 玩家磁铁的满级值**,不是拍脑袋的数(见 SCAN_MAX 的推导)。
//   2. 只瞄**玩家能拾取的那几类**。瞄到怪不锁定 —— 这是"红外线扫过去
//      锁不住妖物、只锁得住地上的东西"的来源。
//   3. **绝不伤害玩家**。本文件没有一行造成伤害的代码,连碰撞检测都没有。
//      (旧 actor 的 _checkHurt 是"怪打她",不是"她打人";新系统完全不碰。)
//
// 与旧 actor 的关系:旧的 _findGem/_pick 已被本模块**取代**(不是并存)。
// 留着两套会同时对同一颗宝石下手 —— 谁先 remove 谁赢,行为不可预测。
//
// 依赖方向:本文件在 js/xiuxian/,单向 import js/game/。合规。

import { applyPickup } from '../game/pickups.js?v=18';
import { COMPANION } from './companion.js';
import { PAL } from '../core/palette.js';

// —— 扫描半径 ——
// 上限 215 不是拍的,是玩家磁铁的**理论满级值**,逐项算出来的:
//   基线            60   (js/game/player.js:137 `magnet: 60 + ...`)
//   磁石满级 5×25   125   (js/game/upgrades.js:20/35)
//   游侠角色         30   (js/game/player.js:31,四角色里唯一带 magnet 的)
//   ------------------------------------------
//   合计            215
// 坐骑倍率与酒馆同伴加成还能再抬,但那是**局外变数**,拿它当上限会让
// 这个数每次开档都不一样。所以取**局内可复现的满级值**当封顶,
// 她的范围只会**不超过**玩家满级,不会超过。
//
// ⚠️ 它取代了 companion.js 里原来的 pickRadius()(`46 + sin(...)×10`)。
//   那个函数本来就**零调用点**,而且 46±10 与 215 差 2~4 倍,根本不是一回事。
//   "范围随时间轻微起伏、避免机械感"这个诉求由下面的扫描摆动(sweep)承担 ——
//   那才是真正被画出来、玩家真看得见的起伏。
const SCAN_MAX = 215;
const SCAN_MIN = 90;          // 开局范围(见 rampSeconds)
const RAMP_SEC = 120;         // 2 分钟从 SCAN_MIN 长到 SCAN_MAX

// —— 节奏:越久越快,但有 10 秒硬下限 ——
// owner 原话:「随着游戏时间越久自动拾取就是越快,但是最快也要10秒间隔」。
// 10 秒是**下限**,不是目标 —— 低于它,递送仪式就变成 spam,玩家看不见
// 触手伸出来了(那正是验收标准)。所以宁可慢到被抱怨,不可快到看不见。
//
// ⚠️ 单位:**全部是毫秒或秒,不许混**。elapsed 存的是**秒**(逐帧 += dt),
//   所以凡是拿 elapsed 做分母的常量必须是**秒**。
//   这里踩过一次:`INTERVAL_RAMP` 原写成 150000(毫秒),却直接和秒相除,
//   实测 interval 恒等于 28000,"越久越快"从来没生效过 ——
//   而烟雾验证的"interval 区间 27993~28000"正是它的指纹。
//   所以下面两个常量一律把单位写进名字。
const INTERVAL_START_MS  = 28000;  // 开局一次要等 28 秒
const INTERVAL_FLOOR_MS  = 10000;  // 但再怎么快,两次之间也隔 10 秒
const INTERVAL_RAMP_SEC  = 150;    // 2.5 分钟降到下限(秒!)

// —— 移动速度:全部慢于玩家 ——
// 玩家正常移动 137~163 像素/秒(见 js/game/player.js:13/22/31/40),
// 冲刺 ×4.5。灵伴三个状态都压在玩家**最慢那个角色**之下,
// 这样"我在这里等等它"才成立 —— 她追不上,所以你得等她。
const SPD_FOLLOW = 96;         // 闲逛跟随
const SPD_FETCH  = 108;        // 去取
const SPD_CARRY  = 120;        // 送回来
const SPD_TENTACLE = 105;      // 触手伸出的速度(这是"慢慢触碰"的量)

// —— 判定距离 ——
const LOCK_R      = 16;        // 扫描线离目标多近算"锁定"
const FETCH_REACH = 20;        // 走到多近算"捡起来了"
const HANDOFF_GAP = 74;        // 离玩家多近才伸触手
const FOLLOW_LAG  = 44;        // 闲逛时落后玩家多少
const RETREAT_LAG = 82;        // 玩家残血时她退开(旧 actor 的行为,搬过来)

// —— 扫描摆动 ——
const SWEEP_ARC = 0.95;        // 左右各摆多少弧度(≈54°,狙击手找目标的视野)
const SWEEP_HZ  = 1.45;        // 摆动频率(弧度/秒)—— 太快看不清,太慢等不及

export const GATHER_STATE = {
  FOLLOW: 'follow',   // 跟着玩家,红外线在扫
  FETCH:  'fetch',    // 锁定了,正在走过去
  CARRY:  'carry',    // 手里有货,正在走回来
  HANDOFF:'handoff',  // 触手伸出中
};

export class CompanionGather {
  constructor(actor) {
    this.actor = actor;          // 位置由 actor 拥有,本模块只驱动意图
    this.g = null;
    this.state = GATHER_STATE.FOLLOW;
    this.carry = null;           // 手上那一个拾取物(原对象)
    this.cool = 0;               // 距下次可以出发多久
    this.elapsed = 0;            // 本局已过秒数(两个 ramp 都用它)
    this.lock = null;            // 当前锁定目标
    this.sweep = 0;              // 当前摆角(弧度,相对「面向玩家」)
    this.sweepT = 0;             // 摆动相位(累加时间)
    this.tentacle = 0;           // 触手已伸出的长度(像素)
    this.deliveries = 0;         // 本局成功交付数(探针/测试用)
  }

  begin(g) {
    this.g = g;
    this.state = GATHER_STATE.FOLLOW;
    this.carry = null;
    this.cool = 0;
    this.elapsed = 0;
    this.lock = null;
    this.sweep = 0;
    this.sweepT = 0;
    this.tentacle = 0;
    this.deliveries = 0;
  }

  /** 当前扫描半径。**从玩家算**,不是从她自己 —— owner 的原话是「玩家范围拾取技能」,
   *  这与玩家磁铁的量法一致(玩家磁铁也是从玩家自己算半径)。
   *  随本局时长 90 → 215 封顶。 */
  scanRadius() {
    return SCAN_MIN + (SCAN_MAX - SCAN_MIN) * Math.min(1, this.elapsed / RAMP_SEC);
  }

  /** 当前两次拾取之间的间隔(28s → 10s 封顶,永不低于 10s)。
   *  ⚠️ 分母是**秒**,所以用 INTERVAL_RAMP_SEC,不是任何毫秒常量。 */
  interval() {
    const t = Math.min(1, this.elapsed / INTERVAL_RAMP_SEC);
    return INTERVAL_START_MS + (INTERVAL_FLOOR_MS - INTERVAL_START_MS) * t;
  }

  /**
   * 玩家能拾取的种类 —— 与玩家**共用** applyPickup,所以这里必须是同一份清单。
   * 少写一种 = 灵伴会漏掉那一种,那就不是"跟玩家一样的拾取"了。
   */
  canPick(k) {
    return !!k && (k.kind === 'gem' || k.kind === 'coin' || k.kind === 'meat'
               || k.kind === 'chest' || k.kind === 'stone');
  }

  update(dt) {
    const g = this.g;
    const p = g && g.player;
    // ⚠️ 防御式取用:她不在场时整个系统必须**静默退场**,不能影响主游戏。
    //   (老 actor 的注释写着"失败不影响主游戏(全程防御式取用)" ——
    //    这条纪律在 V0.98 就定了,这里照办。)
    if (!p || !this.actor || !this.actor.present) { this._reset(); return; }

    this.elapsed += dt;
    this.cool = Math.max(0, this.cool - dt * 1000);
    // 扫描是**来回摆**,不是整圈转。
    //   ⚠️ 原来写成 `sweep += dt * 1.15`,那是单调递增 —— 红外线会绕着玩家
    //   一圈圈转,一圈 2π/1.15 ≈ 5.5 秒。配合下面的窄视场,实测几乎扫不到
    //   任何东西(烟雾验证:3600 帧 = 60 秒,状态机一次都没离开 FOLLOW)。
    //   摆动才像狙击手在找目标:来回扫,扫到就锁。
    this.sweepT += dt;
    this.sweep = SWEEP_ARC * Math.sin(this.sweepT * SWEEP_HZ);

    switch (this.state) {
      case GATHER_STATE.FOLLOW: this._follow(dt, p); break;
      case GATHER_STATE.FETCH:  this._fetch(dt, p); break;
      case GATHER_STATE.CARRY:  this._carry(dt, p); break;
      case GATHER_STATE.HANDOFF:this._handoff(dt, p); break;
    }
  }

  _reset() {
    this.state = GATHER_STATE.FOLLOW;
    this.carry = null;
    this.lock = null;
    this.tentacle = 0;
  }

  // —— FOLLOW:跟着玩家,红外线来回扫 ——
  _follow(dt, p) {
    const a = this.actor;
    // 旧 actor 的两条行为,搬过来,不能因为重构丢掉:
    //   ① 玩家残血时她退开(companion.js shouldRetreat 的调用点在这一行)
    //   ② 坐骑也在捡时不重复触发(companion.js pickBlocked)
    const retreating = !!a.retreating;
    const lag = retreating ? RETREAT_LAG : FOLLOW_LAG;
    this._stepToward(p.x - lag, p.y + (retreating ? 44 : 22), SPD_FOLLOW, dt);

    if (this.cool > 0) { this.lock = null; return; }   // 冷却中:只跟着,不伸手
    if (!COMPANION.autoPick()) { this.lock = null; return; }   // 坐骑在捡 → 让它

    // 扫描:射线在玩家前方来回摆,扫到能拾取的东西才锁。
    // 扫到怪/妖物**不锁** —— 这正是"红外线扫过去,只锁地上的东西"。
    const origin = this._eye();
    const R = this.scanRadius();                    // 从**玩家**算的半径
    const base = Math.atan2(p.y - a.y, p.x - a.x);  // 射线基准朝向:面向玩家
    const rayA = base + this.sweep;
    const rux = Math.cos(rayA), ruy = Math.sin(rayA);

    let best = null, bestD = 1e9;
    for (const k of (this.g.pickups || [])) {
      if (!this.canPick(k)) continue;
      // 范围判定:离玩家(和玩家磁铁同一个量法)
      if (Math.hypot(k.x - p.x, k.y - p.y) > R) continue;
      // 锁定判定:目标到扫描线的**垂距** < LOCK_R。
      //   用垂距而不是夹角:夹角会随距离放大 —— 同一个 0.2 弧度,
      //   对 50px 外的目标是 10px,对 200px 外的就是 40px,近的反而锁不上。
      const dx = k.x - origin.x, dy = k.y - origin.y;
      const along = dx * rux + dy * ruy;
      if (along <= 0) continue;                    // 在射线背后,不锁
      const perp = Math.abs(dx * (-ruy) + dy * rux);
      if (perp > LOCK_R) continue;
      const score = perp * 1000 + along;           // 越正对、越近,优先
      if (score < bestD) { bestD = score; best = k; }
    }
    this.lock = best;
    if (best) this.state = GATHER_STATE.FETCH;
  }

  // —— FETCH:锁定后走过去捡 ——
  _fetch(dt, p) {
    const a = this.actor, k = this.lock;
    // 目标被别的东西捡走了 / 出了范围 / 出局了 → 回到跟随,不算失败。
    // 范围同样从**玩家**算,与锁定时同一把尺子 —— 两处量法不一致的话,
    // 会出现"锁得上却永远够不着"或者"早就能够却一直不伸手"。
    if (!k || !this.g.pickups.includes(k) || !this.canPick(k)
        || Math.hypot(k.x - p.x, k.y - p.y) > this.scanRadius() * 1.25) {
      this.lock = null; this.state = GATHER_STATE.FOLLOW; return;
    }
    this._stepToward(k.x, k.y, SPD_FETCH, dt);
    if (Math.hypot(k.x - a.x, k.y - a.y) < FETCH_REACH) {
      // 拿走:**只是从世界里拿走**,还没有给玩家。
      const i = this.g.pickups.indexOf(k);
      if (i >= 0) this.g.remove(this.g.pickups, i);
      this.carry = k;
      // ⚠️ 旧 actor 的 _pick 里有这一行,搬过来时差点漏掉。
      //   它喂的是 COMPANION.s.run.picked,最终由 main.js:142 的 markRun()
      //   写进年表(log[].picks)。漏了它,年表上「她捡了几颗」会永远是 0 ——
      //   而这正是"她在局内真的做事"唯一留下的量化痕迹。
      COMPANION.onPick(1);
      this.lock = null;
      this.tentacle = 0;
      this.state = GATHER_STATE.CARRY;
    }
  }

  // —— CARRY:拿着走回玩家身边 ——
  _carry(dt, p) {
    if (!this.carry) { this.state = GATHER_STATE.FOLLOW; return; }
    const a = this.actor;
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d > HANDOFF_GAP) this._stepToward(p.x - 18, p.y + 14, SPD_CARRY, dt);
    this.tentacle = 0;
    if (d <= HANDOFF_GAP) this.state = GATHER_STATE.HANDOFF;
  }

  // —— HANDOFF:触手慢慢伸向玩家,够到了才交付 ——
  _handoff(dt, p) {
    const a = this.actor;
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    // 玩家又跑远了 → 触手缩回去追,不悬在半空
    if (d > HANDOFF_GAP * 1.6) { this.state = GATHER_STATE.CARRY; this.tentacle = 0; return; }
    // 单位:SPD 是像素/秒,dt 是秒 → 相乘就是这一帧该伸多少像素。不再换算。
    this.tentacle = Math.min(this.tentacle + SPD_TENTACLE * dt, d);
    if (this.tentacle >= d - 2) this._deliver(p);
  }

  /** 交付:这才是「效果生效」的时刻 —— 和玩家拾取走**同一个函数** */
  _deliver(p) {
    const k = this.carry;
    if (!k) { this.state = GATHER_STATE.FOLLOW; return; }
    const eaten = applyPickup(this.g, k);
    this.carry = null;
    this.tentacle = 0;
    if (eaten) this.deliveries++;
    // 无论成没成都进入冷却 —— 源石背包没就绪那种"没成交"的情况
    // 不应该让她立刻再试一次,否则会贴着玩家反复伸手。
    this.cool = this.interval();
    this.state = GATHER_STATE.FOLLOW;
  }

  _eye() {
    const a = this.actor;
    return { x: a.x, y: a.y - 34 };      // 大约是眼睛的高度(与 draw 的头顶同高)
  }

  _stepToward(tx, ty, spd, dt) {
    const a = this.actor;
    const dx = tx - a.x, dy = ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return;
    const step = Math.min(d, spd * dt);
    a.x += (dx / d) * step;
    a.y += (dy / d) * step;
  }

  // ══════════════ 绘制 ══════════════
  //
  // 分两层画,和 owner 说的两件事一一对应:
  //   红外线 → under 层(贴着地面,压在所有实体下面,像瞄准线)
  //   触手   → player 层(从她身上长出来,要压在实体上面才看得见)

  /** 狙击红外线:扫过去,只锁地上的可拾取物 */
  drawLaser(ctx) {
    const g = this.g, a = this.actor;
    if (!g || !a || !a.present) return;
    const p = g.player;
    if (!p) return;
    const cam = g.cam;
    const base = Math.atan2(p.y - a.y, p.x - a.x) + this.sweep;

    let ex, ey, locked = false;
    if (this.lock && this.g.pickups && this.g.pickups.includes(this.lock)) {
      ex = this.lock.x; ey = this.lock.y; locked = true;
    } else {
      // 没锁定:射线沿当前摆角伸出去。长度要比扫描半径**多留一截** ——
      // 扫描半径是从玩家算的,而射线起点在她眼睛(默认落在玩家身后 44px),
      // 不加这截的话,射线够不到玩家正前方的东西,视觉上就是"明明在范围内却扫不到"。
      const R = this.scanRadius() + 90;
      ex = a.x + Math.cos(base) * R; ey = a.y + Math.sin(base) * R;
    }

    const x0 = a.x - (cam ? cam.x : 0), y0 = (a.y - 34) - (cam ? cam.y : 0);
    const x1 = ex - (cam ? cam.x : 0), y1 = ey - (cam ? cam.y : 0);

    ctx.save();
    // 外层柔光 + 内层细芯 = 红外线的样子;锁定时更亮更实
    ctx.lineCap = 'round';
    ctx.strokeStyle = locked ? PAL.cinnabar : 'rgba(140,58,46,.42)';
    ctx.lineWidth = locked ? 3.2 : 2.0;
    ctx.globalAlpha = locked ? 0.30 : 0.16;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();

    ctx.globalAlpha = locked ? 0.92 : 0.46;
    ctx.lineWidth = locked ? 1.3 : 0.9;
    ctx.strokeStyle = locked ? '#e0664f' : PAL.cinnabar;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();

    // 沿线往返的亮点 —— 扫描感全靠它
    const t = (this.sweep * 0.6) % 1;
    const sx = x0 + (x1 - x0) * t, sy = y0 + (y1 - y0) * t;
    ctx.globalAlpha = 0.85; ctx.fillStyle = locked ? '#e0664f' : PAL.cinnabar;
    ctx.beginPath(); ctx.arc(sx, sy, locked ? 2.2 : 1.4, 0, Math.PI * 2); ctx.fill();

    // 锁定端:准星(空心圆 + 四根短刻度)
    if (locked) {
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#e0664f'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x1, y1, LOCK_R * 0.62, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const ang = i * Math.PI / 2 + Math.PI / 4;
        const cx = Math.cos(ang), sy2 = Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(x1 + cx * LOCK_R * 0.85, y1 + sy2 * LOCK_R * 0.85);
        ctx.lineTo(x1 + cx * LOCK_R * 1.35, y1 + sy2 * LOCK_R * 1.35);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 触手:从她身上慢慢伸向玩家 —— 玩家看见这个就知道东西要给她了 */
  drawTentacle(ctx) {
    const g = this.g, a = this.actor;
    if (!g || !a || !a.present || this.state !== GATHER_STATE.HANDOFF) return;
    const p = g.player;
    if (!p) return;
    const cam = g.cam;
    const x0 = a.x - (cam ? cam.x : 0), y0 = (a.y - 14) - (cam ? cam.y : 0);
    const px = p.x - (cam ? cam.x : 0), py = (p.y - 12) - (cam ? cam.y : 0);
    const dx = px - x0, dy = py - y0;
    const d = Math.hypot(dx, dy) || 1;
    const L = Math.min(this.tentacle, d);
    const ux = dx / d, uy = dy / d;
    // 侧向摆动:让触手看起来是"活的",不是一根直棍
    const wob = Math.sin(this.elapsed * 7) * 6;

    const SEG = 7, pts = [];
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG;
      const bend = Math.sin(f * Math.PI) * wob;
      pts.push({ x: x0 + ux * L * f - uy * bend, y: y0 + uy * L * f + ux * bend });
    }

    ctx.save();
    // 主体:从粗到细
    for (let i = 0; i < SEG; i++) {
      const a1 = pts[i], b1 = pts[i + 1];
      const f = i / SEG;
      ctx.strokeStyle = PAL.ink3;
      ctx.lineWidth = 5.2 * (1 - f * 0.55);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
    }
    // 金线描边:她在水墨里唯一的可见性来源就是这条金线
    ctx.strokeStyle = PAL.goldDim;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= SEG; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    // 尖端光点:够到玩家的那一刻最亮
    const tip = pts[SEG];
    ctx.fillStyle = PAL.gold;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
