// ===== 统一存档 + 种子化随机 =====
// 技术债:原先散在 5 个 localStorage 键
//   pxs_save / xx_cultivation_v077 / xx_nemesis_v077 / xx_titles_v077
//   xx_bag_v080 / xx_camp_v080 / xx_day_v080 / xx_merch_v080 / xx_companion_v081
// 现在合并成单一 xx_profile_v081,含版本号与迁移表。
//
// 种子:所有随机(奇遇、掉落、商人、怨灵、营地来客)都走 PRNG。
// 同一种子 → 同一世界。存档只存种子 + 进度,天然压缩。
//
// 2026-10-10:种子的**真源**是 seed.js(键 xx_seed_v081 由它持有),
// 本文件只做局外 RNG 的持有者。两边曾各写各的同一个键,互不知情。

import { setMaster, getMaster, DEFAULT_SEED } from './seed.js';

const KEY = 'xx_profile_v081';
const LEGACY = {
  cultivation: 'xx_cultivation_v077',
  nemesis:    'xx_nemesis_v077',
  titles:     'xx_titles_v077',
  bag:        'xx_bag_v080',
  camp:       'xx_camp_v080',
  day:        'xx_day_v080',
  merch:      'xx_merch_v080',
  companion:  'xx_companion_v081',
  base:       'pxs_save',
};

// —— 周期自动存档的定值 ——
//
// AUTO_EVERY:周期落盘间隔(主循环侧 setInterval 用,见 js/main.js)。
//   定值依据(实测数据与复现命令见 tests/periodic-autosave-regression.mjs 头注):
//     · 一次 Profile.collect() 写 **9 个键**(8 个老键 + 统一档),
//       真机 localStorage 是**同步** IPC + 落盘,写在主线程上。
//       本机(in-memory Map)实测 ≈120μs/KB,真机比这贵 —— 所以这个数只能
//       当下限看,不能当预算看。
//       复现:node tests/periodic-autosave-regression.mjs --cost
//     · 15s = 每分钟 4 次 × 9 键 = 每分钟 36 次同步写。
//       60fps 下一分钟 3600 帧,即**每 100 帧才 1 次同步写**,帧预算上不可见。
//     · 2s(下面 MIN_GAP 的原型值)是**事件合并**节流,对应「人手动作速率」
//       (各模块 commit 由点击/掉落触发)。拿它当无条件定时器 = 每分钟 30 次
//       × 9 = 270 次主线程写,是 15s 方案的 7.5 倍,换来的只是把最坏
//       丢失窗口从 15s 压到 2s。不值。
//     · 代价侧:最坏丢失窗口 15s,不到最短一局的四分之一 ——
//       正好压在 owner 要的「别切个后台就重新开局」之上。
//   (js/ui/screens.js bindTap 的 300ms 不作参考:那是防人连点,
//    单位是「一次手势」,不是「一次后台巡检」。)
export const AUTO_EVERY = 15000;
// 两次落盘之间的**硬**间隔。节流兜底,防止任何高频调用方把它刷成每帧写盘。
const MIN_GAP = 2000;

// ————— 种子 PRNG(mulberry32)—————
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// —— 种子 ——
//
// 2026-10-10:这里原来自己 normalize、自己写 localStorage,
// seed.js 那边也有一套。两套都往同一个键 xx_seed_v081 写,
// 但互不知情 —— 于是 profile 换了种子、seed.js 的地图生成器还攥着旧的。
// 现在 profile 只做「局外 RNG 的持有者」,种子的真源统一交给 seed.js,
// 两边不可能再各说各话。
export const Seed = {
  cur: DEFAULT_SEED,
  _rng: null,
  get() {
    this.cur = getMaster();
    this._rng = mulberry32(hashStr(this.cur));
    return this.cur;
  },
  set(s) {
    // setMaster 内部已做 trim / 空值回退 / 写 localStorage,并同步 seed.js 内存态
    this.cur = setMaster(s);
    this._rng = mulberry32(hashStr(this.cur));
    return this.cur;
  },
  // 确定性随机(取代 Math.random)
  next() { return this._rng(); },
  int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; },
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
  // 按权重抽
  weighted(arr, wf) {
    let total = arr.reduce((a, e) => a + wf(e), 0);
    let r = this.next() * total;
    for (const e of arr) { r -= wf(e); if (r <= 0) return e; }
    return arr[arr.length - 1];
  },
  chance(p) { return this.next() < p; },
};

const EMPTY = {
  v: 1, seed: DEFAULT_SEED,
  cult: null, nemesis: null, titles: null,
  bag: null, camp: null, day: null, merch: null, companion: null,
  // ⚠️ 这里原来有 `base: null`。已移除(XX-AUDIT-006 批 2)。
  //   它是 pxs_save 的迁移快照,**从不被任何逻辑消费**,却会被
  //   `{ ...d }` 展开带进新键存档,变成一个永不读取的死字段。
  //   migrate() 仍会把旧 base 读进局部变量 d.base(为兼容旧档),
  //   但不再回写 pxs_save(那会覆盖 core/save.js 的活档)。
  savedAt: 0,
};

