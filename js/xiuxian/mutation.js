// ===== 灵伴变异体系 · 数据层与状态机 =====
// 工单: XX-MUTATION-001(数据层) / XX-MUTATION-002(存档接入)
//
// 设计依据 docs/COMPANION-MUTATION.md。三个原则,写死在这:
//  1. **不新造概率系统** —— 稀有度轴复用 loot.js 的「墨分五色」GRADE,
//     投喂物复用 items.js 已有的六阶源石 STONES,不另立一套权重表。
//     (踩过的坑:之前 loot.js 里写 `import rng.js` 导致整个模块加载失败。)
//  2. **变异方向不由玩家直接选** —— 按投喂品阶随机抽族,
//     这是设计上的"赌博";玩家唯一的手动权是「这次先变哪个部位」。
//  3. **一切可量化** —— 每个形态特征都落到具体数字(角度/长度/数量/色相),
//     不写"更成熟一点"这种出图无法复现的形容词。
//
// ⚠️ 本文件**不碰 UI**。投喂入口与真身抉择分别是 XX-MUTATION-003 / 004,
// 它们必须真的被玩家走到(AGENTS.md §0A 三问),不能只活在单测里。
//
// 确定性:所有随机都走可注入的 rng(默认 Math.random),
// 测试传种子函数即可复现 —— 与 tests/test-rng.mjs 的种子纪律一致。

/* ——————————————————————— 一、五阶段 ——————————————————————— */

// need = 累计投喂次数门槛。bg = 立绘背景档位(0~4,对应 §五)。
export const STAGES = [
  { key:'sealed', name:'封印', need: 0, bg:0, desc:'五官模糊,轮廓被墨缠绕,看不清脸' },
  { key:'awaken', name:'初醒', need: 1, bg:1, desc:'五官轮廓浮现,仍有墨痕覆盖' },
  { key:'reveal', name:'显形', need: 3, bg:2, desc:'脸完全清晰,出现第一个特征' },
  { key:'morph',  name:'化形', need: 6, bg:3, desc:'两个特征成型,肢体开始变化' },
  { key:'true',   name:'真身', need:10, bg:4, desc:'全部特征定格,背景完全专属' },
];
export const MAX_STAGE = STAGES.length - 1;   // = 4

/* ——————————————————————— 二、变异族 ——————————————————————— */

// 族是**稀有度抽出来的结果**,不是玩家点的。
// tone 一栏是给美术看的方向词,不是数值。
export const FAMILIES = {
  bone:    { key:'bone',    name:'骸', tone:'苍白骨感,关节外露,克苏鲁骨骼轮廓', sigil:'☠', bg:'墓园水墨' },
  aberrant: { key:'aberrant', name:'畸', tone:'左右不对称,比例失调,多肢',        sigil:'⁂', bg:'错位几何' },
  allure:   { key:'allure',   name:'魅', tone:'柔美,五官精致但仍带墨痕',          sigil:'❈', bg:'朱砂晕染' },
  demon:    { key:'demon',    name:'魔', tone:'角与翼,竖瞳,暗红皮肤',            sigil:'♆', bg:'熔岩朱砂' },
  beast:    { key:'beast',    name:'妖', tone:'兽耳兽尾,非人瞳',                  sigil:'✦', bg:'竹林夜月' },
  celest:   { key:'celest',   name:'仙', tone:'人类五官但极度精致,近乎无瑕',      sigil:'✧', bg:'云海金' },
};
export const FAMILY_LIST = Object.values(FAMILIES);

/** 良品族 —— 保底机制的目标集合。低阶喂不出恶魔/巨乳向,这是刻意的。 */
export const LUCKY = ['allure', 'demon', 'beast', 'celest'];

/** 品阶 1~6 → 各族倾向权重。绝对概率由本表统一算,不另设每族独立概率。 */
export const FAMILY_TABLE = {
  1: { bone:0.70, aberrant:0.25, allure:0.05 },
  2: { bone:0.62, aberrant:0.33, allure:0.05 },
  3: { bone:0.30, aberrant:0.30, allure:0.40 },
  4: { demon:0.50, beast:0.30, celest:0.20 },
  5: { demon:0.45, beast:0.30, celest:0.25 },
  6: { bone:0.20, aberrant:0.20, allure:0.20, demon:0.15, beast:0.15, celest:0.10 },
};

