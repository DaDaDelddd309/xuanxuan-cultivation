import { PAL } from '../core/palette.js';
import { CLOCK, CLOCK_CONST } from './clock.js';   // V0.99 唯一时间真源
// ===== 道具体系 · 品阶与来源 =====
// 设计原则(为什么这样分):
//  1. 源石是「时长」而不是「充能值」——玩家可以 1 颗 1 颗地续,永不浪费。
//     如果做成总能量池,一次投多了就只能干看着烧完,心态极差。
//  2. 品阶决定单颗时长,而不是解锁门槛。这样低阶石永远有用,
//     高阶石是「省心」而非「能不能用」。
//  3. 源石几乎不能靠刷获得 —— 野外只掉最低阶,Boss/世界事件/兑换才给高阶。
//     篝火因此是「长期资产」,逼玩家去争强敌,而不是蹲草地。
//  4. 经验溢出转传承书:突破时多出来的修为不浪费,变成可赠予的资产,
//     同时把「带新人」变成一条真实的养成路线。

// ————— 源石(篝火燃料)—————
// dur = 单颗燃烧分钟数;tier 越高越稀有
export const STONES = {
  stone_1: { id:'stone_1', name:'碎灵石', tier:1, dur:15,  col:PAL.paperFaint,
             src:'野外散妖、奇遇', d:'最常见的源石碎屑,能烧小半个时辰。' },
  stone_2: { id:'stone_2', name:'灵晶石', tier:2, dur:45,  col:PAL.jade,
             src:'险地强敌、部分奇遇', d:'灵气凝聚的晶体,火旺且稳。' },
  stone_3: { id:'stone_3', name:'玄源石', tier:3, dur:120, col:PAL.qi,
             src:'秘境深层', d:'玄黑中透着蓝芒,寻常修士求而不得。' },
  stone_4: { id:'stone_4', name:'紫府源石', tier:4, dur:360, col:PAL.crit,
             src:'妖巢/Boss 必掉', d:'结丹以上大妖陨落所化,燃一整日。' },
  stone_5: { id:'stone_5', name:'仙源石', tier:5, dur:720, col:PAL.goldDim,
             src:'宿敌、世界事件', d:'传说中仙人遗留,可燃三日。' },
  stone_6: { id:'stone_6', name:'太虚源石', tier:6, dur:1440,col:'#e85a3c',
             src:'宗门、大能遗泽', d:'燃则长明,昼夜不熄。传说只在传说里。' },
};
export const STONE_LIST = Object.values(STONES).sort((a,b)=>a.tier-b.tier);

// ————— 传承书(经验溢出转化 / 赠予)—————
// 对应境界;给族人或道友「跳过卡瓶颈」的痛苦
export const SCROLLS = {
  scroll_1: { id:'scroll_1', name:'引气篇', realm:'炼气 1-4 层',  exp:600,   col:PAL.paperFaint,
              d:'最浅薄的引气法门,胜在广传。' },
  scroll_2: { id:'scroll_2', name:'凝气篇', realm:'炼气 5-8 层',  exp:2200,  col:PAL.jade,
              d:'行气有法,可省三月苦功。' },
  scroll_3: { id:'scroll_3', name:'淬体篇', realm:'炼气 9-12 层', exp:9000,  col:PAL.qi,
              d:'淬骨洗髓,九层壁最难的一篇。' },
  scroll_4: { id:'scroll_4', name:'筑基篇', realm:'筑基期',       exp:52000, col:PAL.crit,
              d:'筑的是道基,给错人反而是害。' },
  scroll_5: { id:'scroll_5', name:'金丹篇', realm:'金丹期',       exp:340000,col:PAL.goldDim,
              d:'结丹法门,足以开宗立派。' },
  scroll_6: { id:'scroll_6', name:'元婴篇', realm:'元婴期',       exp:2600000,col:'#e85a3c',
              d:'碎丹成婴。看过此篇的人,活不过三百岁。' },
};
export const SCROLL_LIST = Object.values(SCROLLS).sort((a,b)=>a.exp-b.exp);

// ————— 其他道具 —————
export const GOODS = {
  xi_sui:   { id:'xi_sui',   name:'洗髓丹',   col:PAL.jade, price:3000,
              use:s => { s.demon = Math.max(0, (s.demon||0) - 30); return '入魔尽退,心神通明。'; },
              d:'涤荡入魔之气。用一颗,抵三次生死。' },
  fu_yin:   { id:'fu_yin',   name:'匿息符',   col:PAL.paperFaint, price:400,
              use:() => '气息尽敛,妖怪察觉不到你。',
              d:'贴在身上,一刻钟内不会有东西主动找上门。' },
  yu_jian:  { id:'yu_jian',  name:'传讯玉简', col:PAL.qi, price:1500,
              use:s => { s.recruitRoll = (s.recruitRoll||0) + 1; return '你朝虚空递出一道口信。'; },
              d:'留一道讯息在风里,总有人听得到。' },
  zhan_bei: { id:'zhan_bei', name:'家族令',   col:PAL.crit, price:20000,
              use:s => { s.charter = true; return '一面令旗,可聚四方散修。'; },
              d:'自立门户的凭证。有了它,营地才叫宗门。' },
  tai_xu:   { id:'tai_xu',   name:'太虚丹',   col:PAL.goldDim, price:90000,
              use:s => { s.exp += 200000; return '丹药入腹,仿佛苦修了十年。'; },
              d:'一粒抵十年苦修。仙人也就吃得起了。' },
  beiwen:   { id:'beiwen',   name:'碑文拓片', col:'#9a9285', price:0, noSell:true,
              use:() => '拓片上的字断在「此生」处。后面没有了。',
              d:'墓主自己拓的。拓到一半,纸没了。' },
};
export const GOODS_LIST = Object.values(GOODS);

