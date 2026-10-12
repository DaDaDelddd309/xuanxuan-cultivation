// ===== 篝火营地 · 挂机 / 挡妖 / 聚众 / 立宗 =====
// 核心:
//  · 投源石 → 篝火燃烧。真实时间倒计时,关掉页面也在烧(按时间戳补算)。
//  · 火在时:妖怪进不来,可挂机刷资源。这是「安全区」的来源。
//  · 营地随累计时长升级:篝火 → 围栏 → 屋舍 → 阵旗(传送点)→ 山门(宗门)。
//  · 有人来投宿:散修 / 被救的奴棣 / 同道。人多了才能建宗。

import { STONES, Bag, DAY } from './items.js';

import { PAL } from '../core/palette.js';
// 么么茶是否在队(避免循环依赖,由 main.js 注入)
let MOMOCHA_IN = false;
export function setMomocha(v) { MOMOCHA_IN = !!v; }
export const momochaIn = () => MOMOCHA_IN;

const K = 'xx_camp_v080';

// 营地阶位
export const CAMP_TIERS = [
  { lv:1, name:'篝火',   need:0,     col:PAL.goldDim, d:'一堆火。风大了就灭,但妖怪不进。' },
  { lv:2, name:'围栏',   need:120,   col:'#a88a5a', d:'砍了些木头围起来。开始有人愿意留下。' },
  { lv:3, name:'屋舍',   need:600,   col:PAL.paperFaint, d:'有了屋顶。有人在门口生了火。' },
  { lv:4, name:'阵旗',   need:2400,  col:PAL.qi, d:'四面阵旗落位。营地成了方圆百里的坐标。' },
  { lv:5, name:'山门',   need:9000,  col:PAL.crit, d:'立了旗,挂匾。从这天起,它叫「宗门」。' },
];

// 一杀折算多少秒火候 —— **从 CAMP_TIERS 推,不另立一套数值**。
//
// 为什么是 ÷100:CAMP_TIERS 第 1 阶(篝火→围栏)的门槛是 120 秒,
// 拿它当「一级火候」的刻度,100 只 ≈ 一级 —— 正好对上 owner 说的
// 「砍死 100 只,篝火旺了」。所以这里的口径和营地升级那张表**同源**:
// 火候和累计燃烧时间用同一个单位(秒)、同一把梯子(CAMP_TIERS),
// 玩家看到的「旺到第几档」不需要再记第二套数字。
//
// ⚠️ 它**只喂 display-only 的 warmSec**。totalSec(升级用)与 earn(收益)
//   一个字节都没动 —— 砍杀不能改变挂机收益、掉落或经济。
const SEC_PER_KILL = CAMP_TIERS[1].need / 100;   // = 1.2

// 幂等 token 只留最近几局。存档里存整局历史没有意义,也不会有人回看第 40 局。
const SEEN_RUNS_MAX = 8;

