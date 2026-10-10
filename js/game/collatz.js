// ===== Collatz 驱动的局内难度曲线(XX-MATH-001)=====
//
// 「海拉斯的猜想」= COLLATZ 猜想 / 冰雹序列:偶数 ÷2,奇数 3n+1,直到落入 1。
// 它在这里**只做一件事**:给一局砍杀提供一条**确定性但有呼吸感**的递增曲线。
//
// ⚠️ 为什么它**不是**地图生成器
//   本作的地图已经由 worldgen.js 按种子生成,并且带一整套不变量
//   (全连通 / 秘境≤4 步 / boss 非死角 / 青石村恒为起点)。
//   再塞一台生成器进来,就是**两张表打架** —— 那是 XX-WORLD 那一族 bug 的
//   病根,本轮刚清干净。Collatz 的位置在**局内**,不在地图上。
//
// ⚠️ 为什么它**不是**掉落池
//   奖励池已经存在(upgrades.js / bestiary.js),按节点的局内倾向加权
//   (runcfg.js NODE_TUNING)。再叠一套就是同一个毛病。
//
// 【它补的是哪一块】
//   局内难度原本是**时间的线性函数**:
//     dmgMultAt(t) = 1 + t/240        ← 匀速爬升,玩家三分钟就摸透节奏
//     hpMultAt(t)  = curveAt(t, ...)  ← 分段平滑
//   Collatz 的价值在于它那条曲线的形状:**长长的 ÷2 收敛段,突然一个 3n+1 爆发**。
//   玩家的体感从「越来越难」变成「正在收敛,或者正在爆发」——
//   而且这个体感是**可学习的**:奇数步永远是爆发,偶数步永远是喘息。
//
// 【三条自律】
//   1. 纯函数。给定同样的入参永远同样的输出,无副作用、无全局态污染。
//   2. 有上限。中间值会飙到几千倍(27 → 9232),直接当血量乘子会把玩家秒没。
//      所以难度取 log2 分桶,调制系数夹在 [0.85, 1.25]。
//   3. **默认中性**。没激活时调制系数恒为 1.0 —— 于是不改这个模块的任何一个
//      数字,现有所有测试的行为都不变。这是它能安全接进来的前提。

/** 单局步数上限。COLLATZ 未被证伪,理论上可能不收敛,必须有兜底。 */
export const TRAJ_CAP = 20000;

/** 调制系数区间。刻意窄 —— 难度曲线可以"有呼吸",不能"翻车"。 */
export const MOD_MIN = 0.85;
export const MOD_MAX = 1.25;

/**
 * 生成 Collatz 轨迹。
 * 纯函数:同一个 n 永远得到同一条轨迹。
 * @param {number} n 起始值(正整数;非正/非整数一律按 1 处理)
 * @param {number} [cap=TRAJ_CAP] 步数上限
 * @returns {{seq:number[], steps:number, peak:number,
 *            oddSteps:number, evenSteps:number, oddRatio:number, capped:boolean}}
 */
export function trajectory(n, cap = TRAJ_CAP) {
  let cur = Number(n);
  if (!Number.isFinite(cur) || cur < 1) cur = 1;
  cur = Math.floor(cur);

  const seq = [cur];
  let odd = 0, even = 0, peak = cur;
  const limit = Math.max(1, Number(cap) || TRAJ_CAP);

  while (cur !== 1 && seq.length - 1 < limit) {
    if (cur % 2 === 0) { cur /= 2; even++; }
    else { cur = 3 * cur + 1; odd++; }
    seq.push(cur);
    if (cur > peak) peak = cur;
  }
  const steps = seq.length - 1;
  return {
    seq, steps, peak, oddSteps: odd, evenSteps: even,
    // 奇数步占比:> 0.5 说明这局"爆发多",奖励应当偏激进
    oddRatio: steps ? odd / steps : 0,
    capped: cur !== 1,
  };
}

/**
 * 把任意种子映射到一个**难度可比**的起始值。
 *
 * 为什么不能直接拿种子当 n:相邻整数的步数差异极大(实测 n=26 要 10 步,
 * n=27 要 111 步,峰值 9232)。玩家换个存档码难度就天差地别 —— 那不是随机,
 * 是不可控。所以先做一层**归一**:取种子在 [lo, hi] 区间内的中段,
 * 再按 log2(步数)分桶,让"这一局有多长"落在可控的几档里。
 *
 * @param {string|number} seed
 * @param {number} [lo=64] [hi=1024] 取样区间
 * @returns {{n:number, traj:ReturnType<typeof trajectory>, bucket:number}}
 */
