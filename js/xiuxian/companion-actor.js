// ===== 灵伴 · 局内实体(V0.98)=====
// 工单 XX-COMP-002 / 003 / 004
//
// 这是"她在局内真的存在"的实现。
// 旧版她活在修仙阁菜单里 —— 那层只有点击,没有行为,
// 所以只能用弹窗假装情感。新版她活在砍杀局里:有位置、会动、
// 会捡东西、会挨打。这些是玩家亲眼能看见的。
//
// 设计约束:
//   · 不引入新引擎 —— 复用 engine.addUpdater + addDrawer
//   · 不改原有循环 —— 独立挂载,失败不影响主游戏(全程防御式取用)
//   · 每局最多 2 句台词,且由「本局表现」触发,不是随机池
//
import { COMPANION } from './companion.js';
import { PAL } from '../core/palette.js';

// 行为参数(全部集中在这里,方便调)
const FOLLOW_LAG   = 36;    // 跟随时落后玩家的横向距离
const RETREAT_LAG  = 82;    // 玩家残血时她退到多远
const SEEK_RANGE   = 210;   // 玩家身边多大范围内她才会去捡
const PICK_REACH   = 18;    // 她离宝石多近算捡到
const MOVE_SPEED   = 132;   // 像素/秒(比玩家慢,追不上才像"跟着")
const HURT_REACH   = 26;    // 怪离她多近能打中
const HURT_CD      = 1100;  // 挨打间隔,免得一瞬间被打空

// 局内形象:画布剪影,**不用立绘**。
//
// 踩过的坑(2026-10-08,用户截图发现):立绘是米黄宣纸底的水墨半身,
// 贴到深蓝游戏画布上只有 62px 高 —— 远看就是"一片米黄色背景色",
// 完全看不见人。立绘是给修仙阁卡片用的(58×78,浅底卡片),
// 局内是深底小尺寸,两者的对比逻辑正好相反。
// 正确做法:局内用 canvas 画剪影,和玩家/敌人同一套渲染语言。
//
// 正式立绘仍保留在 assets/portrait/companion.jpg,供人物页与图鉴使用。

export class CompanionActor {
  constructor(engine) {
    this.g = engine;
    this.x = 0; this.y = 0;
    this.present = false;
    this.retreating = false;
    this.bob = 0;
    this.hurtCd = 0;
    this.target = null;      // 当前要捡的那颗宝石
    this._downT = 0;         // 被打散后的消失计时
  }

  /** 开局:跟玩家初始位置,并决定本局是否出场 */
  begin() {
    const p = this.g.player;
    if (p) { this.x = p.x - FOLLOW_LAG; this.y = p.y + 18; }
    this.retreating = false;
    this.hurtCd = 0;
    this.target = null;
    this._downT = 0;
    COMPANION.beginRun();                  // 开局重置局内状态(含连死3次不出场)
    this.present = COMPANION.s.run.present;
    return this.present;
  }

  update(dt) {
    const g = this.g, p = g.player;
    if (!p) { this.present = false; return; }

    // 被打散后的短暂消失
    if (this._downT > 0) {
      this._downT -= dt * 1000;
      if (this._downT <= 0) this.present = COMPANION.s.run.present;
      else { this.present = false; return; }
    }

    if (!COMPANION.s.run.present) { this.present = false; return; }
    this.present = true;
    this.bob += dt * 2.2;

    const maxHp = p.stats && p.stats.maxHp ? p.stats.maxHp : 1;
    const ratio = Math.max(0, Math.min(1, p.hp / maxHp));
    this.retreating = COMPANION.shouldRetreat(ratio);
    if (this.retreating) COMPANION.say('hiding');

    // 目标点:有宝石就去捡,没有就跟玩家
    const tk = this._findGem(p);
    let tx, ty;
    if (tk) { tx = tk.x; ty = tk.y; }
    else {
      const back = this.retreating ? RETREAT_LAG : FOLLOW_LAG;
      tx = p.x - back; ty = p.y + (this.retreating ? 44 : 18);
    }
    this._moveToward(tx, ty, dt);

    // 走到宝石跟前才捡 —— 玩家看得见她跑过去捡
    if (tk && Math.hypot(tk.x - this.x, tk.y - this.y) < PICK_REACH) this._pick(tk);
    else if (!tk) this.target = null;

    this._checkHurt(dt);
  }

