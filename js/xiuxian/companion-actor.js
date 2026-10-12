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
import { CompanionGather, GATHER_STATE } from './companion-gather.js';
import { PAL } from '../core/palette.js';

// 行为参数(全部集中在这里,方便调)
const FOLLOW_LAG   = 36;    // 跟随时落后玩家的横向距离
const RETREAT_LAG  = 82;    // 玩家残血时她退到多远
const HURT_REACH   = 26;    // 怪离她多近能打中
const HURT_CD      = 1100;  // 挨打间隔,免得一瞬间被打空
// ⚠️ SEEK_RANGE / PICK_REACH / MOVE_SPEED 三个常量已随 _findGem/_pick 一起移除。
//   它们的职责整体交给了 companion-gather.js(XX-COMPANION-004):
//     · 移动速度 → SPD_FOLLOW / SPD_FETCH / SPD_CARRY
//     · 搜索范围 → SCAN_MAX(不再是拍脑袋的 210,是玩家磁铁满级值 215)
//     · 拾取距离 → FETCH_REACH
//   留着旧常量会让人以为还能调它们,改了却没效果 —— 本仓库最恨这种假承诺。
//
// 头顶台词气泡的停留时长(毫秒)。台词由「本局表现」触发,不是随机池。
const LINE_MS = 3200;

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
    this.line = null;        // 头顶正在说的话 { text, until }
    this.gather = new CompanionGather(this);   // 移动/锁定/拾取/递送全归它
  }

  /** 开局:跟玩家初始位置,并决定本局是否出场 */
  begin() {
    const p = this.g.player;
    if (p) { this.x = p.x - FOLLOW_LAG; this.y = p.y + 18; }
    this.retreating = false;
    this.hurtCd = 0;
    this.target = null;
    this._downT = 0;
    this.line = null;
    this.gather.begin(this.g);          // 拾取系统跟着一起重置
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
    if (this.line && Date.now() > this.line.until) this.line = null;

    const maxHp = p.stats && p.stats.maxHp ? p.stats.maxHp : 1;
    const ratio = Math.max(0, Math.min(1, p.hp / maxHp));
    this.retreating = COMPANION.shouldRetreat(ratio);
    // ⚠️ 这里原来写的是 `if (this.retreating) COMPANION.say('hiding');` ——
    //   say() 的返回值**当场丢掉**。和本轮 Titles.check() 是同一类病:
    //   台词算出来了、也进预算了,但没人接,于是「你越来越会躲了。」
    //   这句话**从来没被显示过**。现在接住它,冒到头顶去。
    if (this.retreating) this._say(COMPANION.say('hiding'));

    // 移动与拾取**全部**交给独立系统(XX-COMPANION-004)。
    // 旧的「看到宝石→删掉→经验直接进玩家身上」已经不存在了:
    // 现在是 锁定 → 走过去 → 捡起来 → 走回来 → 伸触手 → 才交付。
    this.gather.update(dt);
    this.target = this.gather.lock;

    this._checkHurt(dt);
  }

  /** 接到一句台词就冒到头顶;null / 已满预算 一律静默 */
  _say(line) {
    if (!line) return null;          // say() 返回 null = 本局说过了 / 不出场
    this.line = { text: line, until: Date.now() + LINE_MS };
    return line;
  }

  /** 怪打她:掉血,掉光就消失一会儿。
   *  ⚠️ 单向:怪能打她,**她不会打任何人**。XX-COMPANION-004 追加 ——
   *  owner 明确要求「不会伤害玩家」,所以本类没有任何一行对 player 造成伤害的代码,
   *  也不做与 player 的碰撞。新拾取系统同样没有 —— 递送不是攻击。 */
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

    // 头顶台词(XX-COMPANION-004)。
    //
    // 为什么画在 canvas 里而不是 DOM:她跟着玩家在世界坐标里跑,
    // DOM 气泡要每帧同步 screen 坐标,窗口滚动/分辨率一变就飘。
    // canvas 里直接减 cam 就贴住了,和她的身体用同一套坐标系。
    //
    // 为什么不用 Bond.bubble():那个是被明文批评过「突兀、妨碍视野」的弹窗,
    // 而且每局有 6 条预算、要占打扰队列。这里是**她自己头顶的一行小字**,
    // 不遮弹幕、不进预算、不排队 —— 台词还是同一句(say() 是唯一真源),
    // 只是"说什么"和"怎么显示"分开了(与 companion-broadcast 同一个分工)。
    if (this.line) this._drawLine(ctx, x, y - 46 + bob);
  }

  /** 头顶小字:纸色底 + 金边,宽度不够就换行 */
  _drawLine(ctx, x, top) {
    const txt = this.line.text;
    ctx.save();
    ctx.font = '11px "Kaiti SC","STKaiti","KaiTi","SimSun",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = Math.min(150, ctx.measureText(txt).width + 12);
    const h = 17;
    ctx.fillStyle = 'rgba(8,7,6,.72)';
    ctx.strokeStyle = PAL.goldDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, top - h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PAL.paper;
    ctx.fillText(txt, x, top);
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