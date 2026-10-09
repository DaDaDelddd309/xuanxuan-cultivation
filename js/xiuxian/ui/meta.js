// 修仙阁 · meta页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `vMarket() { return vMarketImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { MARKET, MARKET_GOODS } from '../market.js';
import { CRAFT } from '../craft.js';
import { TAVERN, MATES } from '../tavern.js';
import { STONES, GOODS, Bag } from '../items.js';
import { esc, toast } from './dom.js';

// ---------- 集市(V0.99 · XX-META-001)----------
// owner 指出的大空缺:局后除了结算数字什么都没有,攒的钱只能开角色。
// 这里给三个去处:买东西、卖闲置、换一批货。
export function vMarket(hall, s) {
    if (!MARKET.loaded) MARKET.load();
    const gold = MARKET.gold();
    const stock = MARKET.stock();
    const cards = stock.map((slot, i) => {
      const it = MARKET_GOODS[slot.key];
      if (!it) return '';
      const afford = gold >= it.price;
      return `<div class="xx-mk-card${slot.sold ? ' sold' : ''}">
        <div class="xx-mk-n">${esc(it.name)}<span class="xx-dim"> ${it.tier} 阶</span></div>
        <div class="xx-mk-d">${esc(it.desc)}</div>
        <div class="xx-mk-b">
          <span class="xx-gold">${it.price} 金</span>
          <button class="xx-btn" data-act="mk-buy" data-v="${i}" ${(slot.sold || !afford) ? 'disabled' : ''}>
            ${slot.sold ? '已售出' : afford ? '买 下' : `还差 ${it.price - gold}`}
          </button>
        </div>
      </div>`;
    }).join('');

    // 行囊里可卖的源石(折价回收)
    const sellable = ['stone_1','stone_2','stone_3','stone_4','stone_5','stone_6']
      .filter(id => (Bag.count(id) || 0) > 0)
      .map(id => {
        const g = MARKET_GOODS[id];
        const back = g ? Math.round(g.price * 0.5) : 20;
        return `<div class="xx-mk-sell">
          <span>${esc(STONES[id].name)} ×${Bag.count(id)}</span>
          <button class="xx-btn" data-act="mk-sell" data-v="${id}">卖 1 颗 · ${back} 金</button>
        </div>`;
      }).join('');

    return `
      <div class="xx-card">
        <div class="xx-label">集 市</div>
        <div class="xx-dim">打来的妖物换成钱,钱换成下一局需要的东西。</div>
        <div style="margin-top:7px"><span class="xx-gold" style="font-size:15px">${gold} 金</span></div>
      </div>
      <div class="xx-mk-grid">${cards || '<div class="xx-dim">货架空了,换一批。</div>'}</div>
      <button class="xx-btn main" data-act="mk-refresh">换 一 批 货</button>
      ${hall.vCraft()}
      ${sellable ? `<div class="xx-card" style="margin-top:12px">
        <div class="xx-label">出 售</div>
        <div class="xx-dim" style="margin-bottom:7px">行囊里的源石,折半收。囤太多不如换成别的。</div>
        ${sellable}
      </div>` : ''}
      ${hall.vTavern()}`;
}

