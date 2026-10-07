// ===== 修仙家族 · 繁衍 / 关系 / 领地 / 矿脉 =====
// 营地是家族的地基,宗门是家族的天花板。中间这段就是繁衍与经营。
import { Bag, STONES, SCROLL_LIST, GOODS } from './items.js';
import { CAMP } from './camp.js';
import { Cult } from './index.js';

const K = 'xx_family_v081';

// —— 族人模板 ——
const SURNAME = ['轩','白','陆','沈','谢','萧','慕容','独孤','南宫','云','墨','苏','楚','姜','燕'];
const GIVEN = ['长安','惊鸿','无咎','知白','守拙','照野','观澜','抱朴','听雪','扶摇','衔烛','断章'];
const ROLES = [
  { k:'warrior', name:'战修', col:'#b5342a', d:'守门。开战时在营地外围迎敌。', power:3 },
  { k:'alchemist',name:'丹师', col:'#63c74d', d:'炼丹。每日产丹药。', power:1 },
  { k:'miner',    name:'矿师', col:'#c9a227', d:'下矿。产源石。', power:2 },
  { k:'scholar',  name:'修士', col:'#4a9de0', d:'修行。为家族贡献修为。', power:2 },
  { k:'elder',    name:'长老', col:'#b86fd0', d:'坐镇。降低家族被袭风险。', power:1 },
  { k:'farmer',   name:'茶摊', col:'#c9a227', d:'侍弄灵田,产量远超常人。', power:2 },
];

