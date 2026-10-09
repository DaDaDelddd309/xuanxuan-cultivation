// 修仙阁 · arts页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `artHow() { return artHowImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { ARTS } from '../arts.js';
import { ARTSTAR } from '../artstar.js';
import { CAMP } from '../camp.js';
import { DAY, STONE_LIST, Bag } from '../items.js';
import { esc, toast } from './dom.js';

// ---------- 神通 / 悟道 ----------
// 神通怎么到手(XX-CONTENT-001)
//
// 这条工单我**否掉过一次** —— 当时神通系统是死锁的(悟道要两门满级,
// 但局内升级池根本没有神通,永远凑不出第二门),写"如何获得"等于
// 骗玩家反复去试。XX-ARCH-006 打通之后才有资格写。
//
// 现在两条真实路径(都是代码里实际存在的,不是编的):
//   1. 局内砍杀,升级三选一时会随机出现「参悟 X」
//   2. 修仙阁悟道:两门满级神通 + 够道行 → 融合出这门
export function artHow(hall, a) {
    if (a.fused) return '由两门满级神通融合而成';
    const F = { sword: '剑系', wind: '风系', thunder: '雷法', fire: '炎法',
                water: '水墨', shield: '守御', orb: '器灵', move: '身法' }[a.family] || '';
    return `局内升级时随机参悟 · ${F}。或与另一门满级神通悟道融合`;
}

export function vArts(hall, s) {
    const owned = Object.keys(s.arts).filter(k => s.arts[k] > 0);
    const full = owned.filter(k => s.arts[k] >= 5);
    let h = '';
    if (hall.picking) {
      h += `<div class="xx-card"><div class="xx-label">悟 道</div>
        <div class="xx-val">已选「${ARTS[hall.picking]?.name}」,再选一门满级神通</div>
        <div class="xx-dim" style="margin-top:5px">道行消耗视配方而定,融合后二者各降一级</div></div>`;
    } else {
      h += `<div class="xx-card">
        <div class="xx-label">悟 道</div>
        <div class="xx-val">两门神通皆修至满级(5级)可融合出超武</div>
        <div class="xx-dim" style="margin-top:5px">
          满级神通 ${full.length} / 14 门 · 当前道行 ${s.dao}</div></div>`;
    }
    const grid = Object.entries(ARTS).map(([k, a]) => {
      const lv = s.arts[k] || 0;
      const cls = ['xx-art'];
      if (!lv) cls.push('lock');
      if (lv >= a.max) cls.push('max');
      if (a.fused) cls.push('fused');
      const sel = hall.picking === k;
      // 局外升星(XX-META-004):神通页顺手能花钱升星
      const star = ARTSTAR.stars(k);
      const c = ARTSTAR.cost(k, Object.assign({ base: 260 * (a.max || 5) }, a));
      const canStar = lv > 0 && c;
      return `<div class="${cls.join(' ')}" ${lv ? `data-act="enlighten" data-v="${k}"` : ''}>
        ${a.fused ? '<span class="xx-tag">超武</span>' : lv >= a.max ? '<span class="xx-tag gold">满</span>' : ''}
        ${star ? `<span class="xx-tag star" data-act="art-star" data-v="${k}">${'★'.repeat(star)}</span>` : ''}
        <div class="xx-art-n">${esc(a.name)}</div>
        <div class="xx-art-b">${lv || '—'}</div>
        <div class="xx-art-lv">${sel ? '已选' : a.d.slice(0, 6)}</div>
        ${lv ? '' : `<div class="xx-art-cond">${esc(hall.artHow(a))}</div>`}
        ${canStar ? `<div class="xx-art-up" data-act="art-star" data-v="${k}">升星 · ${c.gold}金 + ${c.books}书</div>` : ''}
        ${!lv ? '<div class="xx-art-up lock">尚未习得</div>' : ''}
        ${lv > 0 && !c ? '<div class="xx-art-up maxed">已满星</div>' : ''}
      </div>`;
    }).join('');
    return h + `<div class="xx-grid3">${grid}</div>`;
}

