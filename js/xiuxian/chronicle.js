// ===== 万年历 · 长期世界事件 =====
// 一个游戏年 = 12 日(配合 items.js 的 DAY)。每过一年抽一件「世纪事」。
// 这些是跨存档、跨周目的世界底色——江湖不会等你。

import { Cult } from './index.js';
import { Bag, STONES } from './items.js';

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
  s: { year:1, day:0, log:[], worldMod:{}, ticks:0 },
  load() { try { const r=localStorage.getItem(K); if(r) this.s={...this.s,...JSON.parse(r),worldMod:{...(this.s.worldMod||{})}}; }catch{} return this.s; },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); }catch{} },

  // 推进一天;跨年触发世纪事件
  day() {
    this.s.day++;
    this.s.ticks++;
    if (this.s.day >= 12) { this.s.day = 0; return this.year(); }
    this.save();
    return null;
  },
  year() {
    this.s.year++;
    const era = ERAS.find(e=>e.year===this.s.year) || ERAS[ERAS.length-1];
    const ev = era.events[Math.floor(Math.random()*era.events.length)];
    this.s.log.unshift({ year:this.s.year, ev, at:Date.now() });
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
    const y=this.s.year, d=this.s.day;
    const eraName = (ERAS.find(e=>e.year<=y) || ERAS[0]).name;
    return `${eraName} · 第 ${y} 年 · ${d+1} 日`;
  },

  // 世界修正:传给刷怪/掉落
  mobMul()  { return this.s.worldMod.mobUp || 1; },
  stoneMul(){ return this.s.worldMod.stoneUp || 1; },
  bossMul() { return this.s.worldMod.bossUp || 1; },

  reset() { localStorage.removeItem(K); },
};
