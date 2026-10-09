// ===== 主线骨架(V0.99)=====
// 工单 XX-SPINE-001
//
// 为什么需要这一层:
//   34 个模块每一个都自洽,但**各自独立触发**。玩家的感觉是
//   「东搞搞西搞搞,越来越难拼」——因为没有任何一条线把它们串起来。
//   砍妖是砍妖,叙事是叙事,领地是领地,篝火是篝火。
//
//   这一层不做新玩法,只做**因果编排**:
//   把「你做了什么」→「因此什么发生」→「于是你能做什么」显式化。
//
// 四个阶段(对应 CREATIVE.md 的叙事线结构):
//   1. 出村   —— 你在青石村醒来,篝火是唯一的锚点
//   2. 遇见   —— 传说妖出现,每只带来一段来历
//   3. 介入   —— 你选择管/不管,因果开始分叉
//   4. 抉择   —— 双结局:你是什么人,而不是你好不好
//
// 设计约束:
//   · 纯数据 + 纯函数,不碰任何现有模块的状态结构
//   · 现有模块通过 BACKBONE.observe() 挂进来,不反向依赖
//   · 任何阶段判定都必须可解释(玩家能看出为什么推进)

import { SAVE_KEYS } from './save-keys.js';
const K = SAVE_KEYS.spine;

// ————————————————— 阶段定义 —————————————————

export const PHASES = {
  // 1 出村:篝火燃起即入此阶段
  depart: {
    id: 'depart', n: 1, name: '出 村',
    desc: '你在青石村醒来。身边只有一堆火。',
    goal: '把篝火烧起来 —— 它是你在这个世界上第一个锚点',
    enter: '篝火首次点燃',
  },
  // 2 遇见:第一次见到传说妖
  encounter: {
    id: 'encounter', n: 2, name: '遇 见',
    desc: '路上有些东西,它们有来处。',
    goal: '见到三只传说妖,听清它们的来历',
    enter: '篝火已燃 且 见到 ≥1 只传说妖',
  },
  // 3 介入:开始做选择,而不只是清怪
  intervene: {
    id: 'intervene', n: 3, name: '介 入',
    desc: '知道了来处,接下来是你的事。',
    goal: '完成一条叙事线的第一个抉择',
    enter: '见到 ≥3 只传说妖 且 接下 ≥1 条支线',
  },
  // 4 抉择:双结局解锁
  ending: {
    id: 'ending', n: 4, name: '抉 择',
    desc: '半句话,补完哪半,定义你是谁。',
    goal: '走到仙人墓,补完那句话',
    enter: '完成 ≥2 条叙事线 且 仙人墓已开启',
  },
};

// ————————————————— 因果图 —————————————————
//
// CREATIVE.md 里「红衣女鬼 → 黑山姥姥 → 愿牌」是有因果的,
// 但当前代码里它们是三条独立的 lore 文本,玩家看不出链条。
// 这里把因果显式化:遇到 B 的时候,如果 A 已经见过,就补一句关联。
//
// 关联强度:
//   origin —— A 是一切的起点,见 B 时必提 A
//   linked —— A 与 B 同源,提一句「你记得…」
//   echo   —— 弱呼应,不提也行,提了更好

export const CAUSAL_LINKS = {
  // 红衣女鬼 → 黑山姥姥:姥姥卖的就是女鬼
  laolao: [
    { from: 'hongyi', rel: 'origin',
      line: '她记得那个被卖给她的女孩。' },
  ],
  // 愿牌:姥姥卖人的凭据
  hongyi: [
    { from: 'laolao', rel: 'origin',
      line: '她腰间那块愿牌,是从姥姥手里换来的。' },
  ],
  // 白泽:见白泽者不必再问天 → 他为什么不走
  baize: [
    { from: 'shijiang', rel: 'echo',
      line: '它守着的那句话,和石将背上的,是同一句。' },
  ],
  // 石将:守的是没说完的话 → 与双结局直接相连
  shijiang: [
    { from: 'baize', rel: 'linked',
      line: '白泽不肯走,因为这句话还没人接。' },
  ],
  // 剑骨:第三百零一柄 → 与古战场相连
  jiangu: [
    { from: 'hongyi', rel: 'linked',
      line: '三百柄断剑里,只有他的名字没有被刻上去。' },
  ],
  // 灯尸:引错方向 → 与愿牌/姥姥呼应
  dengshi: [
    { from: 'hongyi', rel: 'echo',
      line: '纸人举着愿牌,却引向了错的方向。' },
  ],
  // 青穹:虎啸风生
  qingqiong: [
    { from: 'dangkang', rel: 'linked',
      line: '云生风处,风起云涌 —— 它一直在这儿。' },
  ],
};

// ————————————————— 状态 —————————————————

