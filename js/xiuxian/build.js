// ===== 领地建造 · 放置 / 值守 / 产出 / 晋升 =====
// 设计参考《明日之后》聚落、《风起之地》营地、《99 Nights》篝火升级:
//  · 篝火是核心,建筑摆在篝火辐射范围内,共享资源
//  · 最多 6 格(随领地阶位解锁)
//  · 建造时空 = 幻境,无怪,可随意放置
//  · 每个建筑派族人值守,人数越多效率越高
//  · 灵田按 10 分钟一熟,产量受 族人属性 + 区域怪物密度 影响
//  · 晋升看 建筑数 + 人口 + 篝火数

import { BUILDINGS, TIERS } from './bestiary.js';
import { CAMP } from './camp.js';
import { FAMILY } from './family.js';
import { Cult } from './index.js';
import { Bag, DAY } from './items.js';

const K = 'xx_build_v083';
export const FIELD_PERIOD = 10 * 60 * 1000;   // 灵田 10 分钟一熟(按需求)

export const BUILD = {
  s: {
    placed: [],        // [{bid, slot, x, y, workers:[uid], plantAt, ready}]
    fires: [],         // 篝火坐标(多篝火 → 晋升条件)
    tierLv: 1,
    incomeAt: 0,       // 集市/演武场 结算时间戳
  },

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) {
        const d = JSON.parse(r) || {};
        const def = { placed:[], fires:[], tierLv:1, incomeAt:0 };
        this.s = { ...def, ...d };
        if (!Array.isArray(this.s.placed)) this.s.placed = [];
        if (!Array.isArray(this.s.fires)) this.s.fires = [];
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // —— 阶位 ——
  tier() {
    let t = TIERS[0];
    for (const x of TIERS) if (this.s.tierLv >= x.lv) t = x;
    return t;
  },
  nextTier() { return TIERS.find(x => x.lv === this.tier().lv + 1) || null; },
  // 死锁保护:晋升所需建筑数不得超过当前槽位(否则永远升不了)
  _needOf(nx) {
    if (!nx) return null;
    return { ...nx.need, builds: Math.min(nx.need.builds, this.slots()) };
  },
  slots() { return this.tier().slots; },
  fireCount() { return Math.max(1, this.s.fires.length || (CAMP.burning() ? 1 : 0)); },

  // —— 放置 ——
  canPlace(bid) {
    if (!BUILDINGS[bid]) return { ok:false, msg:'无此建筑' };
    const inv = Bag.count(bid) || 0;
    if (inv <= 0) return { ok:false, msg:`没有${BUILDINGS[bid].name}(需击杀特定怪物掉落)` };
    if (this.s.placed.length >= this.slots()) {
      return { ok:false, msg:`位置已满(${this.slots()}/${this.slots()}),晋升领地可扩建` };
    }
    return { ok:true };
  },
  place(bid, slot) {
    const chk = this.canPlace(bid);
    if (!chk.ok) return chk;
    Bag.take(bid, 1);
    const b = BUILDINGS[bid];
    const inst = {
      bid, slot: slot ?? this.s.placed.length,
      workers: [], plantAt: 0, ready: 0, x: 0, y: 0, at: Date.now(),
    };
    this.s.placed.push(inst);
    this.save();
    return { ok:true, inst, msg:`${b.name} 已放置。点它派人值守。` };
  },
  remove(i) {
    const it = this.s.placed[i];
    if (!it) return { ok:false };
    this.s.placed.splice(i, 1);
    Bag.add(it.bid, 1);       // 拆除全额返还
    this.save();
    return { ok:true, msg:`${BUILDINGS[it.bid].name} 已拆除,材料返还。` };
  },

  // —— 值守(多派人 → 效率提升)——
  // 效率公式:单人 1.0,两人 1.6,三人 2.1,四人 2.5(递减)
  efficiency(n) {
    if (n <= 0) return 0;
    const T = [0, 1.0, 1.6, 2.1, 2.5, 2.8, 3.1];
    return T[Math.min(n, T.length-1)];
  },
  canAssign(bidx) {
    const inst = this.s.placed[bidx];
    if (!inst) return { ok:false, msg:'无此建筑' };
    const maxW = BUILDINGS[inst.bid].out ? 3 : 1;   // 生产型可 3 人,防御型 1 人
    if (inst.workers.length >= maxW) return { ok:false, msg:`此建筑最多 ${maxW} 人` };
    const busy = this.s.placed.some(p => p.workers.length > 0 && p.workers.some(w => w.busy));
    const free = FAMILY.s.members.filter(m => !this.isEmployed(m.uid));
    if (!free.length) return { ok:false, msg:'族中已无闲人。先添丁或纳新。' };
    return { ok:true, free, maxW };
  },
  isEmployed(uid) {
    return this.s.placed.some(p => p.workers.some(w => w.uid === uid));
  },
  assign(bidx, uid) {
    const chk = this.canAssign(bidx);
    if (!chk.ok) return chk;
    const inst = this.s.placed[bidx];
    const m = FAMILY.member(uid);
    if (!m) return { ok:false, msg:'无此族人' };
    inst.workers.push({ uid, busy:true, at:Date.now() });
    this.save();
    return { ok:true, msg:`${m.name} 入职${BUILDINGS[inst.bid].name}。效率 ×${this.efficiency(inst.workers.length).toFixed(1)}` };
  },
  unassign(bidx, wi) {
    const inst = this.s.placed[bidx];
    if (!inst || !inst.workers[wi]) return { ok:false };
    inst.workers.splice(wi, 1);
    this.save();
    return { ok:true, msg:'已撤回。' };
  },
  autoFill() {
    let n = 0;
    for (let i = 0; i < this.s.placed.length; i++) {
      const b = BUILDINGS[this.s.placed[i].bid];
      const maxW = b.out ? 3 : 1;
      while (this.s.placed[i].workers.length < maxW) {
        const free = FAMILY.s.members.find(m => !this.isEmployed(m.uid));
        if (!free) break;
        this.s.placed[i].workers.push({ uid: free.uid, busy:true, at:Date.now() });
        n++;
      }
    }
    this.save();
    return { n, msg: n ? `安置了 ${n} 人` : '族中已无闲人' };
  },

  // —— 灵田:10 分钟一熟,受 区域怪物密度 × 族人属性 影响 ——
  fieldBonus(nodeId) {
    // 附近怪物越多 → 灵气越躁 → 产量越高(但同时更危险)
    const node = nodeId || (CAMP.s.nodeId || 'n0');
    // 区域密度表:险地/妖巢附近灵米产量最高
    const DENS = { n0:0, n1:1, n2:1, n3:1, n10:1, n6:1, n7:2, n5:2, n4:2, n8:3, n9:0 };
    return 1 + (DENS[node] || 0) * 0.25;
  },
  fieldYield(bidx) {
    const inst = this.s.placed[bidx];
    if (!inst) return null;
    const eff = this.efficiency(inst.workers.length);
    if (eff <= 0) return { n:0, text:'无人值守' };
    // 属性加成:族人等级
    let attr = 0;
    for (const w of inst.workers) {
      const m = FAMILY.member(w.uid);
      if (m) attr += 1 + m.lv * 0.3;
    }
    attr = inst.workers.length ? attr / inst.workers.length : 0;
    const dens = this.fieldBonus();
    const night = DAY.isNight() ? 1.15 : 1.0;
    const n = Math.max(1, Math.round((2 + Math.random()*3) * eff * (1+attr*0.2) * dens * night));
    return { n, text:`${dens>1.4?'灵气躁动,产量高':'普通'}` };
  },
  // 灵田成熟判定(每次结算调用)
  tickField(bidx) {
    const inst = this.s.placed[bidx];
    if (!inst || inst.bid !== 'bld_field') return null;
    const now = Date.now();
    if (!inst.plantAt) { inst.plantAt = now + FIELD_PERIOD; this.save();
      return { msg:'已下种,约 10 分钟成熟。' }; }
    if (now >= inst.plantAt) {
      inst.plantAt = 0;
      this.save();
      return { ready:true, ...this.fieldYield(bidx) };
    }
    return { left: Math.ceil((inst.plantAt - now)/60000) };
  },

  // —— 其他建筑产出 ——
  tickAll() {
    const out = { lingmi:0, pill:0, dao:0, atk:0, msg:[] };
    for (let i = 0; i < this.s.placed.length; i++) {
      const inst = this.s.placed[i];
      const b = BUILDINGS[inst.bid];
      if (!b.out) continue;
      const r = this.tickField(i);
      if (r && r.ready) { out.lingmi += r.n; out.msg.push(`灵田收${r.n}斤`); }
      if (inst.bid === 'bld_furnace') {
        const eff = this.efficiency(inst.workers.length);
        if (eff > 0) {
          const n = Math.max(0, Math.round((b.min + Math.random()*(b.max-b.min)) * eff));
          if (n > 0) {
            out.pill += n;
            const p = Math.random() < 0.3 ? 'pill_zhuji' : 'stone_1';
            Bag.add(p, n);
            out.msg.push(`丹炉出${n}件`);
          }
        }
      }
    }
    // 集市 / 演武场:按时间戳周期结算
    const now = Date.now();
    if (now - this.s.incomeAt > 600000) {   // 每 10 分钟
      this.s.incomeAt = now;
      const hasMarket = this.s.placed.some(p=>p.bid==='bld_market');
      const hasBarr   = this.s.placed.some(p=>p.bid==='bld_barracks');
      if (hasMarket) { const d = Math.round(120 * this.efficiency(
        this.s.placed.find(p=>p.bid==='bld_market').workers.length));
        if (d) { Cult.get().dao += d; out.dao += d; out.msg.push(`集市入账${d}道行`); } }
      if (hasBarr) { FAMILY.s.wealth += 80; out.atk += 1; out.msg.push('演武场操练,全族受益'); }
      Cult.commit(); this.save();
    }
    return out;
  },

  // —— 晋升 ——
  canPromote() {
    const nx0 = this.nextTier();
    if (!nx0) return { ok:false, msg:'已达顶级(宗门)' };
    const nx = this._needOf(nx0);
    const n = nx;
    const c = {
      builds: this.s.placed.length, pop: FAMILY.s.members.length, fires: this.fireCount(),
    };
    const miss = [];
    if (c.builds < n.builds) miss.push(`建筑 ${c.builds}/${n.builds}`);
    if (c.pop < n.pop) miss.push(`人口 ${c.pop}/${n.pop}`);
    if (c.fires < n.fires) miss.push(`篝火 ${c.fires}/${n.fires}`);
    if (miss.length) return { ok:false, msg:'尚缺:' + miss.join(' · ') };
    return { ok:true };
  },
  promote() {
    const chk = this.canPromote();
    if (!chk.ok) return chk;
    const nx = this.nextTier();
    this.s.tierLv = nx.lv;
    this.save();
    return { ok:true, msg:`领地晋升为「${nx.name}」,可放置 ${nx.slots} 处。` };
  },

  // 篝火建造(多篝火是晋升条件)
  addFire(nodeId) {
    if (this.s.fires.some(f => f.nodeId === nodeId)) return { ok:false, msg:'此处已有篝火' };
    if (this.s.fires.length >= 3) return { ok:false, msg:'最多 3 处篝火' };
    if (this.s.fires.length === 0 && CAMP.burning()) {
      this.s.fires.push({ nodeId: CAMP.s.nodeId, at: Date.now() });
    } else {
      this.s.fires.push({ nodeId, at: Date.now() });
    }
    this.save();
    return { ok:true, msg:`新增篝火(${this.s.fires.length} 处)` };
  },

  summary() {
    const t = this.tier();
    return `领地 ${t.name} · 建筑 ${this.s.placed.length}/${this.slots()} · 篝火 ${this.fireCount()} · 人口 ${FAMILY.s.members.length}`;
  },
  reset() { try { localStorage.removeItem(K); } catch {} },
};