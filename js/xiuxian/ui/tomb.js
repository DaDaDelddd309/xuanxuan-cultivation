// 修仙阁 · 仙人墓页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 拆法:搬实现,ui.js 上留同名壳 `vTomb() { return vTombImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉(顶层函数里是非法尾逗号)。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸 —— 而这几个方法很少被触发。
// 本文件由 split-tomb.mjs 生成,改动请改脚本后重跑,别手改(手改过一次留下了半份状态)。
import { TOMB, ROOMS as TOMB_ROOMS, WORDS as TOMB_WORDS } from '../tomb.js';
import { QUEST } from '../quest.js';
import { esc, toast } from './dom.js';

export function vTomb(hall) {
    const cur = TOMB.room();
    if (!cur) return `<div class="xx-card"><div class="xx-label">仙 人 墓</div>
      <div class="xx-dim">你不在墓里。</div>
      <button class="xx-btn main" style="margin-top:10px" data-act="tomb-enter">下 墓</button></div>`;

    // 平面图:已走过的显示名字,没走过的只给个位置
    const g = 5;
    const pos = r => ({ x: 4 + (r.x / 3) * 92, y: 10 + (r.y / 2) * 74 });
    let edges = '', nodes = '';
    const drawn = new Set();
    for (const r of TOMB_ROOMS) for (const to of r.edge) {
      const pair = [r.id, to].sort().join('-');
      if (drawn.has(pair)) continue;
      drawn.add(pair);
      const a = pos(r), b = pos(TOMB_ROOMS.find(x=>x.id===to));
      const len = Math.hypot(b.x-a.x, b.y-a.y), ang = Math.atan2(b.y-a.y, b.x-a.x)*180/Math.PI;
      edges += `<div class="xx-edge" style="left:${a.x}%;top:${a.y}%;width:${len}%;
        transform:rotate(${ang}deg)"></div>`;
    }
    for (const r of TOMB_ROOMS) {
      const p = pos(r);
      const seen = TOMB.seen(r.id);
      const here = cur.id === r.id;
      const canGo = cur.edge.includes(r.id);
      const cls = ['xx-node','tomb'];
      if (here) cls.push('cur');
      else if (!seen) cls.push('fog');
      if (!here && !canGo) cls.push('locked');
      const mark = here ? '◆' : seen ? '●' : '?';
      const label = seen ? esc(r.name) : '未 至';
      nodes += `<div class="${cls.join(' ')}" style="left:${p.x}%;top:${p.y}%"
        ${canGo&&!here?`data-act="tomb-go" data-v="${r.id}"`:''}>
        <div class="xx-fogq" style="${seen&&!here?'display:none':''}">${mark}</div>
        <div class="xx-node-lb">${label}</div></div>`;
    }

    const pr = TOMB.progress();
    // 石将前 → 补完那半句话
    const guard = cur.guard && !TOMB.s.done
      ? `<button class="xx-btn main" style="width:100%;margin-top:12px" data-act="tomb-words">补 完 那 半 句 话</button>`
      : '';
    const canEnd = cur.end && !TOMB.s.done
      ? `<div class="xx-dim" style="margin-top:10px;text-align:center">这里就是尽头了。</div>` : '';

    return `<div class="xx-card">
        <div class="xx-label">仙 人 墓</div>
        <div class="xx-dim">已至 ${pr.seen} / ${pr.total} 处 · 越往里,字越少</div>
      </div>
      <div class="xx-map" style="height:190px">${edges}${nodes}</div>
      <div class="xx-card" style="border-color:rgba(181,52,42,.4)">
        <div class="xx-label">${esc(cur.name)}</div>
        <div class="xx-story-t" style="white-space:pre-wrap;line-height:2">${esc(cur.text)}</div>
        ${cur.beat?`<div class="xx-story-b" style="margin-top:9px">${esc(cur.beat)}</div>`:''}
        ${guard}
        ${canEnd}
        <div style="display:flex;gap:8px;margin-top:12px">
          ${cur.edge.map(t=>`<button class="xx-btn" style="flex:1"
            data-act="tomb-go" data-v="${t}">往 ${esc(TOMB_ROOMS.find(x=>x.id===t).name.replace(/\s/g,''))}</button>`).join('')}
        </div>
        <button class="xx-btn" style="width:100%;margin-top:8px" data-act="tomb-leave">出 墓</button>
      </div>`;
}

// 进入某间房:结算内容并展示
export function tombRoom(hall, id) {
    TOMB.move(id);
    const s = TOMB.settle(id);
    hall.render();
    if (!s) return;
    // 侧室/主墓的收获提示
    if (s.gift && s.gift.text.length) toast('得了 ' + s.gift.text.join(' · '));
    // 叙事线最后一环的提示
    if (s.arcBeat) {
      toast('石将侧过身,让出半步。');
    }
}

// 补完半句话 —— 只能在石将跟前做
export function askTombWords(hall) {
    if (!TOMB.canFinish()) { toast('你还没走到石将跟前'); return; }
    const el = document.createElement('div');
    el.className = 'xx-storycard legend';
    el.dataset.nag = 'must';     // 必须决策
    el.innerHTML = `<div class="xx-sc-n">半 句 话</div>
      <div class="xx-sc-t">石将背上,「此生不悔」四个字还缺一半。<br>你手上有两个补法。</div>
      ${TOMB_WORDS.map(w=>`<div class="xx-sc-go" style="cursor:pointer;margin-top:13px;
        font-size:13px;line-height:1.7" data-w="${w.path}">
        <b style="color:var(--xx-gold)">${esc(w.text)}</b><br>
        <span class="xx-dim">${esc(w.note)}</span></div>`).join('')}
      <div class="xx-sc-x">再想想</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{
      const path = +b.dataset.w;
      const r = TOMB.finish(path);
      el.remove();
      if (!r.ok) { toast(r.msg||'还不行'); hall.render(); return; }
      QUEST.settleShijiang(path);
      hall.tombEnding(r);
    });
    el.querySelector('.xx-sc-x').onclick=()=>el.remove();
}

// 墓的结局演出
export function tombEnding(hall, r) {
    const el = document.createElement('div');
    el.className = 'xx-storycard';
    el.innerHTML = `<div class="xx-sc-n">此 生 不 悔 · ${esc(r.words)}</div>
      <div class="xx-sc-t" style="white-space:pre-wrap">${esc(r.note)}</div>
      <div class="xx-sc-t" style="white-space:pre-wrap;margin-top:10px;color:var(--xx-paper)">${esc(r.after)}</div>
      ${r.reward&&r.reward.text.length?`<div class="xx-sc-r" style="color:var(--xx-gold)">${esc(r.reward.text.join(' · '))}</div>`:''}
      <div class="xx-sc-x">走出墓去</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelector('.xx-sc-x').onclick=()=>{ el.remove(); hall.render(); };
    setTimeout(()=>{ el.remove(); hall.render(); }, 11000);
}
