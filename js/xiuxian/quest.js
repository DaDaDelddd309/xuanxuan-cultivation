// ===== 支线任务 · 追踪 / 推进 / 结案 =====
// 每只传说妖一条支线,每条叙事线一个结案选择。
// 设计:任务不打断,只在修仙阁里显示进度。完成后弹结算。
import { LEGEND, LEGEND_LIST } from './legend.js';
import { STORY } from './story.js';
import { Cult } from './index.js';
import { Bag, STONES, SCROLLS, GOODS } from './items.js';

const K = 'xx_quest_v087';

// 支线完成条件表:不同妖,不同的结法
export const QUEST_COND = {
  hongyi:  { type:'visit',  where:['n10','n1'],  need:2, tip:'村外枯井(n10)与邻道(n1)' },
  laolao:  { type:'visit',  where:['n5','n7'], need:2, tip:'黑风岭与险地,愿牌散落之处' },
  baize:   { type:'peace',  key:'baize',       tip:'在秘境遇见白泽' },
  dangkang:{ type:'visit',  where:['n2','n1'], need:2, tip:'跟着白牛,它往山里去' },
  qingqiong:{type:'boss',  where:['n8'],      tip:'古战场,青穹每次都会经过' },
  jiangu:  { type:'visit',  where:['n8'],      need:1, tip:'断剑冢,看它演完那一招' },
  shijiang:{ type:'visit',  where:['n8'],      need:1, tip:'仙人墓,石将守着半句话' },
  dengshi: { type:'visit',  where:['n10','n3'], need:2, tip:'村外(n10)与南道(n3)的坟场' },
};

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
      const n = c.where.filter(w => p.visited[w]).length;
      return Math.min(1, n / c.need);
    }
    if (c.type === 'peace') return STORY.met(c.key) ? 1 : 0;
    if (c.type === 'boss')  return p.visited['n8'] ? 1 : 0;
    return 0;
  },
  // 条件是否达成
  ready(key) { return this.progress(key) >= 1; },

  // —— 结案:双结局 ——
  finish(key, path) {
    const l = LEGEND[key];
    if (!l) return { ok:false, msg:'无此支线' };
    if (!this.ready(key)) return { ok:false, msg:'还没办成。' };
    this.s.active = this.s.active.filter(k=>k!==key);
    this.s.done[key] = { path, at: Date.now() };
    const reward = this.grant(l.quest.reward, path);
    this.save();
    return { ok:true, path, quest:l.quest, reward };
  },
  // 奖励发放
  grant(rw, path) {
    const got = { dao:0, scroll:null, item:null, special:null, text:[] };
    if (!rw) return got;
    if (rw.dao) { Cult.get().dao += rw.dao; got.dao = rw.dao; got.text.push(`道行 +${rw.dao}`); }
    if (rw.scroll) {
      const sc = SCROLLS[rw.scroll];
      if (sc) { Bag.add(rw.scroll, 1); got.scroll = rw.scroll;
        got.text.push(`${sc.name} ×1`); }
    }
    if (rw.item) { Bag.add(rw.item, 1); got.item = rw.item;
      got.text.push(`${(STONES[rw.item]||GOODS[rw.item]||{name:rw.item}).name} ×1`); }
    if (rw.special) { got.special = rw.special; Cult.get().dao += path===1?0:300;
      if (path===2) got.text.push('道行 +300'); }
    Cult.commit();
    return got;
  },

  // 特殊结局交互(白泽问答等)—— 返回给 UI 用的提示
  specialPrompt(key) {
    const l = LEGEND[key];
    if (!l) return null;
    switch (l.quest.reward.special) {
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