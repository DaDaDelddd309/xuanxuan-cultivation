// ===== 掉落体系 · 独立模块(XX-DROP-001)=====
//
// 为什么独立成模块:之前掉率是**散落各处的字面量** ——
//   spirit.js 里 `e.boss ? 0.9 : e.elite ? 0.26 : 0.085`
//   pickups.js 里 `STONE_DROP = { elite: 0.30, mob: 0.004 }`
//   realms.js 里丹药 `rare: 0.18`
// 三套语言、没有统一稀有度轴、没有上限、没有保底 ——
// 调一个数不知道会影响谁,owner 实机说"爆率还是太高"我只能瞎猜改哪个。
//
// 参考的成熟做法(经检索核对):
//   1. **加权随机**:每件物品一个 weight,累加到 total,PRNG 落区间即命中
//      —— 而不是"每类怪一个独立概率"(我们原来是后者)
//   2. **稀有度阶梯**:全局基准 + 局部修正,不是拍脑袋的绝对值
//   3. **上限封顶**:任一档的概率不得越过天花板,否则经济崩
//   4. **保底(pity)**:连续 N 次未出货必给,防止极端非酋体验
//   5. **来源节奏(cadence)差异**:Boss 与可重复节点的合理概率本就不同
//
// 调性适配:业界用「白绿蓝紫橙金」彩虹稀有度,但**我们这套是水墨修仙** ——
// 87% 中性暗灰 + 13% 暖纸金,饱和度必须压到 0.2% 以下(见 docs/ART-PORTRAIT-SPEC.md)。
// 所以稀有度轴用**墨分五色**,不用彩虹:
//   清(最淡) → 淡 → 重 → 浓 → 焦(最深最珍)
// 不依赖 rng.js —— 用 Math.random 即可。
// 之前这行 import 会因为 rng.js 不存在而整个模块加载失败(实测报过同类错)。

// ───────────────────────── 稀有度轴:墨分五色 ─────────────────────────
// v 是该档的**基准权重**;cap 是它在任何档位下的**概率上限**。
export const GRADE = {
  qing:  { key:'qing',  name:'清', css:'--xx-paper-dim', v: 1000, cap: 0.42,  rank:1 },
  dan:   { key:'dan',   name:'淡', css:'--xx-paper-dim', v: 260,  cap: 0.18,  rank:2 },
  zhong: { key:'zhong', name:'重', css:'--xx-ink-4',     v: 64,   cap: 0.07,  rank:3 },
  nong:  { key:'nong',  name:'浓', css:'--xx-cinnabar-text', v: 15, cap: 0.03, rank:4 },
  jiao:  { key:'jiao',  name:'焦', css:'--xx-cinnabar', v: 3, cap: 0.012, rank:5 },
};
export const GRADE_LIST = Object.values(GRADE).sort((a, b) => a.rank - b.rank);

// ───────────────────────── 档位乘数:随难度递增 ─────────────────────────
// owner:「特殊物品稀有度应该按难度来」。这里只给**乘数**,不给绝对概率 ——
// 绝对概率由权重表统一算,避免"每类怪一个独立概率"那种各写各的。
export const TIER = {
  normal: { key:'normal', name:'普通', mul: 1.0 },
  elite:  { key:'elite',  name:'精英', mul: 6.7 },   // 是普通的 6.7 倍
  boss:   { key:'boss',   name:'秘窟', mul: 37.0 },  // 是普通的 37 倍
  secret: { key:'secret', name:'秘境', mul: 12.0 },
};

// ───────────────────────── 物品表 ─────────────────────────
// w    : 基准权重(同档内相对高低)
// from : 来源说明 —— 玩家一看就知道该去哪刷(之前 GOODS 完全没有这个字段)
// why  : 来历,掉落时进年表
// val  : 道行估值,用于算期望值
export const LOOT = {
  // —— 源石:篝火燃料,分六阶但**不是随机掉的**,靠合成/指定节点 ——
  stone_1: { id:'stone_1', kind:'stone', grade:'qing',  w:1000, val:  2,
             from:'野外散妖',   why:'最常见的源石碎屑,能烧小半个时辰。' },
  stone_2: { id:'stone_2', kind:'stone', grade:'zhong', w:  18, val:  9,
             from:'秘窟 / 合成', why:'炉火凝出的晶体,火旺且稳。' },
  stone_3: { id:'stone_3', kind:'stone', grade:'nong',  w:   4, val: 34,
             from:'秘境深处',    why:'玄黑中透着蓝芒,寻常修士求而不得。' },
  // —— 丹药 ——
  pill_zhuji:   { id:'pill_zhuji',   kind:'pill', grade:'zhong', w: 12, val:  60,
                  from:'境界·炼气圆满', why:'破炼气九转之壁,直入筑基。' },
  pill_jindan:  { id:'pill_jindan',  kind:'pill', grade:'nong',  w:  3, val: 420,
                  from:'境界·筑基圆满', why:'三转之基,成丹之钥。' },
  pill_yuanying:{ id:'pill_yuanying',kind:'pill', grade:'jiao', w:  1, val:1600,
                  from:'境界·金丹圆满', why:'碎丹成婴,神游太虚。' },
  // —— 货品 ——
  beiwen:   { id:'beiwen',   kind:'good', grade:'nong',  w:  5, val:  90,
              from:'墓中',   why:'墓主自己拓的。拓到一半,纸没了。' },
  yu_jian:  { id:'yu_jian',  kind:'good', grade:'dan',   w: 40, val:  25,
              from:'集市 / 流浪商人', why:'留一道讯息在风里,总有人听得到。' },
  fu_yin:   { id:'fu_yin',   kind:'good', grade:'dan',   w: 55, val:  18,
              from:'集市',   why:'贴在身上,一刻钟内不会有东西主动来找你。' },
  xi_sui:   { id:'xi_sui',   kind:'good', grade:'zhong', w: 14, val:  75,
              from:'秘境',   why:'涤荡入魔之气。一颗抵三次。' },
  zhan_bei: { id:'zhan_bei', kind:'good', grade:'jiao',  w:  1, val: 800,
              from:'极深处', why:'自立门户的凭证。有了它,营地才认你是自家人。' },
  tai_xu:   { id:'tai_xu',   kind:'pill', grade:'jiao',  w:  1, val:2400,
              from:'不可言说之处', why:'一粒抵十年苦修。仙人也就吃得起一颗。' },
};

