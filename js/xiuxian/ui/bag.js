// 修仙阁 · bag页 —— 工单 XX-AUDIT-005（从 ui.js 拆出）
//
// 本文件由 tools/ui/split.mjs 生成 —— **请改脚本后重跑,不要手改**。
// 手改过一次,注入验证时只删掉几个壳里的第一个、其余还在,还原后
// "看着干净"其实重了一份;对象字面量重复定义是后者覆盖前者,不报错。
//
// 拆法:搬实现,ui.js 上留同名壳 `vBag() { return vBagImpl(this); }`。
// Hall 对外接口一字不变,main.js / e2e-cult.mjs 零改动,可单独回滚。
//
// 关键约束:这里**不能 import Hall** —— ui.js import 本文件,本文件再 import
// ui.js 就是循环依赖,原生 ESM 下会拿到 undefined。hall 由 ui.js 作为第一个
// 实参传进来(壳方法里的 `this`)。
//
// 纪律:`this.` 必须全换成 `hall.`;对象成员结尾的 `},` 要去掉。
// 这两类改动错了都不会在定义时报错,只在执行到那一行才炸。
import { STONES, STONE_LIST, SCROLL_LIST, Bag, DAY } from '../items.js';
import { MOUNT, MOUNTS, MOUNT_LIST } from '../mount.js';
import { CHARACTERS, TITLES } from '../lore.js';
import { Cult } from '../index.js';
import { SCROLLS, GOODS } from '../items.js';
import { NAGER, NAG } from '../nag.js';
import { STORY } from '../story.js';
import { TOMB } from '../tomb.js';
import { WORLD as LORE } from '../lore.js';
import { PORTRAIT } from './portrait.js';
import { esc, toast } from './dom.js';

// ---------- 行囊 ----------
export function vBag(hall) {
    const items = Bag.s.items || {};
    const keys = Object.keys(items).filter(k => items[k] > 0);
    let h = `<div class="xx-card">
      <div class="xx-label">道 行</div><div class="xx-big">${Cult.get().dao}</div>
      <div class="xx-dim" style="margin-top:5px">可用道行兑换源石与传承书 —— 比商人便宜,但不打折。</div>
    </div>`;
    if (!keys.length) return h + hall.empty('空 空 如 也',
      '源石用来生篝火,传承书用来补突破溢出。丹药得去秘境才有。',
      [['荒野 · 打散妖','掉落源石,品质随机'],
       ['秘境(n4)','丹药与高阶源石'],
       ['险地 / 妖巢','道行与稀罕物件'],
       ['突破失败','多余的修为自动折成传承书']]);
    for (const k of keys) {
      const it = STONES[k] || SCROLLS[k] || GOODS[k];
      if (!it) continue;
      const isStone = !!STONES[k];
      const isScroll = !!SCROLLS[k];
      h += `<div class="xx-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="flex:1">
            <div class="xx-label" style="color:${it.col}">${it.name} ×${items[k]}</div>
            <div class="xx-val" style="font-size:13px">${isStone ? `燃烧 ${it.dur} 分钟` : (it.d || it.realm || '')}</div>
            ${isStone ? `<div class="xx-dim" style="margin-top:4px">来源:${it.src}</div>` : ''}
          </div>
          ${!isStone && GOODS[k] ? `<button class="xx-btn" style="width:auto;margin:0;padding:8px 15px;font-size:13px"
            data-act="usegood" data-v="${k}">使 用</button>` : ''}
        </div></div>`;
    }
    // 兑换区
    h += `<div class="xx-label" style="margin:14px 0 6px">道 行 兑 换</div>`;
    h += Object.entries(Bag.EXCHANGE).map(([sid, e]) => `
      <div class="xx-card" style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div class="xx-label" style="color:${STONES[sid].col}">${STONES[sid].name}</div>
          <div class="xx-dim">${STONES[sid].dur} 分钟 + ${SCROLL_LIST.find(x=>x.exp<=(e.exp*1.2)&&x.exp>=e.exp*0.45)?.name||'传承书'}</div></div>
          <button class="xx-btn" style="width:auto;margin:0;padding:7px 13px;font-size:12px"
            data-act="exch" data-v="${sid}">${e.dao}</button>
        </div></div>`).join('');
    return h;
}

