// ===== 功法升星(XX-META-004)=====
//
// owner:「金币还可以给功法升级、升⭐之类的,增加特效」
//
// 原来的神通只有"等级"(1..max),而且只能靠悟道(enlighten)慢慢涨。
// 现在局外花钱可以直接升星 —— 给金币一个去处,也给神通一个追求。
//
// 三条设计约束:
//   1. **每星有实质变化**,不是纯数值乘区 —— 每星解锁一条新的效果描述,
//      玩家看得见自己练成了什么。
//   2. **消耗递增** —— 星越高越贵,不会出现"一星性价比碾压后续"
//   3. **有上限** —— max 由 ARTS 自带,到顶了不能无限升

const K = 'xx_artstar_v099';

// 每星的金币消耗倍率(相对神通基础价)
const STAR_COST = [0, 1.0, 1.6, 2.6, 4.2, 6.8];   // 升到第 n 星要花 基础价 × STAR_COST[n]
// 每星额外要一份材料(传承书),高星要更多
const STAR_BOOKS = [0, 1, 1, 2, 3, 5];

// 每星解锁的效果文案。key 是等级,写给玩家看的。
// 用"描述已经生效的东西"而不是"伤害 +15%" —— 前者能让人记住,后者只是数字。
const STAR_NOTES = {
  jianqi:    { 2:'剑气分三道,追着一只不放', 3:'剑气回旋,穿出再折回', 4:'剑气自带破甲,厚甲也挡不住', 5:'剑气不散场 —— 留在原地继续割' },
  yufeng:    { 2:'风刃带上了推力,把怪往一起赶', 3:'风刃回旋,可控方向', 4:'风刃留下真空,别的东西进不来', 5:'风不停 —— 你跑到哪它跟到哪' },
  guanri:    { 2:'箭矢贯穿两个目标', 3:'箭矢折返,回身再穿一次', 4:'箭矢无视护甲', 5:'箭矢钉住 —— 被钉住的动不了' },
};

export const ARTSTAR = {
  s: { stars: {} },      // { artId: 星数 }

  load() {
    try { const r = localStorage.getItem(K); if (r) this.s = { stars: {}, ...JSON.parse(r) }; } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  stars(id) { return this.s.stars[id] || 0; },

  /** 升到下一星要花多少 */
  cost(id, artsMeta) {
    const next = this.stars(id) + 1;
    const max = (artsMeta && artsMeta.max) || 5;
    if (next > max) return null;                 // 已满星
    const base = (artsMeta && artsMeta.base) || 300;
    return {
      star: next,
      gold: Math.round(base * (STAR_COST[next] || 6.8)),
      books: STAR_BOOKS[next] || 1,
    };
  },

  /** 能不能升 */
  canUp(id, artsMeta) {
    const c = this.cost(id, artsMeta);
    if (!c) return { ok: false, msg: '已经满星了。' };
    return { ok: true, cost: c };
  },

  /**
   * 升星。扣金币 + 扣传承书。
   * @param {Function} payGold  (n)=>boolean  扣钱回调(返回是否成功)
   * @param {Function} payBooks (n)=>boolean  扣书回调
   */
  up(id, artsMeta, payGold, payBooks) {
    const chk = this.canUp(id, artsMeta);
    if (!chk.ok) return chk;
    const c = chk.cost;
    if (!payBooks || !payBooks(c.books)) return { ok: false, msg: `还缺 ${c.books} 份传承书。` };
    if (!payGold || !payGold(c.gold)) return { ok: false, msg: '金币不够。' };
    this.s.stars[id] = c.star;
    this.save();
    const note = STAR_NOTES[id] && STAR_NOTES[id][c.star];
    return { ok: true, star: c.star, note: note || null, msg: `升至 ${'★'.repeat(c.star)}` };
  },

  /** 当前星数带来的局内倍率(纯数据,具体怎么用交给调用方) */
  effect(id) {
    const st = this.stars(id);
    if (!st) return null;
    return {
      star: st,
      power: 1 + st * 0.12,      // 威力
      reach: 1 + st * 0.06,      // 范围/射程
      extra: st >= 3 ? 1 : 0,     // 3 星起多一次
    };
  },

  /** 满星判定(界面用) */
  isMax(id, artsMeta) {
    return this.cost(id, artsMeta) === null;
  },

  reset() { this.s = { stars: {} }; this.save(); },
};

export const STAR_NOTES_ALL = STAR_NOTES;
