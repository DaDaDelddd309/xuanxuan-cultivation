// ===== 领地建造 · 放置 / 值守 / 产出 / 晋升 =====
// 设计参考《明日之后》聚落、《风起之地》营地、《99 Nights》篝火升级:
//  · 篝火是核心,建筑摆在篝火辐射范围内,共享资源
//  · 最多 6 格(随领地阶位解锁)
//  · 建造时空 = 幻境,无怪,可随意放置
//  · 每个建筑派族人值守,人数越多效率越高
//  · 灵田按 10 分钟一熟,产量受 族人属性 + 区域怪物密度 影响
//  · 晋升看 建筑数 + 人口 + 篝火数

import { SAVE_KEYS } from './save-keys.js';
import { BUILDINGS, TIERS, BESTIARY, RICE } from './bestiary.js';
import { CAMP } from './camp.js';
import { MOUNT } from './mount.js';
import { FAMILY } from './family.js';
import { Cult } from './index.js';
import { Bag, DAY } from './items.js';
import { momochaIn } from './camp.js';

const K = SAVE_KEYS.build;
export const FIELD_PERIOD = 10 * 60 * 1000;   // 灵田 10 分钟一熟(按需求)

/** 节点类型 → 灵田密度。口径与 regions.js 的 verifyRegionDanger() 同源。 */
const FIELD_DENS = { village:0, field:1, secret:2, elite:2, boss:3 };

