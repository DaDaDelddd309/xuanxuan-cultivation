// ===== 灵伴 · 表现层(V0.98)=====
//  · 怨灵闪屏特写(玩法机制的提示,不打断)
//  · 篝火外强化怪标记 + 护栏内绝对安全提示
//
// V0.98 改动(工单 XX-COMP-004 / 006):
//   删掉「贴边选项卡」与「自说自话气泡」两层主动打扰。
//   它们依赖已删除的 hug/hugChoose/cold/tryGift/三条路线,
//   而且按 owner 的判断:修仙阁里她应该**彻底不打扰**,
//   想看就看一眼,不说话 —— 唯一留下的痕迹是年表(markRun)。
//
//   局内她不是"不说话"了,是有动作:
//   捡东西 / 会受伤 / 会躲 / 会缺席 → 见 companion-actor.js
import { COMPANION } from './companion.js';
import * as Broadcast from './companion-broadcast.js';
import { CAMP } from './camp.js';

const $ = (t,c,h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let L = {};

export const Bond = {
  init() {
    if (L.root) return;
    const r = $('div', 'xx-bond');
    r.innerHTML = `
      <div class="bd-bub" id="bd-bub"></div>
      <div class="bd-flash" id="bd-flash">
        <div class="bd-flash-art">怨</div>
        <div class="bd-flash-t" id="bd-flash-t"></div>
        <div class="bd-flash-s" id="bd-flash-s"></div>
        <div class="bd-flash-c" id="bd-flash-c"></div>
      </div>
      <div class="bd-ward" id="bd-ward"></div>
      <div class="bd-ghost-hud" id="bd-ghost-hud"></div>`;
    document.getElementById('app').appendChild(r);
    L = {
      root:r,
      bub:r.querySelector('#bd-bub'), flash:r.querySelector('#bd-flash'),
      ward:r.querySelector('#bd-ward'), hud:r.querySelector('#bd-ghost-hud'),
    };
  },

  /** 局内事件台词的出口 —— 由 companion-actor 的 runEventLines 调用 */
  bubble(text, kind) {
    if (!text) return;
    // V0.96:气泡也算打扰。全局 tick 每 1.2 秒一次,不加限制的话一局能冒几十个泡。
    // 给它一个独立的低频预算,超了就静默。
    if (!this._bubBudget) this._bubBudget = 6;
    if (this._bubBudget <= 0) return;
    this._bubBudget--;
    this.init();

    // ── XX-COMPANION-003:同时走顶部广播条 ──────────────────
    // 玩家反馈:原来的弹窗在砍杀中途「突兀、妨碍视野」——
    // 正盯着弹幕呢,视野被挡一下。广播条借 HUD 顶部的空档,
    // 不弹窗、不遮画面、不禁操作,说完停留等下一轮推上去。
    //
    // **预算不叠加**:上面 `this._bubBudget` 已经限了每局 6 条,
    // 这里不再另加一份限制 —— 否则「省着说」变成了「不敢说」。
    const nm = (COMPANION.s && COMPANION.s.name) || '宝宝';
    Broadcast.say(nm, text, {
      color: kind === 'ok' ? 'var(--xx-jade, #6f8f6a)'
          : kind === 'dark' ? 'var(--xx-cinnabar, #8c3a2e)'
          : 'var(--cc-name, #c9a227)',
    });

    const b = L.bub;
    b.className = 'bd-bub on' + (kind === 'ok' ? ' ok' : kind === 'dark' ? ' dark' : '');
    b.textContent = text;
    clearTimeout(L._bt);
    L._bt = setTimeout(()=>b.classList.remove('on'), 3400);
  },

  // ————— 怨灵闪屏特写(不打断游戏)—————
  flash(f) {
    if (!f) return;
    this.init();
    L.root.querySelector('#bd-flash-t').textContent = f.t || '';
    L.root.querySelector('#bd-flash-s').textContent = f.s || '';
    L.root.querySelector('#bd-flash-c').textContent = f.c || '';
    L.flash.classList.remove('on'); void L.flash.offsetWidth;
    L.flash.classList.add('on');
    setTimeout(()=>L.flash.classList.remove('on'), 2300);
  },

  // ————— 篝火守卫 HUD —————
  tickWarden() {
    this.init();
    const g = COMPANION.s.ghost;
    const w = COMPANION.wardenTick();
    if (!CAMP.burning()) {
      L.ward.classList.remove('on'); L.hud.classList.remove('on'); return;
    }
    L.ward.classList.add('on');
    L.ward.style.setProperty('--r', COMPANION.wardRadius() + 'px');
    L.ward.innerHTML = `<div class="bd-ward-t">源 石 护 栏</div>
      <div class="bd-ward-s">圈内绝对安全 · 圈外 ${w ? w.count : 0} 只强化妖物</div>`;
    // 怨灵倒计时(reviveCountdown 现在是方法,不是属性)
    if (g.on) {
      const cd = COMPANION.reviveCountdown();
      L.hud.classList.add('on');
      L.hud.innerHTML = cd > 0
        ? `<b>怨灵已散</b> · ${cd}s 后附身「${esc(g.nextHost)}」`
        : `<b>怨灵附身中</b> · 第 ${g.count} 次 · 宿主「${esc(g.host || '待定')}」`
             + (g.nextHost && cd === 0 ? ` · 下一个:${esc(g.nextHost)}` : '');
    } else {
      L.hud.classList.remove('on');
    }
  },

  // ————— 怨灵状态机推进(由主循环调)—————
  tickGhost() {
    const e = COMPANION.tick();
    if (!e) return null;
    if (e.event === 'possess') {
      const host = COMPANION.s.ghost.host || e.host || '某只妖物';
      this.flash({
        t: '怨 灵 附 身',
        s: `宿主「${host}」`,
        c: `第 ${e.count} 次 · 全场妖物被强化`,
      });
    }
    if (e.event === 'revive') {
      this.bubble(`「我回来了。」${e.msg}`, 'dark');
    }
    return e;
  },
};