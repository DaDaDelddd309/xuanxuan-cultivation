// ===== 流浪商人 · 侧边滑入闪卡 =====
// 要求(照做的):
//  · 一闪而过 —— 右侧滑入、停留、到时自动走人
//  · 不打断、不暂停 —— 卡片浮在最上层,底下照样打怪赶路
//  · 可以不管 —— 不点就自己消失,没有强制
//  · 气派 —— 玄黑漆底金字,像从画里走出来的行商

import { STONES, SCROLLS, GOODS, Bag } from './items.js';
import { PAL } from '../core/palette.js';
import { Cult } from './index.js';
import { STORY } from './story.js';

let root, timer, hideTimer;

const fmt = n => n >= 10000 ? (n/10000).toFixed(1) + '万' : String(n);

const TITLES = [
  '云游散商','黑市老鬼','落云货郎','西荒行脚','断魂镖局 · 客卿',
  '无名货郎','四海行商','道旁茶主','负山客 · 凭证人','旧朝遗商',
];
const LINES = [
  '「客官,看一眼?不看不勉强。」',
  '「今日路过贵地,这些东西搁我这儿也是压箱底。」',
  '「源石不多了。要么?不要我就走了。」',
  '「我从不骗人,只骗贪心的人。」',
  '「这笔买卖,做完我就出山。」',
];

function goods(s, seedRole) {
  const sdao = Cult.get().dao;
  const list = [];
  // 必卖:源石(商人自己也卖源石,但比兑换贵,因为他赚差价)
  const cheap = sdao < 3000;
  for (const st of Object.values(STONES)) {
    if (st.tier > (cheap ? 2 : 4)) continue;
    list.push({ kind:'stone', id:st.id, name:st.name, col:st.col,
      desc:`燃烧 ${st.dur} 分钟`, price: Math.round(st.dur * (cheap ? 9 : 15)), tier:st.tier });
  }
  // 传承书:贵的商人出好货
  for (const sc of Object.values(SCROLLS)) {
    if (sc.exp > (cheap ? 2600 : 52000) * 8) continue;
    if (Math.random() < 0.45) continue;
    list.push({ kind:'scroll', id:sc.id, name:sc.name, col:sc.col,
      desc:`${sc.realm} · +${fmt(sc.exp)} 修为`, price: Math.round(sc.exp * 0.16) });
  }
  // 杂物
  for (const g of Object.values(GOODS)) {
    if (g.price > (cheap ? 3000 : 60000)) continue;
    if (Math.random() < 0.5) continue;
    list.push({ kind:'good', id:g.id, name:g.name, col:g.col, desc:g.d, price:g.price });
  }
  return list;
}

export const Merchant = {
  s: { visits:0, lastAt:0 },
  root: null,

  load() { try { const r=localStorage.getItem('xx_merch_v080'); if(r) this.s={...this.s,...JSON.parse(r)}; }catch{} return this.s; },
  save() { try { localStorage.setItem('xx_merch_v080', JSON.stringify(this.s)); }catch{} },

  // 每 N 次行动可能遇到一次
  maybeShow() {
    const now = Date.now();
    // V0.94:90 秒太勤,加上叙事卡/横幅后屏幕上会同时有两三个浮层
    if (now - this.s.lastAt < 260000) return;  // 4 分 20 秒内不来第二次
    if (Math.random() < 0.74) return;           // 出现概率也调低
    this.s.lastAt = now;
    this.s.visits++;
    this.save();
    this.show();
  },

  show() {
    if (!this.root) this.build();
    const title = TITLES[Math.floor(Math.random()*TITLES.length)];
    const line  = LINES[Math.floor(Math.random()*LINES.length)];
    const list  = goods(this.s);
    this.root.querySelector('#xm-title').textContent = title;
    // 商人会念流言(优先念世界里的传闻)
    const rumor = STORY.takeRumor();
    this.root.querySelector('#xm-line').textContent = rumor
      ? `「${rumor}」` : line;
    this.root.querySelector('#xm-list').innerHTML = list.map(g => `
      <div class="xm-item" data-buy="${g.id}" data-price="${g.price}">
        <div class="xm-n" style="color:${g.col}">${g.name}</div>
        <div class="xm-d">${g.desc}</div>
        <div class="xm-p">${fmt(g.price)} 道行</div>
      </div>`).join('');
    this.root.classList.add('on');
    // 到时自动走人(不影响游戏)
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => this.hide(), 24000);
  },

  hide() {
    clearTimeout(hideTimer);
    this.root && this.root.classList.remove('on');
  },

  build() {
    root = document.createElement('div');
    root.className = 'xm-card';
    root.innerHTML = `
      <div class="xm-head">
        <span class="xm-seal">货</span>
        <div><div class="xm-title" id="xm-title">云游散商</div>
        <div class="xm-sub">过 路 · 不 强 求</div></div>
        <button class="xm-x" id="xm-close" aria-label="走开">×</button>
      </div>
      <div class="xm-line" id="xm-line"></div>
      <div class="xm-list" id="xm-list"></div>
      <div class="xm-foot"><span id="xm-dao"></span><button id="xm-leave">谢绝,慢走</button></div>`;
    document.getElementById('app').appendChild(root);
    this.root = root;

    root.querySelector('#xm-close').onclick = () => this.hide();
    root.querySelector('#xm-leave').onclick = () => this.hide();
    root.querySelector('#xm-list').addEventListener('click', e => {
      const b = e.target.closest('[data-buy]');
      if (!b) return;
      const id = b.dataset.buy, price = Number(b.dataset.price);
      const s = Cult.get();
      if (s.dao < price) { this.tip('道行不够。', true); return; }
      s.dao -= price;
      Bag.add(id, 1);
      Cult.commit();
      this.tip(`买下 ${b.querySelector('.xm-n').textContent}`);
      b.style.opacity = '.3';
      b.style.pointerEvents = 'none';
      this.refreshDao();
    });
    this.refreshDao();
    setInterval(() => { if (this.root && this.root.classList.contains('on')) this.refreshDao(); }, 4000);
  },

  refreshDao() {
    const el = this.root && this.root.querySelector('#xm-dao');
    if (el) el.textContent = `你有 ${fmt(Cult.get().dao)} 道行`;
  },

  tip(msg, bad) {
    if (!this.root) return;
    let t = this.root.querySelector('.xm-toast');
    if (!t) { t = document.createElement('div'); t.className = 'xm-toast'; this.root.appendChild(t); }
    t.textContent = msg;
    t.style.color = bad ? '#e06a4a' : PAL.gold;
    t.classList.add('on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('on'), 1600);
  },
};