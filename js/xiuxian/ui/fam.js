// 修仙阁 · fam页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `vFam() { return vFamImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { FAMILY } from '../family.js';
import { CHRONICLE } from '../chronicle.js';
import { esc, toast } from './dom.js';

// ---------- 家族 ----------
export function vFam(hall) {
    const f = FAMILY.s;
    if (!f.founded) {
      return `<div class="xx-card"><div class="xx-label">宗 族</div>
        <div class="xx-val">尚未立族</div>
        <div class="xx-dim" style="margin-top:6px">家是一切的根。有家,才有传承。</div>
        <div class="xx-numrow" style="margin-top:12px">
          <input id="xx-famname" value="轩氏" maxlength="6"
            style="flex:1;background:rgba(0,0,0,.4);border:1px solid rgba(201,162,39,.4);
            border-radius:3px;padding:10px;color:var(--xx-paper);font-size:15px;
            font-family:inherit;text-align:center;outline:none;letter-spacing:3px">
        </div>
        <button class="xx-btn main" data-act="found">立 族</button></div>
      <div class="xx-empty">
        <div class="xx-empty-h">立 族 之 后</div>
        ${[['族人','有族人才能干活:挂机收益、灵田、采矿'],
           ['领地','营地LV2 可开一块地,盖房、种田、炼丹'],
           ['繁衍','族人之间可结亲,添丁进口'],
           ['传 承','族人满 5 人可推举全属性修士(战力 ×3)']]
          .map((c,i)=>`<div class="xx-clue"><span class="xx-clue-i">${i+1}</span>
            <span><b style="color:var(--xx-gold)">${esc(c[0])}</b><br>
            <span class="xx-clue-w">${esc(c[1])}</span></span></div>`).join('')}
      </div>`;
    }
    const mem = f.members.map(m => {
      const p = FAMILY.member(m.partner);
      if (m.npc === 'momocha') {
        return `<div class="xx-mem" style="border-color:rgba(201,162,39,.5)">
          <div class="a">
            <div class="n">${esc(m.name)}<span style="color:${m.col};margin-left:6px;font-size:11px">${esc(m.roleName)}</span>
              <span class="xx-gold" style="font-size:9px;margin-left:5px">同道</span></div>
            <div class="t" style="color:var(--xx-gold)">全局挂机收益 +25% · 灵田产量 ×1.8 · 族产固定 +260 道行</div>
          </div>
        </div>`;
      }
      return `<div class="xx-mem">
        <div class="a">
          <div class="n">${esc(m.name)}<span style="color:${m.col};margin-left:6px;font-size:11px">${esc(m.roleName)}</span></div>
          <div class="t">${m.lv} 层 · 忠 ${m.aff}${p?' · 配偶 '+esc(p.name):''}</div>
        </div>
        <div class="act">
          <button class="xx-mbtn" data-act="feedrice" data-v2="${m.uid}">喂灵米</button>
          <button class="xx-mbtn" data-act="fam" data-v="talk" data-v2="${m.uid}">叙话</button>
          <button class="xx-mbtn" data-act="fam" data-v="train" data-v2="${m.uid}">督修</button>
        </div></div>`;
    }).join('') || '<div class="xx-dim">族中无人。</div>';

    return `
      <div class="xx-card">
        <div class="xx-label">${esc(CHRONICLE.stamp())}</div>
        <div class="xx-big">${esc(f.name)} · 第 ${f.gen} 代</div>
        <div class="xx-dim" style="margin-top:6px">
          族人 ${f.members.length} · 资产 ${f.wealth} · 领地 ${f.land.length} 处 ·
          战功 ${f.defended}/${f.attacks} · 族力 ${FAMILY.power()}</div>
      </div>
      <div class="xx-card">
        <div class="xx-label">年 表</div>
        ${CHRONICLE.s.log.slice(0,4).map(l=>`<div class="xx-dim" style="margin-bottom:5px">
          <span class="xx-gold">第${l.year}年</span> ${esc(l.ev)}</div>`).join('') ||
          '<div class="xx-dim">太平无事。江湖就是这样开始的。</div>'}
      </div>
      <div class="xx-card">
        <div class="xx-label">族 人</div>${mem}
      </div>
      <div class="xx-card">
        <div class="xx-label">全 属 性 修 士</div>
        <div class="xx-dim" style="margin-bottom:9px">
          耗 500 资产养成。一人抵三人,四项全产(源石/丹/修为/道行)。不可婚配 —— 他的道已定。</div>
        <div class="xx-grid3">
          ${FAMILY.RAISED.map(k=>`<button class="xx-btn sm"
            data-act="raise" data-v="${k.key}">${k.name}</button>`).join('')}
        </div>
        ${(()=>{const _g=FAMILY.raiseGap();return _g.full?'<div class="xx-hint">族人已满 · 议事堂可扩容</div>':(_g.ok?'<div class="xx-hintok">资财已足,可招</div>':`<div class="xx-hint">还需 <b>${_g.lack}</b> 资产(需 500)</div>`);})()}
      </div>

      <div class="xx-grid">
        <button class="xx-btn" data-act="birth" ${FAMILY.canBirth()?'':'disabled'}>延 续 香 火</button>
        <button class="xx-btn" data-act="yield">族 产 结 算</button>
        <button class="xx-btn" data-act="call">求 援 友 盟</button>
        <button class="xx-btn" data-act="attack">巡 视 领 地</button>
      </div>
      <div class="xx-dim" style="text-align:center">
        繁衍需两名未婚族人 + 200 资产 · 领地越多,被围攻越频繁,战力要求越高</div>`;
}
