// ===== 支线任务 · 追踪 / 推进 / 结案 =====
// 每只传说妖一条支线,每条叙事线一个结案选择。
// 设计:任务不打断,只在修仙阁里显示进度。完成后弹结算。
import { SAVE_KEYS } from './save-keys.js';
import { WORLD } from './world.js';           // 支线按**类型**锚定,不再按 id(XX-PLAY-011)
import { LEGEND, LEGEND_LIST } from './legend.js';
import { STORY } from './story.js';
import { Cult } from './index.js';
import { Bag, STONES, SCROLLS, GOODS } from './items.js';
import { BUILDINGS } from './bestiary.js';   // 触发建材注册(Bag 白名单)
import { TOMB } from './tomb.js';            // 石将支线在墓里结案
import { Save } from '../core/save.js?v=17';     // 装备掉落落档(XX-EQUIP-005)
import { gearFromSource, GEAR } from '../game/gear.js?v=17';   // 「结案对象 → 装备」反查

const K = SAVE_KEYS.quest;

// 支线完成条件表:不同妖,不同的结法
//
// 【XX-PLAY-011】锚点从**节点 id** 改成**节点类型**。
//
// 为什么原来那样不行:条件写的是 `where:['n10','n1']` 这种 id,而 id 由
// worldgen 按 (y,x) 排序**逐种子重发**(worldgen.js:237)。
// 实测 200 个种子,玩家**照提示去了正确的地方**、支线却结不了案的比例:
//
//   dengshi  46.0%   laolao 47.5%   hongyi 59.5%
//   qingqiong 64.0%  jiangu  64.0%  dangkang 67.5%
//
// 两条 boss 线尤其荒唐:它查 `p.visited['n8']`,而 n8 真是妖巢的种子只有
// **3.5%** —— 于是玩家**打赢妖巢**它不结算,反倒**逛到一片恰好编号 n8 的野地**
// 它就结算了。同一个行为("去了该去的地方"),结果掷骰子。
//
// tip 里原来还把原始 id 直接报给玩家看('村外枯井(n10)与邻道(n1)'),
// 经 ui/story.js 上屏。id 是内部实现,不该出现在任务描述里,一并去掉。
export const QUEST_COND = {
  hongyi:  { type:'visit',  types:['field'], need:2, tip:'村外野道上的那口枯井' },
  laolao:  { type:'visit',  types:['elite'], need:2, tip:'黑风岭一带的险地,愿牌散落之处' },
  baize:   { type:'peace',  key:'baize',       tip:'在秘境遇见白泽' },
  dangkang:{ type:'visit',  types:['field'], need:2, tip:'跟着白牛,它往山里去' },
  qingqiong:{type:'boss',  tip:'古战场遗迹,青穹每次都会经过' },
  jiangu:  { type:'visit',  types:['boss'],  need:1, tip:'断剑冢,看它演完那一招' },
  shijiang:{ type:'tomb',   key:'shijiang',   tip:'走进墓里,到石将跟前' },
  dengshi: { type:'visit',  types:['field'], need:2, tip:'村外的坟场' },
};

/**
 * 当前世界里属于这些类型的节点。
 * 读不到世界时返回空数组 —— 「不知道」不等于「当成没有」
 * (同一个理由见 story.js 的 _nodeTypeOk:信息缺失 ≠ 证据)。
 */
function nodesOfTypes(types) {
  try {
    const w = WORLD;
    if (!w || !w.nodes) return [];
    return w.nodes.filter(n => types.includes(n.type));
  } catch { return []; }
}