/** 真身抉择「伸手」时的确定性路线:品阶 → 族。绕开随机,给玩家一个可预期的兑现。 */
export const ROUTE_BY_TIER = {
  1:'bone', 2:'aberrant', 3:'allure', 4:'demon', 5:'beast', 6:'celest',
};

/* ——————————————————————— 三、改造部位(玩家唯一手动权) ——————————————————————— */

// 每次投喂选一个部位。可以重复选 —— 喂得多且专,该部位变化才显著。
export const PARTS = [
  { key:'skin', name:'肤色', desc:'从纸白 → 苍白 → 灰蓝 → 暗红' },
  { key:'limb', name:'肢体', desc:'手脚、关节、翼的比例变化' },
  { key:'eye',  name:'眼',   desc:'眼睛形态与瞳色' },
  { key:'ear',  name:'耳',   desc:'耳型与角度' },
  { key:'horn', name:'尾角', desc:'追加器官:尾 / 角' },
];
export const PART_KEYS = PARTS.map(p => p.key);

/* ——————————————————————— 四、可量化参数表 ——————————————————————— */

// 耳型。angle = 尖端相对水平线的角度(度),len = 相对人类耳长倍率。
// flip = 外翻角,fuzz = 内侧绒毛,spiral = 螺旋度,hard = 硬质(非软骨)。
export const EAR_TABLE = {
  human: { type:'human', len:1.00, angle:  0, flip: 0,  fuzz:0, spiral:0, hard:0 },
  elf:   { type:'elf',   len:1.35, angle: 35, flip: 0,  fuzz:0, spiral:0, hard:0 },
  beast: { type:'beast', len:1.15, angle:  0, flip:20,  fuzz:1, spiral:0, hard:0 },
  demon: { type:'demon', len:1.80, angle:  0, flip: 0,  fuzz:0, spiral:1, hard:1 },
  bone:  { type:'bone',  len:0.00, angle:  0, flip: 0,  fuzz:0, spiral:0, hard:1, spine:1 },
};

// 眼型。count = 眼数(⚠️ 「有没有眼睛」由**剧情节点**决定,不由随机决定,
// 见 dramaGrant();随机只决定**形态**)。pupil = 瞳仁形态,glow = 自发光色。
export const EYE_TABLE = {
  human:    { type:'human',    count:2, pupil:'round',  glow:null },
  hollow:   { type:'hollow',   count:2, pupil:'none',   glow:'#6fb7ff' },  // 骸:眼窝内无瞳仁
  slit:     { type:'slit',     count:2, pupil:'slit',   glow:null },      // 魔:竖瞳
  beast:    { type:'beast',    count:2, pupil:'horiz',  glow:null },      // 妖:虹膜横裂
  luminous: { type:'luminous', count:2, pupil:'none',   glow:'#ffe9a8' },  // 仙:全瞳无瞳仁
  aberrant: { type:'aberrant', count:2, pupil:'round',  glow:null, asym:true },
  third:    { type:'third',    count:3, pupil:'slit',   glow:'#c8a2ff' },  // 畸:额心第三只
  many:     { type:'many',     count:4, pupil:'slit',   glow:'#c8a2ff' },  // 极端:4~6 只
};

// 肤质。hue 0~360 / sat 0~1 / rough 0~1(0=光滑 0.5=鳞片初现 1=骨质)。
export const SKIN_TABLE = {
  bone:    { hue:210, sat:0.06, rough:0.85 },
  aberrant: { hue:285, sat:0.12, rough:0.50 },
  allure:   { hue: 25, sat:0.18, rough:0.05 },
  demon:    { hue:355, sat:0.32, rough:0.35 },
  beast:    { hue: 30, sat:0.25, rough:0.55 },
  celest:   { hue: 45, sat:0.10, rough:0.00 },
};