// ───────────────────────── 保底 ─────────────────────────
// 连续 miss 多少次后必给当前能出的最好一档。
// 参考成熟做法:阈值 20~120。这里取 30(单局约 100~200 次掉落事件量级)。
export const PITY = { threshold: 30 };

/**
 * 有效权重表。
 * 规则:
 *   1. 同档内按 w 分配
 *   2. 高档物品的**基础权重更低**(这是"稀有"的定义),但被档位乘数放大
 *   3. 任何档的概率都不越过 GRADE.cap(封顶)
 * @param {string} tierKey normal/elite/boss/secret
 * @param {object} [opt] { grades:[只允许出的档], exclude:[排除的 id] }
 * @returns {{id:string, w:number, pct:number}[]}
 */
export function weightTable(tierKey = 'normal', opt = {}) {
  const tier = TIER[tierKey] || TIER.normal;
  const allow = opt.grades && opt.grades.length ? new Set(opt.grades) : null;
  const ex = new Set(opt.exclude || []);
  const rows = [];
  for (const it of Object.values(LOOT)) {
    if (ex.has(it.id)) continue;
    if (allow && !allow.has(it.grade)) continue;
    const g = GRADE[it.grade];
    // 档位乘数作用在**高档**上:越难打,高档越容易出 —— 这就是 owner 说的
    // 「稀有度应该按难度来」。乘数用 rank 的幂,避免 linearly 拉平。
    const tierBoost = 1 + (tier.mul - 1) * ((g.rank - 1) / 4);
    rows.push({ id: it.id, grade: it.grade, w: it.w * tierBoost, pct: 0 });
  }
  const total = rows.reduce((a, b) => a + b.w, 0) || 1;
  for (const r of rows) r.pct = r.w / total;
  // 封顶**只作用于高档**(浓/焦)。
  //
  // 为什么不给低档设封顶:低档天然就高(清档占 40%+ 很正常),
  // 给它设 cap 等于「先压低、再把权重摊去别的档」,而别的档也有 cap ——
  // 两边互相踩,实测出现「淡=46.8% > 18% 上限」这种自相矛盾的结果。
  //
  // 真正需要防的 runaway 永远在**高档**:档位乘数一放大,
  // 浓/焦 会把普通怪也刷成传说。业界那套上限(45/21/8/3/1)也是同理 ——
  // 上限是给"高档别泛滥"用的保险丝,不是给每一档都套的模具。
  const CAPPED = ['nong', 'jiao'];
  let freed = 0;
  const pool = [];
  for (const g of Object.values(GRADE)) {
    const inG = rows.filter(r => r.grade === g.key);
    const sum = inG.reduce((a, b) => a + b.pct, 0);
    if (CAPPED.includes(g.key) && sum > g.cap && inG.length) {
      for (const r of inG) r.pct *= g.cap / sum;
      freed += sum - g.cap;
    } else if (sum > 0) {
      pool.push(...inG);
    }
  }
  // 摊回去时**只摊给没被封顶的档**,避免把差额推进另一个上限里
  if (freed > 0 && pool.length) {
    const ps = pool.reduce((a, b) => a + b.pct, 0) || 1;
    for (const r of pool) r.pct += freed * (r.pct / ps);
  }
  return rows.sort((a, b) => b.w - a.w);
}

/**
 * 掷一次掉落。返回物品 id 或 null。
 * @param {string} tierKey
 * @param {object} [state] { miss:连续未中次数, ... } 会被就地更新(保底计数)
 * @param {object} [opt] 同 weightTable
 */