export const QUEST = {
  s: { active: [], done: {}, choices: {} },   // active:[key], done:{key:{path,at}}, choices:{arc:1|2}

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) { const d = JSON.parse(r)||{};
        const def = { active:[], done:{}, choices:{} };
        this.s = { ...def, ...d };
        if (!Array.isArray(this.s.active)) this.s.active = [];
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // —— 接取:见过那只妖,且该线未结 ——
  canTake(key) {
    const l = LEGEND[key];
    if (!l) return { ok:false };
    if (this.s.active.includes(key)) return { ok:false, msg:'已在手上' };
    if (this.s.done[key]) return { ok:false, msg:'已了结' };
    if (!STORY.met(key)) return { ok:false, msg:'你还没见过它' };
    return { ok:true };
  },
  take(key) {
    const chk = this.canTake(key);
    if (!chk.ok) return chk;
    this.s.active.push(key);
    this.save();
    return { ok:true, quest:LEGEND[key].quest };
  },
  autoTake() {
    // 见妖时自动接(免得玩家漏点)
    let n = 0;
    for (const l of LEGEND_LIST) {
      if (STORY.met(l.key) && this.canTake(l.key).ok) { this.s.active.push(l.key); n++; }
    }
    this.save();
    return n;
  },
  drop(key) {
    this.s.active = this.s.active.filter(k=>k!==key);
    this.save();
  },

  // 进度(0~1)
  progress(key) {
    const c = QUEST_COND[key];
    if (!c) return 0;
    if (this.s.done[key]) return 1;
    if (!this.s.active.includes(key)) return 0;
    const p = Cult.get();
    if (c.type === 'visit') {
      // 按**类型**取当前世界里该去的那些点,不再查写死的 id(XX-PLAY-011)
      const nodes = nodesOfTypes(c.types);
      if (!nodes.length) return 0;                       // 读不到世界/该类不存在 → 不推进,也不误判
      // 需求数不得超过这张图里该类节点的**实际数量**。
      // 不封顶会造出「永远完不成」的支线:险地(elite)每图只有 1~3 个,
      // 而 laolao 要 2 个 —— 只出 1 个险地的图里,这条线就永久卡死。
      // 取 min 的代价是难度随图浮动,换来的是「任何种子都走得完」。
      const need = Math.min(c.need, nodes.length);
      const n = nodes.filter(x => p.visited[x.id]).length;
      return Math.min(1, n / need);
    }
    if (c.type === 'peace') return STORY.met(c.key) ? 1 : 0;
    // boss 线看的是**真正的妖巢**被走过没有。原来查 visited['n8'],
    // 而 n8 真是妖巢的种子只有 3.5% —— 打完妖巢不结算,
    // 逛到一片编号 n8 的野地反而结算。
    if (c.type === 'boss')  return nodesOfTypes(['boss']).some(x => p.visited[x.id]) ? 1 : 0;
    if (c.type === 'tomb') return TOMB.s.done ? 1 : 0;   // 石将那条线在墓里结
    return 0;
  },
  // 条件是否达成
  ready(key) { return this.progress(key) >= 1; },

  // 墓里结案后,同步了结石将支线(结局一致,不重复发奖)
  settleShijiang(path) {
    if (!this.s.active.includes('shijiang') || this.s.done.shijiang) return false;
    this.s.active = this.s.active.filter(k=>k!=='shijiang');
    this.s.done.shijiang = { path, at:Date.now(), inTomb:true };
    this.save();
    return true;
  },

  // —— 结案:双结局 ——
  finish(key, path) {
    const l = LEGEND[key];
    if (!l) return { ok:false, msg:'无此支线' };
    if (!this.ready(key)) return { ok:false, msg:'还没办成。' };
    this.s.active = this.s.active.filter(k=>k!==key);
    this.s.done[key] = { path, at: Date.now() };
    const reward = this.grant(l.quest.reward, path, key);
    this.save();
    return { ok:true, path, quest:l.quest, reward };
  },
  // 奖励发放
  /**
   * @param {object} rw    支线奖励配置
   * @param {number} path  结局 1/2
   * @param {string} [questKey] 支线 key —— XX-EQUIP-005:装备由**结案对象**决定,
   *   所以必须传进来。装备表 gear.js 用 `from` 字段反查,不靠硬编码支线名。
   */
  grant(rw, path, questKey) {
    const got = { dao:0, scroll:null, item:null, special:null, gear:null, text:[] };
    if (!rw && !questKey) return got;
    // ⚠️ 支线的 `reward` 现在是 `[结局1, 结局2]` 数组(XX-NET-003);
    //    叙事线那边 `STORY.finish` 已经先按 path 取好了单对象(ARC_REWARD),
    //    所以两种形状都得认 —— 只按数组处理会打断叙事线,只按对象处理会打断支线。
    const r = Array.isArray(rw) ? (rw[path - 1] || null) : rw;
    if (r && r.dao) { Cult.get().dao += r.dao; got.dao = r.dao; got.text.push(`道行 +${r.dao}`); }
    if (r && r.scroll) {
      const sc = SCROLLS[r.scroll];
      if (sc) { Bag.add(r.scroll, 1); got.scroll = r.scroll;
        got.text.push(`${sc.name} ×1`); }
    }
    if (r && r.item) { Bag.add(r.item, 1); got.item = r.item;
      got.text.push(`${(STONES[r.item]||GOODS[r.item]||BUILDINGS[r.item]||{name:r.item}).name} ×1`); }
    // 特殊结局交互只决定 UI 弹哪个问答(白泽问答、石将补字…),
    // **不再附带道行** —— 原来那条 `path===2 ? +300 : 0` 已折进各自的 reward 表,
    // 留在这里会对结局二双算。
    if (questKey) {
      const qd = LEGEND[questKey] && LEGEND[questKey].quest;
      if (qd && qd.special) got.special = qd.special;
    }
    // —— 装备掉落(XX-EQUIP-005)——
    // 只从**支线结案**掉,绝不进砍杀局普通池:拿到就是拿到了,不会被刷爆。
    // gearFromSource 反查 gear 表的 `from` 字段,不在这里硬编码 8 条支线名 ——
    // 硬编码的话加一件装备就要改两个文件,迟早对不上。
    const gid = questKey && gearFromSource(questKey);
    if (gid) {
      if (Save.ownGear(gid)) { got.gear = gid; got.text.push(`${GEAR[gid].name}`); }
      else got.text.push(`${GEAR[gid].name}(已有)`);   // 不产出第二件,但要告诉玩家
    }
    Cult.commit();
    return got;
  },

  // 特殊结局交互(白泽问答等)—— 返回给 UI 用的提示
  specialPrompt(key) {
    const l = LEGEND[key];
    if (!l) return null;
    switch (l.quest.special) {   // special 已提到 quest 层(reward 变成 [p1,p2] 数组,XX-NET-003)
      case 'ask': return {
        title:'知 者',
        q:'「你修这道,是为了什么?」',
        a1:'「为了活。」', a2:'「为了不再有人像我一样死。」',
        r1:'白泽没笑。它点了点头,转身走了。',
        r2:'白泽给了你一样东西,说:「你会回来的。」',
      };
      case 'chase': return {
        title:'追 豕',
        q:'当康停在山口,回头看了你一眼。',
        a1:'「你走吧。我不追了。」', a2:'「跟我。」',
        r1:'它走了。田里那年丰收。',
        r2:'它带你去了它躲了一辈子的地方。',
      };
      case 'noLook': return {
        title:'不 回 头',
        q:'青穹回头了 —— 这是千年来第一次。',
        a1:'「走。」', a2:'「你为什么回头?」',
        r1:'它没答,展翅走了。你活着。',
        r2:'它说了三个字:「因为你。」然后你们都没活着。',
      };
      case 'watch': return {
        title:'第 三 百 一 柄',
        q:'剑骨演完了。他停下来,第一次看向你。',
        a1:'拿走那柄剑', a2:'陪他再演一遍',
        r1:'剑归你了。他散了,像松了口气。',
        r2:'他对你鞠了一躬,然后继续演。',
      };
      case 'words': return {
        title:'半 句 话',
        q:'石将让你补完那句话。你手上有两半。',
        a1:'「此生无悔」', a2:'「奈何无人共」',
        r1:'石将跪下了。它终于能下班。',
        r2:'墓门开了。里面只有一张空席。',
      };
      default: return null;
    }
  },

  // 列表
  activeList() {
    return this.s.active.map(k => ({
      key:k, title:LEGEND[k].quest.title, desc:LEGEND[k].quest.desc,
      tip: QUEST_COND[k] ? QUEST_COND[k].tip : '',
      p: this.progress(k), ready: this.ready(k),
    }));
  },
  doneList() {
    return Object.entries(this.s.done).map(([k,v])=>({
      key:k, title:LEGEND[k].quest.title, path:v.path, at:v.at,
    }));
  },
  availableList() {
    return LEGEND_LIST.filter(l => this.canTake(l.key).ok);
  },
};