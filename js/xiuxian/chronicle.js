// ===== 万年历 · 长期世界事件 =====
// 一个游戏年 = 12 日(与 items.js 的 DAY 共用 CLOCK 这一个真源)。每过一年抽一件「世纪事」。
// 这些是跨存档、跨周目的世界底色——江湖不会等你。

import { Cult } from './index.js';
import { Bag, STONES } from './items.js';
import { CLOCK } from './clock.js';   // V0.99 唯一时间真源(不再自己数 12 天)

const K = 'xx_chronicle_v081';

// 世纪事件池:年号 + 大事件(改变世界状态,不是数值堆料)
export const ERAS = [
  { year:1,  name:'大衍四二七', events:[
      '灵气渐衰,散修与宗门争资源愈烈。',
      '古战场碑林现,有人夜里在碑上刻名字。',
      '三宗会盟破裂,落云镇成了逃难者的落脚处。',
  ]},
  { year:2,  events:[
      '妖潮。散修死伤过半,青岚秘境被封。',
      '有前辈在黑风岭立了阵旗,过路者需留下三滴血。',
  ]},
  { year:5,  events:[
      '大宗门内斗,一位化神老怪重伤流落江湖。',
      '源石价格翻倍,篝火成了比命还贵的东西。',
  ]},
  { year:9,  events:[
      '断剑冢主墨影之名传遍九幽——他说他在等一个人。',
      '天裂三道,秘境深处开始吐紫府源石。',
  ]},
  { year:13, events:[
      '一纸「清剿令」贴满落云镇:散修,一律登记。',
      '有人看见怨灵在火堆边写字,写完就笑。',
  ]},
];

export const CHRONICLE = {
  // year/day **不再是自有状态**,而是 CLOCK 的只读视图。
  // 原来它们各自存一份,和 items.js 的 DAY 各数各的,永远对不上。
  // 现在唯一真源是 clock.js:15 分钟 = 1 天,12 天 = 1 年,行动 + 真实时间双推。
  s: { log:[], worldMod:{}, ticks:0 },
  load() {
    try { const r=localStorage.getItem(K); if(r) this.s={log:[],worldMod:{},ticks:0,...JSON.parse(r)}; }catch{}
    this.sync(); return this.s;
  },
  /** 从 CLOCK 同步年/日 */
  sync() { this.s.year = CLOCK.year(); this.s.day = CLOCK.day(); return this.s; },
  // ===== 派生读取:读的时候保证已同步 =====
  // 踩过的坑(2026-10-08):year/day 改成 CLOCK 派生之后,只有 day() 会 sync。
  // 而 stamp()、年表日志页这些**只读**的地方没人调 sync,于是新号打开年表页
  // 看到「第 undefined 年 · NaN 日」。
  // 教训:派生状态不能靠"谁碰巧会触发同步",必须在**读**的那一步保证已同步。
  // ⚠️ 名字必须避开同名方法:下面有 year(fromClock) 和 day() 两个方法。
  // 在对象字面量里 `get year(){}` 会被后面的 `year(){}` **整个覆盖**,
  // 于是 this.year 拿到的是函数本身 → 拼进模板就是满屏 JS 源码。
  // 教训:派生属性别和方法同名,这里统一加 cur 前缀。
  get curYear() { this.sync(); return this.s.year; },
  get curDay()  { this.sync(); return this.s.day; },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); }catch{} },

  /**
   * 推进一天。
   * V0.99(XX-FIX-003):不再自己数 —— 年表和昼夜原本各数一套 12 天,
   * 两边永远对不上。现在只回答「时钟有没有跨过一天」,
   * 由 CLOCK 做唯一真源,这里只负责在跨年时产出事件。
   * @returns {null|{year:number, ev:string}} 跨年时返回该年事件
   */
  day() {
    const beforeYear = CLOCK.year();
    CLOCK.action();
    this.s.ticks++;
    this.sync();
    if (CLOCK.year() !== beforeYear) this.year(true);
    this.save();
    return this._pendingYear || null;
  },
  year(fromClock) {
    if (!fromClock) this.s.year = CLOCK.year();
    const era = ERAS.find(e=>e.year===this.s.year) || ERAS[ERAS.length-1];
    const ev = era.events[Math.floor(Math.random()*era.events.length)];
    this.s.log.unshift({ year:this.s.year, ev, at:Date.now() });
    this._pendingYear = { year:this.s.year, ev };
    if (this.s.log.length>30) this.s.log.length=30;
    // 世界状态:某些年份永久改变世界
    if (this.s.year>=2) this.s.worldMod.mobUp = (this.s.worldMod.mobUp||1) * 1.08;
    if (this.s.year>=5) this.s.worldMod.stoneUp = (this.s.worldMod.stoneUp||1) * 1.12;
    if (this.s.year>=5) this.s.worldMod.bossUp = (this.s.worldMod.bossUp||1) * 1.15;
    if (this.s.year>=9) this.s.worldMod.bossUp = this.s.worldMod.bossUp * 1.1;
    this.save();
    return { year:this.s.year, ev, era:era.name };
  },

  // 万年历时间显示
  stamp() {
    const y=this.curYear, d=this.curDay;   // 走 getter,读前必同步
    const eraName = (ERAS.find(e=>e.year<=y) || ERAS[0]).name;
    return `${eraName} · 第 ${y} 年 · ${d+1} 日`;
  },

  // 世界修正:传给刷怪/掉落
  mobMul()  { return this.s.worldMod.mobUp || 1; },
  stoneMul(){ return this.s.worldMod.stoneUp || 1; },
  bossMul() { return this.s.worldMod.bossUp || 1; },

  reset() { localStorage.removeItem(K); },
};
