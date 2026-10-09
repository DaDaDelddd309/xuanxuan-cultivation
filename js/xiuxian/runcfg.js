// ===== 局内配置层(V0.98)=====
// 工单 XX-LINK-001 / 002 / 003
//
// ★ 这层存在的理由
//   修仙阁(局外)与砍杀(局内)此前只有一个数字交换:
//   单局结束 Cult.settle({kills,time}) 把击杀数折算成道行。
//   于是「地图」只是菜单,「生成器」只换了张皮,砍什么怪捡什么宝完全写死。
//   —— 前后两个游戏各做各的。
//
//   本层是唯一的接口:出发节点 → 一份局内参数 → 刷怪/掉落/回合制都读它。
//   于是「你从哪个节点出发」真的决定「这一局会遇到什么」。
//
// 设计原则(不侵入 engine/weapons/enemies 原有循环):
//   只输出参数,不 spawn、不 import 局内模块、无副作用。
//   局内模块只读不写,保持可测试与可回滚。

import { nodeById } from './world.js';

// —— 各节点类型的局内倾向 ——
// 数值是「相对倍率」,不是绝对值:和局内原有曲线相乘,不做替换。
export const NODE_TUNING = {
  village: {
    label: '村庄',
    // 出发于村庄 = 从家出发,一切照常
    spawn:  { eliteRate: 0,   hordeRate: 1.0, hpMult: 1.0, dmgMult: 1.0 },
    loot:   { gemBias: 0, coinBias: 0, meatBias: 1.0, chestBias: 1.0 },
    turnBased: 0,
    note: '从村庄出发 · 平稳开局',
  },
  field: {
    label: '荒野',
    spawn:  { eliteRate: 1.0, hordeRate: 1.15, hpMult: 1.0, dmgMult: 1.0 },
    loot:   { gemBias: 1.0, coinBias: 1.0, meatBias: 0.9, chestBias: 0.9 },
    turnBased: 0,
    note: '散妖游荡 · 练手',
  },
  elite: {
    label: '险地',
    // 险地 = 精英密度高,怪更硬,奖励更好
    spawn:  { eliteRate: 3.2, hordeRate: 1.0, hpMult: 1.25, dmgMult: 1.2 },
    loot:   { gemBias: 1.4, coinBias: 1.2, meatBias: 0.8, chestBias: 1.3 },
    turnBased: 0.35,
    note: '精英扎堆 · 有强敌蛰伏,可能触发回合制',
  },
  secret: {
    label: '秘境',
    // 秘境 = 丹药宝地,但怪更多更凶
    spawn:  { eliteRate: 1.6, hordeRate: 1.5, hpMult: 1.15, dmgMult: 1.1 },
    loot:   { gemBias: 2.0, coinBias: 0.8, meatBias: 0.7, chestBias: 2.2 },
    turnBased: 0,
    note: '藏宝之地 · 爆率翻倍,代价是怪更多',
  },
  boss: {
    label: '妖巢',
    // 妖巢 = 直通回合制剧情
    spawn:  { eliteRate: 3.0, hordeRate: 1.2, hpMult: 1.4, dmgMult: 1.3 },
    loot:   { gemBias: 1.6, coinBias: 1.6, meatBias: 0.8, chestBias: 2.0 },
    turnBased: 1,
    note: '大能坐镇 · 开局即入回合制',
  },
};

export const DEFAULT_TUNING = NODE_TUNING.field;

export function tuningFor(node) {
  if (!node) return DEFAULT_TUNING;
  return NODE_TUNING[node.type] || DEFAULT_TUNING;
}

/**
 * 生成本局的配置。
 * @param {string} nodeId 出发节点 id;查不到则用 field
 * @returns 配置对象(纯数据,可 JSON 序列化,可写入存档用于回放)
 */
export function buildRunConfig(nodeId) {
  const node = nodeById(nodeId);
  const t = tuningFor(node);
  return {
    nodeId: node ? node.id : null,
    nodeType: node ? node.type : 'field',
    label: t.label,
    note: t.note,
    spawn: { ...t.spawn },
    loot: { ...t.loot },
    turnBased: t.turnBased,
    // 矿区加成:占领矿脉后,出产更好
    mineBonus: 1,
  };
}

/** 矿脉占领数量 → 局内收益倍率 */
export function mineBonusOf(landCount) {
  if (!landCount) return 1;
  return 1 + Math.min(0.5, landCount * 0.06);
}

/**
 * 叠加矿脉加成后的最终配置。
 * 这是 main.js 真正该调用的入口。
 */
export function runConfigFor(nodeId, landCount) {
  const cfg = buildRunConfig(nodeId);
  const mb = mineBonusOf(landCount);
  cfg.mineBonus = mb;
  if (mb > 1) {
    cfg.loot.gemBias *= mb;
    cfg.loot.chestBias *= mb;
  }
  return cfg;
}

// —— 当前生效的本局配置 ————————————————————
//
// 【2026-10-10 补齐】这三个函数是 tests/test-runcfg.mjs 一直期待的接口,
// 但实现这边停在半路 —— 测试比实现新一版,所以它从来没跑起来过。
//
// 为什么不存盘:_active 是**本局临时状态**,和 CHRONICLE 的局内状态同理。
// 单局结束就该失效;写进存档反而会造成「读到上局配置」的诡异 bug。
// 真要回放,存的是 `buildRunConfig` 的产物(纯数据),不是这个指针。
let _active = null;

/** 出发节点时由入口调一次,写入本局参数 */
export function setActive(cfg) {
  _active = cfg || null;
  return _active;
}

/** 单局结束 / 离开节点时清空,回到默认(field) */
export function clearActive() {
  _active = null;
}

/**
 * 局内各模块读参数的唯一入口。
 * 永远返回一份配置 —— 未开局时给 field 默认值,而不是 undefined,
 * 因为调用方(spawn/loot/回合制)全都是 `cfg.spawn.hpMult` 这种直接取,
 * 给 undefined 会在最深处的循环里炸,报错点离原因很远。
 */
export function getRunMod() {
  return _active || buildRunConfig(null);
}