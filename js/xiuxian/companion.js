// ===== 灵伴 · V0.98 重做 =====
//
// 为什么删掉重做(而不是修补):
//   旧版把情感放在**没有行为的层**——修仙阁菜单里,45 秒计时器弹四个
//   按钮加两个数值,台词从固定池随机抽。选哪个都不改变任何操作方式。
//   菜单层只有点击,没有行为,用弹窗假装情感就是点击农场。
//
//   割草游戏的情感语言是**动作**,不是菜单。
//   所以:她在局内真的做事(捡东西/会受伤/会躲/会缺席),
//   台词由**本局表现**决定,不给选项。
//   修仙阁里彻底不打扰,只在年表记一笔——时间痕迹,不是养成任务。
//
// 删除: hug/hugChoose/HUG_CHOICES/HUG_LINES/addAff/s.aff/
//       三条路线(kiss/cold/ghost)的选择逻辑/cold()/ghostLine() 的路线分支/
//       COLD_LINES/POSSESS_LINES/FLASH_LINES/tryGift()/canHug()/choose()
//       STAGE(灵伴三形:三路线没了,形态也就没了)
//
// 保留: 名字、怨灵附身(它是玩法机制不是情感系统)、局内拾取、篝火守望
//
// 外部依赖见 docs/COMPANION-PLAN.md

import { DAY } from './items.js';
import { CAMP } from './camp.js';
import { MOUNT } from './mount.js';
import { computeWard } from '../game/director.js';   // 护栏算法唯一真源

const K = 'xx_companion_v081';   // 沿用旧键,老存档不失效

// —— 怨灵强度与节奏 ——
// 这三个数是 **V0.96 刻意调过的**,不是随手写的:
//   附身时长  90s → 75s → **26s**
//   冷却间隔  90s → **210s**
//   强化倍率  ×1.6/×1.45/×1.25 → **×1.28/×1.18/×1.08**
// 理由(owner 原话:「鬼魂还是太频繁,影响游戏体验」):持续的全场施压最伤体验,
// 所以只保留"可感知",不保留"压人"。
// V0.98 重做时曾把 HOLD 写成 45000、SPD 写成 1.12,两处都没有任何文档交代,
// 且与同一份代码里保留的 CD=210000 自相矛盾(冷却照 V0.96 走,时长却退回去了)。
// 现按已记录的决定恢复,并提成常量 —— 以后要改请连同下面这行注释一起改。
const HOLD_MS  = 26000;    // 单次附身持续
const COOL_MS  = 210000;   // 散后到下次附身
const BUFF     = 1.28, DMG = 1.18, SPD = 1.08;

// ————————————————— 台词:由本局表现触发,不是随机池 —————————————————
// 规则:同一表现 → 同一句。每局最多 2 句。不给选项。
const LINES = {
  fullHp:     '「今天没出手。」',
  diedOnce:   '「你上次差点没回来。」',
  hiding:     '「你越来越会躲了。」',
  noDeath3:   '「……你叫什么名字来着?」',   // 连续三局没死
  absent3:    '',                          // 死三次:她不出场,无台词
  lowHp:      '「后面。」',                 // 你血量低时她只说这一个字
};