export const BUILD = {
  s: {
    placed: [],        // [{bid, slot, workers:[uid], plantAt}]
    fires: [],         // 篝火坐标(多篝火 → 晋升条件)
    land: [],          // 占领的领地(含矿脉)
    pacts: { signed: 0, allyAt: 0 },
    tierLv: 1,
    incomeAt: 0,       // 集市/演武场 结算时间戳
  },

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) {
        const d = JSON.parse(r) || {};
        const def = { placed:[], fires:[], land:[], tierLv:1, incomeAt:0,
                     pacts:{signed:0,allyAt:0} };
        this.s = { ...def, ...d };
        if (!Array.isArray(this.s.placed)) this.s.placed = [];
        if (!Array.isArray(this.s.land)) this.s.land = [];
        if (!this.s.pacts) this.s.pacts = { signed:0, allyAt:0 };
        if (!Array.isArray(this.s.fires)) this.s.fires = [];
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // —— 建筑效果聚合(所有已放置建筑的效果加总)——
  effects() {
    const e = { ward:0, popCap:0, atk:0, fieldMul:0, trade:false, lure:0, warn:false };
    for (const p of this.s.placed) {
      const b = BUILDINGS[p.bid];
      if (!b || !b.eff) continue;
      if (b.eff.ward)  e.ward   += b.eff.ward;
      if (b.eff.popCap) e.popCap += b.eff.popCap;
      if (b.eff.atk)    e.atk    += b.eff.atk;
      if (b.eff.fieldMul) e.fieldMul += b.eff.fieldMul;
      if (b.eff.lure)   e.lure   += b.eff.lure;
      if (b.eff.trade)  e.trade  = true;
      if (b.eff.warn)   e.warn   = true;
    }
    return e;
  },
  count(bid) { return this.s.placed.filter(p => p.bid === bid).length; },

  // —— 灵米闭环 ——
  // 收获:从灵田收进背包
  harvest(bidx) {
    const inst = this.s.placed[bidx];
    if (!inst || inst.bid !== 'bld_field') return { ok:false, msg:'这不是灵田。' };
    if (!inst.plantAt) {
      // 未种 → 下种
      inst.plantAt = Date.now() + FIELD_PERIOD;
      this.save();
      return { ok:true, msg:'已下种。约 10 分钟成熟,届时可点此收获。' };
    }
    if (Date.now() < inst.plantAt) {
      const left = Math.ceil((inst.plantAt - Date.now())/60000);
      return { ok:false, msg:`还没熟,还有 ${left} 分钟。` };
    }
    const y = this.fieldYield(bidx);
    inst.plantAt = 0;
    Bag.add(RICE.id, y.n);
    this.save();
    return { ok:true, n:y.n, msg:`收获灵米 ${y.n} 斤。(${y.text})` };
  },
  // 灵田快速重种
  replant(bidx) { return this.harvest(bidx); },
  rice() { return Bag.count(RICE.id) || 0; },
  // 食用
  eatRice(n = 1) {
    if (!Bag.take(RICE.id, n)) return { ok:false, msg:'没有灵米。' };
    Cult.get().exp += RICE.eat.exp;
    Cult.get().dao += RICE.eat.dao;
    Cult.commit();
    return { ok:true, msg:`生吞 ${n} 斤。修为 +${RICE.eat.exp} · 道行 +${RICE.eat.dao}` };
  },
  // 卖给商人
  sellRice(n) {
    const have = this.rice();
    n = Math.min(n, have);
    if (n <= 0) return { ok:false, msg:'没有灵米可卖。' };
    const gain = n * RICE.price;
    Bag.take(RICE.id, n);
    Cult.get().dao += gain;
    Cult.commit();
    return { ok:true, msg:`卖出 ${n} 斤,得 ${gain} 道行。` };
  },
  // 喂给族人:顶半日功夫
  feedRice(uid, n = 1) {
    const m = FAMILY.member(uid);
    if (!m) return { ok:false, msg:'无此族人。' };
    if (m.npc === 'momocha') return { ok:false, msg:'么么茶不吃饭。他只喝茶。' };
    if (!Bag.take(RICE.id, n)) return { ok:false, msg:'没有灵米。' };
    m.lv += 1;
    this.save();
    return { ok:true, msg:`${m.name} 吃了一份,至 ${m.lv} 层。` };
  },

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

  // —— 战斗掉落:按击杀的怪类型掷建材 ——
  // 由 main.js 在 enemy-death 时调用
  onKill(kind) {
    const m = BESTIARY[kind];
    if (!m) return null;
    let out = null;
    for (const d of m.drops) {
      if (!BUILDINGS[d.id]) continue;          // 只处理建筑类
      if (Math.random() < d.p) {
        Bag.add(d.id, 1);
        out = { id:d.id, name:BUILDINGS[d.id].name, icon:BUILDINGS[d.id].icon };
      }
    }
    if (out) this.save();
    return out;
  },
  // 按原版敌人档位(0散妖 1精英 2Boss)兜底给建材
  onKillTier(tier) {
    const T = [[], [ 'bld_well' ], [ 'bld_furnace','bld_field' ]];
    const pool = T[tier] || [];
    if (!pool.length) return null;
    const bid = pool[Math.floor(Math.random()*pool.length)];
    if (Math.random() < (tier>=2 ? 0.06 : 0.03)) {
      Bag.add(bid, 1);
      return { id:bid, name:BUILDINGS[bid].name, icon:BUILDINGS[bid].icon };
    }
    return null;
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
  //
  // 【2026-10-10 改口径】密度**按节点类型**查,不再按节点 id。
  //
  // 为什么原来按 id 是错的(和 XX-PLAY-006 同一个病根):
  //   节点 id 由 worldgen 按 (y,x) 排序**逐种子重发**(worldgen.js:237)。
  //   实测 200 个种子:n1~n16 的**类型全部随种子变**,只有 n0 恒为家的 village。
  //   原表 `{n8:3, n9:0, ...}` 是照着 world/nodes.js 那张手写表写的,
  //   于是「妖巢附近产量更高」这条设计意图,实际变成了
  //   「**碰巧**编号是 n8 的那个节点产量高」—— 而 n8 真是妖巢的种子只有 3.5%。
  //   默认种子下 n8 是一片野地,却按妖巢的 3 倍产灵米。
  //
  // 这张类型表是从 world/nodes.js 那张手写表**反推**出来的,五个类型一一对应、
  // 无歧义(村0 / 野1 / 秘境2 / 险地2 / 妖巢3),所以是把设计意图接回去,不是改设计。
  // 而且它与 regions.js 的 verifyRegionDanger() 同源:区域 danger 取成员密度最大值,
  // 五区实测 1/1/2/2/3,与本表按区域聚合的结果逐一对上 —— 两处口径一致。
  fieldBonus(nodeId) {
    // 附近怪物越多 → 灵气越躁 → 产量越高(但同时更危险)
    const node = nodeId || (CAMP.s.nodeId || 'n0');
    const dens = FIELD_DENS[this._nodeType(node)];
    return 1 + (dens === undefined ? 0 : dens) * 0.25;
  },
  fieldYield(bidx) {
    const inst = this.s.placed[bidx];
    if (!inst) return null;
    const eff = this.efficiency(inst.workers.length);
    if (eff <= 0) return { n:0, text:'无人值守' };
    // 属性加成:族人等级
    let attr = 0, momo = false;
    for (const w of inst.workers) {
      const m = FAMILY.member(w.uid);
      if (!m) continue;
      if (m.npc === 'momocha') { momo = true; continue; }   // 么么茶不吃等级加成,走专属
      attr += 1 + m.lv * 0.3;
    }
    attr = inst.workers.length ? attr / inst.workers.length : 0;
    const dens = this.fieldBonus() * (1 + this.effects().fieldMul);
    const night = DAY.isNight() ? 1.15 : 1.0;
    let n = Math.max(1, Math.round((2 + Math.random()*3) * eff * (1+attr*0.2) * dens * night));
    if (momo) n = Math.round(n * 1.8);      // 么么茶侍弄灵田,产量 ×1.8
    return { n, text: momo ? '么么茶侍弄,产量大增' : (dens>1.4?'灵气躁动,产量高':'普通') };
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
      if (r && r.ready) { inst.plantAt = 0; out.lingmi += r.n;
        out.msg.push(`灵田熟,待收 ${r.n} 斤`); }
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

  // —— 矿脉:占领地图节点,每日产源石 ——
  // 只有秘境地脉价值高,荒野勉强,村庄无矿
  MINE_TIER: { secret: 3, elite: 2, boss: 3, field: 1, village: 0 },
  canClaimMine(nodeId) {
    if (this.s.fires.some(f => f.nodeId === nodeId)) return { ok:false, msg:'此处分给你建篝火了。' };
    if (this.s.land.includes(nodeId)) return { ok:false, msg:'已是自家领地。' };
    return { ok:true };
  },
  claimMine(nodeId, type) {
    const chk = this.canClaimMine(nodeId);
    if (!chk.ok) return chk;
    if ((this.MINE_TIER[type] || 0) <= 0) return { ok:false, msg:'此处无矿。' };
    this.s.land.push(nodeId);
    this.save();
    return { ok:true, msg:`纳入领地。此处将每日出产源石。` };
  },
  // 矿脉日产(每次调用按 10 分钟折算)
  mineYield() {
    if (!CAMP.burning()) return { n:0, msg:'火未燃,矿脉不开。' };
    let t = 0;
    for (const id of this.s.land) {
      // 从 WORLD 反查类型
      const n = this._nodeType(id);
      t += this.MINE_TIER[n] || 0;
    }
    const n = Math.max(1, Math.round(t * (1 + CAMP.tier().lv * 0.4)));
    if (n > 0) Bag.add('stone_1', n);
    this.save();
    return { n, msg:`矿脉产出源石 ×${n}` };
  },
  _nodeType(id) {
    const w = this._world;
    if (!w) return 'field';
    const n = w.nodes.find(x => x.id === id);
    return n ? n.type : 'field';
  },
  setWorld(w) { this._world = w; },

  // —— 阵法旗传送点 ——
  // 需在村/镇/市/宗门 阶位(LV2+)且至少 1 处篝火
  canTeleport() { return this.tier().lv >= 2 && this.fireCount() >= 1; },
  teleportCost() { return 60 - this.tier().lv * 8 < 0 ? 0 : 60 - this.tier().lv * 8; },
  teleportTo(nodeId) {
    if (!this.canTeleport()) return { ok:false, msg:'领地未至村落,或尚无篝火可依。' };
    const cost = this.teleportCost();
    const s = Cult.get();
    if (s.dao < cost) return { ok:false, msg:`道行不足 ${cost}` };
    if (s.current === nodeId) return { ok:false, msg:'已在此处。' };
    s.dao -= cost;
    s.current = nodeId;
    s.visited[nodeId] = true;
    Cult.commit();
    return { ok:true, msg:`阵旗发动,至「${nodeId}」。耗 ${cost} 道行。` };
  },

  // —— 同盟契约 ——
  // 签订后:互相支援、围攻率下降、集市互通
  canPact() { return this.s.pacts.signed < 3; },
  // V0.99:缔约缺口 —— 只读,不参与判定。
  pactGap() {
    const cost = 800 + this.s.pacts.signed * 600;
    const lack = Math.max(0, cost - Cult.get().dao);
    return { cost, lack, full: !this.canPact(), ok: this.canPact() && lack === 0 };
  },
  signPact(name) {
    if (!this.canPact()) return { ok:false, msg:'契约已满。' };
    const cost = 800 + this.s.pacts.signed * 600;
    if (Cult.get().dao < cost) return { ok:false, msg:`缔约需 ${cost} 道行` };
    Cult.get().dao -= cost;
    this.s.pacts.signed++;
    this.s.pacts.allyAt = Date.now();
    Cult.commit();
    this.save();
    return { ok:true, msg:`与「${name}」缔结同盟。往后受袭,盟友会来。` };
  },
  // 盟友支援:被打时自动
  allyAid() {
    if (!this.s.pacts.signed) return null;
    const power = 120 + this.s.pacts.signed * 180 + Math.floor(Math.random()*200);
    return { power, msg:`盟友驰援 ${power} 人马。` };
  },
  // 契约降低围攻率
  pactShield() { return this.s.pacts.signed * 0.06; },

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

  // 人口上限:基础 12 + 议事堂加成
  popCap() { return 12 + this.effects().popCap; },
  // 战力:族人战力 + 演武场加成
  power() { return FAMILY.power() + this.effects().atk; },
  // 护栏:基础 + 哨塔加成 + 坐骑(V0.91)
  ward() { return 70 + CAMP.tier().lv * 22 + this.effects().ward + MOUNT.eff().ward; },
  summary() {
    const t = this.tier();
    return `领地 ${t.name} · 建筑 ${this.s.placed.length}/${this.slots()} · 篝火 ${this.fireCount()} · 人口 ${FAMILY.s.members.length}/${this.popCap()}`;
  },
  reset() { try { localStorage.removeItem(K); } catch {} },
};