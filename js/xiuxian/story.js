// ===== 叙事引擎 · 世界在运转 =====
// 奖励:结案时二选一发放。数值按线的分量给,传说线最重。
// 核心:不是随机抽事件,而是世界按「剧本」推进。
// 一个事件发生 → 产生余波 → 余波改变地图/流言/可刷的怪 → 再产生下一环。
// 每条线都有 3~4 环,玩家介入能改结局。

import { SAVE_KEYS } from './save-keys.js';
const K = SAVE_KEYS.story;

// —— 剧本:每条线一个「剧情」,多环推进 ——
// 每条线的结案奖励(path 1 / path 2)
export const ARC_REWARD = {
  hongyi:   [{dao:900, scroll:'scroll_2'}, {dao:600, item:'bld_field', scroll:'scroll_2'}],
  laolao:   [{dao:2600, scroll:'scroll_3'}, {dao:1800, item:'xi_sui', scroll:'scroll_3'}],
  tomb:     [{dao:3000, scroll:'scroll_4'}, {dao:2200, item:'bld_tower', scroll:'scroll_4'}],
  jiangu:   [{dao:2000, item:'stone_3'}, {dao:2400, scroll:'scroll_3', item:'stone_3'}],
  auspicious:[{dao:1600, scroll:'scroll_4'}, {dao:2800, item:'stone_4', scroll:'scroll_4'}],
};