export const CAMP = {
  // 初始状态。CAMP.s 与 reset() 共用同一个工厂 —— 照 companion.js 的做法。
  // (原来两处各抄一份字面量,加字段时漏抄 reset() 就会静默丢档。)
  s: defaultState(),

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) {
        const d = JSON.parse(r) || {};
        const def = JSON.parse(JSON.stringify(this.s));
        this.s = { ...def, ...d };
        for (const k in def) if (this.s[k] === undefined) this.s[k] = def[k];
        if (!Array.isArray(this.s.members)) this.s.members = [];
        // —— XX-VISIBLE-001 新增字段的老存档兜底 ——
        // 上面那个 for 循环只认 `undefined`。存档里这几个字段是**对象/数组**,
        // 半截旧档或手改档完全可能写成 null,那样 warmLv()/mourning() 会
        // 在 `.length` 上炸掉。「存档金币 8888→30」那类事故就是这么来的:
        // 新字段没默认值,旧存档一读就整块塌。
        if (typeof this.s.warmSec !== 'number' || !isFinite(this.s.warmSec)) this.s.warmSec = 0;
        if (typeof this.s.warmKills !== 'number' || !isFinite(this.s.warmKills)) this.s.warmKills = 0;
        if (typeof this.s.runs !== 'number' || !isFinite(this.s.runs)) this.s.runs = 0;
        if (!Array.isArray(this.s.seenRuns)) this.s.seenRuns = [];
        if (!Array.isArray(this.s.seen)) this.s.seen = [];
        if (this.s.moor != null && typeof this.s.moor !== 'object') this.s.moor = null;
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // ══════════════ 局内 → 局外(XX-VISIBLE-001)══════════════
  //
  // 这一整块只回答一个问题:**「局内发生的事,局外看得见吗」**。
  //
  // 硬边界(改这块之前先读):
  //  · tier() / earn() / feed() / light() 一个字节都没动
  //    → 砍杀**不改变**挂机收益、掉落、经济、战力。
  //  · warmSec / moor / seen 只被写、只被读出来显示,
  //    没有任何一处拿它们去乘除玩家的钱或伤害。
  //  · 数值口径全部取自 CAMP_TIERS(见上面 SEC_PER_KILL),
  //    不自创「旺度 1~5」这种第二套刻度。

  /**
   * 记一局:火候(篝火旺不旺) + 战败纪念(议事堂挂白布)。
   *
   * **幂等**:同一个 id 结算第二次直接返回 { ok:false, dup:true } 且不改任何值。
   *   endRun 自己有 inRun 守卫,但这里仍要再钉一道 ——
   *   结算屏的 onAgain、页面隐藏时的 autosave、离线补算都可能二次触达,
   *   而「同一局结算两次,累计值翻倍」这类错不会崩,只会悄悄把数字做虚。
   *
   * @param {object} o
   * @param {string} o.id      本局唯一 token(必填,幂等靠它)
   * @param {number} [o.kills] 本局击杀数
   * @param {number} [o.runTime] 本局时长(秒)
   * @param {boolean}[o.victory]
   * @param {string|null} [o.choice] 战败路线(回合制里选的哪条)
   * @param {string[]} [o.met] 本局遇到的妖谱 key
   */
  recordRun(o) {
    const r = o || {};
    const id = r.id == null ? '' : String(r.id);
    const runs = Array.isArray(this.s.seenRuns) ? this.s.seenRuns : (this.s.seenRuns = []);
    if (id && runs.includes(id)) return { ok:false, dup:true, sec:0, kills:0 };

    const kills = Math.max(0, Math.floor(Number(r.kills) || 0));
    const sec = Math.round(kills * SEC_PER_KILL);
    if (kills > 0) {
      this.s.warmSec = (Math.max(0, Number(this.s.warmSec) || 0)) + sec;
      this.s.warmKills = (Math.max(0, Number(this.s.warmKills) || 0)) + kills;
    }
    this.s.runs = (Math.max(0, Number(this.s.runs) || 0)) + 1;

    // 本局遇到的妖谱。bestiary 的 key 是稳定字符串,重复遇见不该重复占位。
    for (const k of (Array.isArray(r.met) ? r.met : [])) {
      const key = typeof k === 'string' ? k : '';
      if (!key) continue;
      const seen = Array.isArray(this.s.seen) ? this.s.seen : (this.s.seen = []);
      if (!seen.includes(key)) seen.push(key);
    }

    // 战败纪念:只记**最近一次**,不叠层 —— 议事堂挂的是一块白布,不是一面墙。
    // 没有「挂多久」的时长:那是个产品决定,不在这里编。
    if (r.victory === false) {
      this.s.moor = {
        at: Date.now(),
        kills, runTime: Math.max(0, Math.floor(Number(r.runTime) || 0)),
        choice: r.choice || null,
        tier: this.tier().lv,
      };
    }

    if (id) { runs.push(id); while (runs.length > SEEN_RUNS_MAX) runs.shift(); }
    this.save();
    return { ok:true, dup:false, sec, kills, warm: this.warmLv() };
  },

  /**
   * 火旺到第几档。**刻度就是 CAMP_TIERS**,和营地升级同一张表 ——
   * UI 拿到的 tier / col / name 可以直接用,不用再映射一次。
   * 注意它读的是 warmSec(砍杀喂的),**不是** totalSec(烧出来的):
   * 两者单位相同(秒)、来源不同,混在一起就没法回答「旺是因为砍还是因为烧」。
   */
  warmLv() {
    const sec = Math.max(0, Number(this.s.warmSec) || 0);
    let t = CAMP_TIERS[0];
    for (const c of CAMP_TIERS) if (sec >= c.need) t = c;
    const next = CAMP_TIERS.find(c => c.lv === t.lv + 1) || null;
    return {
      lv: t.lv, tier: t, next, sec,
      kills: Math.max(0, Number(this.s.warmKills) || 0),
      toNext: next ? Math.max(0, next.need - sec) : 0,
      pct: next ? Math.min(1, (sec - t.need) / Math.max(1, next.need - t.need)) : 1,
    };
  },

  /** 战败纪念。老存档没有这字段 → null(等于「没打过白布」),不崩。 */
  mourning() {
    const m = this.s.moor;
    if (!m || typeof m !== 'object') return null;
    return { on:true, at:Number(m.at)||0, kills:Math.max(0,Number(m.kills)||0),
             runTime:Math.max(0,Number(m.runTime)||0), choice:m.choice||null,
             tier:Math.max(1,Number(m.tier)||1) };
  },

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
      // 么么茶被动:茶摊开着,大家都有口热水喝 → 收益 +25%
      if (MOMOCHA_IN) { out.dao = Math.floor(out.dao * 1.25); out.exp = Math.floor(out.exp * 1.25); }

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
    { k:'guest',  name:'散修',   col:PAL.paperFaint, benefit:'寄居白吃白住。偶尔会留下谢礼。',
      line:'「借火烤个饼,不留名。」' },
    { k:'slave',  name:'奴棣',   col:'#8a5a4a', benefit:'被你救下的,做些杂活。',
      line:'「若不是公子,我已死在沟里了。」' },
    { k:'friend', name:'道友',   col:PAL.qi, benefit:'同道。可赠传承书助其精进。',
      line:'「同走此道,不必相识。」' },
    { k:'guest',  name:'游方僧', col:PAL.gold, benefit:'带来远方消息。',
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

  // 换世重置。走 defaultState() 而不是再抄一份字面量 ——
  // 原来这里和 s: 各写一遍,加字段时只改一处就会静默丢档(companion.js 同款教训)。
  reset() { this.s = defaultState(); this.save(); },
};

// 初始状态。CAMP.s 与 reset() 共用,避免两处写漂移。
function defaultState() {
  return {
    lit:false, nodeId:null,
    fuelEnd:0,          // 燃料耗尽时间戳(真实时间)
    lastTick:0,         // 上次结算时间戳
    totalSec:0,         // 累计燃烧秒数(升级用,熄火也不清零)
    members:[],         // 在营地的人
    invites:0,          // 累计招揽次数
    formed:false,       // 是否已立宗
    rep:0,              // 营地声望
    // —— 局内 → 局外(XX-VISIBLE-001):下面这六个**只用于显示**,
    //    收益/掉落/战力一个都不读。详见 recordRun 的注释。
    warmSec:0,          // 火候秒(砍杀折算)—— 与 CAMP_TIERS 同单位
    warmKills:0,        // 折出这些火候的累计击杀
    runs:0,             // 记过几局
    seen:[],            // 局内遇到过的妖谱 key(有界)
    seenRuns:[],        // 已结算的局 token(有界,幂等用)
    moor:null,          // 战败纪念:{at,kills,runTime,choice,tier}
  };
}

// 挂机离线收益汇总(玩家进游戏时调一次)
export function offlineReport() {
  const out = CAMP.earn();
  if (!out || !out.dao) return null;
  return out;
}