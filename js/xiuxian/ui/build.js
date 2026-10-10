// 修仙阁 · build页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `vBuild() { return vBuildImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { BUILD, FIELD_PERIOD } from '../build.js';
import { BUILDINGS, RICE } from '../bestiary.js';
import { Bag } from '../items.js';
import { esc, toast } from './dom.js';

// ---------- 领地建造 ----------
export function vBuild(hall) {
    const t = BUILD.tier(), nx = BUILD.nextTier();
    const inv = Object.keys(BUILDINGS).filter(b => Bag.count(b) > 0);
    const E = BUILD.effects();
    const rice = BUILD.rice();

    let slots = '';
    for (let i = 0; i < 6; i++) {
      if (i >= t.slots) { slots += `<div class="bd-slot lock">🔒</div>`; continue; }
      const inst = BUILD.s.placed[i];
      if (!inst) { slots += `<div class="bd-slot empty" data-act="slot" data-v="${i}">＋</div>`; continue; }
      const b = BUILDINGS[inst.bid];
      const wn = inst.workers.length;
      const fld = inst.bid === 'bld_field' ? BUILD.tickField(i) : null;
      slots += `<div class="bd-slot" data-act="binfo" data-v="${i}" style="border-color:${b.col}66">
        <div class="bd-slot-i">${b.icon}</div>
        <div class="bd-slot-n">${b.name}</div>
        <div class="bd-slot-w">${wn ? '值守 '+wn : '<span style="color:var(--xx-cinnabar)">待派人</span>'}</div>
        ${fld && fld.ready ? '<div class="bd-slot-r">可收</div>'
          : fld && fld.left != null ? `<div class="bd-slot-r">${fld.left}分</div>` : ''}
      </div>`;
    }

    const pk = BUILD.canPromote();
    const out = BUILD.tickAll();

    return `
      <div class="xx-card">
        <div class="xx-label">领 地 等 级</div>
        <div class="xx-big" style="color:${t.col}">${t.name} · LV${t.lv}</div>
        <div class="xx-dim" style="margin-top:5px">${t.desc}</div>
        <div class="xx-dim" style="margin-top:8px">${BUILD.summary()}</div>
      </div>

      <div class="xx-card">
        <div class="xx-label">建 筑 效 果</div>
        <div class="xx-dim">
          护栏 +${E.ward}px${E.warn?' · 围攻预警':''} · 人口上限 +${E.popCap} ·
          全族战力 +${E.atk}${E.fieldMul?` · 灵田 +${Math.round(E.fieldMul*100)}%`:''}${E.trade?' · 贸易已开':''}
        </div>
        ${['ward','popCap','atk','fieldMul'].every(k=>!E[k])&&!E.trade
          ? '<div class="xx-dim" style="margin-top:6px">还没建有用的建筑。灵井、哨塔、议事堂、演武场、集市各有其用。</div>' : ''}
      </div>

      ${out.msg.length ? `<div class="xx-card"><div class="xx-label">本 轮 产 出</div>
        <div class="xx-val" style="font-size:13px;color:var(--xx-gold)">${out.msg.join(' · ')}</div></div>` : ''}

      <div class="xx-card">
        <div class="xx-label">灵 米 (${rice} 斤)</div>
        <div class="xx-dim" style="margin-bottom:9px">
          ${RICE.d}生吞 +${RICE.eat.exp}修为/${RICE.eat.dao}道行 · 喂族人顶半日 · 卖 ${RICE.price}/斤</div>
        <div class="xx-grid3">
          <button class="xx-btn sm"
            data-act="harvestall">收起全部</button>
          <button class="xx-btn sm"
            data-act="eat" data-v="1">生吞一斤</button>
          <button class="xx-btn sm"
            data-act="sell" data-v="10">卖10斤</button>
        </div>
      </div>

      <div class="xx-card">
        <div class="xx-label">建 造 空 间</div>
        <div class="xx-dim" style="margin-bottom:9px">幻境之内,无怪,可随意放置。点空格取出建筑,点建筑派人。</div>
        <div class="bd-grid">${slots}</div>
        ${BUILD.s.placed.some(p=>p.bid==='bld_field')
          ? '<div class="xx-dim" style="margin-top:9px">灵田:点空格下种 → 10 分钟后再点收获。灵井可加速产量。</div>' : ''}
      </div>

      <div class="xx-card">
        <div class="xx-label">可 用 建 材</div>
        ${inv.length ? `<div class="bd-inv">${inv.map(b=>{
          const d = BUILDINGS[b];
          return `<button class="bd-inv-i" style="border-color:${d.col}66"
            data-act="place" data-v="${b}">${d.icon}<br><span>${d.name}</span>
            <em>×${Bag.count(b)}</em></button>`;
        }).join('')}</div>`
        : '<div class="xx-dim">没有建材。去打怪 —— 妖王掉灵田,魔修掉丹炉哨塔,老祖掉议事堂集市。</div>'}
      </div>

      <div class="xx-card">
        <div class="xx-label">人 手 安 置</div>
        <div class="xx-dim" style="margin-bottom:8px">生产型最多 3 人(1人×1.0 / 2人×1.6 / 3人×2.1)</div>
        <button class="xx-btn" data-act="autofill">一 键 满 编</button>
      </div>

      <div class="xx-card">
        <div class="xx-label">矿 脉</div>
        <div class="xx-val">${BUILD.s.land.length} 处领地</div>
        <div class="xx-dim" style="margin-top:5px">去大地图点「占」纳入领地,每日出产源石。</div>
        <button class="xx-btn" data-act="minenow">立 即 开 采</button>
      </div>

      <div class="xx-card">
        <div class="xx-label">传 送 阵 法</div>
        ${BUILD.canTeleport()
          ? `<div class="xx-val">可用 · 每次 ${BUILD.teleportCost()} 道行</div>
             <div class="xx-dim" style="margin-top:5px">去大地图点「传」前往已到之处。</div>`
          : `<div class="xx-dim">需领地至「村落」LV2 以上,且有篝火。当前 ${t.name}。</div>`}
      </div>

      <div class="xx-card">
        <div class="xx-label">同 盟 契 约 (${BUILD.s.pacts.signed}/3)</div>
        <div class="xx-dim" style="margin-bottom:8px">
          缔结后受袭盟友驰援,围攻率 -${Math.round(BUILD.pactShield()*100)}%,集市互通。</div>
        <div style="display:flex;gap:8px">
          <button class="xx-btn" data-act="pact" style="flex:1"
            ${BUILD.canPact()?'':'disabled'}>缔 结 同 盟</button>
          <button class="xx-btn" data-act="refuse" style="flex:1">拒 绝</button>
        </div>
        ${(()=>{const _g=BUILD.pactGap();return _g.full?'<div class="xx-hint">契约已满(3/3)</div>':(_g.ok?'<div class="xx-hintok">道行已足,可缔约</div>':`<div class="xx-hint">还需 <b>${_g.lack}</b> 道行(需 ${_g.cost})</div>`);})()}
      </div>

      <button class="xx-btn main" data-act="promote" ${pk.ok?'':'disabled'}>
        晋 升 为「${nx ? nx.name : '顶级'}」${pk.ok?'':`<div class="xx-dim" style="letter-spacing:0;margin-top:4px">${esc(pk.msg)}</div>`}
      </button>`;
}