// ---------- 人物 ----------
// 得到坐骑:必须有明确反馈,不能静默发
export function showMountGet(hall, m) {
    const el = document.createElement('div');
    el.className = 'xx-storycard legend';
    const isRide = m.kind === 'ride';
    el.innerHTML = `<div class="xx-sc-n">得 ${esc(m.name)}</div>
      <div class="xx-sc-t">${esc(m.lore)}</div>
      <div class="xx-sc-t" style="margin-top:9px;color:var(--xx-jade)">${esc(m.give)}</div>
      <div class="xx-sc-r" style="color:var(--xx-gold)">
        ${m.ward?`护栏 +${m.ward} `:''}${m.speed?`移速 +${m.speed}% `:''}
        ${m.pickup?`拾取 ×${(1+m.pickup).toFixed(2)} `:''}${m.atk?`攻击 +${m.atk}%`:''}
      </div>
      <div class="xx-sc-t" style="margin-top:8px;font-size:12px">已${isRide?'骑上':'带上'}。往「修仙阁 → 人物」可换。</div>
      <div class="xx-sc-x">收下</div>`;
    document.getElementById('app').appendChild(el);
    el.querySelector('.xx-sc-x').onclick = () => { el.remove(); hall._nextPending(); };
    setTimeout(() => { el.remove(); hall._nextPending(); }, 18000);
}

// 全屏卡队列:一次只弹一张,关掉再弹下一张
export function _nextPending(hall) {
    if (hall._busy) return;
    const q = hall._pendingMount;
    if (!q || !q.length) return;
    const m = q.shift();
    hall._busy = true;
    const el = document.createElement('div');
    el.className = 'xx-storycard legend';
    const done = () => { el.remove(); hall._busy = false; hall._nextPending(); };
    el.innerHTML = `<div class="xx-sc-n">得 ${esc(m.name)}</div>
      <div class="xx-sc-t">${esc(m.lore)}</div>
      <div class="xx-sc-t" style="margin-top:9px;color:var(--xx-jade)">${esc(m.give)}</div>
      <div class="xx-sc-r" style="color:var(--xx-gold)">
        ${m.ward?`护栏 +${m.ward} `:''}${m.speed?`移速 +${m.speed}% `:''}
        ${m.pickup?`拾取 ×${(1+m.pickup).toFixed(2)} `:''}${m.atk?`攻击 +${m.atk}%`:''}
      </div>
      <div class="xx-sc-t" style="margin-top:8px;font-size:12px">已${m.kind==='ride'?'骑上':'带上'}。往「修仙阁 → 人物」可换。</div>
      <div class="xx-sc-x">收下</div>`;
    document.getElementById('app').appendChild(el);
    NAGER.request({ level: NAG.MUST, el, dur: 11000, onClose: done });
}

// 统一空态:一句状态 + 去哪儿的线索(V0.95)
// 原来空页面只写「还没什么」,玩家不知道下一步该干嘛。
export function empty(hall, title, desc, clues) {
    return `<div class="xx-empty">
      <div class="xx-empty-t">${esc(title)}</div>
      <div class="xx-empty-d">${esc(desc)}</div>
      ${(clues && clues.length) ? `
        <div class="xx-empty-h">去 哪 儿</div>
        ${clues.map((c,i)=>`<div class="xx-clue">
          <span class="xx-clue-i">${i+1}</span>
          <span><b style="color:var(--xx-gold)">${esc(c[0])}</b><br>
          <span class="xx-clue-w">${esc(c[1])}</span></span>
        </div>`).join('')}` : ''}
    </div>`;
}

