// ===== 修仙阁 · 主界面 UI =====
// 五个标签:境界 / 地图 / 神通 / 人物 / 称号
// 契约:只读 Cult.s 并调用其已有函数,不改状态结构。

import { Cult } from './index.js';
import { REALMS, PILLS, getRealm, maxLayerOf, layerCost, canBreakthrough, doBreakthrough, addExp } from './realms.js';
import { ARTS, canEnlighten, enlighten } from './arts.js';
import { WORLD, nodeById, neighbors } from './world.js';
import { CHARACTERS, TITLES, WORLD as LORE } from './lore.js';
import { Duel } from './duel.js';
import { STONES, STONE_LIST, SCROLL_LIST, SCROLLS, GOODS, Bag, DAY, OVERFLOW_RATE, scrollForExp } from './items.js';
import { CAMP, CAMP_TIERS, offlineReport } from './camp.js';
import { Merchant } from './merchant.js';
import { ENCOUNTERS } from './lore.js';
import { COMPANION } from './companion.js';
import { Profile, Seed } from './profile.js';
import { FAMILY } from './family.js';
import { CHRONICLE } from './chronicle.js';
import { BUILD, FIELD_PERIOD } from './build.js';
import { BUILDINGS, BESTIARY, NPCS, TIERS, RICE } from './bestiary.js';

const PORTRAIT = { hero:'assets/portrait/hero.jpg', foe:'assets/portrait/foe.jpg', aunt:'assets/portrait/aunt.jpg' };
const TABS = [['realm','境界'],['map','大地图'],['camp','营地'],['arts','神通'],['bag','行囊'],['people','人物'],['title','称号'],['fam','家族'],['build','领地'],['dex','图鉴'],['sys','存档']];

let root, bodyEl, tab = 'realm';
let feedN = 1;   // 投石数量

const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const pct = (a, b) => b > 0 ? Math.min(100, Math.max(0, a / b * 100)) : 0;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function tierNeedText(nx){
  if(!nx) return '已达顶级。';
  const n=nx.need;
  return `晋升「${nx.name}」需:建筑 ${n.builds} · 人口 ${n.pop} · 篝火 ${n.fires}`;
}

function toast(msg) {
  let t = document.getElementById('xx-toast');
  if (!t) { t = $('div', 'xx-toast'); t.id = 'xx-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('on'));
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 1900);
}