export const COMPANION = {
  s: defaultState(),

  load() {
    try {
      const raw = localStorage.getItem(K);
      if (raw) {
        const d = JSON.parse(raw) || {};
        if (d.name) this.s.name = d.name;
        if (d.ghost) this.s.ghost = { ...this.s.ghost, ...d.ghost };
        if (Array.isArray(d.log)) this.s.log = d.log.slice(-40);
      }
    } catch {}
    return this.s;
  },

  save() {
    try {
      const { run, ...rest } = this.s;      // 局内状态不存档
      localStorage.setItem(K, JSON.stringify(rest));
    } catch {}
  },

  init(name) {
    if (name) this.s.name = name;
    this.save();
    return this;
  },

  /** 是否已经取过名字(开局仪式用) */
  born() { return !!this.s.name; },

  get(name) { return this.s.name || name || '宝宝'; },

  // ————— 局内:开局重置 —————
  beginRun() {
    const r = this.s.run;
    // 连续死 3 次 → 本局她不出场
    r.present = r.deadStreak < 3;
    r.picked = 0;
    r.hp = r.maxHp;
    r.said = [];
    r.tookDamage = false;
    return r;
  },

  /** 本局死了 */
  onPlayerDeath() {
    const r = this.s.run;
    r.deadStreak++;
    r.cleanStreak = 0;
    this.save();
    return r.deadStreak;
  },

  /** 本局活着过关 */
  onRunClear() {
    const r = this.s.run;
    r.cleanStreak++;
    r.deadStreak = 0;
    this.save();
    return r.cleanStreak;
  },

  /** 年表记一笔:时间痕迹 */
  markRun({ deaths, picks, present }) {
    this.s.log.push({
      day: DAY && DAY.now ? DAY.now() : Date.now(),
      deaths, picks, present,
    });
    if (this.s.log.length > 40) this.s.log.shift();
    this.save();
  },

  // ————— 台词:同一表现必出同一句,不给选项 —————
  /**
   * @param {string} key LINES 里的键
   * @returns {string|null} 本局已说过则返回 null
   */
  say(key) {
    const r = this.s.run;
    if (!r.present) return null;
    if (r.said.length >= 2) return null;          // 每局最多 2 句
    const line = LINES[key];
    if (!line) return null;
    if (r.said.includes(key)) return null;        // 不重复
    r.said.push(key);
    return line;
  },

  /** 本局还能说几句 */
  sayLeft() { return Math.max(0, 2 - this.s.run.said.length); },

  // ————— 局内行为 —————
  /** 捡到一颗 */
  onPick(n = 1) {
    const r = this.s.run;
    r.picked += n;
    return r.picked;
  },

  /** 被怪打中:掉血但不致命,她会消失一段时间 */
  hurt() {
    const r = this.s.run;
    if (!r.present) return 0;
    r.hp = Math.max(0, r.hp - 10);
    r.tookDamage = true;
    if (r.hp <= 0) { r.hp = r.maxHp; return -1; }  // 消失一会儿,下轮回来
    return r.hp;
  },

  /** 玩家血量低 → 她会后退,不挡路 */
  shouldRetreat(playerHpRatio) {
    return playerHpRatio < 0.3;
  },

  // ————— 局内拾取(她唯一的"主动帮忙")—————
  /** 坐骑也会捡时不重复触发 */
  pickBlocked() {
    return !!(MOUNT.s && MOUNT.s.pick && MOUNT.s.pick.on);
  },

  /** 拾取半径(随时间轻微起伏,避免机械感) */
  pickRadius() {
    return 46 + Math.sin(Date.now() / 900) * 10;
  },

  autoPick() {
    if (!this.s.run.present) return false;
    return !this.pickBlocked();
  },

  // ————— 怨灵系统(玩法机制,原样保留)—————
  ghostLine() {
    const g = this.s.ghost;
    if (!g.on || g.phase !== 'possessing') return null;
    return '「借你的剑用一用。」';
  },

  /** 怨灵倒计时(秒)。已散=正数,附身中=0 */
  reviveCountdown() {
    const g = this.s.ghost;
    if (g.phase !== 'idle') return 0;
    return Math.max(0, Math.ceil((g.cd - Date.now()) / 1000));
  },

  tick() {
    const g = this.s.ghost;
    if (!g.on) return null;
    if (g.phase === 'possessing' && Date.now() > g.scatterAt) { this.scatter(); return null; }
    if (g.phase === 'idle' && Date.now() > g.cd) {
      g.host = g.nextHost || this._pickHost();
      g.phase = 'possessing';
      g.count++;
      g.scatterAt = Date.now() + HOLD_MS;
      this.save();
      return { event: 'possess', host: g.host, count: g.count };
    }
    return null;
  },

  _pickHost() {
    return HOSTS[Math.floor(Math.random() * HOSTS.length)];
  },

  scatter() {
    const g = this.s.ghost;
    g.phase = 'idle';
    g.cd = Date.now() + COOL_MS;
    g.nextHost = this._pickHost();
    this.save();
    return { event: 'revive', msg: `下一个宿主「${g.nextHost}」` };
  },

  wardenTick() {
    const g = this.s.ghost;
    if (!g.on || g.phase !== 'possessing') return null;
    if (!CAMP.burning()) return null;
    if (this.wardRadius() < 140) { g.scatterAt = Date.now(); }
    return g;
  },

  /**
   * 篝火护栏半径。**随昼夜伸缩**(V0.99 · 工单 XX-SPAWN-002):
   *   夜里妖物最多 → 护栏放到最大(218),这时候火才是刚需;
   *   白天妖物弱 → 护栏收小(118),省燃料,也提示"白天不用靠火"。
   * 这样"什么时候生火"才是个真决策,而不是有火就永远安全。
   */
  /**
   * 篝火护栏半径 —— 唯一入口,UI / 局内推怪 / HUD 全部走它。
   *
   * 它是一��**可投入的成长线**,不是固定值:
   *   玩家撑大拾取范围 → 护栏跟不上 → 自动拾取在火圈外沿也在发生 → 危险
   *   玩家砸源石升篝火 → 护栏涨得比拾取快 → 护栏 ⊃ 拾取 → 安逸挂机
   * 谁涨得快由玩家决定,这才有取舍。真正的算法在 director.js 的 computeWard()。
   *
   * @param {number} [pickupRadius] 局内拾取半径(局内传真实值,UI 层可省略)
   */
  wardRadius(pickupRadius) {
    if (!CAMP.burning()) return 0;
    const phase = (DAY && DAY.phase && DAY.phase()) || null;
    const pr = pickupRadius || (typeof window !== 'undefined' && window.__g && window.__g.player
      ? window.__g.player.stats.magnet : 0);
    return computeWard({
      campLv: CAMP.tier().lv,
      phase: (phase && phase.key) || 'day',
      mount: !!(MOUNT.s && MOUNT.s.ward),
      pickup: pr,
    });
  },

  hostBuff() { return this.s.ghost.on && this.s.ghost.phase === 'possessing' ? BUFF : 1; },
  hostDmg()  { return this.s.ghost.on && this.s.ghost.phase === 'possessing' ? DMG : 1; },
  hostSpd()  { return this.s.ghost.on && this.s.ghost.phase === 'possessing' ? SPD : 1; },
  possessing() { return this.s.ghost.on && this.s.ghost.phase === 'possessing'; },

  /** 重置:内存 + 存档一起清(只清存档会留下脏内存,这是 V0.98 测试发现的) */
  reset() {
    this.s = defaultState();
    try { localStorage.removeItem(K); } catch {}
  },
};

export const HOSTS = ['黑风散修','守谷妖修','青云长老','青岚妖王','黑风魔修','游方剑客','炼骨傀','血河老祖'];

/** 初始状态。COMPANION.s 与 reset() 共用,避免两处写漂移 */
function defaultState() {
  return {
    name: '',
    // —— 局内状态(每局重置,不存档)——
    run: {
      present: true,     // 本局是否出场
      picked: 0,         // 本局捡了几颗
      hp: 60, maxHp: 60,
      deadStreak: 0,     // 连续死亡(3 → 本局不出场)
      cleanStreak: 0,    // 连续未死(3 → 她问你名字)
      said: [],          // 本局已说过的(防重复,上限 2)
      tookDamage: false, // 本局是否挨过打
    },
    // —— 怨灵系统(玩法机制,保留)——
    ghost: {
      on: false, phase: 'idle', host: null, cd: 0,
      scatterAt: 0, nextHost: null, count: 0,
    },
    // —— 年表:时间痕迹,不是养成 ——
    log: [],
  };
}