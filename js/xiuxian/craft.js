// 合成系统(XX-META-005)=====
//
// owner 提的「合成」没定规则。我按当前游戏缺什么来定:
//
//   现在 6 级源石**只能靠掉落**,而低阶石头一局也掉不了几颗 ——
//   高阶玩家想要紫府源石(6 小时篝火)只能等 Boss,或者去集市花 1200 金。
//   这条路太贵,而且和"打怪→源石→篝火"的主循环脱节。
//
//   合成让它闭合:低阶石头 + 催化剂 → 高阶石头。
//   这样玩家攒低阶石头有意义,高阶燃料也不必全靠钱。
//
// 三条约束:
//   1. **有损耗** —— 合成不是凭空升级,低级石头要真的消耗掉
//   2. **有上限** —— 最顶的石头(太虚)不能合成,那是纯粹的 boss 掉落物
//   3. **不免费** —— 除了源石,还要催化剂(杂货/丹药),避免"石头无限刷"

const K = 'xx_craft_v099';

// 配方表:from + catalyst → to
// 比例刻意做成「2 换 1」而不是「4 换 1」:
//   2 换 1 的损耗感还在,但攒到 2 颗的速度不至于劝退。
// 催化剂全部用 items.js 里**真实存在**的杂货 ——
// 上一版写了 cat:'iron',而游戏里根本没有这个 id,于是永远「缺催化剂」。
// 挑的这些都是市集上真在卖的,所以催化是「花钱买得到」的,不是凭空要求。
const RECIPES = [
  { from: 'stone_1', n: 2, cat: 'beiwen', catN: 1, to: 'stone_2', d: '两枚碎灵石熔成灵晶石(催化:碑文拓片)' },
  { from: 'stone_2', n: 2, cat: 'fu_yin', catN: 1, to: 'stone_3', d: '两枚灵晶石凝成玄源石(催化:匿息符)' },
  { from: 'stone_3', n: 2, cat: 'yu_jian', catN: 1, to: 'stone_4', d: '两枚玄源石提炼成紫府源石(催化:传讯玉简)' },
  { from: 'stone_4', n: 3, cat: 'xi_sui', catN: 1, to: 'stone_5', d: '三枚紫府源石炼成仙源石(催化:洗髓丹)' },
  // stone_5 → stone_6(太虚)不给配方:那是纯粹的 boss 掉落物,保底稀有度
];

export const CRAFT = {
  s: { done: 0 },

  load() { try { const r = localStorage.getItem(K); if (r) this.s = { done: 0, ...JSON.parse(r) }; } catch {} return this.s; },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },
  reset() { this.s = { done: 0 }; this.save(); },

  recipes() { return RECIPES; },

  /** 某条配方现在能不能做
   *  names: id → 显示名的解析器(和 do() 用同一套)。
   *  ⚠️ XX-FIX-018:原来这个函数签名里没有 names,拼 `miss` 时直接把
   *  `r.from`/`r.cat` 原始 id 写进了文案 —— 玩家看到的是「缺 stone_1 ×2」。
   *  而同一张卡的标题走 ui.js 已经解析过的 fromN/catN,一页两种语言。
   *  不给 names 时退回 id,保证老调用方不炸。 */
  can(r, bag, names) {
    const nm = typeof names === 'function' ? names : (id => id);
    const hasFrom = bag.count(r.from) >= r.n;
    const hasCat = bag.count(r.cat) >= r.catN;
    const need = (id, n) => {
      const short = Math.max(0, n - bag.count(id));
      return `缺 ${nm(id)} ×${short}`;
    };
    return {
      ok: hasFrom && hasCat,
      fromNeed: r.n, fromHave: bag.count(r.from),
      catNeed: r.catN, catHave: bag.count(r.cat),
      miss: hasFrom ? (hasCat ? '' : `缺催化剂 ${need(r.cat, r.catN)}`) : need(r.from, r.n),
    };
  },

  /**
   * 合成。全部走 Bag.take —— 失败时不扣任何东西
   * (先查够不够,再扣,不做"先扣了再发现不够"这种脏事)。
   */
  do(idx, bag, names) {
    const r = RECIPES[idx];
    if (!r) return { ok: false, msg: '没有这一条方子。' };
    const chk = this.can(r, bag);
    if (!chk.ok) return { ok: false, msg: chk.miss };
    // 先全扣,任何一步失败就全部退回去
    const backup = [[r.from, r.n], [r.cat, r.catN]];
    for (const [id, n] of backup) if (!bag.take(id, n)) {
      for (const [id2, n2] of backup) bag.add(id2, n2);
      return { ok: false, msg: '材料不够,已退回。' };
    }
    if (!bag.add(r.to, 1)) {
      for (const [id, n] of backup) bag.add(id, n);
      return { ok: false, msg: '行囊放不下成品。' };
    }
    this.s.done++;
    this.save();
    const tn = names ? (names(r.to) || r.to) : r.to;
    return { ok: true, msg: `合成 ${tn} ×1`, to: r.to };
  },
};

export const CRAFT_RECIPES = RECIPES;   // 配方表(测试与外部消费用这个名字)