export function runSeedFor(seed, lo = 64, hi = 1024) {
  const s = String(seed == null ? '' : seed);
  // FNV-1a:短、稳定、跨平台,同样的种子在任何机器上得到同样的 n
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const span = Math.max(1, hi - lo);
  const n = lo + (h % span);
  const traj = trajectory(n);
  // 分桶:步数取 log2,天然落在 0..~7,便于夹住调制系数
  const bucket = Math.max(0, Math.min(7, Math.round(Math.log2(Math.max(1, traj.steps)))));
  return { n, traj, bucket };
}

/**
 * 局内时刻 t(秒)对应轨迹上的第几步。
 * 一局默认按 SECONDS_PER_STEP 秒走一步,让长轨迹的局自然变长。
 */
export function stepAt(traj, t, secondsPerStep = 20) {
  if (!traj || !traj.seq || traj.seq.length < 2) return 0;
  const idx = Math.floor((Number(t) || 0) / Math.max(1, secondsPerStep));
  return Math.max(0, Math.min(traj.seq.length - 1, idx));
}

/**
 * 该步是「爆发」还是「收敛」。
 * 奇数步(3n+1)= 爆发,偶数步(÷2)= 收敛。
 * @returns {'odd'|'even'|'settle'} settle = 已落到 1
 */
export function parityAt(traj, t, secondsPerStep = 20) {
  const i = stepAt(traj, t, secondsPerStep);
  if (!traj || i >= traj.seq.length) return 'settle';
  const v = traj.seq[i];
  if (v === 1) return 'settle';
  return v % 2 === 1 ? 'odd' : 'even';
}

/**
 * 难度调制系数 ∈ [MOD_MIN, MOD_MAX]。**没有轨迹时恒为 1**(默认中性)。
 *
 * 形状:奇数步给正向尖峰,偶数步给轻微回落 —— 这就是「呼吸」。
 * 再按当前值与本局峰值的关系收一下:越接近峰值,调制越靠近上界。
 * 最后整体夹进 [MOD_MIN, MOD_MAX],保证任何种子、任何时刻都不会失控。
 */
export function modAt(traj, t, secondsPerStep = 20) {
  if (!traj || !traj.seq || traj.seq.length < 2) return 1;
  const i = stepAt(traj, t, secondsPerStep);
  if (i >= traj.seq.length) return 1;                 // 走完/超限 → 中性

  const v = traj.seq[i];
  const peak = Math.max(1, traj.peak || 1);

  // 奇数步 +0.14,偶数步 -0.10。奇数步是 3n+1 之后的位置,值本来就大,
  // 这也让"爆发"在数值上是自洽的,不是凭空加的。
  let m = v % 2 === 1 ? 1.14 : 0.90;

  // 接近本局峰值时整体抬一点,让"最高点"真的最高
  const rel = Math.min(1, Math.log2(v + 1) / Math.log2(peak + 1));
  m *= 1 + 0.10 * rel;

  return Math.max(MOD_MIN, Math.min(MOD_MAX, m));
}

/** 这一局整体偏激进还是偏续航:奇数步占比超过阈值记为 aggro。 */
export function biasOf(traj) {
  if (!traj || !traj.steps) return 'sustain';
  return traj.oddRatio > ODD_BIAS_CUT ? 'aggro' : 'sustain';
}

/**
 * 激进/续航的分界。
 *
 * ⚠️ 这里原来写的是 0.5,实测**一次都没触发过** —— 在取样区间 [64,1024] 里
 * 2000 个种子的 oddRatio 最大只有 **0.365**(中位 0.311),0.5 是不可达的,
 * 于是 `biasOf` 恒返回 'sustain',这个特性**是死的**。
 *
 * 测出来的分布:
 *   min 0.000 · p25 0.267 · 中位 0.311 · p75 0.353 · max 0.365
 *   >0.32 的占 44.0%
 *
 * 取 0.32 → 约 44/56 分成两半,两种倾向都会真实出现。
 * 门禁里有一条断言盯着这件事(两种倾向都得出现),
 * 免得改回一个不可达的阈值、把特性又悄悄弄死。
 *
 * ⚠️ 这个阈值依赖 `runSeedFor` 的取样区间。改了 [lo, hi] 就要重新量分布。
 */
export const ODD_BIAS_CUT = 0.32;