// 族 → 各部位默认形态。points(投喂点数)再在此基础上做偏移。
const FAMILY_FORM = {
  bone:    { ear:'bone',    eye:'hollow',   skin:'bone',    wing:'none',      tail:'bone-tail', horn:0 },
  aberrant: { ear:'human',   eye:'aberrant', skin:'aberrant', wing:'none',      tail:'none',      horn:0 },
  allure:   { ear:'elf',     eye:'human',    skin:'allure',   wing:'none',      tail:'none',      horn:0 },
  demon:    { ear:'demon',   eye:'slit',     skin:'demon',    wing:'membrane',  tail:'spade',     horn:2 },
  beast:    { ear:'beast',   eye:'beast',    skin:'beast',    wing:'none',      tail:'fluff',     horn:0 },
  celest:   { ear:'human',   eye:'luminous', skin:'celest',   wing:'none',      tail:'none',      horn:0 },
};

/** 每个阶段的头身比下限(封印态是 Q 版三头身,随解封逐步拉长) */
export const RATIO_BY_STAGE = [2.5, 3.2, 4.2, 5.5, 6.5];

/** 保底:连续这么多次没出良品族,下一次强制出 */
export const PITY_AFTER = 10;

export const TOTAL_FEEDS = STAGES[MAX_STAGE].need;   // = 10

/* ——————————————————————— 五、状态机 ——————————————————————— */

/** 初始变异状态。COMPANION.s.mut 与本函数共用,避免两处写漂移。 */
export function defaultMut() {
  return {
    stage: 0,          // 当前阶段索引 0~4
    feeds: 0,          // 累计投喂次数(阶段唯一驱动量)
    family: null,      // 变异族 key,第一次投喂才定
    best: 0,           // 历史最高投喂品阶 1~6,真身抉择要用
    pity: 0,           // 连续未出良品族次数
    parts: { skin:0, limb:0, eye:0, ear:0, horn:0 },  // 各部位累计点数
    lastTier: 0,       // 最近一次投喂品阶
    drama: null,       // 剧情授予的眼型(如 third/many),压过族的默认眼型
    chosen: false,     // 真身抉择是否已做
    reach: false,      // 抉择结果:伸手=true / 收回=false
    skippedMorph: false, // 伸手分支跳过化形阶段
  };
}

const clampTier = t => Math.min(6, Math.max(1, Math.floor(t) || 1));

/** 按累计投喂次数算阶段索引。门槛见 STAGES[].need */
export function stageOf(feeds) {
  let s = 0;
  for (let i = 0; i < STAGES.length; i++) if (feeds >= STAGES[i].need) s = i;
  return s;
}

/**
 * 抽变异族。
 * @param {number} tier 投喂品阶 1~6
 * @param {number} pity  当前连续未出良品族次数
 * @param {function} [rng] 返回 [0,1) 的随机源,默认 Math.random
 */
export function rollFamily(tier, pity = 0, rng = Math.random) {
  // 保底:连续 PITY_AFTER 次没出良品族 → 下一次强制出。这是硬规则,不是可选优化,
  // 否则低阶玩家会永远停在骸族而弃坑。
  if (pity >= PITY_AFTER) {
    const pool = FAMILY_TABLE[6];
    return weighted(Object.fromEntries(LUCKY.map(k => [k, pool[k]])), rng);
  }
  return weighted(FAMILY_TABLE[clampTier(tier)], rng);
}

/** 权重表抽一个 key。权重和不必为 1,内部归一化 —— 与 loot.js 同一原则。 */
function weighted(table, rng) {
  const keys = Object.keys(table);
  let total = 0;
  for (const k of keys) total += table[k];
  let r = rng() * total;
  for (const k of keys) { r -= table[k]; if (r <= 0) return k; }
  return keys[keys.length - 1];
}

