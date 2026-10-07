// ===== 灵伴 · 怨灵系统 =====
// 三条路线(开局一次选择,永久生效):
//   kiss  ——「愿意亲我一下吗」→ 愿:自动拾取 + 贴边对话 + 亲密度成长
//   cold  —— 不愿意        → 冷:只送礼(经验/道行/源石),自说自话,没有选项
//   ghost ——「谈恋爱影响我修仙」→ 魅:恋爱线,怨灵定期附身怪物,永不击散
//
// 怨灵规则(严格按需求):
//  · 定期附身怪物,提升怪物能力
//  · 永远打不死。打散 → 倒计时复活,并预告下一个宿主
//  · 每 5 次附身 → 闪屏特写警告(疯狂马克思式),水墨复仇语录,每次不同
//  · 不打断游戏:闪屏期间玩家照常移动攻击
//  · 篝火状态:在火外召唤强化怪物。火内(源石)绝对安全,永不被突破
import { Bag, STONES, STONE_LIST, DAY } from './items.js';
import { CAMP } from './camp.js';
import { Cult } from './index.js';

const K = 'xx_companion_v081';

// ————— 境界阶段:决定对话亲密程度 —————
export const STAGE = [
  { key:'baby',   name:'初识', min:0,  mult:1.0,  desc:'她还不敢靠太近。' },
  { key:'shy',    name:'依偎', min:3,  mult:1.25, desc:'话变多了,爱蹭你。' },
  { key:'sweet',  name:'缠绵', min:8,  mult:1.6,  desc:'开始用「我们」。' },
  { key:'burn',   name:'炽',   min:16, mult:2.1,  desc:'她开始碰你的剑。' },
  { key:'possess',name:'入骨', min:28, mult:2.8,  desc:'她已经分不清自己和你了。' },
  { key:'eternal',name:'永',   min:40, mult:3.6,  desc:'「你死我也死。」' },
];

// ————— 贴边台词(随阶段变化)—————
const HUG_LINES = {
  baby: [
    '「我在这儿。」',
    '「……你打得过它吗?打得过就好。」',
    '「我看着呢。」',
  ],
  shy: [
    '「我想你了。记得找我。」',
    '「别一个人走太远。会回来的对吧?」',
    '「刚才那个……我帮你挡了。」',
  ],
  sweet: [
    '「今天也一起,好不好?」',
    '「我把最软的那块给你留着了。」',
    '「你身上有血味。是我的,还是别人的?」',
  ],
  burn: [
    '「我们是一起的。别一个人。」',
    '「你受伤我会疼。所以——别受伤。」',
    '「我看你握剑的手,想起你第一次的样子。」',
  ],
  possess: [
    '「为什么你不看我?」',
    '「我能感觉到你每一次呼吸。」',
    '「别推开我。你推不开的。」',
  ],
  eternal: [
    '「我在这里。你在哪儿,我们就在哪儿。」',
    '「我不需要你爱我。我已经是你的了。」',
    '「你走的每一步,身后都有我。」',
  ],
};

// 贴边时的选项(给玩家真选择,不同选择影响拾取)
const HUG_CHOICES = [
  { text:'握住她的手',   eff:{ range:10,  spd:0.05 }, say:'她的手很凉。但你没松开。' },
  { text:'摸摸她的头',   eff:{ range:14,  spd:0.08 }, say:'她眯起眼睛,像被顺毛的猫。' },
  { text:'「我也想你。」', eff:{ range:18,  spd:0.10 }, say:'她愣住了。然后笑了。', aff:3 },
  { text:'替她擦去眼泪', eff:{ range:8,   spd:0.12 }, say:'她没哭。但你做的时候,她在笑。', aff:2 },
];

// 冷路线:自说自话气泡(没有选项)
const COLD_LINES = [
  '「……我不吵你的。」',
  '「你走你的路。我看着就行。」',
  '「刚才那株草,你没看见。我替你收了。」',
  '「别回头。回了我也不会承认。」',
];

// 魅/怨灵:病娇独白
const POSSESS_LINES = [
  '「你今天的血,是热的。真好。」',
  '「它们不听话。我教过它们了。」',
  '「你往左走的时候,我就在你右边。」',
  '「别用那种眼神看我。我又不是要杀你。」',
  '「你打的每一个东西,都在替我碰你。」',
  '「我给你留了路。和我一起走。」',
];

