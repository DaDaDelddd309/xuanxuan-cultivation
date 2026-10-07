// ===== 修仙系统 · 集成层 =====
// 职责:局外持久状态的读写、局内↔局外的结算桥接。
// 关键:不侵入 engine / weapons / enemies 原有循环,只通过 Bus 事件挂接。
// 原有割草玩法完全不受影响;新系统是「局外」层,单局结束后才结算。

import { Save } from '../core/save.js';
import { Bus } from '../core/engine.js';
import { defaultCultivation, addExp, canBreakthrough, doBreakthrough, combatPower, realmTitle } from './realms.js';
import { defaultArts, enlighten, canEnlighten } from './arts.js';
import { Nemesis, DEFEAT, Titles, BGM } from './relations.js';
import { unlock as unlockAudio, play as playBGM } from './assets.js';

const CKEY = 'xx_cultivation_v077';

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

  // 局内结束 → 局外结算:修为、道行、丹药
  settle({ kills, time, realmLayer }) {
    const s = this.s;
    // 修为收益与击杀挂钩,并随境界递减(防止后期刷爆)
    const gain = Math.round(kills * 2.5 * (1 + realmLayer*0.02));
    const r = addExp(s, gain);
    s.dao += Math.round(kills * 0.6);
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
