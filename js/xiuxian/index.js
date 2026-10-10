// ===== 修仙系统 · 集成层 =====
// 职责:局外持久状态的读写、局内↔局外的结算桥接。
// 关键:不侵入 engine / weapons / enemies 原有循环,只通过 Bus 事件挂接。
// 原有割草玩法完全不受影响;新系统是「局外」层,单局结束后才结算。

import { SAVE_KEYS } from './save-keys.js';
import { Save } from '../core/save.js?v=17';
import { Bus } from '../core/engine.js?v=17';
import { defaultCultivation, addExp, canBreakthrough, doBreakthrough, combatPower, realmTitle, layerCost } from './realms.js';
import { defaultArts, enlighten, canEnlighten } from './arts.js';
import { Nemesis, DEFEAT, Titles, BGM } from './relations.js';
import { unlock as unlockAudio, play as playBGM } from './assets.js';

const CKEY = SAVE_KEYS.cultivation;

function defaultState() {
  const c = defaultCultivation();
  return { ...c, arts: defaultArts(), current: 'n0', visited: { n0: true } };
}

export const Cult = {
  s: defaultState(),

  load() {
    try {
      const raw = localStorage.getItem(CKEY);
      this.s = raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
    } catch { this.s = defaultState(); }
    return this.s;
  },
  // 供解构/箭头函数安全调用
  get() { return this.s; },
  commit() {
    try { localStorage.setItem(CKEY, JSON.stringify(this.s)); } catch {}
  },

  /** 一次「吐纳」折合几只妖的产出(XX-NET-004)。
   *  4 = 一次吐纳约等于砍死 4 只,作为「不想打架时的兜底」——
   *  低于它,吐纳就只是个空按钮;高于它,砍杀失去意义。
   *  这个数是**设计旋钮**,连同 killYield 一起改。 */
  MEDITATE_AS_KILLS: 4,

  /**
   * 吐纳开关 —— **冻结**(owner 2026-10-10 定:冻结,不删)。
   *
   * 为什么冻结而不是删掉:
   *   「吐纳」是修仙阁里唯一不靠砍杀的产出入口,MEDITATE_AS_KILLS / killYield /
   *   修炼狂 streak(XX-ARCH-006)整套逻辑都挂在它上面。删了这些就成孤儿,
   *   以后想解冻得重新考古。所以**只关入口,逻辑全留**。
   *
   * 冻结的表现(两处都要挡,别只藏按钮):
   *   · 修仙阁页面不再渲染按钮(realm.js)
   *   · 处理器直接拒绝(ui.js)—— 防存档里残留 data-act 的旧页面还能点出来
   *
   * 解冻:把 true 改成 false 即可,不需要动别处。
   */
  MEDITATE_FROZEN: true,

  /**
   * 「击杀 N 只」换算成修为与道行 —— **唯一的产出公式**(XX-BAL-001 / XX-NET-004)。
   *
   * 为什么必须抽出来:修仙阁的「吐纳」本来自己写死了 40 修为 / 200 道行,
   * 与境界完全无关,于是两头都坏 ——
   *   炼气期 1 次吐纳 = 16 只妖的修为、333 只妖的道行 → 砍杀彻底失去意义
   *   化神期 1 次吐纳 = 40 修为(1 只妖 ≈ 2500)  → 吐纳彻底失去意义
   * 两套系数各走各的,谁也看不见谁。现在吐纳改为**按几只妖的量换算**,
   * 口径永远一致,以后改 LAYER_COST 两边自动跟着走。
   */
  killYield(s, kills) {
    const baseCost = layerCost('qi', 1) || 50;
    const myCost   = layerCost(s.realm, 1) || baseCost;
    const realmMul = Math.pow(myCost / baseCost, 0.63);
    return { exp: Math.round(kills * 2.5 * realmMul), dao: Math.round(kills * 0.6) };
  },

  // 局内结束 → 局外结算:修为、道行、丹药
  settle({ kills, time, realmLayer, realmIdx = 0 }) {
    const s = this.s;
    // 修为收益与击杀挂钩。
    //
    // ⚠️ XX-BAL-001:原来这里写的是 `1 + realmLayer*0.02`,注释说"随境界递减(防止后期刷爆)"。
    // 但 LAYER_COST 从炼气到化神涨了 1,443 倍,产出侧却被这行锁死在 300 多 ——
    // 跨 48 层只涨 1.16 倍。化神期因此**数学上不可达**(9,000,000 ÷ 354 ≈ 25,428 局)。
    // 两侧从来没对过账:消耗涨了一千倍,产出却被主动压平。
    //
    // 现在改为**从 LAYER_COST 反推倍率**,而不是拍一个系数。
    //
    // 为什么必须反推:消耗侧是硬编码表(炼气层1=50 → 化神层1=3,500,000,跨 70,000 倍),
    // 产出侧如果自己定系数,那就是**两套互不相干的数** —— XX-BAL-001 的病根。
    // 绑在一起之后,以后谁改 LAYER_COST,产出自动跟着走,不会再出现
    // "改了一边忘了另一边"。
    //
    // 指数 0.63:略低于 1(1.0 = 严格同比例,后期会平得没有挑战感),
    // 使后期每个大境界约 26~65 局,而不是几万局。
    const { exp: gain, dao } = this.killYield(s, kills);
    const r = addExp(s, gain);
    s.dao += dao;
    s.totalKills += kills;
    // 丹药小概率掉落
    if (Math.random() < 0.12 && s.realm === 'qi') {
      s.pills.pill_zhuji = (s.pills.pill_zhuji || 0) + 1;
    }
    this.commit();
    return { exp: gain, leveled: r.levels, realmFull: r.broke };
  },

  grantPill(pillId, n = 1) {
    this.s.pills[pillId] = (this.s.pills[pillId] || 0) + n;
    this.commit();
  },
  spendDao(n) { if (this.s.dao < n) return false; this.s.dao -= n; this.commit(); return true; },

  // 神通:局内学会的 → 局外记录(取局内最高级)
  syncArt(id, lv) {
    if (lv > (this.s.arts[id] || 0)) { this.s.arts[id] = lv; }
  },
  canEnlighten(a, b) { return canEnlighten(this.s, a, b); },
  enlighten(a, b) { return enlighten(this.s, a, b); },

  canBreakthrough() { return canBreakthrough(this.s); },
  breakthrough() {
    const r = doBreakthrough(this.s);
    if (r && !r.err) this.commit();
    return r;
  },
  title() { return realmTitle(this.s); },
  power() { return combatPower(this.s); },
  reset() { this.s = defaultState(); this.commit(); },

  // ---- 集成:宿敌/称号/战败/BGM ----
  nemesis: Nemesis,
  defeat: DEFEAT,
  titles: Titles,
  bgm: BGM,

  init() {
    // 存档必须在这里读回来。
    // 坑(V0.90 修):init 以前只 load 了 nemesis/titles,没 load 自己 ——
    // 结果每次刷新页面,修为/境界/丹药/神通全归零,存档里写回的也是 0。
    this.load();
    this.nemesis.load();
    this.titles.load();
    unlockAudio();
    return this;
  },
  // 宿敌战专用 BGM
  playNemesisBgm() { playBGM('bgm_nemesis'); },
  // 越级大佬专用 BGM
  playOverlordBgm() { playBGM('bgm_overlord'); },
  // 离开回合制,恢复环境曲
  leaveBattleBgm() { BGM.curPrio = -1; },
};