// ————— 经验溢出 → 传承书 —————
// 突破成功时,把当前层剩余修为换算成传承书。
// 转化率 40%:既让溢出有意义,又不至于让人乱吃丹药卡层。
export const OVERFLOW_RATE = 0.4;

export function scrollForExp(exp) {
  // 返回能承载该经验量的最高阶传承书 id
  let best = SCROLL_LIST[0];
  for (const s of SCROLL_LIST) {
    if (exp >= s.exp * 0.5) best = s;
  }
  return best;
}

// ————— 背包 —————
// 外部物品注册表(建筑等由 bestiary.js 在加载时注册,避免循环依赖)
export const REGISTRY = { buildings: {}, extras: {} };
export function registerExtras(map) { Object.assign(REGISTRY.extras, map); }
export function registerBuildings(map) { Object.assign(REGISTRY.buildings, map); }
const isItem = id => !!(STONES[id] || SCROLLS[id] || GOODS[id] || REGISTRY.buildings[id] || REGISTRY.extras[id]);

export const Bag = {
  s: { items: {}, demon: 0, charter: false },

  load(k) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) this.s = { ...this.s, ...JSON.parse(raw) };
    } catch {}
    return this.s;
  },
  save(k) { try { localStorage.setItem(k, JSON.stringify(this.s)); } catch {} },

  count(id) { return this.s.items[id] || 0; },
  add(id, n = 1) {
    if (!isItem(id)) return false;
    this.s.items[id] = (this.s.items[id] || 0) + n;
    return true;
  },
  take(id, n = 1) {
    if ((this.s.items[id] || 0) < n) return false;
    this.s.items[id] -= n;
    if (this.s.items[id] <= 0) delete this.s.items[id];
    return true;
  },
  // 建材数量
  buildCount(id) { return this.s.items[id] || 0; },
  // 源石总时长(分钟)
  stoneMinutes() {
    let m = 0;
    for (const [id, n] of Object.entries(this.s.items)) {
      if (STONES[id]) m += STONES[id].dur * n;
    }
    return m;
  },
  use(id) {
    const g = GOODS[id];
    if (!g || !this.take(id)) return null;
    return g.use(this.s);
  },
  // 掉落表:Boss 必给高阶,野怪给低阶
  rollStone(bossLevel = 0) {
    if (bossLevel >= 3) {                      // 妖巢/Boss
      const roll = Math.random();
      if (roll < 0.55) return { id:'stone_3', n:1 };
      if (roll < 0.88) return { id:'stone_4', n:1 };
      if (roll < 0.98) return { id:'stone_5', n:1 };
      return { id:'stone_6', n:1 };
    }
    if (bossLevel === 2) {                      // 秘境
      const roll = Math.random();
      if (roll < 0.45) return { id:'stone_2', n:1 };
      if (roll < 0.80) return { id:'stone_3', n:1 };
      return { id:'stone_4', n:1 };
    }
    if (bossLevel === 1) {                      // 险地
      const roll = Math.random();
      if (roll < 0.30) return null;
      if (roll < 0.78) return { id:'stone_1', n:1 + Math.floor(Math.random()*3) };
      return { id:'stone_2', n:1 };
    }
    // 荒野:只给碎灵石,概率也不高
    return Math.random() < 0.18 ? { id:'stone_1', n:1 } : null;
  },
  // 兑换:用道行换源石(给不想打 Boss 的玩家一条兜底,但很贵)
  EXCHANGE: { stone_1:{ dao:120, exp:400 }, stone_2:{ dao:900, exp:2600 },
              stone_3:{ dao:6000, exp:16000 }, stone_4:{ dao:40000, exp:90000 },
              stone_5:{ dao:260000, exp:400000 } },
  exchange(id) {
    const e = this.EXCHANGE[id];
    if (!e) return null;
    return { id, cost:e.dao, scroll:{ id:scrollForExp(e.exp).id, n:1 } };
  },
  reset() { this.s = { items:{}, demon:0, charter:false }; },
};

// ————— 白天黑夜 —————
// 一个游戏日 = 12 次「行动」(吐纳/赶路/战斗各算一次)。
// 夜:妖怪更凶、篝火更重要、白天能安全赶路。
export const DAY = {
  // V0.99(XX-FIX-003):全部委托给 CLOCK。
  // 原来这里自己数"12 次行动",和 CHRONICLE 各数各的,和篝火的真实时间零关联。
  // 现在只有一个真源:真实时间打底 + 行动加速,同一个刻度。
  ACTIONS_PER_DAY: CLOCK_CONST.ACTIONS_PER_DAY,
  s: { actions: 0 },
  load(k) {
    // 保留旧调用签名(传的是 localStorage key),真存在 CLOCK 里
    CLOCK.load();
    this.s.actions = CLOCK.s.actions;
    return this.s;
  },
  save() { this.s.actions = CLOCK.s.actions; CLOCK.save(); },
  tick() { CLOCK.action(); this.s.actions = CLOCK.s.actions; return this.phase(); },
  phase() { return CLOCK.phase(); },
  isNight() { return CLOCK.isNight(); },
  bonus() { return CLOCK.isNight() ? 1.35 : 1.0; },
  /** 绝对天数,用于比较先后 */
  day() { return Math.floor(CLOCK.absoluteDay()); },
  reset() { CLOCK.reset(); this.s.actions = 0; this.s.day = 0; },
};
