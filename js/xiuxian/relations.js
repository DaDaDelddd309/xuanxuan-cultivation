// ===== 宿敌 / 战败 / 称号 系统 =====
// 核心设计:
//  · 宿敌(墨影)专属 BGM,不与他人的战斗共用
//  · 越级大佬(境界高于玩家)专属 BGM
//  · 战败不清档:废修为 / 赎金 / 分期 / 反抗,四条路
//  · 称号由行为触发,带隐藏条件

import { SAVE_KEYS } from './save-keys.js';
import { Bus } from '../core/engine.js';

const NK = SAVE_KEYS.nemesis;

// ---------- 宿敌 ----------
export const Nemesis = {
  s: { met:false, battles:0, wins:0, alive:true, grudge:0 },

  load() {
    try { const r = localStorage.getItem(NK); if (r) this.s = { ...this.s, ...JSON.parse(r) }; }
    catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(NK, JSON.stringify(this.s)); } catch {} },

  meet() { this.s.met = true; this.save(); },
  battle(result) {
    this.s.battles++;
    if (result === 'win') { this.s.wins++; this.s.grudge += 20; this.s.alive = true; }
    else { this.s.grudge += 35; }
    this.save();
    return this.s.grudge;
  },
  get grudge() { return this.s.grudge; },
  // grudge 越高,他越强(反打回来时血量提升)
  powerBoost() { return 1 + Math.min(1.2, this.s.grudge * 0.008); },
  reset() { this.s = { met:false,battles:0,wins:0,alive:true,grudge:0 }; this.save(); },
};

// ---------- 战败惩罚(绝不清档)----------
// 三条路:交赎金 / 分期 / 反抗
export const DEFEAT = {
  // 结算:返回 { type, text, effect }
  resolve(stronger, s, opts = {}) {
    // 1) 反抗
    if (opts.resist) {
      return {
        type:'resist',
        text:`你咬碎了牙关,硬扛了${stronger.title}一击,转身就走。`,
        effect:{ expLoss:0.5, realmDamage:1, demon:+15, title:'rumo' },
        log:'修为倒退,但那股狠劲留在了骨头里。',
      };
    }
    // 2) 分期
    if (opts.installment) {
      return {
        type:'installment',
        text:`"这笔账,我分期还。"你放下身上值钱的东西,换来喘息。`,
        effect:{ daoLoss:0.3, debt:{ total:opts.debt || 300, left:opts.debt || 300 } },
        log:`欠下 ${opts.debt||300} 道行,三年为期。到期不还,后果自负。`,
      };
    }
    // 3) 赎金
    if (opts.ransom) {
      return {
        type:'ransom',
        text:`你交出全部身家,${stronger.title}收了,说:"滚吧,别让我再看见你。"`,
        effect:{ daoLoss:0.6, hpLoss:0.3 },
        log:'人在,修为还在。钱没了。',
      };
    }
    // 默认:废修为(境界跌 1 大境,但不清空人物/地图/神通)
    return {
      type:'ruin',
      text:`${stronger.title}一掌拍碎你的丹田。你侥幸活着,修为尽废。`,
      effect:{ realmDamage:1, expLoss:1, demon:+8 },
      log:'修为尽失。但你还活着——修仙路,重新来过。',
    };
  },

  // 分期还款到期的三种结局
  settleDebt(s, paid) {
    if (paid >= s.debt.total) {
      return { ok:true, text:'最后一笔还清。他收了钱,转身走了,再没回头。',
               effect:{ demon:-10, title:'buniao' } };
    }
    if (paid > 0) {
      return { ok:false, text:`你只凑出 ${paid}。他摇头:"三十年河东——但你不一定等得到。"`,
               effect:{ demon:+12, grudge:+10 } };
    }
    return { ok:false, text:'你身无分文。他笑了,那一笑比剑还冷。',
             effect:{ realmDamage:1, demon:+20, death:'rout' } };
  },
};

// ---------- 称号 ----------
export const Titles = {
  s: { flags:{}, active:[] },
  load() {
    try { const r = localStorage.getItem('xx_titles_v077'); if (r) this.s = JSON.parse(r); } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem('xx_titles_v077', JSON.stringify(this.s)); } catch {} },

  // 记录行为
  track(action, n = 1) {
    this.s.flags[action] = (this.s.flags[action] || 0) + n;
    this.save();
    this.check();
  },
  add(id) {
    if (this.s.active.includes(id)) return false;
    this.s.active.push(id);
    this.save();
    return true;
  },
  has(id) { return this.s.active.includes(id); },

  // 条件检查
  check() {
    const f = this.s.flags;
    const gained = [];
    const test = [
      ['chizi',      (f.challenge||0) >= 30 && (f.spare||0) >= 20],
      ['xiuliankuang',(f.streak||0) >= 30],
      ['jianfa',     (f.sword_kill_boss||0) >= 1],
      ['jiansheng',  (f.sword_all_max||0) >= 1],
      ['rumo',       (f.demon||0) >= 80],
      ['chishui',    (f.nemesis_win||0) >= 3],
      ['buniao',     (f.refuse_alliance||0) >= 5],
      ['renxia',     (f.rescue||0) >= 50],
    ];
    for (const [id, ok] of test) if (ok && this.add(id)) gained.push(id);
    return gained;
  },
  list() { return this.s.active; },
  reset() { this.s = { flags:{}, active:[] }; this.save(); },
};

// ---------- BGM 调度 ----------
// 优先级:宿敌 > 越级大佬 > 回合制普通 > 环境
export const BGM = {
  cur: null,
  TRACKS: {
    nemesis:  'bgm_nemesis',    // 宿敌专用(最高优先)
    overlord: 'bgm_overlord',   // 越级大佬专用
    turn:     null,             // 回合制:不额外铺BGM,沿用环境曲
    field:    null,             // 大地图
    town:     null,             // 洞府
  },
  play(kind) {
    if (!kind || this.cur === kind) return;
    this.cur = kind;
    Bus.emit('bgm', { track: this.TRACKS[kind] || kind, kind });
  },
  stop() { this.cur = null; Bus.emit('bgm', { track: null }); },
  // 依据战斗上下文自动选曲
  forBattle({ isNemesis, enemyStronger }) {
    if (isNemesis) return this.play('nemesis');
    if (enemyStronger) return this.play('overlord');
    return this.play('turn');
  },
};
