// ===== 篝火营地 · 挂机 / 挡妖 / 聚众 / 立宗 =====
// 核心:
//  · 投源石 → 篝火燃烧。真实时间倒计时,关掉页面也在烧(按时间戳补算)。
//  · 火在时:妖怪进不来,可挂机刷资源。这是「安全区」的来源。
//  · 营地随累计时长升级:篝火 → 围栏 → 屋舍 → 阵旗(传送点)→ 山门(宗门)。
//  · 有人来投宿:散修 / 被救的奴棣 / 同道。人多了才能建宗。

import { STONES, Bag, DAY } from './items.js';

const K = 'xx_camp_v080';

// 营地阶位
export const CAMP_TIERS = [
  { lv:1, name:'篝火',   need:0,     col:'#c96a3c', d:'一堆火。风大了就灭,但妖怪不进。' },
  { lv:2, name:'围栏',   need:120,   col:'#a88a5a', d:'砍了些木头围起来。开始有人愿意留下。' },
  { lv:3, name:'屋舍',   need:600,   col:'#8a9a5a', d:'有了屋顶。有人在门口生了火。' },
  { lv:4, name:'阵旗',   need:2400,  col:'#6aa8e0', d:'四面阵旗落位。营地成了方圆百里的坐标。' },
  { lv:5, name:'山门',   need:9000,  col:'#b072d8', d:'立了旗,挂匾。从这天起,它叫「宗门」。' },
];

