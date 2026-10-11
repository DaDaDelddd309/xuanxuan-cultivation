// ===== 宿敌 / 战败 / 称号 系统 =====
// 核心设计:
//  · 宿敌(墨影)专属 BGM,不与他人的战斗共用
//  · 越级大佬(境界高于玩家)专属 BGM
//  · 战败不清档:废修为 / 赎金 / 分期 / 反抗,四条路
//  · 称号由行为触发,带隐藏条件

import { SAVE_KEYS } from './save-keys.js';
import { Bus } from '../core/engine.js?v=17';
import { REALMS, maxLayerOf } from './realms.js';
// 债的到期日必须挂在**唯一时间真源**上(clock.js,XX-FIX-003 定的规矩):
// 昼夜/年表/篝火三套计时已经被合并过一次,再给债单独造一套就是把它拆回去。
// clock.js 不 import 任何东西,所以这条边不会成环(lint-deps 的 Tarjan 会查)。
import { CLOCK, CLOCK_CONST } from './clock.js';

const NK = SAVE_KEYS.nemesis;

/** 「三年为期」—— 按 CLOCK 的 1 年 = DAYS_PER_YEAR 个游戏日折算。 */
const DEBT_TERM_DAYS = 3 * CLOCK_CONST.DAYS_PER_YEAR;

