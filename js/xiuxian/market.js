// ===== 局外集市(V0.99 · 工单 XX-META-001/002)=====
//
// 为什么要有这个:
//   原来整局结束后除了结算数字什么都没有。攒的金币只能开角色
//   (300/800/2000),无处可去 —— 局内是 roguelike,局外完全断裂。
//   这就是 owner 说的「不是一个游戏,是不同游戏」的根因之一。
//
// 设计原则(沿用刷怪导演的教训):
//   **数据驱动,不硬编码。** 商品表、刷新规则、稀有度权重全在下面,
//   界面只负责读。想加东西改表,不改逻辑。
//
// 三块:
//   · 随机商人  —— 每局后刷一批货,买完换一批
//   · 酒馆招揽  —— 雇一个同伴进下一局(接得上生成预算系统)
//   · 功法      —— 见 arts.js,这里只做统一入口

import { Bag } from './items.js';   // 只取真的用得上的,别把一堆没用到的名字也 import 进来
import { Cult } from './index.js';
import { TAVERN } from './tavern.js';   // 同伴线索折成酒馆招募次数,单一真源

const K = 'xx_market_v099';

// 金币挂在局内存档(save.js)上。这里通过全局拿,
// 局内结束 → 局外,同一个存档对象。
function purse() {
  const g = globalThis.__g;
  if (g && g.save && g.save.data) return g.save.data;
  return { gold: 0 };
}
function addGold(n) { purse().gold = (purse().gold || 0) + n; return purse().gold; }

// ————————————————————————— 商品表 —————————————————————————
// kind: stone(源石) | scroll(传承书) | pill(丹药) | good(杂货) | mate(同伴线索) | artSeed(功法材料)
// tier: 1..5,决定稀有度和价格
const GOODS_TABLE = {
  // 源石:篝火续航。注意太高级的石头太贵,逼玩家一局一局攒
  stone_1: { kind:'stone', id:'stone_1', tier:1, name:'碎灵石',   price:  60, desc:'篝火燃料 · 15 分钟' },
  stone_2: { kind:'stone', id:'stone_2', tier:2, name:'灵晶石',   price: 160, desc:'篝火燃料 · 45 分钟' },
  stone_3: { kind:'stone', id:'stone_3', tier:3, name:'玄源石',   price: 420, desc:'篝火燃料 · 2 小时' },
  stone_4: { kind:'stone', id:'stone_4', tier:4, name:'紫府源石', price:1200, desc:'篝火燃料 · 6 小时' },
  // 丹药:直接吃,破境用
  pill_zhuji:  { kind:'pill', id:'pill_zhuji',  tier:2, name:'筑基丹', price: 900, desc:'破炼气之壁' },
  pill_jindan: { kind:'pill', id:'pill_jindan', tier:3, name:'结丹丹', price:3200, desc:'三转之基' },
  pill_yuanying:{kind:'pill', id:'pill_yuanying',tier:4, name:'元婴丹', price:9800, desc:'碎丹成婴' },
  // 传承书:换功法材料
  scroll_1: { kind:'scroll', id:'scroll_1', tier:1, name:'残卷',   price: 120, desc:'功法残页' },
  scroll_2: { kind:'scroll', id:'scroll_2', tier:2, name:'拓本',   price: 380, desc:'功法拓本' },
  scroll_3: { kind:'scroll', id:'scroll_3', tier:3, name:'原本',   price: 900, desc:'功法原本' },
  // 同伴线索:酒馆招人的钥匙
  mate_1: { kind:'mate', id:'mate_1', tier:1, name:'同行之约', price: 200, desc:'落云镇酒馆 · 一位散修愿意跟你走' },
  mate_2: { kind:'mate', id:'mate_2', tier:2, name:'同门引荐', price: 650, desc:'落云镇酒馆 · 有来历的人' },
  mate_3: { kind:'mate', id:'mate_3', tier:3, name:'生死之交', price:1800, desc:'落云镇酒馆 · 肯把后背交给你的人' },
  // 杂货:直接引用 items.js 里既有的 GOODS(它们自带 price / use / d),
  // 不在这里另造一套 —— 上一个版本凭空写了 herb/iron 两个不存在的 id,
  // 结果「行囊放不下」。数据要单一真源。
  xi_sui:  { kind:'good', id:'xi_sui',  tier:3, name:'洗髓丹',   price:3000, desc:'涤荡入魔之气 · 抵三次生死' },
  fu_yin:  { kind:'good', id:'fu_yin',  tier:2, name:'匿息符',   price: 400, desc:'一刻钟内妖怪不会主动找上门' },
  yu_jian: { kind:'good', id:'yu_jian', tier:2, name:'传讯玉简', price:1500, desc:'给远方的人递一句话' },
  zhan_bei: { kind:'good', id:'zhan_bei', tier:3, name:'家族令',  price: 900, desc:'家族身份 · 领族人' },
  beiwen:  { kind:'good', id:'beiwen',  tier:1, name:'碑文拓片', price: 200, desc:'断剑冢带回来的字' },
};