export const MUTATION = {
  STAGES, MAX_STAGE, FAMILIES, FAMILY_LIST, LUCKY, FAMILY_TABLE,
  ROUTE_BY_TIER, PARTS, PART_KEYS,
  EAR_TABLE, EYE_TABLE, SKIN_TABLE, RATIO_BY_STAGE, PITY_AFTER, TOTAL_FEEDS,
  defaultMut, stageOf, rollFamily,

  // ————— 事件钩子(XX-MUTATION-005)—————
  // 放在这里而不是 `COMPANION`,有两个理由:
  //  1. **归属正确** —— `mutate` / `final` 本来就是变异事件,不是泛化事件。
  //  2. `companion.js` 有一条体积守卫(`test-companion.mjs` 要求它远小于
  //     V0.98 重做前的 342 行),那是为了守住「菜单系统没长回来」。
  //     把事件钩子塞进去会顶破它 —— 而放宽阈值就是「改实现改测试」,指标错了。
  //     让 companion.js 保持瘦,是那条守卫存在的意义。
  //
  // 模型层**只发事件不喊话**:companion-broadcast 是视图模块,
  // 由 bond.js 订阅后转给它。于是 **ui.js 一行都不用改**(与 Z8 并行开发零冲突)。
  _subs: {},

  /** 订阅。返回退订函数,免得测试里卸不干净 */
  on(ev, fn) {
    (this._subs[ev] || (this._subs[ev] = [])).push(fn);
    return () => { const a = this._subs[ev]; if (a) a.splice(a.indexOf(fn), 1); };
  },

  emit(ev, data) {
    const a = this._subs[ev];
    if (!a) return 0;
    let n = 0;
    // 复制一份再遍历:回调里退订自己不会打乱正在进行的循环
    for (const fn of a.slice()) { try { fn(data); n++; } catch {} }
    return n;
  },

  /** 测试与重置用:摘掉全部订阅(应用接线在正常运行期不这么调) */
  offAll() { this._subs = {}; },

  /** 距下一阶段还差几次投喂;已在真身则返回 0 */
  toNext(mut) {
    if (mut.stage >= MAX_STAGE) return 0;
    return STAGES[mut.stage + 1].need - mut.feeds;
  },

  /** 进度 n/total,UI 显示用 */
  progress(mut) {
    return { feeds: mut.feeds, total: TOTAL_FEEDS };
  },

  /**
   * 投喂一次。
   *
   * ⚠️ 族**每次都重抽**,不是第一次抽完就锁死。
   * 一开始写成 `mut.family || rollFamily(...)`,结果族在第 1 次投喂后永远不变,
   * 保底计数一路涨到 10 以上却再也不会触发 rollFamily —— 低阶玩家会永远停在骸族,
   * 整个"稀有度驱动"是死的。是 tests/mutation-regression.mjs 的
   * 「60 次低阶后必已出良品族」抓出来的。
   * 现在每次重抽:喂什么阶就有什么概率,这才是玩家能感知的赌博。
   *
   * @param {object} mut     变异状态(就地修改)
   * @param {number} tier    投喂品阶 1~6(源石阶)
   * @param {string} part    玩家选的改造部位,见 PART_KEYS
   * @param {function} [rng]
   * @returns {{stageUp:boolean,from:number,to:number,family:string,part:string,tier:number}}
   */
  feed(mut, tier, part, rng = Math.random) {
    if (!PART_KEYS.includes(part)) throw new Error('未知改造部位: ' + part);
    const t = clampTier(tier);
    const from = mut.stage;
    const fam = rollFamily(t, mut.pity, rng);
    mut.family = fam;
    mut.pity = LUCKY.includes(fam) ? 0 : mut.pity + 1;
    mut.feeds++;
    mut.best = Math.max(mut.best, t);
    mut.lastTier = t;
    mut.parts[part]++;
    mut.stage = stageOf(mut.feeds);
    const ev = { stageUp: mut.stage > from, from, to: mut.stage, family: fam, part, tier: t };
    this.emit('mutate', ev);          // 播报交给订阅方(XX-MUTATION-005)
    return ev;
  },

  /**
   * 剧情授予眼型 —— **只有剧情能改「有没有眼睛 / 几只眼睛」**。
   * 随机只决定形态。这是规格里的硬约束,不是接口冗余。
   * @param {object} mut
   * @param {'third'|'many'} eyeType
   */
  dramaGrant(mut, eyeType) {
    if (eyeType !== 'third' && eyeType !== 'many') throw new Error('剧情眼型不合法: ' + eyeType);
    mut.drama = eyeType;
    return mut.drama;
  },

  /** 真身抉择是否可用:到真身阶段且还没选过 */
  canChooseFinal(mut) { return mut.stage >= MAX_STAGE && !mut.chosen; },

  /**
   * 体系是否已完结(真身抉择已定)。
   * 定稿之后不能再投喂 —— 阶段在 MAX_STAGE 已经封顶,再投只会让部位点数
   * 无限增长而什么都不变。UI 用它来关掉入口。
   */
  isDone(mut) { return !!mut.chosen; },

  /**
   * 真身抉择结算。
   * @param {object} mut
   * @param {boolean} reach true=伸手(路线修正) / false=收回(维持随机结果)
   *
   * 伸手 → 族由「历史最高投喂品阶」确定性决定(ROUTE_BY_TIER),并跳过化形阶段直落真身。
   * 收回 → 维持抽出来的族,但仍正常定稿。
   */
  resolveFinal(mut, reach) {
    if (!this.canChooseFinal(mut)) throw new Error('真身抉择尚未开放');
    mut.chosen = true;
    mut.reach = !!reach;
    if (reach) {
      const tier = clampTier(mut.best || mut.lastTier || 1);
      mut.family = ROUTE_BY_TIER[tier];
      // 伸手 = 不走化形过场,直接定稿真身。
      // ⚠️ 这里**不能**写成 `mut.feeds < STAGES[3].need`:canChooseFinal 已要求
      // feeds ≥ 10,那个条件恒为 false,skippedMorph 成了永不触发的死字段。
      // (tests/mutation-regression.mjs 的「喂不够 6 次时伸手 → 跳过化形」抓出来的。)
      mut.skippedMorph = true;
      mut.stage = MAX_STAGE;
    }
    const out = { family: mut.family, reach: mut.reach, skippedMorph: mut.skippedMorph };
    this.emit('final', out);
    return out;
  },

  /**
   * 派生全部可量化形态参数 —— 立绘/生图直接吃这个对象。
   * @param {object} mut
   * @returns {{stage,bg,family,ear,eye,skin,limb,horn,tail,ratio}}
   */
  derive(mut) {
    const fam = mut.family ? FAMILY_FORM[mut.family] : FAMILY_FORM.allure;
    const famKey = mut.family || 'allure';
    const st = Math.min(MAX_STAGE, mut.stage);
    const p = mut.parts || defaultMut().parts;

    // 耳:族默认形态 + 投喂点数加长/加角度(每点 8% 长度、4° 角度,封顶防跑飞)
    const earBase = EAR_TABLE[fam.ear];
    const ear = {
      ...earBase,
      len: +(earBase.len * (1 + Math.min(p.ear, 5) * 0.08)).toFixed(3),
      angle: earBase.angle + Math.min(p.ear, 5) * 4,
    };

    // 眼:剧情授予压过族默认 —— 「有没有几只眼」永远只由剧情决定
    const eyeKey = mut.drama || fam.eye;
    const eyeBase = EYE_TABLE[eyeKey] || EYE_TABLE.human;
    const eye = { ...eyeBase, count: eyeBase.count, fromDrama: !!mut.drama };

    // 肤质:族基准 + 投喂点数推饱和与粗糙
    const sk = SKIN_TABLE[fam.skin];
    const skin = {
      hue: sk.hue,
      sat: +Math.min(0.6, sk.sat + p.skin * 0.03).toFixed(3),
      rough: +Math.min(1, sk.rough + p.skin * 0.04).toFixed(3),
    };

    // 肢体:头身比随阶段拉长;畸族可多肢;关节可见度由骨感推
    const limb = {
      ratio: RATIO_BY_STAGE[st],
      extra: famKey === 'aberrant' ? (p.limb >= 4 ? 4 : p.limb >= 2 ? 2 : 0) : 0,
      wing: p.limb >= 3 ? fam.wing : 'none',
      jointVis: famKey === 'bone' ? +Math.min(1, 0.4 + p.limb * 0.12).toFixed(2) : 0,
    };

    // 尾角:族默认 + 点数追加
    const horn = { count: fam.horn + (p.horn >= 3 ? 2 : p.horn >= 1 ? 1 : 0), spiral: p.horn >= 3 ? 1 : 0 };
    const tail = { count: p.horn >= 4 ? 2 : p.horn >= 2 ? 1 : 0, type: p.horn >= 2 ? fam.tail : 'none' };

    return {
      stage: st, bg: STAGES[st].bg, family: famKey,
      ear, eye, skin, limb, horn, tail,
      ratio: RATIO_BY_STAGE[st],
    };
  },

  /** 给广播条/图鉴用的一行摘要 */
  title(mut) {
    if (!mut.family) return STAGES[0].name;
    const f = FAMILIES[mut.family];
    return `${f.sigil}${f.name}·${STAGES[Math.min(MAX_STAGE, mut.stage)].name}`;
  },
};