  _moveToward(tx, ty, dt) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return;
    const step = Math.min(d, MOVE_SPEED * dt);
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
  }

  /** 找玩家身边最近的一颗宝石 */
  _findGem(p) {
    if (!this.g.pickups || !COMPANION.autoPick()) { this.target = null; return null; }
    let best = null, bestD = SEEK_RANGE;
    for (let i = this.g.pickups.length - 1; i >= 0; i--) {
      const k = this.g.pickups[i];
      if (!k || k.kind !== 'gem') continue;
      const d = Math.hypot(k.x - p.x, k.y - p.y);
      if (d < bestD) { bestD = d; best = k; }
    }
    // 锁定后别每帧换目标,免得她原地抖动
    if (this.target && this.g.pickups.includes(this.target)) {
      const d = Math.hypot(this.target.x - p.x, this.target.y - p.y);
      if (d < SEEK_RANGE * 1.3) return this.target;
    }
    this.target = best;
    return best;
  }

  _pick(k) {
    const g = this.g, idx = g.pickups.indexOf(k);
    if (idx < 0) { this.target = null; return; }
    g.remove(g.pickups, idx);
    if (g.player && g.player.addXp) g.player.addXp(k.xp);
    COMPANION.onPick(1);
    this.target = null;
    if (g.spawnText) {
      g.spawnText(this.x, this.y - 30, '她捡走了', { color: PAL.gold, size: 13, life: 1.1 });
    }
  }

  /** 怪打她:掉血,掉光就消失一会儿 */
  _checkHurt(dt) {
    const g = this.g;
    this.hurtCd -= dt * 1000;
    if (this.hurtCd > 0 || !g.enemies) return;
    for (let i = 0; i < g.enemies.length; i++) {
      const e = g.enemies[i];
      if (!e || e.dead) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) < HURT_REACH) {
        this.hurtCd = HURT_CD;
        this.hurt();
        return;
      }
    }
  }

  hurt() {
    const r = COMPANION.hurt();
    if (r === -1) {
      this.present = false;
      this._downT = 6000;          // 消失一会儿,下一轮回来
      if (this.g.spawnText) {
        this.g.spawnText(this.x, this.y - 30, '她被打散了', { color: PAL.cinnabar, size: 14, life: 1.4 });
      }
    }
    return r;
  }

  /** 暗色剪影 + 金线(ART-GUIDELINES 方案 B) */
  draw(ctx) {
    if (!this.present) return;
    const cam = this.g.cam;                       // 镜头在 engine.cam,不是 camera
    const x = this.x - (cam ? cam.x : 0);
    const y = this.y - (cam ? cam.y : 0);
    const bob = Math.sin(this.bob) * 2.2;
    const hpRatio = COMPANION.s.run.hp / COMPANION.s.run.maxHp;

    ctx.save();
    ctx.globalAlpha = this.retreating ? 0.45 : 0.92;

    // 影:脚下淡墨,让她"站"在地上而不是飘着
    ctx.fillStyle = 'rgba(8,7,6,.34)';
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 11, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 水墨剪影(上窄下阔的袍形)
    ctx.fillStyle = PAL.ink3;
    ctx.beginPath();
    ctx.moveTo(x, y - 30 + bob);
    ctx.quadraticCurveTo(x + 9, y - 20 + bob, x + 8, y + 1);
    ctx.lineTo(x - 8, y + 1);
    ctx.quadraticCurveTo(x - 9, y - 20 + bob, x, y - 30 + bob);
    ctx.fill();

    // 头
    ctx.fillStyle = PAL.ink2;
    ctx.beginPath();
    ctx.arc(x, y - 35 + bob, 5.4, 0, Math.PI * 2);
    ctx.fill();

    // 金线轮廓:唯一亮点,也是她在水墨里被看见的原因
    ctx.strokeStyle = hpRatio > 0.5 ? PAL.gold : PAL.goldDim;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y - 30 + bob);
    ctx.quadraticCurveTo(x + 9, y - 20 + bob, x + 8, y + 1);
    ctx.moveTo(x, y - 30 + bob);
    ctx.quadraticCurveTo(x - 9, y - 20 + bob, x - 8, y + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 35 + bob, 5.4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}

/**
 * 事件台词:由「本局表现」触发,不给选项,每局 ≤2 句。
 * 同一表现 → 同一句。这是玩家打得好不好的镜子,不是随机池。
 *
 * @param {string} evt  LINES 的键(fullHp / diedOnce / noDeath3 / lowHp)
 * @param {{say:Function}} api  气泡出口(由调用方注入,便于测试)
 * @returns {string|null}
 */
export function runEventLines(evt, api) {
  const line = COMPANION.say(evt);
  if (!line || !api || typeof api.say !== 'function') return null;
  api.say(line);
  return line;
}