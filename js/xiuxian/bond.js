// ===== 灵伴 · 表现层 =====
//  · 贴边选项卡(kiss 路线)
//  · 自说自话气泡(cold / ghost)
//  · 怨灵闪屏特写(每 5 次,不打断)
//  · 篝火外强化怪标记 + 护栏内绝对安全提示
import { COMPANION } from './companion.js';
import { CAMP } from './camp.js';

const $ = (t,c,h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let L = {};

export const Bond = {
  init() {
    if (L.root) return;
    const r = $('div', 'xx-bond');
    r.innerHTML = `
      <div class="bd-hug" id="bd-hug">
        <div class="bd-line" id="bd-hug-line"></div>
        <div class="bd-opts" id="bd-hug-opts"></div>
      </div>
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
      hug:r.querySelector('#bd-hug'), hugLine:r.querySelector('#bd-hug-line'),
      hugOpts:r.querySelector('#bd-hug-opts'),
      bub:r.querySelector('#bd-bub'), flash:r.querySelector('#bd-flash'),
      ward:r.querySelector('#bd-ward'), hud:r.querySelector('#bd-ghost-hud'),
    };
    L.root.addEventListener('click', e => {
      const b = e.target.closest('[data-hug]');
      if (b) this.hugChoose(+b.dataset.hug);
    });
  },

  // ————— 贴边(有选项)—————
  showHug() {
    this.init();
    const h = COMPANION.hug();
    if (!h) return;
    L.hugLine.textContent = `${COMPANION.s.name}${h.line}`;
    L.hugOpts.innerHTML = h.choices.map((c,i)=>
      `<button class="bd-hug-opt" data-hug="${i}">${esc(c.text)}</button>`).join('');
    L.hug.classList.add('on');
    clearTimeout(L._ht);
    L._ht = setTimeout(()=>L.hug.classList.remove('on'), 22000);
  },
  hugChoose(i) {
    const say = COMPANION.hugChoose(i);
    if (!say) return;
    L.hug.classList.remove('on');
    this.bubble(say, 'ok');
  },

  // ————— 自说自话气泡 —————
  bubble(text, kind) {
    this.init();
    const b = L.bub;
    b.className = 'bd-bub on' + (kind === 'ok' ? ' ok' : kind === 'dark' ? ' dark' : '');
    b.textContent = text;
    clearTimeout(L._bt);
    L._bt = setTimeout(()=>b.classList.remove('on'), 3400);
  },
  // 根据路线自动说一句话
  idle() {
    if (COMPANION.s.route === 'cold') { this.bubble(COMPANION.cold()); return; }
    if (COMPANION.s.route === 'ghost' && Math.random() < 0.4) {
      this.bubble(COMPANION.ghostLine(), 'dark'); return;
    }
    const g = COMPANION.tryGift();
    if (g) this.bubble(`${COMPANION.s.name}：「给你。」${g.t}`, 'ok');
  },

  // ————— 怨灵闪屏特写(不打断游戏)—————
  flash(f) {
    this.init();
    L.root.querySelector('#bd-flash-t').textContent = f.t;
    L.root.querySelector('#bd-flash-s').textContent = f.s;
    L.root.querySelector('#bd-flash-c').textContent = f.c;
    L.flash.classList.remove('on'); void L.flash.offsetWidth;
    L.flash.classList.add('on');
    setTimeout(()=>L.flash.classList.remove('on'), 2300);
  },

  // ————— 篝火守卫 HUD —————
  tickWarden() {
    this.init();
    const w = COMPANION.wardenTick();
    if (!CAMP.burning()) { L.ward.classList.remove('on'); L.hud.classList.remove('on'); return; }
    L.ward.classList.add('on');
    L.ward.style.setProperty('--r', COMPANION.wardRadius() + 'px');
    L.ward.innerHTML = `<div class="bd-ward-t">源 石 护 栏</div>
      <div class="bd-ward-s">圈内绝对安全 · 圈外 ${w.count} 只强化妖物</div>`;
    // 怨灵倒计时
    const g = COMPANION.s.ghost;
    if (g.on) {
      const cd = COMPANION.reviveCountdown;
      L.hud.classList.add('on');
      L.hud.innerHTML = cd > 0
        ? `<b>怨灵已散</b> · ${cd}s 后附身「${esc(g.nextHost)}」`
        : `<b>怨灵附身中</b> · 第 ${g.poss} 次 · 宿主「${esc(g.hostName || '待定')}」`
             + (g.nextHost && cd === 0 ? ` · 下一个:${esc(g.nextHost)}` : '');
    }
  },

  // ————— 怨灵状态机推进(由主循环调)—————
  tickGhost() {
    const e = COMPANION.tick();
    if (!e) return null;
    if (e.event === 'possess') {
      COMPANION.s.ghost.hostName = COMPANION.s.ghost.nextHost || '某只妖物';
      COMPANION.s.ghost.nextHost = '';
      COMPANION.save();
      if (e.flash) { this.flash(e.flash); }
      else { this.bubble(COMPANION.ghostLine(), 'dark'); }
    }
    if (e.event === 'revive') {
      this.bubble(`「我回来了。」下一个:${e.msg.split('「')[2]||'未知'}`, 'dark');
    }
    return e;
  },
};
