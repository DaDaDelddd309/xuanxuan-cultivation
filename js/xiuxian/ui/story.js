// 修仙阁 · story页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `showStoryBeat() { return showStoryBeatImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { STORY, ARCS, ARC_REWARD } from '../story.js';
import { QUEST } from '../quest.js';
import { SPINE } from '../spine.js';
import { NAGER, NAG } from '../nag.js';
import { LEGEND } from '../legend.js';
import { esc, toast } from './dom.js';

export function showStoryBeat(hall, b) {
    const el = document.createElement('div');
    el.className = 'xx-storycard';
    el.innerHTML = `<div class="xx-sc-n">${esc(b.name)}</div>
      <div class="xx-sc-t">${esc(b.text)}</div>
      ${b.reveal?`<div class="xx-sc-r">${esc(b.reveal)}</div>`:''}
      ${b.last?`<div class="xx-sc-go">此线已至尽头。去「${esc(ARCS[b.arc].mob)}」处了结。</div>`:''}
      <div class="xx-sc-x">知道了</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelector('.xx-sc-x').onclick = () => el.remove();
    setTimeout(() => el.remove(), 9000);
}
// 初见妖:一条窄横幅,4.2 秒自己走(V0.94)
// 原来是整张叙事卡,走一圈图能弹 5 次以上,像连环弹窗骚扰。
// 现在只告知「你见到什么了 + 一句来历」,细节去图鉴里翻。
/** @param {string[]} [causal] 主线骨架给的因果句(只提示一次,重复遇见不再啰嗦) */
export function showLegend(hall, l, causal) {
    if (hall._bn) hall._bn.remove();
    const el = document.createElement('div');
    el.className = 'xx-banner';
    el.innerHTML = `
      <div class="xx-bn-img"><img src="${l.img}"></div>
      <div class="xx-bn-txt">
        <div class="xx-bn-n">初见 · ${esc(l.name)}</div>
        <div class="xx-bn-l">${esc(l.lore)}</div>
        ${causal && causal.length ? causal.map(c => `<div class="xx-bn-c">${esc(c)}</div>`).join('') : ''}
        <div class="xx-bn-t">详情记在「修仙阁 → 支线 / 图鉴」</div>
      </div>`;
    hall._bn = el;
    NAGER.request({ level: NAG.MID, el, dur: 4200,
      onClose: () => { if (hall._bn === el) hall._bn = null; } });
}

// ---------- 支线 ----------
export function vQuest(hall) {
    QUEST.autoTake();            // 见过妖就自动接,不要求玩家先去跑图
    // V0.99:支线状态同步主线(encounter → intervene 这一阶靠它判定)
    // 放在 autoTake 之后 —— 顺序反了就同步不到本轮新接的支线。
    // QUEST.s 的形状是 { active:[key], done:{key:{...}}, choices:{} }
    try {
      for (const k of (QUEST.s.active || [])) SPINE.observeQuest(k, 'active');
      for (const k of Object.keys(QUEST.s.done || {})) SPINE.observeQuest(k, 'done');
    } catch (e) { console.warn('[spine]', e); }
    const act = QUEST.activeList();
    const done = QUEST.doneList();
    const avail = QUEST.availableList();
    return `
      <div class="xx-card">
        <div class="xx-label">眼 下 的 事</div>
        <div class="xx-dim">见过传说妖,它的来历就变成你的事。办成了,会来找你要个说法。</div>
      </div>

      ${act.length ? act.map(q=>`
        <div class="xx-card" style="border-color:${q.ready?'rgba(201,162,39,.6)':'rgba(232,220,196,.12)'}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="xx-val" style="font-size:15px;color:var(--xx-gold)">${esc(q.title)}</div>
            <div class="xx-dim">${q.ready?'可结案':Math.round(q.p*100)+'%'}</div>
          </div>
          <div class="xx-dim" style="margin-top:5px">${esc(q.desc)}</div>
          ${q.ready
            ? `<button class="xx-btn main" style="margin-top:10px" data-act="qdone" data-v="${q.key}">了 结 这 件 事</button>`
            : `<div class="xx-bar" style="margin-top:9px"><i style="width:${q.p*100}%"></i></div>
               <div class="xx-dim" style="margin-top:5px">${esc(q.tip)}</div>`}
        </div>`).join('')
        : hall.empty('手 上 没 有 事',
            '传说妖只在你亲眼见到它时才会现身。走远一点,别总待在村口。',
            [['荒野(n1 / n2)','灯尸、当康出没一带'],
             ['黑风岭(n5)','姥姥、剑骨'],
             ['青岚秘境(n4)','白泽'],
             ['古战场遗迹(n8)','青穹每回经过']])}

      ${(() => {
        const ready = STORY.readyList();
        if (!ready.length) return '';
        return `<div class="xx-card" style="border-color:rgba(181,52,42,.45)">
          <div class="xx-label">看 完 了 · 等 你 选</div>
          <div class="xx-dim" style="margin-bottom:9px">事到末尾了。选哪一条路,得你自己定。</div>
          ${ready.map(r=>`<div style="margin-bottom:11px">
            <div class="xx-val" style="font-size:14px;color:var(--xx-gold)">${esc(r.name)}</div>
            <button class="xx-btn main" style="margin:8px 0 0" data-act="sfinal" data-v="${r.key}">了 结</button>
          </div>`).join('')}</div>`;
      })()}

      ${(() => {
        const act = STORY.activeList().filter(a=>!STORY.readyFinish(a.key));
        if (!act.length) return '';
        return `<div class="xx-card"><div class="xx-label">听 说 的 事</div>
          <div class="xx-dim" style="margin-bottom:8px">还没走到头。去该去的地方看看。</div>
          ${act.map(a=>`<div style="margin-bottom:8px">
            <div class="xx-val" style="font-size:13px;color:var(--xx-paper)">${esc(a.name)}
              <span class="xx-dim">(${a.beat+1}/${a.total})</span></div>
            <div class="xx-dim" style="margin-top:2px">下一处:${esc(a.next?a.next.node:'')}</div>
            <div class="xx-bar" style="margin-top:6px"><i style="width:${(a.beat/a.total)*100}%"></i></div>
          </div>`).join('')}</div>`;
      })()}

      ${avail.length ? `
        <div class="xx-card"><div class="xx-label">可 以 接 下</div>
        ${avail.map(l=>`<div class="xx-mem">
          <div class="a"><div class="n">${esc(l.quest.title)}</div>
          <div class="t">${esc(l.quest.desc)}</div></div>
          <div class="act"><button class="xx-mbtn" data-act="qtake" data-v="${l.key}">接 下</button></div>
        </div>`).join('')}</div>` : ''}

      ${done.length ? `
        <div class="xx-card"><div class="xx-label">了 结 过 的</div>
        ${done.map(d=>`<div style="margin-bottom:6px">
          <div class="xx-dim" style="color:var(--xx-jade)">${esc(d.title)} ·
            ${d.path===1?'其一':'其二'}</div></div>`).join('')}</div>` : ''}`;
}

export function showQuestReady(hall, q) { toast(`「${q.title}」可结案了。往修仙阁 → 支线`); }
// 叙事线结案:二选一(墓里补完半句话走 askTombWords,这里管地表叙事线)
export function askStoryPath(hall, k) {
    const arc = ARCS[k];
    const last = arc.beats[arc.beats.length-1];
    const el = document.createElement('div');
    el.className = 'xx-storycard legend';
    el.dataset.nag = 'must';     // 必须决策,不占打扰预算
    el.innerHTML = `<div class="xx-sc-n">${esc(arc.name)} · 了 结</div>
      <div class="xx-sc-t">事到头了。剩下的,是你的选择。</div>
      <div class="xx-sc-go" style="cursor:pointer;margin-top:14px;font-size:13px;line-height:1.7"
        data-p="1"><b style="color:var(--xx-gold)">${esc(last.epilogue)}</b><br>
        <span class="xx-dim">${esc((ARC_REWARD[k]||[])[0] ? '道行 +' + (ARC_REWARD[k][0].dao||0) : '')}</span></div>
      <div class="xx-sc-go" style="cursor:pointer;margin-top:10px;font-size:13px;line-height:1.7"
        data-p="2"><b style="color:var(--xx-gold)">${esc(last.epilogue2)}</b><br>
        <span class="xx-dim">${esc((ARC_REWARD[k]||[])[1] ? '道行 +' + (ARC_REWARD[k][1].dao||0) : '')}</span></div>
      <div class="xx-sc-x">再想想</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{
      const path = +b.dataset.p;
      el.remove();
      // 先结案(记录结局/写日志/移出活跃),由 finish 内部发奖
      const r = STORY.finish(k, path, (rw) => QUEST.grant(rw, path));
      if (!r.ok) { toast(r.msg || '还不行'); hall.render(); return; }
      hall.showStoryDone({ name:r.name, path, reward:r.reward, text:r.text });
      hall.render();
    });
    el.querySelector('.xx-sc-x').onclick = () => el.remove();
}