export const ARCS = {
  // 一、红衣女鬼:由一桩旧婚事引发
  hongyi: {
    name:'红 嫁 衣', mob:'hongyi',
    beats:[
      { at:0, node:'n0', text:'青石村东头那口枯井,最近总有人听见哭声。',
        rumor:'村里人说:井里夜里红彤彤的,像有人在办喜事。',
        reveal:'她叫阿禾。十六岁那年,她爹把她卖给了黑山姥姥。' },
      { at:1, node:'n0', text:'有人在井边捡到一角红布。绣的是并蒂莲,针脚很拙。',
        rumor:'绣活计差 —— 说明她没学过。她本来不用会这个。',
        reveal:'她本该在那一年的冬天穿上它。' },
      { at:2, node:'n4', text:'红布的下半截在青岚秘境的一具骸骨手里。骸骨的腕上,缠着红绳。',
        rumor:'秘境里那具尸首,和井里哭的那个,是同一个人。',
        reveal:'黑山姥姥收的人,都穿着嫁衣下葬。' },
      { at:3, node:'n5', text:'你把嫁衣凑齐了。现在该问她一句:想不想走。',
        rumor:'井不哭了。',
        reveal:'她想走。她只是不知道往哪儿走。',
        epilogue:'她把嫁衣给你留下了。井还是井,但从此不哭了。',
        epilogue2:'你把嫁衣烧了。她的名字终于能写全了。' },
    ],
  },
  // 二、黑山姥姥:许愿链
  laolao: {
    name:'愿 牌', mob:'laolao',
    beats:[
      { at:0, node:'n9', text:'落云镇有个孩子病了。看了三个大夫,都说不是病。',
        rumor:'不是病,是要价。那孩子许过愿。',
        reveal:'他许的是「让我娘好起来」。' },
      { at:1, node:'n7', text:'黑风岭的石头缝里,挂满了写着字的木牌。都是愿。',
        rumor:'愿上写的名字,没有一个活着兑现。',
        reveal:'姥姥收愿,不定价格 —— 她看你能付多少,你就欠多少。' },
      { at:2, node:'n5', text:'你找到了那块愿牌。字是她自己刻的,歪歪扭扭。',
        rumor:'字丑是因为她不识字。她不是一开始就是妖怪。',
        reveal:'她原是某家小姐,那年大饥,爹把她卖给了人贩子。' },
      { at:3, node:'n5', text:'愿牌在你手里。姥姥在洞府里等着 —— 她知道你要来。',
        rumor:'她在等。六十年来,第一次有人要替别人还愿。',
        reveal:'她要的不是你的命。她要一个「不许」的先例。',
        epilogue:'你把愿牌砸了。她说:记住你今天。她记住了。',
        epilogue2:'你替那孩子还了愿。她说:那我这六十年的愿,谁来还?' },
    ],
  },
  // 三、仙人墓:遗迹线
  tomb: {
    name:'半 句 话', mob:'shijiang',
    beats:[
      { at:0, node:'n8', text:'古战场遗迹最深处,有一座没在图上的墓。',
        rumor:'有人进去过,只出来一个人。那人从此不肯说话。',
        reveal:'墓主是化神期的大能。他不是被杀死的 —— 他是坐化的。' },
      { at:1, node:'n8', text:'墓道两壁刻满了字,全是同一个人的名字。',
        rumor:'刻了三百年。他一个人刻的。',
        reveal:'他在给自己记名 —— 怕自己忘了是谁。' },
      { at:2, node:'n8', text:'石将背上的字被凿掉了一半。剩下的半句是:「此生不悔」。',
        rumor:'石将不让任何人碰那半句话。碰了,就得补完。',
        reveal:'原话是「此生不悔,奈何无人共」。' },
      // 最后一环不在地面上:得亲自走进墓里,走到石将跟前
      { at:3, room:'sj', text:'石将侧过身,让出半步。它等你。',
        rumor:'补哪半,决定了你在这个故事里是谁。',
        reveal:'不悔的人独活。共过的人,一起死。',
        epilogue:'你补了「奈何无人共」。墓门开了。里面没有尸骨,只有一张空席。',
        epilogue2:'你补了「此生无悔」。石将跪下了。它终于能下班了。' },
    ],
  },
  // 四、剑骨:宿敌支线
  jiangu: {
    name:'第 三 百 一 柄', mob:'jiangu',
    beats:[
      { at:0, node:'n8', text:'断剑冢的剑,现在是三百零一柄了。',
        rumor:'多出来的那一柄,没有主人的名字。',
        reveal:'他叫沈骨。他是唯一一个赢过墨影的人。' },
      { at:1, node:'n8', text:'剑骨在原地演同一招,演了不知道多少年。',
        rumor:'他赢的那一剑,断了。断了就永远停在那一刻。',
        reveal:'不是墨影杀的。是那一剑本身承受不住。' },
      { at:2, node:'n8', text:'你站在他旁边看完了整招。他没有停,又来了一遍。',
        rumor:'他不记得你。他只记得那一剑。',
        reveal:'墨影其实一直在看。他每年都来,看一遍,走。' },
      { at:3, node:'n8', text:'你面前两个选择:拿走那柄剑,或者替他演完。',
        rumor:'拿走剑他解脱。替他演完,他还得再等一千年。',
        reveal:'墨影的碑上,沈骨的名字排在第一个。',
        epilogue:'剑归你了。他散了,散得很轻,像松了口气。',
        epilogue2:'你陪他演完了。他终于能停 —— 然后他对你鞠了一躬。' },
    ],
  },
  // 五、灵兽:机缘线
  auspicious: {
    name:'异 兽', mob:'baize',
    beats:[
      { at:0, node:'n2', text:'有个农户说,他家的牛一夜之间白了,他不敢再要。',
        rumor:'白牛不是宝,是替身。有东西借了它一辈子。',
        reveal:'那牛是当康变的。它在躲什么。' },
      { at:1, node:'n2', text:'白牛往山里的方向走了。你跟在后面,它不停。',
        rumor:'它不是跑,它是领路。',
        reveal:'它要带你去某个地方。' },
      { at:2, node:'n4', text:'秘境深处,白泽在看你。它问了一个问题。',
        rumor:'白泽问的问题,答错会死,答对会疯。',
        reveal:'它问的是:「你修这道,是为了什么?」' },
      { at:3, node:'n4', text:'它还在等。它没有不耐烦,它只是等 —— 等过的人它都记着。',
        rumor:'白泽不评判答案。它只记着。',
        reveal:'它在等,看你将来会变成什么。',
        epilogue:'你说:为了活。它没笑,点了点头,转身走了。',
        epilogue2:'你说了实话。它给了你一样东西,然后说:你会回来的。' },
    ],
  },
};