// ---------- 营地 ----------
export function vCamp(hall, s) {
    const burning = CAMP.burning();
    const t = CAMP.tier(), nx = CAMP.next();
    const d = DAY.phase();
    const fuel = CAMP.fuelMin();
    const maxF = CAMP.maxFuel();
    const barW = maxF > 0 ? Math.min(100, fuel / (maxF + fuel) * 100) : 0;

    let stones = '';
    if (burning) {
      stones = STONE_LIST.filter(x => Bag.count(x.id) > 0).map(x => `
        <div class="xx-stone has" data-act="feed" data-v="${x.id}">
          <div class="xm-"></div><div class="xx-stone-m">${Bag.count(x.id)}</div>
          <div class="xx-stone-n" style="color:${x.col}">${x.name}</div>
          <div class="xx-stone-d">${x.dur} 分钟</div>
          <div class="xx-stone-c">投 ${feedN}</div>
        </div>`).join('') ||
        '<div class="xx-dim" style="text-align:center;padding:10px">没有源石了 —— 源石只能靠猎妖、秘境外加兑换。</div>';
    }

    const mem = CAMP.s.members.length
      ? CAMP.s.members.map(m => `
        <div class="xx-mem">
          <div class="a">
            <div class="n">${esc(m.name)}<span class="xx-dim" style="margin-left:6px">${esc(m.title)}</span></div>
            <div class="t">修为 ${m.lv} 层 · 已赠 ${m.gift}/3</div>
          </div>
          <div class="act">
            <button class="xx-mbtn" data-act="gift" data-v="${m.uid}">讨谢礼</button>
            <button class="xx-mbtn" data-act="teach" data-v="${m.uid}">授传承</button>
          </div>
        </div>`).join('')
      : '<div class="xx-dim">还没有人留下。营地的名声要靠时间传出去。</div>';

    return `
      <div class="xx-fire ${burning ? 'on' : ''}">
        <div class="xx-fire-t">${burning ? '火 还 烧 着' : '尚 无 篝 火'}</div>
        <div class="xx-fire-s">${burning ? `余 ${fuel} 分钟 · ${esc(t.name)} LV${t.lv}` : '需要一枚源石'}</div>
      </div>

      <div class="xx-card">
        <div class="xx-label">昼 夜</div>
        <div class="xx-daynow">${d.name} · ${d.desc}</div>
        <div class="xx-daybar"></div>
        <div class="xx-dim">夜间挂机收益 ×1.35,但没有火会更危险。</div>
      </div>

      <div class="xx-card">
        <div class="xx-label">源 石(${Bag.stoneMinutes()} 分钟)</div>
        ${burning
          ? `<div class="xx-bar s"><i style="width:${barW}%"></i></div>
             <div class="xx-dim" style="margin:6px 0 10px">烧完为止。当前容量 ${maxF} 分钟。</div>
             <div class="xx-numrow">
               <button class="xx-nbtn" data-act="nfeed" data-v="-1">−</button>
               <div class="xx-val">${feedN}</div>
               <button class="xx-nbtn" data-act="nfeed" data-v="1">＋</button>
             </div>
             <div class="xx-stones">${stones}</div>
             <button class="xx-btn" style="margin-top:10px" data-act="feed">全 部 投 入</button>
             <button class="xx-btn" data-act="douse">熄 火</button>`
          : `<button class="xx-btn main" data-act="light">生 火 · 投入现有源石</button>`}
      </div>

      <div class="xx-card">
        <div class="xx-label">营 地</div>
        <div class="xx-val">${t.name} · LV${t.lv}</div>
        <div class="xx-dim" style="margin-top:5px">${t.d}</div>
        ${nx ? `<div class="xx-bar jade"><i style="width:${Math.min(100, CAMP.s.totalSec / nx.need * 100)}%"></i></div>
          <div class="xx-dim" style="margin-top:5px">距「${nx.name}」还需燃烧 ${Math.ceil((nx.need - CAMP.s.totalSec)/60)} 分钟 · 声望 ${CAMP.s.rep}</div>`
          : '<div class="xx-gold" style="margin-top:6px">已至顶级。</div>'}
        ${CAMP.tier().lv >= 4 ? '<div class="xx-dim">阵旗已成:此营地可作方圆传送点(传送一次 ' + CAMP.teleportCost() + ' 道行)。</div>' : ''}
      </div>

      <div class="xx-card">
        <div class="xx-label">人 员 (${CAMP.s.members.length})</div>
        ${mem}
      </div>

      ${CAMP.tier().lv >= 5 ? `<button class="xx-btn main" data-act="sect">${CAMP.s.formed ? '宗门已成' : '立 宗'}</button>`
        : '<div class="xx-dim" style="text-align:center">营地经营至「山门」并持家族令,可自立宗门。</div>'}

      <div style="height:10px"></div>
      <button class="xx-btn" data-act="merchant">招 呼 路 过 的 商 人</button>`;
}