// 结局结算卡
export function showStoryDone(hall, r) {
    const el = document.createElement('div');
    el.className = 'xx-storycard';
    const rw = r.reward && r.reward.text && r.reward.text.length ? r.reward.text : ['得了一份缘法。'];
    el.innerHTML = `<div class="xx-sc-n">${esc(r.name)} · ${r.path===1?'其一':'其二'}</div>
      <div class="xx-sc-t">${esc(r.text||'')}</div>
      <div class="xx-sc-r" style="color:var(--xx-gold)">${rw.map(esc).join(' · ')}</div>
      <div class="xx-sc-x">收下</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelector('.xx-sc-x').onclick = () => el.remove();
    setTimeout(() => el.remove(), 9000);
}

// 双结局选择
export function askPath(hall, k) {
    const el = document.createElement('div');
    el.className = 'xx-storycard';
    el.innerHTML = `<div class="xx-sc-n">${esc(LEGEND[k].quest.title)}</div>
      <div class="xx-sc-t">${esc(LEGEND[k].quest.desc)}</div>
      <div class="xx-sc-go" style="cursor:pointer" data-p="1">其一</div>
      <div class="xx-sc-go" style="cursor:pointer" data-p="2">其二</div>
      <div class="xx-sc-x">再想想</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{
      const r=QUEST.finish(k, +b.dataset.p);
      el.remove();
      if(r.ok) hall.showQuestDone(r); else toast(r.msg||'还没办成');
      hall.render();
    });
    el.querySelector('.xx-sc-x').onclick=()=>el.remove();
}
// 特殊结局(白泽问答 / 剑骨观剑 等)
export function askSpecial(hall, k, sp) {
    const el = document.createElement('div');
    el.className = 'xx-storycard legend';
    el.innerHTML = `<div class="xx-sc-n">${esc(sp.title)}</div>
      <div class="xx-sc-t" style="font-size:16px">${esc(sp.q)}</div>
      <div class="xx-sc-go" style="cursor:pointer;margin-top:14px" data-p="1">${esc(sp.a1)}</div>
      <div class="xx-sc-go" style="cursor:pointer" data-p="2">${esc(sp.a2)}</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{
      const path = +b.dataset.p;
      const r = QUEST.finish(k, path);
      el.remove();
      if (r.ok) {
        const txt = path===1?sp.r1:sp.r2;
        const e2 = document.createElement('div');
        e2.className='xx-storycard';
        e2.innerHTML = `<div class="xx-sc-n">${esc(sp.title)}</div>
          <div class="xx-sc-t">${esc(txt)}</div>
          <div class="xx-sc-r" style="color:var(--xx-gold)">${(r.reward.text||[]).map(esc).join(' · ')||'得了一份缘法。'}</div>
          <div class="xx-sc-x">知道了</div>`;
        document.getElementById('app').appendChild(e2);
        e2.querySelector('.xx-sc-x').onclick=()=>e2.remove();
        setTimeout(()=>e2.remove(),16000);
      } else toast(r.msg||'还没办成');
      hall.render();
    });
}
export function showQuestDone(hall, res) {
    const el = document.createElement('div');
    el.className = 'xx-storycard';
    el.innerHTML = `<div class="xx-sc-n">${esc(res.quest.title)} · ${res.path===1?'其一':'其二'}</div>
      <div class="xx-sc-t">${esc(res.quest.desc)}</div>
      <div class="xx-sc-r" style="color:var(--xx-gold)">
        ${(res.reward.text||[]).map(esc).join(' · ') || '得了一份缘法。'}</div>
      <div class="xx-sc-x">收下</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelector('.xx-sc-x').onclick = () => el.remove();
    setTimeout(() => el.remove(), 9000);
}