export const Profile = {
  data: { ...EMPTY },

  load() {
    let d = null;
    try { const r = localStorage.getItem(KEY); if (r) d = JSON.parse(r); } catch {}
    if (d && d.v >= 1) { this.data = { ...EMPTY, ...d }; }
    else { this.data = this.migrate(); }
    Seed.set(this.data.seed || DEFAULT_SEED);
    return this.data;
  },

  // 旧键 → 统一档
  migrate() {
    const read = k => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } };
    const d = { ...EMPTY, savedAt: Date.now() };
    d.cult = read(LEGACY.cultivation);
    d.nemesis = read(LEGACY.nemesis);
    d.titles = read(LEGACY.titles);
    d.bag = read(LEGACY.bag);
    d.camp = read(LEGACY.camp);
    d.day = read(LEGACY.day);
    d.merch = read(LEGACY.merch);
    d.companion = read(LEGACY.companion);
    d.base = read(LEGACY.base);
    if (d.cult) d.seed = DEFAULT_SEED;
    this.data = d;
    this.flush();
    return d;
  },

  // 写回各自的 localStorage 键(各模块仍按老接口读,不 invasive)
  flush() {
    const d = this.data;
    const w = (k, v) => { if (v != null) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
    w(LEGACY.cultivation, d.cult);
    w(LEGACY.nemesis, d.nemesis);
    w(LEGACY.titles, d.titles);
    w(LEGACY.bag, d.bag);
    w(LEGACY.camp, d.camp);
    w(LEGACY.day, d.day);
    w(LEGACY.merch, d.merch);
    w(LEGACY.companion, d.companion);
    // ⚠️ 不再回写 LEGACY.base('pxs_save')(XX-AUDIT-006 批 2)。
    //   这一行是**真实的存档损坏源**,已用模拟脚本复现:
    //     玩家从 V0.77 旧档升级 → migrate() 把 pxs_save 读进 d.base
    //     → 玩家继续玩,core/save.js 的 Save.commit() 写入新数据(gold=8888,totalRuns=12)
    //     → 本行把**迁移时的陈旧快照**原样写回去,覆盖掉 Save 的活跃存档
    //     → 金币回滚成 30、局数回滚成 1
    //   根因:d.base 只在 migrate() 里读进来,**此后从未被消费**——
    //         collect() 收的是 mods.Bag.s / mods.CAMP.s,不含 base。
    //         它是一个只进不出的往返,读进来只为了原样写回去。
    //   为什么只有 base 有这个风险:其余 8 个 LEGACY 键(V0.77~V0.81)
    //         迁移后不再被 core/save.js 之类模块活跃写,回写是幂等的;
    //         而 pxs_save 是 core/save.js 的**活键**,双写必然打架。
    // 真正的新键(数据主体)
    try { localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() })); } catch {}
  },

  // 收集各模块的当前状态
  collect(mods) {
    this.data.cult = mods.Cult.s;
    this.data.nemesis = mods.Nemesis.s;
    this.data.titles = mods.Titles.s;
    this.data.bag = mods.Bag.s;
    this.data.camp = mods.CAMP.s;
    this.data.day = mods.DAY.s;
    this.data.merch = mods.Merchant.s;
    this.data.companion = mods.COMPANION.s;
    this.data.seed = Seed.cur;
    this.flush();
  },

  // 导出/导入:整档压成一段可复制的字符串
  export() {
    return btoa(unescape(encodeURIComponent(JSON.stringify(this.data))))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  },
  import(str) {
    try {
      const b64 = String(str).replace(/-/g,'+').replace(/_/g,'/');
      const json = decodeURIComponent(escape(atob(b64)));
      const d = JSON.parse(json);
      if (!d || !d.cult) return { ok:false, msg:'存档码无效' };
      this.data = { ...EMPTY, ...d };
      Seed.set(this.data.seed || DEFAULT_SEED);
      this.flush();
      return { ok:true, msg:'导入成功' };
    } catch (e) { return { ok:false, msg:'存档码损坏' }; }
  },

  size() { try { return (localStorage.getItem(KEY) || '').length; } catch { return 0; } },

  // 周期自动存档(V0.99.5 接上,此前全仓零调用 = 死代码)
  //
  // 为什么必须有它 —— 这是「存在 ≠ 生效」的又一例:
  //   main.js 的三个钩子(visibilitychange / pagehide / beforeunload)
  //   只在**玩家主动离开页面**时触发。崩掉、系统杀进程、移动端后台被回收 ——
  //   一个都不触发。上次落盘之后的进度全丢,重开就是重新开局。
  //   周期落盘是**兜底**:三个钩子一个都不删、不改、不替换。
  //
  // ⚠️ 这里**必须**走 collect(mods),绝不能退回 flush():
  //   flush() 写的是 this.data —— 那是**上一次 collect 时的快照**。
  //   只 flush 不 collect,就是每 15 秒把开机那一刻的陈旧快照原样重写一遍。
  //   这与 XX-AUDIT-006(`d.base` 只在 migrate() 里读进来、此后从未被消费,
  //   每次 flush 原样写回,把金币盖回迁移时的 30、局数盖回 1)
  //   是**同一个动作**,只是把 `d.base` 换成了整个 `this.data`。
  //   所以拿不到模块表时本方法**宁可不写**,也绝不退回 flush()。
  _lastWrite: 0,
  _t: 0,
  _mods: null,
  /**
   * 节流落盘。返回 true = 这次真的写了盘。
   * @param {object} [mods] 模块表;省略时沿用上次记住的那份
   */
  auto(mods) {
    if (mods) this._mods = mods;
    if (!this._mods) return false;                 // 没有真源 ⇒ 不写(见上 ⚠️)
    const wait = MIN_GAP - (Date.now() - this._lastWrite);
    if (wait > 0) {
      // 窗口内的重复请求**合并**成一次尾写,不丢弃。
      // 原型只有 clearTimeout + setTimeout:调用方只要比 MIN_GAP 更频繁,
      // 定时器就会被无限推迟 —— 永远写不了盘(饿死)。保留尾写,
      // 既限流,又不把请求丢掉。
      clearTimeout(this._t);
      this._t = setTimeout(() => { this._t = 0; this.auto(); }, wait);
      return false;
    }
    this._lastWrite = Date.now();
    this.collect(this._mods);
    return true;
  },
};