export const CAMP = {
  s: {
    lit:false, nodeId:null,
    fuelEnd:0,          // 燃料耗尽时间戳(真实时间)
    lastTick:0,         // 上次结算时间戳
    totalSec:0,         // 累计燃烧秒数(升级用,熄火也不清零)
    members:[],         // 在营地的人
    invites:0,          // 累计招揽次数
    formed:false,       // 是否已立宗
    rep:0,              // 营地声望
  },

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) {
        const d = JSON.parse(r) || {};
        const def = JSON.parse(JSON.stringify(this.s));
        this.s = { ...def, ...d };
        for (const k in def) if (this.s[k] === undefined) this.s[k] = def[k];
        if (!Array.isArray(this.s.members)) this.s.members = [];
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // —— 状态 ——
  tier() {
    let t = CAMP_TIERS[0];
    for (const c of CAMP_TIERS) if (this.s.totalSec >= c.need) t = c;
    return t;
  },
  next() {
    const t = this.tier();
    return CAMP_TIERS.find(c => c.lv === t.lv + 1) || null;
  },
  burning() {
    if (!this.s.lit) return false;
    return Date.now() < this.s.fuelEnd;
  },
  fuelMin() {
    if (!this.burning()) return 0;
    return Math.max(0, Math.ceil((this.s.fuelEnd - Date.now()) / 60000));
  },
  // 满燃料时长(当前背包里所有源石)
  maxFuel() { return Bag.stoneMinutes(); },

  // —— 生火 ——
  light(nodeId) {
    if (this.s.lit) return { ok:false, msg:'火已经烧着了。' };
    if (Bag.stoneMinutes() <= 0) return { ok:false, msg:'没有源石。先去猎妖,或用道行兑换。' };
    this.s.lit = true;
    this.s.nodeId = nodeId;
    this.s.lastTick = Date.now();
    // 关键:到期时间以「现在」为基准,不能从 0 累加(那会永远判定为已耗尽)
    this.s.fuelEnd = Date.now();
    this.feed();                       // 自动投入现有源石
    this.save();
    return { ok:true, msg:'火起了。' };
  },
  // 投入源石(默认投全部,也可指定数量)
  feed(id, n) {
    if (!this.s.lit) return { ok:false, msg:'还没生火。' };
    let added = 0;
    const base = Math.max(Date.now(), this.s.fuelEnd || 0);
    const bag = Bag.s.items;
    const list = id ? [[id, n]] :
      Object.keys(STONES).map(k => [k, bag[k] || 0]).filter(([, c]) => c > 0);
    for (const [sid, cnt] of list) {
      const st = STONES[sid];
      if (!st) continue;
      const use = cnt == null ? (bag[sid] || 0) : Math.min(cnt, bag[sid] || 0);
      if (use <= 0) continue;
      Bag.take(sid, use);
      this.s.fuelEnd = base + (this.s.fuelEnd > Date.now() ? this.s.fuelEnd - base : 0)
                 + use * st.dur * 60000;
      added += use * st.dur;
    }
    if (!added) return { ok:false, msg:'没有可投入的源石。' };
    this.save();
    return { ok:true, added, total:this.fuelMin(),
             msg:`投入 ${added} 分钟燃料,还剩 ${this.fuelMin()} 分钟。` };
  },
  // 熄灭(保留累计时长和成员)
  douse() {
    this.earn(true);
    this.s.lit = false; this.s.fuelEnd = 0;
    this.save();
    return { ok:true, msg:'你踩灭了火。营地还在。' };
  },

  // —— 挂机结算:按真实经过时间 ——
  // 每次调用都会把 elapsed 折算成收益。关页面再回来照样补算。
  earn(force) {
    const now = Date.now();
    const last = this.s.lastTick || now;
    const wasBurning = this.s.lit && now < this.s.fuelEnd;
    let sec = Math.floor((now - last) / 1000);
    if (sec <= 0) return null;
    // 燃料不足时按实际燃烧时长截断
    if (this.s.lit) {
      const fuelLeft = Math.max(0, Math.floor((this.s.fuelEnd - last) / 1000));
      if (fuelLeft <= 0) {
        this.s.lit = false;
        sec = Math.min(sec, 0);
      } else sec = Math.min(sec, fuelLeft);
    }
    if (sec <= 0) { this.s.lastTick = now; this.save(); return null; }

    const out = { sec, dao:0, exp:0, stone:null, scroll:null, visitors:0 };
    if (wasBurning && sec > 0) {
      this.s.totalSec += sec;
      const t = this.tier();
      const min = sec / 60;
      // 收益 = 时长 × 阶位系数 × 昼夜系数
      const lvMul = 1 + (t.lv - 1) * 0.85;
      out.dao = Math.floor(min * 1.6 * lvMul);
      out.exp = Math.floor(min * 9 * lvMul);
      const b = 1 + (DAY.bonus() - 1);       // 夜里有加成
      out.dao = Math.floor(out.dao * b);
      out.exp = Math.floor(out.exp * b);
      if (DAY.isNight()) out.dao = Math.floor(out.dao * 1.2);

      // 低阶石产出随阶位提升
      const sRoll = Math.random();
      const p = 0.05 + t.lv * 0.035;
      if (sRoll < p) {
        out.stone = t.lv >= 3 && Math.random() < 0.35
          ? { id:'stone_2', n:1 } : { id:'stone_1', n:1 };
      }
      // 每 40 分钟一份传承书
      if (Math.random() < min / 40) out.scroll = { id:'scroll_1', n:1 };

      // 有人来投宿
      const vp = 0.006 * t.lv * (sec / 60);
      if (Math.random() < Math.min(0.5, vp)) {
        const v = this.spawnVisitor();
        if (v) { out.visitors++; out.visitor = v; }
      }
      if (out.dao || out.exp) {
        this.s.rep += Math.floor(min * 0.8);
      }
    }
    this.s.lastTick = now;
    this.save();
    return out;
  },

  // —— 来客 ——
  KINDS: [
    { k:'guest',  name:'散修',   col:'#9aa08a', benefit:'寄居白吃白住。偶尔会留下谢礼。',
      line:'「借火烤个饼,不留名。」' },
    { k:'slave',  name:'奴棣',   col:'#8a5a4a', benefit:'被你救下的,做些杂活。',
      line:'「若不是公子,我已死在沟里了。」' },
    { k:'friend', name:'道友',   col:'#6aa8e0', benefit:'同道。可赠传承书助其精进。',
      line:'「同走此道,不必相识。」' },
    { k:'guest',  name:'游方僧', col:'#c9a227', benefit:'带来远方消息。',
      line:'「西边有座塔,塔里有个人在等。」' },
  ],
  spawnVisitor() {
    const cap = 3 + this.tier().lv * 4;
    if (this.s.members.length >= cap) return null;
    const kd = this.KINDS[Math.floor(Math.random() * this.KINDS.length)];
    const m = {
      uid: 'm' + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36),
      kind: kd.k, name: this.pickName(), title: kd.name,
      lv: 1 + Math.floor(Math.random() * (2 + this.tier().lv)),
      joined: Date.now(), gift: 0,
    };
    this.s.members.push(m);
    this.s.invites++;
    this.save();
    return { ...m, line: kd.line, benefit: kd.benefit };
  },
  NAMES: ['阿七','石头','李三娘','周野','老木','青禾','陈九','柳细','张大胆','白小满',
           '赵青山','钱多多','孙二','吴用','郑三','马蹄','朱砂','钱串子','铁蛋','小满'],
  pickName() {
    const used = new Set(this.s.members.map(m => m.name));
    const free = this.NAMES.filter(n => !used.has(n));
    return free.length ? free[Math.floor(Math.random()*free.length)] : '无名';
  },
  gift(uid) {
    const m = this.s.members.find(x => x.uid === uid);
    if (!m || m.gift >= 3) return null;
    m.gift++;
    const dao = 200 + m.lv * 120;
    this.s.rep += 30;
    this.save();
    return { dao, text:`${m.name}留下 ${dao} 道行作谢。` };
  },
  // 赠传承书给族人(这就是「传承」)
  teach(uid, scrollId) {
    const m = this.s.members.find(x => x.uid === uid);
    if (!m) return { ok:false, msg:'无此人。' };
    if (!Bag.take(scrollId, 1)) return { ok:false, msg:'没有这本传承书。' };
    m.lv += 3;
    m.gift = 0;
    this.s.rep += 60;
    this.save();
    return { ok:true, msg:`${m.name} 接过传承,顿有所悟。` };
  },
  // 传送:需阵旗(Lv4)以上
  canTeleport() { return this.tier().lv >= 4; },
  teleportCost() { return 80; },

  // —— 立宗 ——
  foundSect() {
    const t = this.tier();
    if (this.s.formed) return { ok:false, msg:'已经立过宗了。' };
    if (t.lv < 5) return { ok:false, msg:`还需把营地经营到「山门」(LV5)。当前 ${t.name}。` };
    if (!Bag.s.charter) return { ok:false, msg:'缺一面「家族令」。' };
    this.s.formed = true;
    this.save();
    return { ok:true, msg:'旗立了,匾挂了。从这天起,它叫宗门。' };
  },

  reset() { this.s = { lit:false,nodeId:null,fuelEnd:0,lastTick:0,totalSec:0,
                       members:[],invites:0,formed:false,rep:0 }; this.save(); },
};

// 挂机离线收益汇总(玩家进游戏时调一次)
export function offlineReport() {
  const out = CAMP.earn();
  if (!out || !out.dao) return null;
  return out;
}