export const Hall = {
  open() {
    if (!root) this.build();
    root.classList.remove('hidden');
    this.render();
  },
  close() { root && root.classList.add('hidden'); },
  isOpen() { return root && !root.classList.contains('hidden'); },

  // 离线收益弹层
  showOffline(o) {
    const el = document.createElement('div');
    el.className = 'xx-off';
    const sc = o.scroll;
    el.innerHTML = `<div class="xx-off-in">
      <h3>篝 火 仍 烧 着</h3>
      <div class="sub">你走后的 ${Math.floor(o.sec/60)} 分钟</div>
      <div class="xx-card"><div class="xx-label">道行</div><div class="xx-big">+${o.dao}</div></div>
      <div class="xx-card"><div class="xx-label">修为</div><div class="xx-big">+${o.exp}</div></div>
      ${o.stone ? `<div class="xx-card"><div class="xx-label">拾得</div>
        <div class="xx-val">${STONES[o.stone.id].name} ×${o.stone.n}</div></div>` : ''}
      ${sc ? `<div class="xx-card"><div class="xx-label">有人留下一卷</div>
        <div class="xx-val">${SCROLL_LIST.find(x=>x.id===sc.id)?.name || '传承书'}</div></div>` : ''}
      ${o.visitor ? `<div class="xx-card"><div class="xx-label">来了个人</div>
        <div class="xx-val">${esc(o.visitor.name)} · ${esc(o.visitor.title)}</div>
        <div class="xx-dim" style="margin-top:5px">${esc(o.visitor.line)}</div></div>` : ''}
      <button class="xx-btn main" style="margin-top:8px">收 下</button>
    </div>`;
    document.getElementById('app').appendChild(el);
    // 收益入账
    const s = Cult.get();
    s.dao += o.dao;
    addExp(s, o.exp);
    if (o.stone) Bag.add(o.stone.id, o.stone.n);
    if (sc) Bag.add(sc.id, sc.n || 1);
    Cult.commit();
    el.querySelector('button').onclick = () => el.remove();
    setTimeout(() => el.remove(), 14000);
  },

  build() {
    root = $('div', 'xx-screen hidden');
    root.innerHTML =
      `<div class="xx-head">
         <button class="xx-back" data-act="back">‹</button>
         <h2>修 仙 阁</h2>
         <div class="xx-realm" id="xx-realm-badge">炼气一层</div>
       </div>
       <div class="xx-tabs">${TABS.map(([k, n]) =>
         `<button class="xx-tab" data-tab="${k}">${n}</button>`).join('')}</div>
       <div class="xx-body" id="xx-body"></div>`;
    document.getElementById('app').appendChild(root);

    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act],[data-tab]');
      if (!b) return;
      if (b.dataset.tab) { tab = b.dataset.tab; this.render(); return; }
      this.act(b.dataset.act, b.dataset.v, b.dataset.v2);
    });
    bodyEl = root.querySelector('#xx-body');
  },

  act(a, v, v2) {
    const s = Cult.get();
    switch (a) {
      case 'back': this.close(); break;
      case 'meditate': {
        const g = addExp(s, 40);
        const yr = CHRONICLE.day();
        if (yr) { Cult.get().dao += 200; toast(`第${yr.year}年:${yr.ev}`); }
        Cult.commit(); this.render();
        if (!yr) toast(`吐纳 ${g} 点修为`);
        break;
      }
      case 'break': {
        const chk = canBreakthrough(s);
        if (!chk.ok) { toast(chk.msg || '时机未到'); return; }
        if (chk.needPill) {
          const p = PILLS[chk.needPill];
          if ((s.pills[chk.needPill] || 0) < 1) { toast(`缺 ${p.name},去秘境寻觅`); return; }
          s.pills[chk.needPill] -= 1;
        }
        const overflow = Math.max(0, s.exp);
        const r = doBreakthrough(s);
        // 溢出的修为不浪费 → 自动转成传承书
        let got = null;
        if (overflow > 200) {
          const conv = Math.floor(overflow * OVERFLOW_RATE);
          got = { id: scrollForExp(conv).id, exp: conv };
          Bag.add(got.id, 1);
        }
        DAY.tick();
        Cult.commit(); this.render();
        toast(got ? `突破 → ${r.realm}${r.layer}层 · 溢出化为${SCROLL_LIST.find(x=>x.id===got.id).name}`
                  : `突破成功 → ${r.realm}${r.layer}层`); break;
      }
      case 'buy': {
        const p = PILLS[v];
        if (!p) return;
        if (s.dao < p.price) { toast('道行不足'); return; }
        s.dao -= p.price;
        s.pills[v] = (s.pills[v] || 0) + 1;
        Cult.commit(); this.render(); toast(`购得 ${p.name} ×1`); break;
      }
      case 'travel': {
        const from = Cult.get().current;
        const path = neighbors(from);
        if (!path.includes(v)) { toast('路不通'); return; }
        Cult.get().current = v;
        Cult.get().visited[v] = true;
        Cult.commit();
        this.render();
        this.arrive(v); break;
      }
      case 'enlighten': this.doEnlighten(v, v2); break;

      // —— 营地 ——
      case 'light': {
        const r = CAMP.light(s.current);
        toast(r.msg);
        if (r.ok) setTimeout(() => { const f = CAMP.feed(); toast(f.msg); this.render(); }, 260);
        this.render(); break;
      }
      case 'douse': { const r = CAMP.douse(); toast(r.msg); this.render(); break; }
      case 'nfeed': feedN = Math.max(1, Math.min(99, feedN + Number(v))); this.render(); break;
      case 'feed': {
        const r = CAMP.feed(v || null, v ? feedN : null);
        toast(r.msg);
        if (r.ok && v === null) { /* 投了全部 */ }
        this.render(); break;
      }
      case 'gift': { const r = CAMP.gift(v); toast(r ? r.text : '他暂时没什么可给的。'); this.render(); break; }
      case 'teach': {
        const m = CAMP.s.members.find(x => x.uid === v);
        const pick = SCROLL_LIST.find(sc => sc.realm.includes('炼气')) || SCROLL_LIST[0];
        const r = CAMP.teach(v, pick.id);
        toast(r.msg); this.render(); break;
      }
      case 'sect': { const r = CAMP.foundSect(); toast(r.msg); this.render(); break; }
      case 'exch': {
        const ex = Bag.exchange(v);
        if (!ex) { toast('无法兑换'); break; }
        if (s.dao < ex.cost) { toast('道行不足'); break; }
        s.dao -= ex.cost;
        Bag.add(ex.scroll.id, 1);
        Cult.commit(); toast(`兑得 ${SCROLL_LIST.find(x=>x.id===ex.scroll.id).name} ×1`); this.render(); break;
      }
      case 'usegood': {
        const msg = Bag.use(v);
        Cult.commit();
        toast(msg || '无效'); this.render(); break;
      }
      case 'merchant': Merchant.maybeShow(); break;
      // —— 领地 ——
      case 'place': { const r=BUILD.place(v); toast(r.msg); this.render(); break; }
      // —— 灵米 / 领地 ——
      case 'harvest': { const r=BUILD.harvest(+v); toast(r.msg); this.render(); break; }
      case 'harvestall': {
        let got=0, n=0;
        BUILD.s.placed.forEach((p,i)=>{ if(p.bid==='bld_field'&&Date.now()>=p.plantAt){ const r=BUILD.harvest(i); if(r.ok){got+=r.n;n++;} } });
        toast(n? `收了 ${n} 块灵田,共 ${got} 斤` : '没有成熟的灵田。');
        this.render(); break;
      }
      case 'eat': { const r=BUILD.eatRice(v||1); toast(r.msg); this.render(); break; }
      case 'sell': { const r=BUILD.sellRice(v||1); toast(r.msg); this.render(); break; }
      case 'minenow': { const r=BUILD.mineYield(); toast(r.msg); this.render(); break; }
      case 'mine': { const r=BUILD.claimMine(v, v2); toast(r.msg); this.render(); break; }
      case 'tp': { const r=BUILD.teleportTo(v); toast(r.msg); this.render(); break; }
      case 'pact': { const r=BUILD.signPact('落云散修'); toast(r.msg); this.render(); break; }
      case 'slot': {
        const inv = Object.keys(BUILDINGS).filter(b=>Bag.count(b)>0);
        if(!inv.length){toast('没有可用建材');break;}
        const r = BUILD.place(inv[0], +v);
        toast(r.msg);
        if (r.ok && BUILD.s.placed[+v] && BUILD.s.placed[+v].bid==='bld_field') {
          const h = BUILD.harvest(+v); if (h.ok) setTimeout(()=>toast(h.msg), 300);
        }
        this.render(); break;
      }
      case 'binfo': {
        const i = +v; const chk = BUILD.canAssign(i);
        if(chk.ok){ const r=BUILD.assign(i, chk.free[0].uid); toast(r.msg); }
        else toast(chk.msg);
        this.render(); break;
      }
      case 'autofill': { const r=BUILD.autoFill(); toast(r.msg); this.render(); break; }
      case 'addfire': { const r=BUILD.addFire(s.current); toast(r.msg); this.render(); break; }
      case 'promote': { const r=BUILD.promote(); toast(r.msg); this.render(); break; }
      // —— 家族 ——
      case 'found': {
        const inp = document.getElementById('xx-famname');
        const nm = inp ? inp.value : (v || '轩氏');
        const r = FAMILY.found(nm);
        toast(r.msg); this.render(); break;
      }
      case 'fam': { const r=FAMILY.interact(v2,v); toast(r.msg); this.render(); break; }
      case 'feedrice': { const r=BUILD.feedRice(v2,1); toast(r.msg); this.render(); break; }
      case 'raise': { const r=FAMILY.raise(v); toast(r.msg); this.render(); break; }
      case 'birth': { const r=FAMILY.birth(); toast(r.msg); this.render(); break; }
      case 'yield': { const y=FAMILY.yieldDay();
        FAMILY.s.wealth += y.dao;
        Cult.get().dao += y.dao; Cult.get().exp += y.exp;
        if(y.stone) Bag.add('stone_1', y.stone);
        if(y.pill) Bag.s.items.pill_zhuji=(Bag.s.items.pill_zhuji||0)+y.pill;
        Cult.commit(); toast(`族产:道行+${y.dao} 源石+${y.stone} 丹+${y.pill} 修为+${y.exp}`);
        this.render(); break; }
      case 'call': { const r=FAMILY.callHelp(); toast(r.msg); this.render(); break; }
      case 'attack': { const r=FAMILY.resolveAttack(); toast(r.msg); this.render(); break; }
      case 'setseed': {
        const si = document.getElementById('xx-seed');
        const v = si ? si.value : '';
        Seed.set(v);
        Cult.commit(); this.render();
        toast(`新的一世:${Seed.cur}`); break;
      }
      case 'copycode': {
        const ta = document.getElementById('xx-code');
        ta.select();
        try { navigator.clipboard ? navigator.clipboard.writeText(ta.value)
          : document.execCommand('copy'); toast('存档码已复制'); }
        catch { toast('长按上方文字手动复制'); }
        break;
      }
      case 'import': {
        const ii = document.getElementById('xx-in');
        if (!ii) { toast('没有输入框'); break; }
        const r = Profile.import(ii.value);
        toast(r.msg);
        if (r.ok) setTimeout(() => location.reload(), 900);
        break;
      }
    }
  },

  // ---- 抵达节点:村庄休整 / 野地自动遭遇 / 强敌才打断 ----
  // 设计:普通地图内容自动播放、不打断操作。只有 elite/secret/boss 才进回合制。
  arrive(id) {
    const s = Cult.get();
    const n = nodeById(id);
    if (!n) return;

    // 村庄:不战斗,给休整
    if (n.type === 'village') { this.render(); toast('炊烟袅袅。歇一会儿。'); return; }

    // 荒野/野地:自动遭遇,直接结算,不打断
    if (n.type === 'field') {
      const gain = 20 + Math.floor(Math.random() * 40) + s.layer * 6;
      s.dao += gain; s.totalKills += 1;
      addExp(s, 30 + Math.floor(Math.random() * 40));
      const herb = Math.random() < 0.12;
      if (herb) { s.pills.pill_zhuji = (s.pills.pill_zhuji || 0) + 1; }
      Cult.commit();
      Cult.titles.track('challenge', 1);
      if (Math.random() < 0.2) Cult.titles.track('spare', 1);
      Cult.titles.track('rescue', 1);
      DAY.tick();
      const st = Bag.rollStone(0);
      if (st) Bag.add(st.id, st.n);
      Cult.commit();
      Merchant.maybeShow();
      // 奇遇判定(后台推进,不打断)
      const enc = this.rollEncounter(s);
      this.render();
      const encTxt = enc ? ` · ${enc.name}` : '';
      toast(`遭遇散妖,道行 +${gain}`
        + (herb ? ' · 拾得七叶草' : '')
        + (st ? ` · ${STONES[st.id].name}×${st.n}` : '')
        + encTxt);
      if (enc) this.logEncounter(enc, s);
      return;
    }

    // 险地 / 秘境 / 妖巢:才打断,进回合制
    Duel.start({
      node: n,
      hero: { name:'轩轩', img: PORTRAIT.hero, realmIdx: REALMS.findIndex(r => r.id === s.realm) },
      foe: this.makeFoe(n, s),
      onWin: (r) => {
        const s2 = Cult.get();
        s2.dao += r.dao; s2.totalKills += 1;
        if (r.pill) s2.pills[r.pill] = (s2.pills[r.pill] || 0) + 1;
        addExp(s2, r.exp);
        Cult.commit();
        Cult.titles.track('challenge', 1);
        DAY.tick();
        // 源石掉落:按节点层级,只有 Boss 才给高阶
        const lvl = n.type === 'boss' ? 3 : n.type === 'secret' ? 2 : 1;
        const st = Bag.rollStone(lvl);
        if (st) Bag.add(st.id, st.n);
        Cult.commit();
        const stoneTxt = st ? ` · 得${STONES[st.id].name}×${st.n}` : '';
        toast(`胜!道行 +${r.dao}${r.pill ? ' · 得丹' : ''}${stoneTxt}`);
        Merchant.maybeShow();
        const enc = this.rollEncounter(s2);
        this.render();
        if (enc) this.logEncounter(enc, s2);
      },
      onLose: (choice) => { this.applyDefeat(choice); },
    });
  },

  // 按玩家境界匹配敌人强度 —— 不是固定数值
  makeFoe(n, s) {
    const pIdx = REALMS.findIndex(r => r.id === s.realm);
    const isBoss = n.type === 'boss';
    const isElite = n.type === 'elite';
    // 越境压迫:精英/首领有概率出现高于玩家的对手
    const stronger = isBoss || (isElite && Math.random() < 0.4);
    const foeIdx = Math.max(0, Math.min(REALMS.length - 1,
      pIdx + (stronger ? 1 : 0)));
    const foes = isBoss ? [[LORE.CHARACTERS.moying.name, LORE.CHARACTERS.moying.title, 'foe', true]]
      : [['黑风散修','炼气中期','foe', false], ['守谷妖修','妖修','aunt', false],
         ['游方剑客','筑基初期','foe', false]];
    const pick = foes[Math.floor(Math.random() * foes.length)];
    return {
      name: pick[0], title: pick[1],
      img: isBoss ? PORTRAIT.foe : (pick[2] === 'aunt' ? PORTRAIT.aunt : PORTRAIT.foe),
      realmIdx: foeIdx,
      stronger: foeIdx > pIdx,
      isNemesis: !!pick[3],
    };
  },

  // 战败结算:不清档,四选一
  applyDefeat(choice) {
    const s = Cult.get();
    const pIdx = REALMS.findIndex(r => r.id === s.realm);
    const foe = { title: '对手' };
    const r = Cult.defeat.resolve(foe, s, {
      ransom: choice === 'ransom',
      installment: choice === 'installment',
      resist: choice === 'resist',
      debt: 300,
    });
    const e = r.effect;
    if (e.realmDamage) {
      // 跌一大境(至少炼气一层)
      if (pIdx > 0) { s.realm = REALMS[pIdx - 1].id; s.layer = Math.max(1, maxLayerOf(s.realm) - 2); }
      else s.layer = Math.max(1, s.layer - 3);
      s.exp = 0;
    }
    if (e.demon) { Cult.titles.track('demon', e.demon); }
    if (e.debt) s.debt = e.debt;
    if (e.daoLoss) s.dao = Math.floor(s.dao * (1 - e.daoLoss));
    Cult.commit();
    this.render();
  },

  // ---- 悟道:选两门满级神通融合 ----
  picking: null,
  doEnlighten(a, b) {
    if (this.picking) {
      const first = this.picking; this.picking = null;
      if (first === a) { this.render(); return; }
      const chk = canEnlighten(Cult.get(), first, a);
      if (!chk.ok) { toast(chk.msg); this.render(); return; }
      const r = enlighten(Cult.get(), first, a);
      if (r.ok) {
        Cult.commit();
        const outName = ARTS[r.out] ? ARTS[r.out].name : r.out;
        toast(`悟道!${outName} — ${r.rec.rule}`);
        Cult.titles.track('sword_all_max', ARTS[r.out] && ARTS[r.out].family === 'sword' ? 1 : 0);
      }
      this.render(); return;
    }
    this.picking = a; this.render();
  },

  render() {
    if (!bodyEl) return;
    const s = Cult.get();
    const r = getRealm(s.realm);
    root.querySelector('#xx-realm-badge').textContent = `${r.name}${s.layer}层`;
    root.querySelectorAll('.xx-tab').forEach(t =>
      t.classList.toggle('on', t.dataset.tab === tab));
    bodyEl.innerHTML =
      tab === 'realm' ? this.vRealm(s)
      : tab === 'map'   ? this.vMap(s)
      : tab === 'camp'  ? this.vCamp(s)
      : tab === 'bag'   ? this.vBag(s)
      : tab === 'arts'  ? this.vArts(s)
      : tab === 'people'? this.vPeople(s)
      : tab === 'fam'   ? this.vFam()
      : tab === 'build' ? this.vBuild()
      : tab === 'dex'   ? this.vDex()
      : tab === 'sys'   ? this.vSys()
      : this.vTitle(s);
  },

  // ---------- 奇遇(后台推进,不打断操作) ----------
  rollEncounter(s) {
    if (Math.random() > 0.34) return null;
    const pool = ENCOUNTERS.filter(e => e.type !== 'choice');
    if (!pool.length) return null;
    let total = pool.reduce((a,e)=>a+e.weight,0);
    let r = Math.random() * total, pick = pool[0];
    for (const e of pool) { r -= e.weight; if (r <= 0) { pick = e; break; } }
    const fx = pick.effect || {};
    if (fx.dao) s.dao += fx.dao;
    if (fx.insight) s.insight = (s.insight||0) + fx.insight;
    if (fx.herb) s.pills.pill_zhuji = (s.pills.pill_zhuji||0) + fx.herb;
    if (fx.hp === 1) s.hp = (s.hp||0) + 1;   // 标记
    if (fx.demonSeed) COMPANION.addAff(-2);  // 败者之剑:亲密度微降
    Cult.commit();
    return pick;
  },
  logEncounter(enc, s) {
    const log = s.encLog || (s.encLog = []);
    log.unshift({ id:enc.id, name:enc.name, text:enc.text, log:enc.log, t:Date.now() });
    if (log.length > 40) log.length = 40;
    Cult.commit();
  },

  // ---------- 境界 ----------
  vRealm(s) {
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
          <button class="xx-btn" style="width:auto;margin:0;padding:8px 16px;font-size:13px"
            data-act="buy" data-v="${id}">购</button>
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
      <button class="xx-btn" data-act="meditate">吐 纳 修 炼</button>
      <button class="xx-btn main" data-act="break" ${chk.ok ? '' : 'disabled'}>
        ${chk.needPill ? `服 ${PILLS[chk.needPill]?.name || '丹'} 突 破` : '突 破'}
        ${chk.ok ? '' : `<div class="xx-dim" style="letter-spacing:0;margin-top:4px">${esc(chk.msg || '')}</div>`}
      </button>
      <div style="height:12px"></div>
      <div class="xx-label">丹 药</div>${pills}`;
  },

  // ---------- 地图 ----------
  vMap(s) {
    const g = WORLD.grid;
    const pos = n => ({ x: 6 + (n.x - 1) / (g - 1) * 88, y: 8 + (n.y - 1) / (g - 1) * 86 });
    let nodes = '', edges = '';
    for (const e of WORLD.edges) {
      const a = nodeById(e[0]), b = nodeById(e[1]);
      const pa = pos(a), pb = pos(b);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
      edges += `<div class="xx-edge" style="left:${pa.x}%;top:${pa.y}%;
        width:${len}%;transform:rotate(${ang}deg)"></div>`;
    }
    for (const n of WORLD.nodes) {
      const p = pos(n);
      const t = { village:'🏘', field:'🌾', elite:'⛰', secret:'💎', boss:'☠' }[n.type] || '•';
      const cls = ['xx-node'];
      if (s.visited[n.id]) cls.push('visited');
      if (s.current === n.id) cls.push('cur');
      const adj = neighbors(s.current).includes(n.id);
      if (!adj && s.current !== n.id) cls.push('locked');
      const isMine = ['secret','elite','boss'].includes(n.type) && !BUILD.s.land.includes(n.id) && s.current !== n.id;
      const canTp  = BUILD.canTeleport() && s.visited[n.id] && s.current !== n.id;
      nodes += `<div class="${cls.join(' ')}" style="left:${p.x}%;top:${p.y}%"
        data-act="travel" data-v="${n.id}" title="${esc(n.name || '')}">
        ${t}<div class="xx-node-lb">${esc(n.name || n.id)}</div>
        ${isMine?`<div class="xx-node-mine" data-act="mine" data-v="${n.id}" data-v2="${n.type}">占</div>`:''}
        ${canTp?`<div class="xx-node-tp" data-act="tp" data-v="${n.id}">传</div>`:''}
        </div>`;
    }
    const cur = nodeById(s.current);
    const typeName = { village:'村庄', field:'荒野', elite:'险地', secret:'秘境', boss:'妖巢' }[cur.type] || '';
    const meta = { village:'可休整、炼丹、悟道', field:'散妖游荡',
      elite:'有强敌蛰伏,可能触发回合制', secret:'藏宝之地,盛产丹药', boss:'大能坐镇,必逢回合' }[cur.type] || '';
    return `<div class="xx-map">${edges}${nodes}</div>
      <div class="xx-card" style="margin-top:14px">
        <div class="xx-label">当前位置</div>
        <div class="xx-val">${esc(cur.name || cur.id)} · ${typeName}</div>
        <div class="xx-dim" style="margin-top:5px">${meta}</div>
      </div>
      <div class="xx-dim" style="text-align:center;line-height:1.9">
        点亮相邻节点即可前往 · 秘境界/妖巢点「占」纳入领地开矿<br>
        ${BUILD.canTeleport() ? `阵法旗已立,可点「传」前往已到之处(每次 ${BUILD.teleportCost()} 道行)` : '领地至村落LV2 可布阵法旗传送'}</div>`;
  },

  // ---------- 神通 / 悟道 ----------
  vArts(s) {
    const owned = Object.keys(s.arts).filter(k => s.arts[k] > 0);
    const full = owned.filter(k => s.arts[k] >= 5);
    let h = '';
    if (this.picking) {
      h += `<div class="xx-card"><div class="xx-label">悟 道</div>
        <div class="xx-val">已选「${ARTS[this.picking]?.name}」,再选一门满级神通</div>
        <div class="xx-dim" style="margin-top:5px">道行消耗视配方而定,融合后二者各降一级</div></div>`;
    } else {
      h += `<div class="xx-card">
        <div class="xx-label">悟 道</div>
        <div class="xx-val">两门神通皆修至满级(5级)可融合出超武</div>
        <div class="xx-dim" style="margin-top:5px">
          满级神通 ${full.length} / 14 门 · 当前道行 ${s.dao}</div></div>`;
    }
    const grid = Object.entries(ARTS).map(([k, a]) => {
      const lv = s.arts[k] || 0;
      const cls = ['xx-art'];
      if (!lv) cls.push('lock');
      if (lv >= a.max) cls.push('max');
      if (a.fused) cls.push('fused');
      const sel = this.picking === k;
      return `<div class="${cls.join(' ')}" ${lv ? `data-act="enlighten" data-v="${k}"` : ''}>
        ${a.fused ? '<span class="xx-tag">超武</span>' : lv >= a.max ? '<span class="xx-tag gold">满</span>' : ''}
        <div class="xx-art-n">${esc(a.name)}</div>
        <div class="xx-art-b">${lv || '—'}</div>
        <div class="xx-art-lv">${sel ? '已选' : a.d.slice(0, 6)}</div>
      </div>`;
    }).join('');
    return h + `<div class="xx-grid3">${grid}</div>`;
  },

  // ---------- 营地 ----------
  vCamp(s) {
    const burning = CAMP.burning();
    const t = CAMP.tier(), nx = CAMP.next();
    const d = DAY.phase();
    const fuel = CAMP.fuelMin();
    const maxF = CAMP.maxFuel();
    const barW = maxF > 0 ? Math.min(100, fuel / (maxF + fuel) * 100) : 0;

    let stones = '';
    if (burning) {
      stones = STONE_LIST.filter(x => Bag.count(x.id) > 0).map(x => `
        <div class="xx-stone has" data-act="feed" data-v="${x.id}">
          <div class="xm-"></div><div class="xx-stone-m">${Bag.count(x.id)}</div>
          <div class="xx-stone-n" style="color:${x.col}">${x.name}</div>
          <div class="xx-stone-d">${x.dur} 分钟</div>
          <div class="xx-stone-c">投 ${feedN}</div>
        </div>`).join('') ||
        '<div class="xx-dim" style="text-align:center;padding:10px">没有源石了 —— 源石只能靠猎妖、秘境外加兑换。</div>';
    }

    const mem = CAMP.s.members.length
      ? CAMP.s.members.map(m => `
        <div class="xx-mem">
          <div class="a">
            <div class="n">${esc(m.name)}<span class="xx-dim" style="margin-left:6px">${esc(m.title)}</span></div>
            <div class="t">修为 ${m.lv} 层 · 已赠 ${m.gift}/3</div>
          </div>
          <div class="act">
            <button class="xx-mbtn" data-act="gift" data-v="${m.uid}">讨谢礼</button>
            <button class="xx-mbtn" data-act="teach" data-v="${m.uid}">授传承</button>
          </div>
        </div>`).join('')
      : '<div class="xx-dim">还没有人留下。营地的名声要靠时间传出去。</div>';

    return `
      <div class="xx-fire ${burning ? 'on' : ''}">
        <div class="xx-fire-t">${burning ? '火 还 烧 着' : '尚 无 篝 火'}</div>
        <div class="xx-fire-s">${burning ? `余 ${fuel} 分钟 · ${esc(t.name)} LV${t.lv}` : '需要一枚源石'}</div>
      </div>

      <div class="xx-card">
        <div class="xx-label">昼 夜</div>
        <div class="xx-daynow">${d.name} · ${d.desc}</div>
        <div class="xx-daybar"></div>
        <div class="xx-dim">夜间挂机收益 ×1.35,但没有火会更危险。</div>
      </div>

      <div class="xx-card">
        <div class="xx-label">源 石(${Bag.stoneMinutes()} 分钟)</div>
        ${burning
          ? `<div class="xx-bar s"><i style="width:${barW}%"></i></div>
             <div class="xx-dim" style="margin:6px 0 10px">烧完为止。当前容量 ${maxF} 分钟。</div>
             <div class="xx-numrow">
               <button class="xx-nbtn" data-act="nfeed" data-v="-1">−</button>
               <div class="xx-val">${feedN}</div>
               <button class="xx-nbtn" data-act="nfeed" data-v="1">＋</button>
             </div>
             <div class="xx-stones">${stones}</div>
             <button class="xx-btn" style="margin-top:10px" data-act="feed">全 部 投 入</button>
             <button class="xx-btn" data-act="douse">熄 火</button>`
          : `<button class="xx-btn main" data-act="light">生 火 · 投入现有源石</button>`}
      </div>

      <div class="xx-card">
        <div class="xx-label">营 地</div>
        <div class="xx-val">${t.name} · LV${t.lv}</div>
        <div class="xx-dim" style="margin-top:5px">${t.d}</div>
        ${nx ? `<div class="xx-bar jade"><i style="width:${Math.min(100, CAMP.s.totalSec / nx.need * 100)}%"></i></div>
          <div class="xx-dim" style="margin-top:5px">距「${nx.name}」还需燃烧 ${Math.ceil((nx.need - CAMP.s.totalSec)/60)} 分钟 · 声望 ${CAMP.s.rep}</div>`
          : '<div class="xx-gold" style="margin-top:6px">已至顶级。</div>'}
        ${CAMP.tier().lv >= 4 ? '<div class="xx-dim">阵旗已成:此营地可作方圆传送点(传送一次 ' + CAMP.teleportCost() + ' 道行)。</div>' : ''}
      </div>

      <div class="xx-card">
        <div class="xx-label">人 员 (${CAMP.s.members.length})</div>
        ${mem}
      </div>

      ${CAMP.tier().lv >= 5 ? `<button class="xx-btn main" data-act="sect">${CAMP.s.formed ? '宗门已成' : '立 宗'}</button>`
        : '<div class="xx-dim" style="text-align:center">营地经营至「山门」并持家族令,可自立宗门。</div>'}

      <div style="height:10px"></div>
      <button class="xx-btn" data-act="merchant">招 呼 路 过 的 商 人</button>`;
  },

  // ---------- 家族 ----------
  vFam() {
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
        <button class="xx-btn main" data-act="found">立 族</button></div>`;
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
          ${FAMILY.RAISED.map(k=>`<button class="xx-btn" style="margin:0;padding:10px;font-size:12px;letter-spacing:1px"
            data-act="raise" data-v="${k.key}">${k.name}</button>`).join('')}
        </div>
      </div>

      <div class="xx-grid">
        <button class="xx-btn" data-act="birth" ${FAMILY.canBirth()?'':'disabled'}>延 续 香 火</button>
        <button class="xx-btn" data-act="yield">族 产 结 算</button>
        <button class="xx-btn" data-act="call">求 援 友 盟</button>
        <button class="xx-btn" data-act="attack">巡 视 领 地</button>
      </div>
      <div class="xx-dim" style="text-align:center">
        繁衍需两名未婚族人 + 200 资产 · 领地越多,被围攻越频繁,战力要求越高</div>`;
  },

  // ---------- 领地建造 ----------
  // ---------- 领地建造 ----------
  vBuild() {
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
          <button class="xx-btn" style="margin:0;padding:10px;font-size:12px;letter-spacing:1px"
            data-act="harvestall">收起全部</button>
          <button class="xx-btn" style="margin:0;padding:10px;font-size:12px;letter-spacing:1px"
            data-act="eat" data-v="1">生吞一斤</button>
          <button class="xx-btn" style="margin:0;padding:10px;font-size:12px;letter-spacing:1px"
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
        <button class="xx-btn" data-act="pact" ${BUILD.canPact()?'':'disabled'}>缔 结 同 盟</button>
      </div>

      <button class="xx-btn main" data-act="promote" ${pk.ok?'':'disabled'}>
        晋 升 为「${nx ? nx.name : '顶级'}」${pk.ok?'':`<div class="xx-dim" style="letter-spacing:0;margin-top:4px">${esc(pk.msg)}</div>`}
      </button>`;
  },

  // ---------- 图鉴(怪物 + NPC)----------
  vDex() {
    const cs = COMPANION.s;
    const form = cs.route === 'kiss' ? 'baby' : cs.route === 'cold' ? 'ghostfire' : cs.route === 'ghost' ? 'revenant' : null;
    const order = ['ghostfire','revenant','baby','momocha','merchant','moying'];
    return `
      <div class="xx-card"><div class="xx-label">灵 伴 三 形</div>
        <div class="xx-dim">同一段因果,三条路。三种形态,三种待遇。</div></div>
      ${order.map(k=>{
        const n = NPCS[k];
        const mine = k === form;
        return `<div class="xx-dxx ${mine?'mine':''}">
          <img src="${n.img}" alt="">
          <div class="xx-dxx-b">
            <div class="xx-dxx-n">${esc(n.name)}<span>${esc(n.form)}</span>${mine?'<em>你当前</em>':''}</div>
            <div class="xx-dxx-d">${esc(n.desc)}</div>
            <div class="xx-dxx-b2">${esc(n.ability)}</div>
            ${n.threat && n.threat!=='无' ? `<div class="xx-dxx-t">威胁:${esc(n.threat)}</div>` : ''}
          </div>
        </div>`;
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
  },

  // ---------- 存档(种子 / 存档码)----------
  vSys() {
    const code = Profile.export();
    return `
      <div class="xx-card">
        <div class="xx-label">世 界 种 子</div>
        <div class="xx-big">${esc(Seed.cur)}</div>
        <div class="xx-dim" style="margin-top:6px">
          同一种子 = 同一个世界:奇遇、掉落、商人、怨灵、营地来客,全部一致。
          换种子 = 换一世。存档只存进度,不存世界,所以很省。
        </div>
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
        灵伴 · ${esc(COMPANION.s.name || '未遇')}(${({kiss:'相守',cold:'冷淡',ghost:'纠缠'})[COMPANION.s.route] || '—'})<br>
        称号 · ${Cult.titles.list().length} 枚
      </div>`;
  },

  // ---------- 行囊 ----------
  vBag() {
    const items = Bag.s.items || {};
    const keys = Object.keys(items).filter(k => items[k] > 0);
    let h = `<div class="xx-card">
      <div class="xx-label">道 行</div><div class="xx-big">${Cult.get().dao}</div>
      <div class="xx-dim" style="margin-top:5px">可用道行兑换源石与传承书 —— 比商人便宜,但不打折。</div>
    </div>`;
    if (!keys.length) return h + '<div class="xx-dim" style="text-align:center">空空如也。去打点东西回来。</div>';
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
  },

  // ---------- 人物 ----------
  vPeople() {
    return Object.values(CHARACTERS).map(c => `
      <div class="xx-ch">
        <img src="${PORTRAIT[c.portrait] || PORTRAIT.hero}" alt="">
        <div>
          <h4>${esc(c.name)} <span class="xx-dim" style="font-size:11px">${esc(c.role)}</span></h4>
          <div class="t">${esc(c.title)}</div>
          <p>${esc(c.bio)}</p>
          <p class="xx-gold" style="margin-top:5px">${esc(c.arc)}</p>
        </div>
      </div>`).join('')
      + (Cult.get().encLog && Cult.get().encLog.length ? `
        <div class="xx-card"><div class="xx-label">行 脚 日 记</div>
        ${Cult.get().encLog.slice(0,6).map(e => `
          <div style="margin-bottom:9px">
            <div class="xx-val" style="font-size:13px;color:var(--xx-gold)">${esc(e.name)}</div>
            <div class="xx-dim" style="margin-top:2px">${esc(e.text)}</div>
            <div class="xx-dim" style="color:var(--xx-jade)">${esc(e.log)}</div>
          </div>`).join('')}
        </div>` : '')
      + `<div class="xx-card"><div class="xx-label">世 界</div>
        <div class="xx-val">${esc(LORE.title)} · ${esc(LORE.era)}</div>
        <div class="xx-dim" style="margin-top:6px">${esc(LORE.intro)}</div></div>
        ${LORE.rules.map(r => `<div class="xx-dim" style="padding:4px 0">· ${esc(r)}</div>`).join('')}`;
  },

  // ---------- 称号 ----------
  vTitle() {
    const got = Cult.titles.list();
    return TITLES.map(t => {
      const on = got.includes(t.id);
      return `<div class="xx-title-i ${on ? 'on' : 'off'}">
        <div class="xx-seal">${on ? '印' : '？'}</div>
        <div style="flex:1">
          <div style="color:${on ? 'var(--xx-gold)' : 'var(--xx-paper)'};letter-spacing:2px">${esc(t.name)}</div>
          <div class="xx-dim">${on ? esc(t.desc) : esc(t.cond)}</div>
        </div>
      </div>`;
    }).join('');
  },
};