// 村庄:真有功能的地方(V0.96)
// 原来点进去只有一句「炊烟袅袅。歇一会儿。」—— 村庄是个空壳,
// 而 world.js 里落云镇还标着 shop:true,代码却从来没读过这个字段。
export function enterVillage(hall, n) {
    hall.village = n.id;
    hall.render();
    setTimeout(() => {
      const body = document.getElementById('xx-body');
      if (!body) return;
      const el = document.createElement('div');
      el.innerHTML = hall.vVillage(n);
      // 插到地图最前面
      const first = body.querySelector('.xx-card, .xx-map');
      if (first) body.insertBefore(el, first); else body.appendChild(el);
      // 事件代理在 root 上,插入的内容照样能点
    }, 0);
    // 布告栏:告诉玩家这个村子是干什么的
    setTimeout(() => {
      const isTown = !!n.shop;
      toast(isTown ? '落云镇 · 集市开市' : '青石村 · 炊烟起了');
    }, 200);
}

// 村庄面板(挂在页面顶部)
export function vVillage(hall, n) {
    const s = Cult.get();
    const isTown = !!n.shop;
    const heal = (s.hp || 0) < (s.maxHp || 0);
    return `<div class="xx-card" style="border-color:rgba(201,162,39,.4)">
        <div class="xx-label">${esc(n.name || '村 落')}</div>
        <div class="xx-val" style="font-size:14px;color:var(--xx-gold)">
          ${isTown ? '集 市 开 市' : '炊 烟 袅 袅'}</div>
        <div class="xx-dim" style="margin-top:6px;line-height:1.85">
          ${isTown
            ? '落云镇的集市每旬开一次。散修把用不上的东西拿来换,也有人在这儿收传说。'
            : '青石村是最早落脚的地方。村口的老槐树下,总有人愿意跟你讲两句。'}</div>
      </div>

      <div class="xx-grid">
        <div class="xx-card">
          <div class="xx-label">歇 息</div>
          <div class="xx-dim" style="font-size:12px;margin:5px 0 9px">
            ${heal ? `气血 ${s.hp}/${s.maxHp} — 睡一觉就好了` : '气血已满,歇着也是歇着'}</div>
          <button class="xx-btn" data-act="rest">睡 一 觉</button>
        </div>
        ${isTown ? `
        <div class="xx-card">
          <div class="xx-label">集 市</div>
          <div class="xx-dim" style="font-size:12px;margin:5px 0 9px">
            你有 ${s.dao} 道行。散商的货比仙人便宜,但他挑人。</div>
          <button class="xx-btn" data-act="merchant">找 散 商</button>
        </div>` : `
        <div class="xx-card">
          <div class="xx-label">村 口</div>
          <div class="xx-dim" style="font-size:12px;margin:5px 0 9px">
            青石村没有集市,但有别的 —— 猎户会带你进山。</div>
          <button class="xx-btn" data-act="guide">问 路 人</button>
        </div>`}
      </div>

      <div class="xx-card">
        <div class="xx-label">村 中 所 见</div>
        ${(isTown
          ? [['卖符的', '「匿息符?一张不够,两张才稳。」'],
             ['说书的', '他讲古战场那一段,每回都讲得不一样。'],
             ['磨刀的', '他在等一个人。等了很久了。']]
          : [['打铁的老汉', '他要的从来不是钱。'],
             ['门口的小孩', '他数着天,说再过几天就能去捡灵石了。'],
             ['收山货的', '他压价,但他认得每一味草。']]
        ).map((c,i)=>`<div class="xx-clue" style="border:0;padding:6px 0">
            <span class="xx-clue-i">${i+1}</span>
            <span><b style="color:var(--xx-paper)">${esc(c[0])}</b><br>
            <span class="xx-clue-w">${esc(c[1])}</span></span></div>`).join('')}
      </div>`;
}

