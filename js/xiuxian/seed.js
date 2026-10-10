// ===== 分层种子管理(V0.97)=====
// 工单 XX-S2-001 / XX-S2-002 / XX-S2-003
//
// 为什么分层(业界 procgen 共识):
//   单一随机流会导致"改一处、动全身"—— 调整掉落权重会连带改变地形。
//   lillytechsystems 明确建议: 从主种子派生子种子,各系统独立。
//
//   masterSeed ──┬─ terrain  节点位置/数量
//                ├─ village  村庄分布与命名
//                ├─ loot     矿脉/资源分布
//                └─ event    随机事件
//
// 设计约束:
//   1. 存档只存 masterSeed 一个字符串,世界数据一律重建 —— 天然压缩
//   2. 每个子流是独立 RNG 实例(基于 vendor/rot-rng.js 的 Alea),
//      不是全局单例 —— 全局随机是 procgen bug 的主要来源
//   3. 向后兼容: 沿用 profile.js 的 mulberry32 + FNV-1a hashStr,
//      同一字符串种子生成的随机序列与 V0.96 一致,老存档不失效

import { RNG } from './vendor/rot-rng.js';

const SEED_KEY = 'xx_seed_v081';   // 与 profile.js 同一个键,避免双份种子

/** FNV-1a —— 与 profile.js 的 hashStr 完全一致,保证老存档种子解析结果不变 */
export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 子流命名 —— 改动会让对应子流变化,新增不会影响已有流 */
export const STREAMS = ['terrain', 'village', 'loot', 'event'];

/**
 * 子种子派生:hash(master + ':' + stream)
 * 不同流得到完全独立的数值空间。
 */
export function derive(master, stream) {
  return hashStr(String(master) + ':' + stream);
}

export class SeedSet {
  constructor(master) {
    this.master = String(master);
    this._streams = new Map();
  }

  /** 取(并惰性创建)某个子流。同一流多次调用返回同一实例。 */
  stream(name) {
    if (!STREAMS.includes(name)) {
      throw new Error('未知子种子流: ' + name + '(可用: ' + STREAMS.join(', ') + ')');
    }
    if (!this._streams.has(name)) {
      this._streams.set(name, new RNG(derive(this.master, name)));
    }
    return this._streams.get(name);
  }

  /** 把某个子流重置回起点(换 loot 种子时用) */
  reset(name) { this._streams.delete(name); }

  /** 全部重置 */
  resetAll() { this._streams.clear(); }
}

// ————— 模块级当前种子集 —————
//
// 2026-10-10 修:原来 currentSeeds() 会把读到的值写回 currentMaster,
// 于是第一次取种子就把 localStorage 路径**封死**了 —— 之后即便
// localStorage 换了值,getMaster() 也永远返回旧种子。
// 后果:玩家点「换一世」,种子字符串变了、奇遇和掉落变了,
// 但地图纹丝不动 —— 因为 world.js 读的是被封死的那个值。
//
// 现在 currentMaster 只由 setMaster() 写(显式切换),storage 路径每次现读。
let current = null;
let currentMaster = null;

/** 默认种子。与 profile.js / setMaster() 保持同一个字面量。 */
export const DEFAULT_SEED = '青石村';

export function getMaster() {
  if (currentMaster !== null) return currentMaster;
  // 惰性从 localStorage 读,浏览器外(测试)回退默认值。
  // 刻意**不做缓存**:缓存就是这个 bug 的来源。
  let v = DEFAULT_SEED;
  try {
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem(SEED_KEY);
      if (s) v = s;
    }
  } catch {}
  return v;
}

export function currentSeeds() {
  const m = getMaster();
  if (!current || current.master !== m) current = new SeedSet(m);
  return current;
}

/** 取某条子流 —— worldgen.js 的主要入口 */
export function rng(stream) { return currentSeeds().stream(stream); }

/** 换主种子。会清空所有子流缓存,并同步 localStorage。 */
export function setMaster(master) {
  const v = (master == null ? '' : String(master)).trim() || DEFAULT_SEED;
  currentMaster = v;
  current = new SeedSet(v);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SEED_KEY, v);
  } catch {}
  return v;
}

// ————— 存档:只存种子,不存世界 —————

/** 导出存档载荷。刻意只有种子 —— 世界是纯函数产物,存下来反而会不同步。 */
export function save() {
  return { seed: getMaster() };
}

/**
 * 从存档恢复。
 * 兼容: V0.96 老存档没有 seed 字段 → 用默认种子,不能崩。
 */
export function load(payload) {
  const m = payload && payload.seed ? String(payload.seed) : DEFAULT_SEED;
  return setMaster(m);
}

/** 当前世界的可复现指纹 —— 调试用,同种子必须同指纹 */
export function fingerprint() {
  return hashStr(getMaster()).toString(36);
}