export const FAMILY = {
  s: {
    founded: false,
    name: '轩氏',
    members: [],       // 族人
    couples: [],       // 配偶关系 [aUid,bUid]
    gen: 1,            // 世代
    wealth: 0,         // 家族资产
    land: [],          // 领地 nodeId
    mines: [],         // 矿脉 nodeId
    lastYield: 0,
    attacks: 0,        // 被围攻次数
    defended: 0,
  },
  _cap: 40,        // 人口上限,由 BUILD.popCap 注入
  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) {
        const d = JSON.parse(r) || {};
        // 逐字段合并,缺字段用默认值补齐(防旧档/半截档导致 undefined)
        const def = { founded:false, name:'轩氏', members:[], couples:[], gen:1,
                      wealth:0, land:[], mines:[], lastYield:0, attacks:0, defended:0 };
        this.s = { ...def, ...d };
        for (const k in def) if (this.s[k] === undefined) this.s[k] = def[k];
        if (!Array.isArray(this.s.members)) this.s.members = [];
        if (!Array.isArray(this.s.land)) this.s.land = [];
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); }catch{} },

  // —— 立族 ——
  found(name) {
    if (this.s.founded) return { ok:false, msg:'已立族。' };
    this.s.founded = true;
    this.s.name = (name||'').trim() || '轩氏';
    this.addMomocha();      // 么么茶固定在队
    this.addMember('elder');
    this.save();
    return { ok:true, msg:`${this.s.name} 立族了。` };
  },

  // —— 族人 ——
  // 么么茶:固定队友。开服即在队,不走随机生成。
  addMomocha() {
    if (this.s.members.some(m => m.npc === 'momocha')) return null;
    const m = {
      uid:'npc_momocha', gen:0, npc:'momocha',
      name:'么么茶', role:'farmer', roleName:'茶摊', col:'#c9a227',
      desc:'开服即在队。全局挂机收益 +25%,灵田产量 ×1.8。',
      lv:3, aff:100, partner:null, born:Date.now(),
    };
    this.s.members.push(m);
    this.save();
    return m;
  },
  momocha() { return this.s.members.find(m => m.npc === 'momocha') || null; },

  addMember(forceRole) {
    const uid = 'f' + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36);
    const role = forceRole
      ? ROLES.find(r=>r.k===forceRole)
      : ROLES[Math.floor(Math.random()*ROLES.length)];
    const m = {
      uid, gen: this.s.gen,
      name: this.surname() + this.given(),
      role: role.k, roleName: role.name, col: role.col, desc: role.d,
      lv: 1 + Math.floor(Math.random() * 3),
      aff: 50 + Math.floor(Math.random()*20),   // 忠诚 0-100
      partner: null,
      born: Date.now(),
    };
    this.s.members.push(m);
    this.save();
    return m;
  },
  surname() { return this.s.members.length ? '' : (SURNAME[Math.floor(Math.random()*SURNAME.length)] || '轩'); },
  given() { return GIVEN[Math.floor(Math.random()*GIVEN.length)]; },

  member(uid) { return this.s.members.find(m=>m.uid===uid); },

  // —— 繁衍(消耗资产 + 人口)——
  canBirth() {
    return this.s.founded && this.s.members.length < 40
      && this.s.members.filter(m=>!m.partner).length >= 2
      && this.s.wealth >= 200;
  },
  birth() {
    if (!this.s.founded) return { ok:false, msg:'尚未立族。' };
    const free = this.s.members.filter(m=>!m.partner && m.npc!=='momocha' && !m.raised);
    if (free.length < 2) return { ok:false, msg:'族中无未婚配对,人口凋零。' };
    if (this.s.wealth < 200) return { ok:false, msg:'家族资产不足 200。' };
    const a = free[0], b = free[1];
    a.partner = b.uid; b.partner = a.uid;
    this.s.couples.push([a.uid, b.uid]);
    this.s.wealth -= 200;
    //  offspring
    const baby = this.addMember();
    baby.gen = this.s.gen + 1;
    baby.parents = [a.uid, b.uid];
    baby.birth = Date.now();
    // 父母忠诚消耗
    a.aff = Math.max(10, a.aff - 5); b.aff = Math.max(10, b.aff - 5);
    this.save();
    return { ok:true, baby, parents:[a,b], msg:`${baby.name} 出生了。` };
  },

  // —— 关系培养 ——
  interact(uid, kind) {
    const m = this.member(uid);
    if (!m) return { ok:false, msg:'无此族人。' };
    if (m.npc === 'momocha') return { ok:false, msg:'么么茶不是你能安排的。他自己会沏茶。' };
    const COST = { talk:20, gift:60, train:120 };
    if (this.s.wealth < COST[kind]) return { ok:false, msg:`家族资产不足 ${COST[kind]}` };
    this.s.wealth -= COST[kind];
    let r;
    if (kind === 'talk') { m.aff = Math.min(100, m.aff + 6); r = `${m.name} 与你多说了几句。`; }
    else if (kind === 'gift') {
      const st = Math.random()<0.6?'stone_1':'stone_2';
      Bag.add(st,1); m.aff = Math.min(100, m.aff + 12);
      r = `${m.name} 收下源石,忠心大增。`;
    } else { m.lv += 1; m.aff = Math.min(100, m.aff+4);
      r = `${m.name} 勤修苦练,至 ${m.lv} 层。`; }
    this.save();
    return { ok:true, msg:r };
  },

  // —— 全属性修士 ——
  // 传承书喂出来的,不走随机生成。四维全满,战力 = 层数 ×3(普通族人 ×2)
  RAISED: [
    { key:'sword',  name:'剑 修',   col:'#c8d4e0' },
    { key:'body',   name:'体 修',   col:'#e0904a' },
    { key:'spirit', name:'神 修',   col:'#b86fd0' },
    { key:'array',  name:'阵 修',   col:'#4a9de0' },
  ],
  canRaise() {
    const cap = this._cap || 40;
    if (this.s.members.length >= cap) return { ok:false, msg:'族人已满(议事堂可扩容)。' };
    if (this.s.wealth < 500) return { ok:false, msg:'资产不足 500。' };
    return { ok:true };
  },
  raise(kind) {
    const chk = this.canRaise();
    if (!chk.ok) return chk;
    const k = this.RAISED.find(x => x.key === kind) || this.RAISED[0];
    this.s.wealth -= 500;
    const m = {
      uid: 'r' + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36),
      gen: this.s.gen, role: 'raised', roleName: k.name, col: k.col,
      raised: k.key,
      desc: '以传承书喂养而出。四维俱佳,一人抵三。',
      name: k.name[0] + (['无涯','守拙','长明','抱一'][Math.floor(Math.random()*4)]),
      lv: 3, aff: 70, partner: null, born: Date.now(),
    };
    this.s.members.push(m);
    this.save();
    return { ok:true, m, msg:`${m.name}(${k.name})养成了。` };
  },

  // —— 每日产出(按角色职能)——
  yieldDay() {
    let stone = 0, pill = 0, dao = 0, exp = 0;
    for (const m of this.s.members) {
      if (m.npc === 'momocha') { dao += 260; continue; }   // 固定贡献
      const P = 1 + m.lv * 0.25;
      if (m.raised) {                       // 全属性修士:四项都产
        stone += Math.round(3 * P); pill += Math.round(0.8 * P);
        exp += Math.round(50 * P); dao += Math.round(25 * P);
      }
      else if (m.role === 'miner') stone += Math.round(2 * P);
      else if (m.role === 'alchemist') pill += Math.round(0.6 * P);
      else if (m.role === 'scholar') exp += Math.round(40 * P);
      else if (m.role === 'warrior' || m.role === 'elder') dao += Math.round(15 * P);
    }
    this.s.lastYield = { stone, pill, dao, exp };
    this.save();
    return this.s.lastYield;
  },

  // —— 领地与矿脉 ——
  claim(nodeId) {
    if (this.s.land.includes(nodeId)) return { ok:false, msg:'已是自家领地。' };
    this.s.land.push(nodeId);
    this.save();
    return { ok:true, msg:'纳入领地。' };
  },
  // 领地矿脉:每天自动产源石(营地点亮时才产)
  mineYield() {
    if (!CAMP.burning()) return 0;
    let n = 0;
    for (const node of this.s.mines) n += 1;
    const tier = CAMP.tier().lv;
    return Math.round(n * (1 + tier * 0.5));
  },

  // —— 围攻 / 守城 ——
  attackChance() {
    if (this.s.land.length < 2) return 0;
    const elders = this.s.members.filter(m=>m.role==='elder').length;
    return Math.max(0, 0.18 - elders * 0.05) * (1 + this.s.land.length * 0.1);
  },
  resolveAttack() {
    this.s.attacks++;
    const power = this.s.members.reduce((a,m)=>a+m.lv*2,0) + this.s.land.length * 20;
    const threat = 100 + this.s.land.length * 60;
    if (power > threat) { this.s.defended++; this.s.wealth += 150; this.save();
      return { ok:true, msg:'守住了。战利品入库 +150。' }; }
    // 破防:损失
    const loss = Math.min(this.s.wealth, 100 + this.s.land.length * 50);
    this.s.wealth = Math.max(0, this.s.wealth - loss);
    if (Math.random() < 0.3 && this.s.members.length > 1) {
      const gone = this.s.members.pop();
      this.save();
      return { ok:false, msg:`领地被破,损失 ${loss} 资产,${gone.name} 不知所踪。` };
    }
    this.save();
    return { ok:false, msg:`领地被破,损失 ${loss} 资产。` };
  },

  // 求援:盟友
  callHelp() {
    if (this.s.wealth < 100) return { ok:false, msg:'资产不足 100,发不出传讯。' };
    this.s.wealth -= 100;
    const power = 100 + Math.floor(Math.random()*400);
    this.save();
    return { ok:true, power, msg:`求援发出,${power>300?'老友带援兵赶来':'只来了几个散修'}` };
  },

  power() { return this.s.members.reduce((a,m)=>a+(m.raised? m.lv*3 : m.lv*2+(m.role==='warrior'?3:0)),0); },
  ROLES,
  reset() { localStorage.removeItem(K); },
};
