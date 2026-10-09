// ===== 世界时钟(V0.99 · 工单 XX-FIX-003)=====
//
// 修的是什么:
//   原来有**四套互不相干**的计时,同一个"一天"有四个定义:
//     · 昼夜 DAY        —— 12 次**行动**(点吐纳/赶路/战斗)
//     · 年表 CHRONICLE  —— 另外 12 次行动,自己数一套
//     · 篝火 CAMP       —— 真实时间戳 Date.now()
//     · 家族 FAMILY     —— 只有 Date.now() 的时间点,没有"一天"的概念
//   实测:点 24 次吐纳 → 昼夜过了 0.0 天、年表过了 36 天、现实过了 0 秒、
//   篝火一分钟没少。它们之间没有任何换算关系。
//
//   owner 的判断:「每 15 分钟是游戏的一天,修仙阁也会记录我修仙多久,
//   修仙家族的计时不应该也同步吗?」—— 是的,应该同步,而且现在根本没记。
//
// 现在怎么做的:
//   **一个真源,其余全部派生。**
//   · 真实时间是底座(离线也走 —— 关掉页面 15 分钟,回来就该是一天)
//   · 行动是加速器(点得多就推进得快,活跃玩家不至于觉得慢)
//   两者相加,同一个刻度,谁也不��脱节。
//
// 刻度(全在这里,想调只改这一块):
//   1 游戏日 = 15 分钟真实时间 = 12 次行动
//   → 一次行动折算 75 秒真实时间。
//   这样"只动手不动"和"只挂机不动"都不会让世界停摆,但活跃玩家推进更快。

const DAY_MS = 15 * 60 * 1000;   // 1 游戏日 = 15 分钟真实时间
const ACTIONS_PER_DAY = 12;      // 1 游戏日 = 12 次行动
const ACTION_MS = DAY_MS / ACTIONS_PER_DAY;  // 每次行动折算 75 秒
const DAYS_PER_YEAR = 12;
const HOUR_MS = DAY_MS / 24;     // 1 游戏小时 = 37.5 秒

const K = 'xx_clock_v099';

export const CLOCK = {
  s: { ms: 0, totalMs: 0, actions: 0, lastSeen: 0, year: 1, day: 0 },
  loaded: false,

  load() {
    try {
      const r = localStorage.getItem(K);
      if (r) this.s = { ...this.s, ...JSON.parse(r) };
    } catch {}
    if (!this.s.lastSeen) this.s.lastSeen = Date.now();
    this.loaded = true;
    // 补算离线时间:关掉页面期间世界照样在走
    this.catchUp();
    return this.s;
  },

  save() {
    try {
      this.s.lastSeen = Date.now();
      localStorage.setItem(K, JSON.stringify(this.s));
    } catch {}
  },

  /** 离线补算:把"上次见到"到"现在"之间的真实时间折算成游戏时间 */
  catchUp() {
    const now = Date.now();
    const gap = Math.max(0, now - (this.s.lastSeen || now));
    if (gap > 1000) this.advanceReal(gap);
    this.s.lastSeen = now;
    return this;
  },

  /** 真实时间推进(毫秒) */
  advanceReal(ms) {
    if (ms <= 0) return this;
    this.s.ms += ms;
    this.s.totalMs = (this.s.totalMs || 0) + ms;   // 累计修仙时长(只增不减)
    // 溢出成天/年
    while (this.s.ms >= DAY_MS) {
      this.s.ms -= DAY_MS;
      this._nextDay();
    }
    return this;
  },

  /** 一次行动(吐纳/赶路/战斗/砍杀) */
  action() {
    this.s.actions++;
    return this.advanceReal(ACTION_MS);
  },

  _nextDay() {
    this.s.day++;
    if (this.s.day >= DAYS_PER_YEAR) {
      this.s.day = 0;
      this.s.year++;
    }
    return this.s;
  },

  // ---------- 读取 ----------

  /** 0..1,今天过了多少 */
  dayProgress() {
    // 只认 ms —— 它已经是**统一累加器**:
    //   真实时间经 catchUp()/advanceReal() 进来,
    //   行动也经 action() → advanceReal(ACTION_MS) 进来,
    //   跨天由它触发 _nextDay()。
    //
    // 【V0.99 修掉的重复计数】
    // 这里原来还额外加了一项 (s.actions % ACTIONS_PER_DAY) / ACTIONS_PER_DAY,
    // 理由是文件头那句「真实时间是底座、行动是加速器,两者相加」。
    // 但 action() 已经把 ACTION_MS 加进 ms 了,再把 actions 加一次,
    // 等于**一次行动算两遍**。实测后果:
    //   · 12 行动/日 实际 6 次行动就走完一天(act6 就回到 hour=0)
    //   · 「暮」(17:00~19:00)永远采样不到 —— hour 只落在 …16, 20…,
    //     中间那三小时被整个跳过,黄昏这个相位等于不存在
    // ms 这一条路径已经同时承载了真实时间与行动,再相加就是重复计数。
    return Math.min(1, Math.max(0, this.s.ms / DAY_MS));
  },

  /** 游戏内小时 0..23 */
  hour() {
    return Math.floor(this.dayProgress() * 24);
  },

  /** 绝对进度(天),用于比较先后 */
  absoluteDay() {
    return (this.s.year - 1) * DAYS_PER_YEAR + this.s.day + this.dayProgress();
  },

  year() { return this.s.year; },
  day() { return this.s.day; },

  /** 昼夜相位 —— 单一真源,DAY/Ambience/篝火/家族都从这里读 */
  phase() {
    const h = this.hour();
    if (h >= 5  && h < 8)  return { key: 'dawn',  name: '晨', night: false, hour: h,
      desc: '天光微亮,露气未消。' };
    if (h >= 8  && h < 17) return { key: 'day',   name: '昼', night: false, hour: h,
      desc: '日头正高,适合赶路。' };
    if (h >= 17 && h < 20) return { key: 'dusk',  name: '暮', night: false, hour: h,
      desc: '日落西山,妖气渐起。' };
    return { key: 'night', name: '夜', night: true, hour: h, desc: '夜色压山。点燃篝火吧。' };
  },

  isNight() { return this.phase().night; },

  /**
   * 「修仙多久」—— 修仙阁要显示这个。
   *
   * 别拿 s.ms 直接当天数换算:ms 是**当天之内**的余量,跨天时已被 _nextDay() 扣掉。
   * 累计时长另存在 s.totalMs,只增不减。
   */
  uptimeMs() { return this.s.totalMs || 0; },
  uptimeText() {
    const totalMin = Math.floor((this.s.totalMs || 0) / 60000);
    const d = Math.floor(totalMin / 15);          // 15 分钟 = 1 游戏日
    return `第 ${this.s.year} 年 · ${this.s.day} 日 ${this.hour()} 时 · 累计修仙 ${d} 日`;
  },

  /** 供篝火:当前是夜间的第几段 0..1(余烬特效用) */
  nightProgress() {
    if (!this.isNight()) return 0;
    // 夜 = 20:00~05:00,占 9 小时
    const h = this.hour();
    const nightH = h >= 20 ? h - 20 : h + 4;   // 20,21,22,23,0,1,2,3,4
    return Math.min(1, Math.max(0, nightH / 9));
  },

  reset() {
    this.s = { ms: 0, totalMs: 0, actions: 0, lastSeen: Date.now(), year: 1, day: 0 };
    this.save();
  },
};

export const CLOCK_CONST = { DAY_MS, ACTIONS_PER_DAY, ACTION_MS, DAYS_PER_YEAR, HOUR_MS };