// ---------- 宿敌 ----------
export const Nemesis = {
  // ⚠️ met / battles / wins 三个字段**写完全仓没人读**(2026-10-11 实测:
  //   js/ 下唯一的读取点只有 duel.js:288 的 meet() 与 profile.js:155 的
  //   整对象快照 `this.data.nemesis = mods.Nemesis.s`,没有任何一处按字段取值)。
  //   看着像该删,但**删不掉**:tests/save-integrity-audit.mjs:84 的 CONTRACTS
  //   把 xx_nemesis_v077 的形状钉成 { met:'B', battles:'N', wins:'N', alive:'B', grudge:'N' },
  //   checkShape(:155)要求 load() 的产物**每个契约字段都在且类型正确**,
  //   删掉默认值的任何一个字段 → 那道门禁在「空存档」向量上直接报「缺字段」。
  //   要删必须同步改那个文件,不属于本工单的文件所有权。
  //   真正「恒为 true」的是 alive:全仓只有默认值和 `= true` 两处写入,
  //   从来没有置 false 的路径;而它唯一的读取点 main.js:279 是
  //   `if (…s.alive) Cult.titles.track('nemesis_win', 0)` —— track 传 0,
  //   等于什么都没做。那一行要改同样得动 main.js(不是本工单的)。
  s: { met:false, battles:0, wins:0, alive:true, grudge:0 },

  load() {
    try { const r = localStorage.getItem(NK); if (r) this.s = { ...this.s, ...JSON.parse(r) }; }
    catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(NK, JSON.stringify(this.s)); } catch {} },

  meet() { this.s.met = true; this.save(); },
  // ⚠️ 'lose' 那一半(打不过时宿敌更恨你)目前**结构上不可达**:
  //   全仓唯一调用点是 js/xiuxian/duel.js:431 `Cult.nemesis.battle('win')`,
  //   写死在 win() 里。duel.js 的 lose()(:438)从头到尾没碰过 nemesis。
  //   所以 else 分支只在有人改成传 'lose' 时才会跑 —— 本文件改不动 duel.js,
  //   修法见交付报告(duel.js 的 lose() 里补一行)。
  //   这里先把入参口径钉死:只认 'win' 是赢,其余一律按「打不过」处理,
  //   免得将来 duel.js 传 'loss'/'defeat' 时静默落进「赢」那半边。
  battle(result) {
    const won = result === 'win';
    this.s.battles++;
    if (won) { this.s.wins++; this.s.grudge += 20; this.s.alive = true; }
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
        // ⚠️ hpLoss 已删(死数据普查 #1):Cult 持久态**根本没有 hp 字段**
        //   (血量是局内临时值),所以它不是「忘了接线」而是**无处可落**;
        //   Boss 路径上局已经结束,秘境路径上也不跨局。
        //   留着一个永远不生效的键,比删掉更坏 —— 它让人以为赎金有代价。
        effect:{ daoLoss:0.6 },
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

  /** 跌一大境(至少炼气一层)。apply() 与 settleIfDue() 共用一份落点逻辑,
   *  免得「战败跌境」和「债到期跌境」长出两套分叉的实现。 */
  _dropRealm(s) {
    const pIdx = Math.max(0, REALMS.findIndex(r => r.id === s.realm));
    if (pIdx > 0) { s.realm = REALMS[pIdx - 1].id; s.layer = Math.max(1, maxLayerOf(s.realm) - 2); }
    else s.layer = Math.max(1, s.layer - 3);
    s.exp = 0;
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
    // 先清旧账:分期是**同一个债主**的旧账,玩家再站到他面前时先把上一笔结掉。
    // 没有这一步,「三年为期,到期不还,后果自负」永远兑现不了 —— settleDebt
    // 在接线之前是零调用点的死函数(工单 XX-QA-066)。
    const collected = this.settleIfDue(s, cult);
    const r = this.resolve({ title: foeTitle || '对手' }, s, {
      resist: choice === 'resist',
      installment: choice === 'installment',
      ransom: choice === 'ransom',
      debt: 300,
    });
    // 附加(不改动原返回结构):这一笔旧账的结算结果,结算屏该把它显示出来。
    // 现在还没有读者(ui.js / main.js 不是本工单的),先留好这个接缝 ——
    // 不显示的话玩家会看到「凭空跌一境」,那是比不收账更糟的事。
    r.collected = collected;
    const e = r.effect;
    if (e.realmDamage) {
      this._dropRealm(s);
    } else if (typeof e.expLoss === 'number' && e.expLoss > 0) {
      // ⚠️ XX-DUEL-006:expLoss 以前**从来没有被应用过** —— 它在 resolve() 里
      //   声明了两次(反抗 0.5 / 认栽 1),全仓零个读取点。所以「反抗只剩一半修为」
      //   这句承诺从来没兑现过。跌境那一支已经把 exp 清零了,所以这里必须
      //   写成 else if:两条分支对 exp 的处置互斥,不能都跑。
      s.exp = Math.floor((s.exp || 0) * (1 - e.expLoss));
    }
    if (e.demon) cult.titles.track('demon', e.demon);
    // 称号:effect.title 声明了从来没读过(死数据普查 #2)。称号实际走的是
    //   track('demon', …) → check() 的「入魔值 ≥80」,跟 title 无关 ——
    //   于是「反抗」并不像文案承诺的那样直接授予「入魔」称号。接上。
    if (e.title && cult.titles && cult.titles.add) cult.titles.add(e.title);
    if (e.debt) s.debt = this._openDebt(e.debt);
    if (e.daoLoss) s.dao = Math.floor(s.dao * (1 - e.daoLoss));
    cult.commit();
    return r;
  },

  /**
   * 开一份新债。**必须补 dueDay**,理由是文案已经承诺了期限:
   *   战败面板写的是「欠下 300 道行,三年为期。到期不还,后果自负。」
   *   而原实现写进存档的只有 `{ total, left }` —— 没有到期日。
   *   settleDebt(s, paid) 在接线之前是零调用点的死函数,所以这个洞一直没暴露:
   *   只要没人收账,「期限」就不需要存在,于是也没人写它。
   *   现在 settleIfDue() 要真的按期收,就必须有一个可比对的时刻;
   *   而这个时刻只有一个真源:CLOCK(见文件头 import 处)。
   *   另造一套「债专用计时」就是把它刚合并掉的四套计时又拆出来一次。
   */
  _openDebt(d) {
    return { total: d.total, left: d.left, dueDay: CLOCK.absoluteDay() + DEBT_TERM_DAYS };
  },

  /**
   * 债到期结算 —— **只收一次**。
   *
   * 返回本次结算结果(未到期/无债返回 null)。效果全部落到 s / cult 上。
   * 「只收一次」用**结清即销账**(s.debt = null)来保证,而不是加一个
   * `settled` 标志位:销账之后下一次进来根本看不到债,重复扣款在结构上
   * 不可能发生;标志位还得额外保证自己不会被人手滑重置。
   *
   * ⚠️ 旧存档:缺 dueDay 的债**不给追溯**,补一个完整期限。
   *   理由:我们无从知道这笔债是哪天欠的 —— 存档里只有 total/left,
   *   没有时间戳。若按「缺 dueDay = 立即到期」处理,等于把「到期不还」
   *   这条惩罚追溯到所有老存档上,一个刚在五分钟前点过「暂缓」的玩家
   *   会被当场跌一大境 + 入魔 20,那是在花掉玩家已有进度
   *   (AUTONOMY.md §6.1 越权红线)。所以从迁移这一刻起给满一个期限,
   *   并立刻写回存档 —— 是一次性决定,不是「每次进来都续期」。
   */
  settleIfDue(s, cult) {
    if (!s || !s.debt || typeof s.debt !== 'object') return null;
    const now = CLOCK.absoluteDay();
    if (!Number.isFinite(s.debt.dueDay)) {
      s.debt.dueDay = now + DEBT_TERM_DAYS;
      if (cult && cult.commit) cult.commit();
    }
    if (now < s.debt.dueDay) return null;          // 到期前一分都不能收

    const left = Math.max(0, Number(s.debt.left) || 0);
    const dao  = Math.max(0, Number(s.dao) || 0);
    const paid = Math.min(left, Math.floor(dao));  // 「这次还了多少」
    const r = this.settleDebt(s, paid);
    if (paid > 0) s.dao = Math.max(0, dao - paid);  // 收了钱就得真的少钱

    const e = r.effect;
    if (e.realmDamage) this._dropRealm(s);
    if (e.demon && cult && cult.titles) cult.titles.track('demon', e.demon);
    if (e.title && cult && cult.titles && cult.titles.add) cult.titles.add(e.title);
    // grudge:宿敌的怨念。这是 settleDebt 里唯一一个 effect 键在 apply()
    // 里没有对应落点的 —— 它必须落到 Nemesis,而不是塞进没人读的返回值。
    if (e.grudge) { Nemesis.s.grudge = (Nemesis.s.grudge || 0) + e.grudge; Nemesis.save(); }
    // ⚠️ death:'rout' **故意不落**:本文件里没有「处决玩家」的机制
    //   (持久态根本没有 hp 字段,血量是局内临时值,见 ransom 那段注释),
    //   而给玩家判死属于「花掉已有进度」,得产品拍板。
    //   它仍然留在 settleDebt 的返回里作为设计意图,lint-dead-effect-key
    //   也把它登记在基线里 —— 这不是忘了接线,是还没到能接的时候。
    s.debt = null;                                  // 销账 = 只收一次
    if (cult && cult.commit) cult.commit();
    return r;
  },

  // 分期还款到期的三种结局(纯判定,不落盘 —— 落盘在 settleIfDue)
  settleDebt(s, paid) {
    // ⚠️ 原写的是 `paid >= s.debt.total`,拿**本次付款**比**原始总额**。
    //   只在「一次还清」时碰巧正确:先还 150(欠 300)再还 150,
    //   第二次 150 >= 300 为假 → 永远落进「只凑出」那半边,债永远还不清。
    //   它零调用点这么久没人发现,正是因为没人调它。改成比 left。
    const left = Math.max(0, Number(s.debt && s.debt.left) || 0);
    if (paid >= left) {
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
