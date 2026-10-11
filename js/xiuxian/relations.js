// ===== 宿敌 / 战败 / 称号 系统 =====
// 核心设计:
//  · 宿敌(墨影)专属 BGM,不与他人的战斗共用
//  · 越级大佬(境界高于玩家)专属 BGM
//  · 战败不清档:废修为 / 赎金 / 分期 / 反抗,四条路
//  · 称号由行为触发,带隐藏条件

import { SAVE_KEYS } from './save-keys.js';
import { Bus } from '../core/engine.js?v=17';
import { REALMS, maxLayerOf } from './realms.js';

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
      // ⚠️ XX-DUEL-006:这里原来带 realmDamage:1(「照样跌一大境,只剩一半修为」)。
      //   那个组合是**自相矛盾**的 —— apply() 里跌境会先把 exp 清零,
      //   后面那句「只剩一半」根本无从兑现;而 expLoss 全仓**从来没有被应用过**
      //   (声明了两次,零个读取点)。两条后果:
      //     · 反抗的真实效果 = 跌境 + exp 清零 + 入魔 15
      //     · 认栽的真实效果 = 跌境 + exp 清零 + 入魔 8
      //   四个选项里两个完全同构,只差入魔 —— **认栽全面支配反抗**,
      //   「反抗」那块牌是纯陪衬。这条路不是被玩家选的,是被跳过的。
      //
      //   去掉 realmDamage:1 之后,反抗与认栽才真正成为两种损失:
      //     反抗 = 保境界、损一半修为、入魔 +15   (代价是神魂)
      //     认栽 = 跌一大境、修为尽废、入魔 +8     (代价是道途)
      //   都不是对方的更优解,这才叫选择。
      //    fiction 也对得上:「硬扛一击,转身就走」——走掉了还保住境界,
      //   折在骨头里的是别的东西。
      return {
        type:'resist',
        text:`你咬碎了牙关,硬扛了${stronger.title}一击,转身就走。`,
        effect:{ expLoss:0.5, demon:+15, title:'rumo' },
        log:'修为折了一半,但那股狠劲留在了骨头里。',
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

  // 把 resolve() 的 effect 真正落到持久化存档上(工单 XX-DUEL-006)
  //
  // 为什么从 ui.js 提上来:这段逻辑原本是 Screens.applyDefeat 的私有方法,
  // 只有**秘境**那条路(ui.js:752 → onLose)会调它。于是**局内 Boss 战败**
  // (main.js 的 onLose)拿不到 —— 四个选项点下去行为完全一样,
  // 面板上写的「入魔值 +15」「欠下 300 道行」「修为尽废」全是空话。
  // 抄一份到 main.js 只会让两边迟早分叉,提到数据模型旁边才是正路。
  //
  // `cult` 由调用方传进来(不 import index.js):index.js 会 import 本文件,
  // 反向 import 就成环了 —— 项目铁律之一。
  //
  // 返回 resolve() 的结果(含 text/log/effect),方便调用方结算屏用。
  apply(choice, foeTitle, s, cult) {
    const pIdx = Math.max(0, REALMS.findIndex(r => r.id === s.realm));
    const r = this.resolve({ title: foeTitle || '对手' }, s, {
      resist: choice === 'resist',
      installment: choice === 'installment',
      ransom: choice === 'ransom',
      debt: 300,
    });
    const e = r.effect;
    if (e.realmDamage) {
      // 跌一大境(至少炼气一层)
      if (pIdx > 0) { s.realm = REALMS[pIdx - 1].id; s.layer = Math.max(1, maxLayerOf(s.realm) - 2); }
      else s.layer = Math.max(1, s.layer - 3);
      s.exp = 0;
    } else if (typeof e.expLoss === 'number' && e.expLoss > 0) {
      // ⚠️ XX-DUEL-006:expLoss 以前**从来没有被应用过** —— 它在 resolve() 里
      //   声明了两次(反抗 0.5 / 认栽 1),全仓零个读取点。所以「反抗只剩一半修为」
      //   这句承诺从来没兑现过。跌境那一支已经把 exp 清零了,所以这里必须
      //   写成 else if:两条分支对 exp 的处置互斥,不能都跑。
      s.exp = Math.floor((s.exp || 0) * (1 - e.expLoss));
    }
    if (e.demon) cult.titles.track('demon', e.demon);
    if (e.debt) s.debt = e.debt;
    if (e.daoLoss) s.dao = Math.floor(s.dao * (1 - e.daoLoss));
    cult.commit();
    return r;
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
    // 默认合并,不是整体替换(与 craft/merchant/index/spine 等全仓其余 load 同一口径)。
    // 原写 `this.s = JSON.parse(r)`,是全仓**唯一**一个不做默认合并的:
    // 存档里只要缺一个字段(比如 flags 是后加的),整个 this.s 就变成残缺对象,
    // 之后 track() 里的 `this.s.flags[action]` 直接抛 TypeError,
    // 称号系统永久卡死且没有任何报错出口(外层 catch 只包住 parse 那一步)。
    try { const r = localStorage.getItem('xx_titles_v077'); if (r) this.s = { ...this.s, ...JSON.parse(r) }; } catch {}
    // 再兜一层:存档里显式写了 null/非对象时,补回默认值,
    // 否则 spread 会把默认值覆盖掉,故障形态和上面完全一样。
    if (!this.s || typeof this.s !== 'object') this.s = { flags:{}, active:[] };
    if (!this.s.flags || typeof this.s.flags !== 'object') this.s.flags = {};
    if (!Array.isArray(this.s.active)) this.s.active = [];
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