export function roll(tierKey, state, opt = {}) {
  const st = state || (state = {});
  const table = weightTable(tierKey, opt);
  if (!table.length) return null;

  // 保底:连续 N 次未中,直接给当前能出的**最好一档**
  if ((st.miss || 0) >= PITY.threshold) {
    // 保底要的是**最高**档。原判断写反了(<= 时留 a),结果发的是最低档。
    const best = table.reduce((a, b) =>
      (GRADE[a.grade].rank >= GRADE[b.grade].rank ? a : b));
    st.miss = 0;
    return best.id;
  }

  let r = Math.random() * table.reduce((a, b) => a + b.pct, 0);
  for (const t of table) { r -= t.pct; if (r <= 0) { st.miss = 0; return t.id; } }
  st.miss = (st.miss || 0) + 1;
  return null;
}

/** 期望道行:EV = Σ(估值 × 概率) */
export function ev(tierKey = 'normal', opt = {}) {
  return weightTable(tierKey, opt).reduce(
    (a, t) => a + (LOOT[t.id]?.val || 0) * t.pct, 0);
}

/** 该物品在给定档位的实际概率(给 UI 用) */
export function pctOf(id, tierKey = 'normal', opt = {}) {
  return weightTable(tierKey, opt).find(t => t.id === id)?.pct ?? 0;
}

/** 掉落时进年表的那句话 */
export function narrate(id) {
  const it = LOOT[id];
  return it ? `${it.why}（${it.from}）` : '';
}

/** 给玩家看的「这东西哪来的」 */
export function sourceOf(id) {
  return LOOT[id]?.from || '来源不明';
}

// ══════════════ 表中有表:外层门槛 + 内层权重 ══════════════
//
// owner 定的形状:
//   「掉落的件中,从表格按照物品概率来,再调低一些,
//     然后精英和boss只是额外增加掉落率,而不是掉落指定,
//     所以是表中表,死够数量,掉落率提升,但是掉落什么物品
//     还是看表中表的其他物品权重,
//     然后还有稀有度的负向调低,如果达到掉落门槛的,就有什���保底,
//     然后其他什么物品的还是看随机概率掉落」
//
// 社区成熟做法(检索核对):**hierarchical / nested loot tables** ——
//   "rarity tiers feeding into type and modifier pools"
//   "guaranteed drops via zero-probability nulls"
//   "pity counters",典型阈值 20~120 抽
//
// 两层各管一件事,这是它不卡的关键:
//
//   外层 GATE —— 只做加法,判断"够不够出货"
//     一次死 n 只:charge += n × 每只充能,一次运算,不逐只掷骰。
//     精英/Boss **只加充能**(8/45),**不指定掉什么** —— 这是 owner 的原话。
//
//   内层 PICK —— 只在"要出货了"时才跑一次权重表
//     掉什么由权重决定,档位只调整高档权重占比。
//
// 复杂度:每批 O(1) 次加法 + O(1) 次权重表,**与这一批死了多少只无关**。
// 这就是为什么"一秒死几十只"不会卡。

/** 每只怪给门槛充多少能(精英/Boss 只是加能,不是必掉指定物) */
export const CHARGE = {
  normal: 1,
  elite:  8,
  boss:   45,
};

/** 出货门槛(充能值)。达到即**必出** —— 这就是保底,不是随机。 */
export const GATE = { spirit: 125, stone: 300, pill: 200, good: 500 };

const _gate = {};
const _pick = {};

/**
 * 一次死了 n 只同类型的怪。
 * @param {string} kind spirit/stone/pill/good
 * @param {string} tier normal/elite/boss
 * @param {number} n   这一批死了多少只
 * @returns {{drops:string[], forced:number}} 掉了什么 / 其中几次是保底
 */
export function gateDrop(kind, tier, n) {
  if (n <= 0) return { drops: [], forced: 0 };
  const need = GATE[kind];
  if (!need) return { drops: [], forced: 0 };
  const ch = CHARGE[tier] ?? 1;
  let g = (_gate[kind] || 0) + n * ch;

  let times = 0;
  while (g >= need) { g -= need; times++; }   // 一次可能跨过多个门槛
  _gate[kind] = g;
  if (!times) return { drops: [], forced: 0 };

  // 内层:每次出货跑一次权重表。档位只影响高档占比,**不指定物品**。
  const drops = [];
  for (let i = 0; i < times; i++) {
    const id = roll(tier, _pick);           // 权重表决定掉什么
    if (id) drops.push(id);
  }
  return { drops, forced: times };
}

/** 门槛进度 0~1 —— 给 UI 显示"还要再杀多少" */
export function gateProgress(kind) {
  const need = GATE[kind] || 1;
  return Math.min(1, (_gate[kind] || 0) / need);
}
/** 距离下一次必出,还差多少只(按普通怪的充能算) */
export function gateRemain(kind) {
  const need = GATE[kind] || 1;
  return Math.max(0, Math.ceil((need - (_gate[kind] || 0)) / CHARGE.normal));
}

export function resetGate() { for (const k in _gate) delete _gate[k]; }

export default { GRADE, TIER, LOOT, PITY, CHARGE, GATE,
  weightTable, roll, ev, pctOf, narrate, sourceOf, gateDrop, gateProgress, gateRemain, resetGate };