function defaultState() {
  return {
    phase: 'depart',
    seen: {},        // 见过的传说妖 key → 时间戳
    quests: {},      // 接下的支线 key → 状态
    arcsDone: {},    // 完成的叙事线
    choices: {},     // 做过的抉择
    tombstone: false,// 仙人墓是否开启
    ending: null,    // 'none' | 'unlone' | 'noless'
    log: [],         // 阶段推进记录(时间痕迹)
  };
}

export const SPINE = {
  s: defaultState(),

  load() {
    try {
      const raw = localStorage.getItem(K);
      this.s = raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
    } catch { this.s = defaultState(); }
    return this.s;
  },
  get() { return this.s; },
  commit() { try { localStorage.setItem(K, JSON.stringify(this.s)); } catch {} },
  reset() { this.s = defaultState(); try { localStorage.removeItem(K); } catch {} },

  // —— 阶段判定(纯函数,只读)——
  _compute(s) {
    const nSeen = Object.keys(s.seen).length;
    const nQuest = Object.keys(s.quests).filter(k => s.quests[k] === 'active').length;
    const nArc = Object.keys(s.arcsDone).length;

    if (s.tombstone && nArc >= 2) return 'ending';
    if (nSeen >= 3 && nQuest >= 1) return 'intervene';
    if (nSeen >= 1) return 'encounter';
    return 'depart';
  },

  /** 当前阶段 */
  phase() { return PHASES[this.s.phase] || PHASES.depart; },

  /** 推进到该玩家应有的阶段。会记一笔时间痕迹。 */
  sync() {
    const want = this._compute(this.s);
    if (want !== this.s.phase) {
      const from = this.s.phase;
      this.s.phase = want;
      this.s.log.push({ from, to: want, at: Date.now() });
      if (this.s.log.length > 30) this.s.log.shift();
      this.commit();
      return { changed: true, from, to: want };
    }
    return { changed: false };
  },

  /** 当前阶段的目标进度(给 UI 显示「离下一步还差多少」) */
  progress() {
    const s = this.s;
    const p = this.s.phase;
    if (p === 'depart')  return { text: '把篝火点起来', cur: 0, need: 1 };
    if (p === 'encounter') return { text: `见过传说妖 ${Object.keys(s.seen).length}/3`, cur: Object.keys(s.seen).length, need: 3 };
    if (p === 'intervene') {
      const q = Object.keys(s.quests).filter(k => s.quests[k] === 'active').length;
      return { text: `接下支线 ${q}/1`, cur: q, need: 1 };
    }
    return { text: '走到仙人墓,补完那句话', cur: s.arcsDone ? Object.keys(s.arcsDone).length : 0, need: 2 };
  },

  // ——————————— 挂载点:现有模块往这里汇 ———————————

  /**
   * 见到一只传说妖。
   * @returns {{lines:string[]}} 因果提示(可能为空)
   */
  observeLegend(key) {
    const s = this.s;
    const isFirst = !s.seen[key];
    s.seen[key] = Date.now();
    this.commit();
    this.sync();
    // 只在第一次见到时给因果提示,重复遇见不重复啰嗦
    return isFirst ? { lines: this._causalFor(key, s) } : { lines: [] };
  },

  /** 见到某只妖时,应该补哪些因果句 */
  _causalFor(key, s) {
    const links = CAUSAL_LINKS[key];
    if (!links) return [];
    return links
      .filter(l => s.seen[l.from])      // 只提玩家已经遇过的
      .map(l => l.line);
  },

  /** 支线状态变化 */
  observeQuest(key, status) {
    this.s.quests[key] = status;   // 'active' | 'done'
    this.commit();
    this.sync();
  },

  /** 叙事线推进 */
  observeArc(key, done) {
    if (done) this.s.arcsDone[key] = Date.now();
    this.commit();
    this.sync();
  },

  /** 仙人墓开启 */
  openTomb() {
    this.s.tombstone = true;
    this.commit();
    this.sync();
  },

  /** 双结局结算 —— 不改奖励大小,只定义你是谁 */
  chooseEnding(which) {
    this.s.ending = which === 'unlone' ? '奈何无人共' : '此生无悔';
    this.s.choices.ending = this.s.ending;
    this.commit();
    this.sync();
    return this.s.ending;
  },

  /** 年表:阶段推进记录(时间痕迹) */
  timeline() { return this.s.log.slice(); },
};

/**
 * 挂到 main.js 的开局。确保进度与修仙阁状态一致。
 * 故意做成独立模块,现有模块不需要改。
 */
export function installSpine(cultState, campState) {
  SPINE.load();
  try {
    if (!campState || !campState.burning || campState.burning()) SPINE.sync();
  } catch {}
  return SPINE;
}