// ---------- 合成(XX-META-005)----------
// 高阶源石原本只能靠 Boss 掉或花 1200 金买,和「打怪→源石→篝火」的主循环脱节。
// 这里让低阶源石 + 催化剂 → 高阶源石,把那条链闭上。
export function vCraft(hall) {
    const rows = CRAFT.recipes().map((r, i) => {
      // XX-FIX-018:can() 现在也收名字解析器,和 do() 用同一套 ——
      // 原来按钮上写的是「缺 stone_1 ×2」,而这张卡的标题写的是「碎灵石」。
      const chk = CRAFT.can(r, Bag, id => (STONES[id] || GOODS[id] || {}).name || id);
      const fromN = (STONES[r.from] || {}).name || r.from;
      const toN = (STONES[r.to] || {}).name || r.to;
      const catN = (GOODS[r.cat] || {}).name || r.cat;
      return `<div class="xx-cf-row${chk.ok ? ' ok' : ''}">
        <div class="xx-cf-t">${esc(fromN)} ×${r.n} + ${esc(catN)} ×${r.catN}
          <span class="xx-gold">→ ${esc(toN)}</span></div>
        <div class="xx-cf-d">${esc(r.d)}</div>
        <div class="xx-cf-b">
          <span class="xx-dim" style="font-size:10px">持有 ${chk.fromHave}/${r.n} · 催化 ${chk.catHave}/${r.catN}</span>
          <button class="xx-btn" data-act="craft-do" data-v="${i}" ${chk.ok ? '' : 'disabled'}>
            ${chk.ok ? '合 成' : esc(chk.miss)}
          </button>
        </div>
      </div>`;
    }).join('');
    return `<div class="xx-card" style="margin-top:12px">
      <div class="xx-label">合 成</div>
      <div class="xx-dim" style="margin-bottom:8px">低阶源石熔成高阶。有损耗,但攒石头就有了用处。
        太虚源石(6 级)不参与合成 —— 那是 boss 的东西。</div>
      ${rows}
    </div>`;
}

// ---------- 酒馆(XX-META-003)----------
// 同伴不是"攻击+10%"。他进局后会真的改变这一局:
//   · minAlive  —— 你不动,场面也不会冷清到只剩几只
//   · wardBonus —— 他帮你把篝火护栏撑大
//   · 其余属性 —— 落到 player.stats
export function vTavern(hall) {
    const leads = TAVERN.leads();
    const act = TAVERN.active();
    const mine = TAVERN.s.owned.map(id => MATES[id]).filter(Boolean);
    return `
      <div class="xx-card" style="margin-top:12px">
        <div class="xx-label">酒 馆</div>
        <div class="xx-dim">同行之约 ${leads} 张。线索越多,来的越可能是明白人 —— 但酒馆是看运气的,攒够也不一定称心。</div>
        <div style="margin-top:9px">
          <button class="xx-btn main" data-act="mk-recruit" ${leads < 1 ? 'disabled' : ''}>
            ${leads < 1 ? '没有同行之约' : '招 揽 同 伴'}
          </button>
        </div>
      </div>
      ${act ? `<div class="xx-card">
        <div class="xx-label">出 战</div>
        <div class="xx-mk-n">${esc(act.name)}<span class="xx-dim"> ${act.tier} 阶</span></div>
        <div class="xx-mk-d">${esc(act.bio)}</div>
        <div class="xx-mk-d" style="color:var(--xx-gold);margin-top:5px">
          ${act.mods.minAlive ? `保底怪量 +${act.mods.minAlive} · ` : ''}
          ${act.mods.wardBonus ? `篝火护栏 +${act.mods.wardBonus} · ` : ''}
          ${act.mods.might ? `攻击 ×${act.mods.might} · ` : ''}
          ${act.mods.magnet ? `拾取 +${act.mods.magnet} · ` : ''}
          ${act.mods.xpMult ? `经验 ×${act.mods.xpMult}` : ''}
        </div>
        <div style="margin-top:8px"><button class="xx-btn" data-act="mk-dismiss">让他歇着</button></div>
      </div>` : ''}
      ${mine.length > 1 ? `<div class="xx-card">
        <div class="xx-label">你 带 过 的 人</div>
        ${mine.map(m => `<div class="xx-mk-sell">
          <span>${esc(m.name)}${m.id === (act||{}).id ? ' <em style="color:var(--xx-gold)">在场</em>' : ''}</span>
          <button class="xx-btn" data-act="mk-mate" data-v="${m.id}">${m.id === (act||{}).id ? '已在场' : '带上'}</button>
        </div>`).join('')}
      </div>` : ''}
      ${TAVERN.s.log.length ? `<div class="xx-card">
        <div class="xx-label">招 揽 记 录</div>
        ${TAVERN.s.log.slice(0,5).map(l => `<div class="xx-mk-d">${esc(l.name)}</div>`).join('')}
      </div>` : ''}`;
}