// 闪屏特写:每 5 次一条,水墨复仇语录
const FLASH_LINES = [
  { t:'第 5 次',   s:'她从墙里走出来,墨迹未干。',   c:'「我数着呢。」' },
  { t:'第 10 次',  s:'第五块碑碎了,她踩在上面。',   c:'「还差五个。」' },
  { t:'第 15 次',  s:'她从你背后长出来。',         c:'「你终于回头了。」' },
  { t:'第 20 次',  s:'满山都是她的字,同一个名字。', c:'「写满了好找。」' },
  { t:'第 25 次',  s:'她把剑递给你,刀锋朝着自己。', c:'「你砍啊。」' },
  { t:'第 30 次',  s:'篝火熄了。她坐在灰里。',     c:'「你看,没火我也在。」' },
  { t:'第 35 次',  s:'她的影子先动了。',           c:'「我比你想的快。」' },
  { t:'第 40 次',  s:'她站在你本该在的位置。',     c:'「换个位置,你来当鬼。」' },
];

export const COMPANION = {
  s: {
    born: false,
    name: '宝宝',
    route: '',            // 'kiss' | 'cold' | 'ghost'
    aff: 0,               // 亲密度
    // 自动拾取(仅 kiss 路线)
    pick: { on:false, range:34, spd:0, every:0 },
    // 冷路线:自动送礼
    giftAt: 0,
    // 怨灵(仅 ghost 路线,但也可能自己爬出来)
    ghost: {
      on:false, poss:0, warnings:0, phase:'idle', nextAt:0,
      reviveAt:0, hostName:'', nextHost:'', killed:0, since:0, holdMs:75000,
    },
    // 篝火外围强化怪
    warden: { on:false, count:0, nodeId:null },
    stageIdx: 0,
    lastHug: 0,
    lastGift: 0,
    firstRun: true,
  },

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) {
        const d = JSON.parse(r) || {};
        const def = JSON.parse(JSON.stringify(this.s));   // 拿默认结构
        this.s = { ...def, ...d };
        this.s.pick  = { ...def.pick,  ...(d.pick  || {}) };
        this.s.ghost = { ...def.ghost, ...(d.ghost || {}) };
        this.s.warden= { ...def.warden,...(d.warden|| {}) };
        for (const k in def) if (this.s[k] === undefined) this.s[k] = def[k];
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // —— 开局命名 + 三选一 ——
  init(name) {
    this.s.born = true;
    this.s.name = (name || '').trim() || '宝宝';
    this.save();
  },
  choose(route) {
    this.s.route = route;
    this.s.pick.on = route === 'kiss';
    this.s.ghost.on = route === 'ghost';
    // 初始福利:拾取范围 (新手福利)
    this.s.pick.range = 34 + (route === 'kiss' ? 10 : 6);
    this.s.pick.spd = 0;
    if (route === 'ghost') this.s.ghost.nextAt = Date.now() + 90000;
    this.save();
  },
  get(name) { return this.s.name || name; },

  // —— 亲密度 / 阶段 ——
  stage() {
    const r = Cult.get();
    const realmIdx = ['qi','zhuji','jindan','yuanying','huashen'].indexOf(r.realm);
    // 炼气12层=0,化神满=4*9+9=45。阶段门槛覆盖 0..45
    const cap = [12, 21, 30, 39, 48];
    const power = Math.min(45, (realmIdx > 0 ? cap[realmIdx-1] : 0) + r.layer);
    let s = STAGE[0];
    for (const st of STAGE) if (power >= st.min) s = st;
    return s;
  },
  stageIdx() { return STAGE.indexOf(this.stage()); },

  addAff(n) { this.s.aff = Math.max(0, this.s.aff + n); this.save(); },

  // —— 贴边(有选项)——
  canHug() {
    if (this.s.route !== 'kiss') return false;
    return Date.now() - this.s.lastHug > 45000;
  },
  hug() {
    if (!this.canHug()) return null;
    this.s.lastHug = Date.now();
    this.s.pick.every = 0;
    const st = this.stage();
    const pool = HUG_LINES[st.key] || HUG_LINES.baby;
    this.save();
    return { line: pool[Math.floor(Math.random()*pool.length)],
             choices: HUG_CHOICES, stage: st.name };
  },
  hugChoose(idx) {
    const c = HUG_CHOICES[idx];
    if (!c) return null;
    const p = this.s.pick;
    p.range = Math.min(220, p.range + c.eff.range);
    p.spd = Math.min(0.95, p.spd + c.eff.spd);
    if (c.aff) this.addAff(c.aff);
    this.save();
    return c.say;
  },

  // —— 冷路线:自说自话 + 随机送礼 ——
  cold() {
    const pool = COLD_LINES;
    return pool[Math.floor(Math.random()*pool.length)];
  },
  tryGift() {
    if (this.s.route !== 'cold') return null;
    if (Date.now() - this.s.lastGift < 30000) return null;
    this.s.lastGift = Date.now();
    const r = Math.random();
    if (r < 0.4) { const dao = 300 + Math.floor(Math.random()*900);
      Cult.get().dao += dao; Cult.commit(); return { kind:'dao', n:dao, t:`获得 ${dao} 道行` }; }
    if (r < 0.75) { const st = Math.random()<0.8 ? 'stone_1' : 'stone_2';
      Bag.add(st, 1); return { kind:'stone', id:st, t:`拾得 ${STONES[st].name}` }; }
    const ex = 400 + Math.floor(Math.random()*1600);
    Cult.get().exp += ex; Cult.commit();
    return { kind:'exp', n:ex, t:`修为 +${ex}` };
  },

  // ————————————————————————————
  //  怨灵:附身 / 复活 / 闪屏
  // ————————————————————————————
  ghostLine() {
    const pool = POSSESS_LINES;
    return pool[Math.floor(Math.random()*pool.length)];
  },
  // 巡逻:每帧/每次更新调用,推进怨灵状态机
  tick() {
    const g = this.s.ghost;
    if (!g.on) return null;
    const now = Date.now();

    if (g.phase === 'scattered' && now >= g.reviveAt) {
      g.phase = 'idle';
      g.nextAt = now + 60000;
      this.save();
      return { event:'revive', msg:`附身散了。她在重聚 —— 下一具:「${g.nextHost}」` };
    }
    // possessing:附身中,倒计时到点自动回 idle 准备下一轮
    if (g.phase === 'possessing') {
      if (!g.since) g.since = now;
      if (now - g.since >= (g.holdMs || 75000)) {
        g.phase = 'idle';
        g.since = 0;
        g.nextAt = now + 45000;   // 间隔 45s 再附身
        this.save();
      }
      return null;
    }
    if (g.phase === 'idle' && now >= g.nextAt) {
      g.phase = 'possessing';
      g.since = now;
      g.poss++;
      // 每 5 次 → 闪屏特写
      let flash = null;
      if (g.poss % 5 === 0) {
        g.warnings++;
        flash = FLASH_LINES[Math.floor((g.warnings - 1) / 5) % FLASH_LINES.length];
      }
      this.save();
      return { event:'possess', count:g.poss, flash };
    }
    return null;
  },
  // 打散怨灵(永远会回来)
  scatter() {
    const g = this.s.ghost;
    g.killed++;
    g.phase = 'scattered';
    g.reviveAt = Date.now() + 120000;   // 2 分钟复活
    // 预告下一个宿主
    g.nextHost = HOSTS[Math.floor(Math.random()*HOSTS.length)];
    this.save();
    return { reviveIn:120, nextHost:g.nextHost };
  },
  get reviveCountdown() {
    const g = this.s.ghost;
    if (g.phase !== 'scattered') return 0;
    return Math.max(0, Math.ceil((g.reviveAt - Date.now())/1000));
  },

  // ————————————————————————————
  //  篝火外围:强化怪(源石护栏内绝对安全)
  // ————————————————————————————
  // 篝火点亮时,火焰外圈出现强化怪;火焰内(源石范围)永不被侵入
  wardenTick() {
    const w = this.s.warden;
    const burning = CAMP.burning();
    if (burning) {
      if (w.nodeId !== CAMP.s.nodeId) { w.nodeId = CAMP.s.nodeId; w.count = 0; }
      const want = 2 + CAMP.tier().lv;
      w.on = true;
      w.count = Math.min(want, w.count + 1);
    } else {
      w.on = false; w.count = 0; w.nodeId = null;
    }
    this.save();
    return w;
  },
  // 源石护栏:返回怪物被允许逼近的最小距离(火内绝对安全)
  wardRadius() {
    if (!CAMP.burning()) return 0;
    // 半径随营地阶位扩大;但玩家永远站在圈内 → 绝对安全
    return 70 + CAMP.tier().lv * 22;
  },

  // 供主循环读:本帧是否让玩家拾取
  autoPick(dt, dist) {
    const p = this.s.pick;
    if (!p.on) return false;
    // 效率不快:一次一个。spd 越小间隔越长
    p.every += dt * (1 + p.spd * 2.2);
    const need = 0.85 - p.spd * 0.45;   // 0.85s → 0.4s,永远不快
    if (p.every < need) return false;
    if (dist > p.range) { p.every = need * 0.5; return false; }
    p.every = 0;
    return true;
  },

  reset() { try { localStorage.removeItem(K); } catch {} },
};

export const HOSTS = ['黑风散修','守谷妖修','青云长老','青岚妖王','黑风魔修','游方剑客','炼骨傀','血河老祖'];
