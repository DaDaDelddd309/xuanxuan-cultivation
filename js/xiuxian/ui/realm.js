// 修仙阁 · realm页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `vRealm() { return vRealmImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { getRealm, maxLayerOf, layerCost, canBreakthrough, realmTitle, PILLS } from '../realms.js';
import { REALMS } from '../realms.js';
import { CHRONICLE } from '../chronicle.js';
import { Cult } from '../index.js';
import { pct, esc } from './dom.js';

// ---------- 境界 ----------
export function vRealm(hall, s) {
    const r = getRealm(s.realm);
    const maxL = maxLayerOf(s.realm);
    const need = layerCost(s.realm, s.layer);
    const chk = canBreakthrough(s);
    const cost = need == null ? 0 : need;
    let pills = '';
    for (const [id, p] of Object.entries(PILLS)) {
      const own = s.pills[id] || 0;
      pills += `<div class="xx-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div class="xx-label">${p.name}${own ? ` ×${own}` : ''}</div>
          <div class="xx-val">${p.price} 道行</div></div>
          <button class="xx-btn tiny" data-act="buy" data-v="${id}">购</button>
        </div>
        <div class="xx-dim" style="margin-top:6px">${p.desc}</div>
      </div>`;
    }
    return `
      <div class="xx-card">
        <div class="xx-label">${esc(r.desc)}</div>
        <div class="xx-big">${r.name} · ${s.layer}/${maxL} 层</div>
        ${need == null
          ? `<div class="xx-dim" style="margin-top:8px">本境界已修满,需 ${PILLS[REALMS.find(x=>x.id===s.realm).requires]?.name || '丹药'} 方可突破</div>`
          : `<div class="xx-bar"><i style="width:${pct(s.exp, cost)}%"></i></div>
             <div class="xx-dim" style="margin-top:6px">修为 ${Math.floor(s.exp)} / ${cost}</div>`}
      </div>
      <div class="xx-grid">
        <div class="xx-card"><div class="xx-label">道行</div><div class="xx-big">${s.dao}</div></div>
        <div class="xx-card"><div class="xx-label">击杀</div><div class="xx-big">${s.totalKills}</div></div>
        <div class="xx-card" style="grid-column:1/-1"><div class="xx-label">年 表</div>
          <div class="xx-dim">${esc(CHRONICLE.stamp())}</div></div>
      </div>
      ${Cult.MEDITATE_FROZEN ? '' : `<button class="xx-btn" data-act="meditate">吐 纳 修 炼</button>`}
      ${Cult.MEDITATE_FROZEN ? `<div class="xx-dim" style="letter-spacing:0;text-align:center;margin:-2px 0 8px">吐纳已冻结 —— 修为只由砍杀产出</div>` : ''}
      <button class="xx-btn main" data-act="break" ${chk.ok ? '' : 'disabled'}>
        ${chk.needPill ? `服 ${PILLS[chk.needPill]?.name || '丹'} 突 破` : '突 破'}
        ${chk.ok ? '' : `<div class="xx-dim" style="letter-spacing:0;margin-top:4px">${esc(chk.msg || '')}</div>`}
      </button>
      <div style="height:12px"></div>
      <div class="xx-label">丹 药</div>${pills}`;
}