// 刷新权重:tier 越高越少见。随修仙阁道行提高,高档货才逐渐上架
function tierWeights(dao) {
  // 基础权重:低档多、高档少。
  // 之前 [1, 1, 0.7, 0.4, 0.15] 让 tier3+ 在低道行时也刷出 1.4 件/批,
  // 「高档货随修为解锁」这条感觉就没了。压低基础,靠 dao 往上抬。
  const w = [1.0, 0.55, 0.18, 0.06, 0.02];
  // 道行越高,高档越常见(上限 0.9)
  const lift = Math.min(0.9, dao / 12000);
  for (let i = 1; i < w.length; i++) w[i] = Math.min(0.95, w[i] + lift * (i / w.length));
  return w;
}

export const MARKET = {
  s: { stock: [], run: 0, bought: [] },
  loaded: false,

  load() {
    try { const r = localStorage.getItem(K); if (r) this.s = { stock: [], run: 0, bought: [], ...JSON.parse(r) }; } catch {}
    this.loaded = true;
    if (!this.s.stock || !this.s.stock.length) this.refresh(true);
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  /** 刷新货架。force=true 是首次填充 */
  refresh(force) {
    const dao = Cult.get ? (Cult.get().dao || 0) : 0;
    const w = tierWeights(dao);
    const keys = Object.keys(GOODS_TABLE);
    const n = force ? 5 : 4;
    const out = [];
    const used = new Set();
    for (let i = 0; i < n; i++) {
      // 按 tier 权重抽,抽中的池内随机
      let total = 0;
      const pool = [];
      for (const k of keys) {
        const t = GOODS_TABLE[k].tier;
        if (t - 1 >= w.length) continue;
        total += w[t - 1];
        pool.push(k);
      }
      if (!pool.length) break;
      let r = Math.random() * total, pick = pool[0];
      for (const k of pool) { r -= w[GOODS_TABLE[k].tier - 1]; if (r <= 0) { pick = k; break; } }
      if (used.has(pick)) { i--; continue; }        // 不重复
      used.add(pick);
      out.push({ key: pick, sold: false });
    }
    this.s.stock = out;
    this.s.run++;
    this.save();
    return out;
  },

  stock() {
    if (!this.loaded) this.load();
    return this.s.stock;
  },

  gold() { return purse().gold || 0; },

  /** 买。返回 {ok, msg} */
  buy(i) {
    if (!this.loaded) this.load();
    const slot = this.s.stock[i];
    if (!slot) return { ok: false, msg: '没有这一件。' };
    if (slot.sold) return { ok: false, msg: '已经卖出去了。' };
    const it = GOODS_TABLE[slot.key];
    if (!it) return { ok: false, msg: '货不对版。' };
    if (this.gold() < it.price) return { ok: false, msg: `还差 ${it.price - this.gold()} 金币。` };
    const done = this._deliver(it);
    if (!done.ok) return done;
    addGold(-it.price);
    slot.sold = true;
    this.s.bought.push({ key: slot.key, t: Date.now() });
    this.save();
    return { ok: true, msg: `买下 ${it.name}` };
  },

  /** 交货:不同种类走不同去处 */
  _deliver(it) {
    switch (it.kind) {
      case 'stone':
      case 'pill':
      case 'scroll':
      case 'good':
        return Bag.add(it.id, 1)
          ? { ok: true } : { ok: false, msg: '行囊放不下了。' };
      case 'mate':
        // 同伴线索 → 折成酒馆的招募次数(不在 market 里另存一份)
        TAVERN.addLead(1);
        return { ok: true };
      default:
        return { ok: false, msg: '这件不知道怎么用。' };
    }
  },

  /** 卖闲置:行囊里的源石折价。给玩家一个清包口 */
  sellStone(id, n = 1) {
    if (!Bag.take(id, n)) return { ok: false, msg: '没有那么多。' };
    const it = GOODS_TABLE[id];
    const back = it ? Math.round(it.price * 0.5) : 20;   // 一半价钱回收
    addGold(back);
    return { ok: true, msg: `卖得 ${back} 金币` };
  },

  reset() { this.s = { stock: [], run: 0, bought: [], mates: {} }; this.save(); },
};

export const MARKET_GOODS = GOODS_TABLE;