// ---------- 坐骑 / 宠物 ----------
export function vMount(hall) {
    const e = MOUNT.eff(), b = MOUNT.breakdown();
    const ride = MOUNT.s.ride ? MOUNTS[MOUNT.s.ride] : null;
    const pet  = MOUNT.s.pet  ? MOUNTS[MOUNT.s.pet]  : null;
    const row = (label, base, add, unit) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;
        padding:5px 0;border-bottom:1px solid rgba(232,220,196,.07)">
        <span class="xx-dim" style="font-size:12px">${label}</span>
        <span style="font-size:13px">${base}<span style="color:var(--xx-jade)">${add}</span>
          <span class="xx-dim" style="font-size:11px">${unit||''}</span></span>
      </div>`;

    const card = (m, slot) => {
      const on = slot==='ride' ? MOUNT.s.ride===m.id : MOUNT.s.pet===m.id;
      return `
      <div style="border:1px solid rgba(232,220,196,.12);border-radius:3px;
        padding:10px;margin-bottom:8px;${on?'border-color:rgba(201,162,39,.5);':''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;color:var(--xx-gold);white-space:nowrap">${esc(m.name)}</div>
            <div class="xx-dim" style="font-size:11px;margin-top:2px;white-space:nowrap">${esc(m.from)} · ${m.kind==='ride'?'坐骑':'随行'}</div>
          </div>
          <button class="xx-btn mini" data-act="mset" data-v="${m.id}" data-s="${slot}">${on?'卸 下':(slot==='ride'?'骑 上':'带 上')}</button>
        </div>
        <div class="xx-dim" style="font-size:12px;margin-top:7px;line-height:1.75">${esc(m.lore)}</div>
        ${m.give?`<div class="xx-dim" style="font-size:11px;margin-top:4px;line-height:1.7;color:var(--xx-jade)">${esc(m.give)}</div>`:''}
        <div style="font-size:11px;color:var(--xx-jade);margin-top:6px">
          ${m.ward?`护栏 +${m.ward} `:''}${m.speed?`移速 +${m.speed}% `:''}${m.pickup?`拾取 ×${(1+m.pickup).toFixed(2)} `:''}${m.atk?`攻击 +${m.atk}%`:''}
        </div>
      </div>`;
    };

    const owned = MOUNT.s.have.map(id=>MOUNTS[id]).filter(Boolean);
    const rides  = owned.filter(m=>m.kind==='ride');
    const pets   = owned.filter(m=>m.kind==='pet');

    const statBlock = (MOUNT.s.have.length ? `
      <div class="xx-card">
        <div class="xx-label">在 身 之 物</div>
        ${row('篝火护栏', '70', b.ward?` +${b.ward}`:'', ' px')}
        ${row('局内移速', '1.00', b.speed?` +${b.speed}%`:'', '')}
        ${row('拾取范围', '1.00', b.pickup?` +${Math.round(b.pickup*100)}%`:'', '')}
        ${b.atk?row('随行攻击','0',` +${b.atk}%`,''):''}
        <div class="xx-dim" style="font-size:11px;margin-top:9px;line-height:1.7">
          ${ride?`骑：${esc(ride.name)}`:'未骑乘'}${pet?`　带：${esc(pet.name)}`:(pets.length?'　（随行未带出）':'')}</div>
      </div>` : '');

    // 未获得的:直接写清楚在哪儿、怎么才能拿到。
    // 不写清楚的话,玩家走一圈图什么都没拿到,却不知道差什么(V0.92 修)
    const lack = MOUNT_LIST.filter(m => !MOUNT.has(m.id));
    let lackHtml = '';
    if (lack.length) {
      // 近在咫尺:条件已满足一半的单独点出来,免得玩家瞎找
      const near = lack.filter(m =>
        (m.id === 'baize'      && STORY.met('baize')) ||
        (m.id === 'qiao'       && STORY.met('qingqiong')) ||
        (m.id === 'stonepuppy' && TOMB.known()));
      lackHtml = `<div class="xx-card">
        <div class="xx-label">还 没 得 到</div>
        <div class="xx-dim" style="margin-bottom:9px;line-height:1.8">
          坐骑不是买来的。它们只认一个特定的人,或者只在一个地方等。
          走对地方才有,走错了再多次也没有。</div>
        ${near.length ? `<div class="xx-dim" style="color:var(--xx-jade);
          background:rgba(74,157,224,.08);padding:7px 9px;border-radius:2px;
          margin-bottom:10px;font-size:12px;line-height:1.7">
          快了 —— ${near.map(m=>esc(m.name.replace(/ /g,''))).join('、')}
          那边你已经有眉目了,只差最后一步。</div>` : ''}
        ${lack.map(m => `<div style="margin-bottom:9px;padding-left:9px;
          border-left:2px solid rgba(201,162,39,.28)">
          <div style="font-size:13px;color:var(--xx-gold)">${esc(m.name)}
            <span class="xx-dim" style="font-size:11px">${m.kind==='ride'?'坐骑':'随行'}</span></div>
          <div class="xx-dim" style="font-size:12px;line-height:1.7;margin-top:2px">${esc(m.how)}</div>
        </div>`).join('')}
      </div>`;
    }

    return `<div class="xx-card">
        <div class="xx-label">坐 骑 与 随 行</div>
        <div class="xx-dim" style="line-height:1.8">
          坐骑拉开护栏、加移速;随行的会自己上去咬人。<br>
          和灵伴不同 —— 灵伴陪你说话,它们只出力气。</div>
      </div>`
      + statBlock
      + (rides.length ? `<div class="xx-card"><div class="xx-label">坐 骑</div>
          ${rides.map(m=>card(m,'ride')).join('')}</div>` : '')
      + (pets.length ? `<div class="xx-card"><div class="xx-label">随 行</div>
          ${pets.map(m=>card(m,'pet')).join('')}</div>` : '')
      + lackHtml;
}

export function vPeople(hall) {
    return hall.vMount()
      + Object.values(CHARACTERS).map(c => `
      <div class="xx-ch">
        <img src="${PORTRAIT[c.portrait] || PORTRAIT.hero}" alt="">
        <div>
          <h4>${esc(c.name)} <span class="xx-dim" style="font-size:11px">${esc(c.role)}</span></h4>
          <div class="t">${esc(c.title)}</div>
          <p>${esc(c.bio)}</p>
          <p class="xx-gold" style="margin-top:5px">${esc(c.arc)}</p>
        </div>
      </div>`).join('')
      + (STORY.s.log.length ? `
        <div class="xx-card"><div class="xx-label">所 见 所 闻</div>
        ${STORY.s.log.slice(0,7).map(e => `
          <div style="margin-bottom:9px">
            <div class="xx-val" style="font-size:12px;color:var(--xx-gold)">${esc(e.arc)}</div>
            <div class="xx-dim" style="margin-top:2px">${esc(e.text)}</div>
          </div>`).join('')}
        </div>` : '')
      + (STORY.doneList().length ? `
        <div class="xx-card"><div class="xx-label">了 结</div>
        ${STORY.doneList().map(e=>`<div style="margin-bottom:8px">
          <div class="xx-val" style="font-size:12px;color:var(--xx-jade)">${esc(e.name)}</div>
          <div class="xx-dim" style="margin-top:2px">${esc(e.epilogue||'')}</div>
        </div>`).join('')}
        </div>` : '')
      + `<div class="xx-card"><div class="xx-label">世 界</div>
        <div class="xx-val">${esc(LORE.title)} · ${esc(LORE.era)}</div>
        <div class="xx-dim" style="margin-top:6px">${esc(LORE.intro)}</div></div>
        ${LORE.rules.map(r => `<div class="xx-dim" style="padding:4px 0">· ${esc(r)}</div>`).join('')}`;
}