export const STORY = {
  s: { active: {}, done: {}, beat:{}, rumors: [], log: [], met: {}, t: 0 },

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) { const d = JSON.parse(r)||{};
        const def = { active:{}, done:{}, beat:{}, rumors:[], log:[], met:{}, t:0 };
        this.s = { ...def, ...d };
      }
    } catch {}
    return this.s;
  },
  save() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },

  // 启动:随机拉 2 条线进入活跃
  tick() {
    this.s.t++;
    const act = Object.keys(this.s.active).length;
    if (act < 2 && this.s.t % 3 === 0) {
      const cand = Object.keys(ARCS).filter(k => !this.s.active[k] && !this.s.done[k]);
      if (cand.length) this.start(this.pick(cand));
    }
    return this.s.active;
  },
  pick(a) { return a[Math.floor(Math.random()*a.length)]; },

  start(key) {
    const arc = ARCS[key];
    if (!arc || this.s.active[key] || this.s.done[key]) return false;
    this.s.active[key] = { at: 0, startedAt: this.s.t };
    this.s.beat[key] = 0;
    // 铺开第一环的流言
    this.pushRumor(arc.beats[0].rumor);
    this.logLine(arc.name, arc.beats[0].text);
    this.save();
    return true;
  },

  // 玩家到了某节点 → 检查是否有线该推进
  arrive(nodeId) {
    return this._advance(nodeId, 'node');
  },
  // 墓内房间触发(见 tomb.js)
  arriveRoom(roomId) {
    return this._advance(roomId, 'room');
  },
  _advance(nodeId, key2) {
    const out = [];
    for (const key of Object.keys(this.s.active)) {
      const arc = ARCS[key];
      const i = this.s.beat[key] || 0;
      const b = arc.beats[i];
      if (!b) continue;
      if (b[key2] === nodeId) {
        // 只有当玩家"知道"这一环才会推进(第一环自动,后续需玩家做过什么)
        const isLast = i >= arc.beats.length - 1;
        out.push({ arc:key, name:arc.name, beat:i, text:b.text, reveal:b.reveal,
                   last: isLast,
                   ep1: isLast ? arc.beats[i].epilogue  : null,
                   ep2: isLast ? arc.beats[i].epilogue2 : null });
        this.s.beat[key] = i + 1;
        this.logLine(arc.name, b.text);
        if (b.reveal) this.pushRumor(b.reveal);
        // 最后一环不自动结案:留给玩家选结局(见 finish)
        if (!isLast && this.s.beat[key] >= arc.beats.length) {
          delete this.s.active[key];
        }
      }
    }
    this.save();
    return out;
  },

  // 待结案:最后一环已看完,但还没选结局
  readyFinish(key) {
    const arc = ARCS[key];
    if (!arc) return false;
    if (this.s.done[key]) return false;
    return (this.s.beat[key] || 0) >= arc.beats.length;
  },
  // 结案:玩家选了哪条路 → 发奖
  finish(key, path, grant) {
    const arc = ARCS[key];
    if (!arc) return { ok:false, msg:'无此线' };
    if (this.s.done[key]) return { ok:false, msg:'已了结' };
    if (!this.readyFinish(key)) return { ok:false, msg:'还没看完。' };
    const last = arc.beats[arc.beats.length-1];
    const txt = path === 1 ? last.epilogue : last.epilogue2;
    const rw = (ARC_REWARD[key] || [])[path-1] || null;
    const reward = (rw && grant) ? grant(rw) : { text: rw ? [] : [] };
    this.s.done[key] = { at:this.s.t, epilogue:txt, path };
    delete this.s.active[key];
    this.logLine(arc.name, '【结案】' + txt);
    this.save();
    return { ok:true, name:arc.name, text:txt, reward };
  },

  // 流言池(商人/鬼火会念)
  pushRumor(text) {
    if (!text) return;
    this.s.rumors.unshift({ text, at: Date.now() });
    if (this.s.rumors.length > 30) this.s.rumors.length = 30;
    this.save();
  },
  // 取一条没用过的
  takeRumor() {
    const r = this.s.rumors.find(x => !x.used);
    if (r) { r.used = true; this.save(); }
    return r ? r.text : null;
  },
  rumorCount() { return this.s.rumors.filter(r=>!r.used).length; },

  // 行脚日记(叙事线日志)
  logLine(arc, text) {
    this.s.log.unshift({ arc, text, at: Date.now(), id:'l'+Date.now().toString(36) });
    if (this.s.log.length > 60) this.s.log.length = 60;
    this.save();
  },
  logsOf(key) { return this.s.log.filter(l => l.arc === ARCS[key]?.name); },

  reset() {
    this.s = { active:{}, done:{}, beat:{}, rumors:[], log:[], met:{}, t:0 };
    this.save();
  },
  // 待结案的线(看完最后一环,等玩家选结局)
  readyList() {
    return Object.keys(this.s.active)
      .filter(k => this.readyFinish(k))
      .map(k => ({
        key:k, name:ARCS[k].name,
        ep1: ARCS[k].beats[ARCS[k].beats.length-1].epilogue,
        ep2: ARCS[k].beats[ARCS[k].beats.length-1].epilogue2,
        mob: ARCS[k].mob,
      }));
  },
  activeList() {
    return Object.keys(this.s.active).map(k => ({
      key:k, name:ARCS[k].name, beat:this.s.beat[k]||0,
      total:ARCS[k].beats.length,
      next: ARCS[k].beats[this.s.beat[k]],
      mob: ARCS[k].mob,
    }));
  },
  doneList() {
    return Object.entries(this.s.done).map(([k,v]) => ({ key:k, name:ARCS[k].name, ...v }));
  },

  // 玩家在图鉴里见过的传说妖
  met(k) { return !!this.s.met[k]; },
  see(k) { if (!this.s.met[k]) { this.s.met[k] = Date.now(); this.save(); return true; } return false; },
  metList() { return Object.keys(this.s.met); },
};