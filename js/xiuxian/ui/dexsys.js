// 修仙阁 · dexsys页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `vDex() { return vDexImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { BUILDINGS, BESTIARY, NPCS, TIERS } from '../bestiary.js';
import { Profile, Seed } from '../profile.js';
import { CHRONICLE } from '../chronicle.js';
import { CLOCK } from '../clock.js';
import { Cult } from '../index.js';
import { STONES, SCROLLS } from '../items.js';
import { WORLD_INFO } from '../world.js';
import { STORY } from '../story.js';
import { LEGEND_LIST } from '../legend.js';
import { COMPANION } from '../companion.js';
import { esc, toast } from './dom.js';

// ---------- 图鉴(怪物 + NPC)----------
export function vDex(hall) {
    // V0.98:三选一路线(kiss/cold/ghost)删了,「灵伴三形」随之消失。
    // 这里只列与路线无关的 NPC。灵伴本人的来历走「传说妖谱」与年表。
    const order = ['momocha','merchant','moying'];
    return `
      <div class="xx-card"><div class="xx-label">山 中 人</div>
        <div class="xx-dim">路上遇见的,不是选项。</div></div>
      ${order.map(k=>{
        const n = NPCS[k];
        if (!n) return '';
        return `<div class="xx-dxx">
          <img src="${n.img}" alt="">
          <div class="xx-dxx-b">
            <div class="xx-dxx-n">${esc(n.name)}<span>${esc(n.form)}</span></div>
            <div class="xx-dxx-d">${esc(n.desc)}</div>
            <div class="xx-dxx-b2">${esc(n.ability)}</div>
            ${n.threat && n.threat!=='无' ? `<div class="xx-dxx-t">威胁:${esc(n.threat)}</div>` : ''}
          </div>
        </div>`;
      }).join('')}
      <div class="xx-card"><div class="xx-label">传 说 妖 谱 (${STORY.metList().length}/${LEGEND_LIST.length})</div>
        <div class="xx-dim">每只都有来历。见过了,它的故事就展开了。</div></div>
      ${LEGEND_LIST.map(l=>{
        const seen = STORY.met(l.key);
        return `<div class="xx-dxx ${seen?'':'unseen'}">
          <img src="${l.img}" alt="">
          <div class="xx-dxx-b">
            <div class="xx-dxx-n">${esc(l.name)}<span>${['','','常','稀有','珍稀','传说'][l.rarity]}</span></div>
            <div class="xx-dxx-d">${esc(seen?l.lore:'……未曾遇见。')}</div>
            ${seen?`<div class="xx-dxx-b2">${esc(l.story)}</div>`:''}
            ${seen?`<div class="xx-dxx-t">传闻:${esc(l.tell)}</div>`:''}
            ${seen&&l.quest?`<div class="xx-dxx-b2" style="color:var(--xx-gold);margin-top:4px">
              支线「${esc(l.quest.title)}」— ${esc(l.quest.desc)}</div>`:''}
          </div></div>`;
      }).join('')}
      <div class="xx-card"><div class="xx-label">妖 物 图 谱</div>
        <div class="xx-dim">${Object.keys(BESTIARY).length} 种已知。</div></div>
      ${Object.entries(BESTIARY).map(([k,m])=>`
        <div class="xx-dxx">
          <img src="${m.img}" alt="">
          <div class="xx-dxx-b">
            <div class="xx-dxx-n">${esc(m.name)}<span>${esc(m.realm)}</span></div>
            <div class="xx-dxx-d">${esc(m.desc)}</div>
            <div class="xx-dxx-b2">气血 ${m.hp} · 伤害 ${m.dmg} · 修为 +${m.xp}</div>
            <div class="xx-dxx-b2">掉落:${m.drops.map(d=>{
              const it = BUILDINGS[d.id] || STONES[d.id] || SCROLLS[d.id] || {name:d.id};
              return `${it.name} ${(d.p*100).toFixed(0)}%`;
            }).join(' · ')}</div>
          </div>
        </div>`).join('')}`;
}

// ---------- 存档(种子 / 存档码)----------
export function vSys(hall) {
    const code = Profile.export();
    // 生成元信息(2026-10-10):把「这一世是第几次尝试生成的」摆出来。
    //   之前玩家看不到 —— 但世界是程序生成的,重试次数与是否走兜底
    //   确实会改变地图面貌(兜底那张图明显更稀疏)。不透明等于不可信。
    let gen = '';
    try {
      const fb = WORLD_INFO.fallback;
      gen = `<div class="xx-dim" style="margin-top:6px">
        本世 ${WORLD_INFO.nodeCount} 个节点 · 第 ${WORLD_INFO.attempts} 次布局命中`
        + `${fb ? ' · <span style="color:var(--xx-gold)">已走兜底布局</span>' : ''}
      </div>`;
    } catch (e) { console.warn('[world-info]', e); }
    return `
      <div class="xx-card">
        <div class="xx-label">世 界 种 子</div>
        <div class="xx-big">${esc(Seed.cur)}</div>
        <div class="xx-dim" style="margin-top:6px">
          同一种子 = 同一个世界:奇遇、掉落、商人、怨灵、营地来客,全部一致。
          换种子 = 换一世。存档只存进度,不存世界,所以很省。
        </div>
        ${gen}
        <div class="xx-numrow" style="margin-top:12px">
          <input id="xx-seed" value="${esc(Seed.cur)}" maxlength="12"
            style="flex:1;background:rgba(0,0,0,.4);border:1px solid rgba(201,162,39,.4);
            border-radius:3px;padding:10px;color:var(--xx-paper);font-size:15px;
            font-family:inherit;text-align:center;outline:none;letter-spacing:2px">
        </div>
        <button class="xx-btn" data-act="setseed">换 一 世</button>
      </div>

      <div class="xx-card">
        <div class="xx-label">存 档 码 (${Profile.size()} 字节)</div>
        <div class="xx-dim" style="margin-bottom:10px">
          整份存档压成一段字。复制存到备忘录,换设备粘贴回来就恢复。
          清缓存也不怕。
        </div>
        <textarea id="xx-code" readonly style="width:100%;height:110px;background:rgba(0,0,0,.45);
          border:1px solid rgba(201,162,39,.35);border-radius:3px;padding:9px;
          color:var(--xx-paper);font-size:10px;font-family:monospace;outline:none;
          resize:none;line-height:1.5">${esc(code)}</textarea>
        <button class="xx-btn" data-act="copycode">复 制 存 档 码</button>
      </div>

      <div class="xx-card">
        <div class="xx-label">导 入 存 档</div>
        <textarea id="xx-in" placeholder="粘贴存档码…" style="width:100%;height:80px;
          background:rgba(0,0,0,.45);border:1px solid rgba(232,220,196,.25);border-radius:3px;
          padding:9px;color:var(--xx-paper);font-size:10px;font-family:monospace;outline:none;
          resize:none;line-height:1.5"></textarea>
        <button class="xx-btn main" data-act="import">导 入 并 恢 复</button>
      </div>

      <div class="xx-dim" style="text-align:center;line-height:1.9">
        境界 · 炼气${Cult.get().layer}层 / 道行 ${Cult.get().dao}<br>
        灵伴 · ${esc(COMPANION.s.name || '未遇')}<br>
        称号 · ${Cult.titles.list().length} 枚
      </div>`;
}
