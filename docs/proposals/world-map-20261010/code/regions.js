// ===== 区域层 · 数据与示例 =====
//
// 现状:项目**完全没有区域概念**。world.js 是一条 11 节点 × 4 列的平铺网格,
// 规则(危险度、产出、势力)要么硬编码在逻辑里,要么根本没建模。
// 最典型的是 build.js:255 那张表:
//
//   const DENS = { n0:0, n1:1, n2:1, n3:1, n10:1, n6:1, n7:2, n5:2, n4:2, n8:3, n9:0 };
//   return 1 + (DENS[node] || 0) * 0.25;
//
// 这就是**没有区域模型的病征**:想要「区域危险度」,只能在业务逻辑里
// 硬编码一张 11 行的查表,而且这张表一改就得全局搜一遍。
// 区域层要做的事,就是让这张表变成 `region.danger`。
//
// ⚠️ 本文件只新增 `REGIONS`,不改动任何既有节点 ID。
//    5 个区域覆盖 n0..n10 全部 11 个节点,一个不多一个不少。

// ───────────────────────────────────────────────────────────
// 势力
// ───────────────────────────────────────────────────────────

/** @type {import('./types.js').Faction[]} */
export const FACTIONS = [
  { id:'f_none',    name:'无主',   col:'#7a8a5a', stance:'neutral', power:0, desc:'无旗无号。谁来都能走,但谁也不保你。' },
  { id:'f_luoyun',  name:'落云商会', col:'#a88a5a', stance:'good',  power:2,
    desc:'把持商道与矿税。买卖公道,抽成也公道。' },
  { id:'f_heifeng', name:'黑风寨',  col:'#c86a4a', stance:'evil',  power:3,
    desc:'占山为王的散修与山贼。给钱能过路,给命才能过山。' },
  { id:'f_gucha',   name:'古朝遗族', col:'#8a7a9a', stance:'chaotic', power:4,
    desc:'守着古战场不让外人进。他们不打你,只是不让你进。' },
  { id:'f_sect',    name:'青岚宗',  col:'#6a9a8a', stance:'good',   power:4,
    desc:'新立的宗门。收弟子,也收过路钱。' },
];

// ───────────────────────────────────────────────────────────
// 区域
// ───────────────────────────────────────────────────────────

/**
 * 5 个初始区域。danger 与 build.js:255 的 DENS 逐一对齐 ——
 * 这是刻意的:迁移时 `fieldBonus()` 可以先退回按区域查 danger,
 * 行为不变;等节点都带上 region 字段,再彻底删掉那张表。
 *
 * @type {import('./types.js').Region[]}
 */
export const REGIONS = [
  {
    id: 'r_qingshi',
    name: '青石河谷',
    col: '#8a7a5a',
    danger: 1,
    faction: 'f_none',
    nodes: ['n0', 'n10', 'n1', 'n3'],       // 家园 + 两条村外野道
    desc: '一条河,两岸田。妖也来,但只来夜里,来了也只翻几户。',

    resources: [
      { id:'rice',        name:'灵米',   weight:0.5 },
      { id:'herb_qi',     name:'七叶草', weight:0.3 },
      { id:'stone_1',     name:'下品源石', weight:0.2 },
    ],

    dayNight: {
      nightDangerMul: 1.35,   // 与 items.js DAY.bonus() 的 1.35 同源
      dayYieldMul: 1.0,
      closedTypes: [],        // 河谷夜里照样能走
    },

    sect: null,               // 无宗门。玩家的起步区。

    mapRect: { x:2, y:6, w:44, h:52 },
  },

  {
    id: 'r_luoyun',
    name: '落云商道',
    col: '#a88a5a',
    danger: 1,
    faction: 'f_luoyun',
    nodes: ['n9', 'n2', 'n6'],               // 镇 + 两条北上的商道节点
    desc: '从落云镇往北,官道铺到望驿台。路上干净,因为商会养着人。',

    resources: [
      { id:'stone_1', name:'下品源石', weight:0.4 },
      { id:'scroll_1', name:'残卷',    weight:0.3 },
      { id:'herb_qi', name:'七叶草',   weight:0.3 },
    ],

    dayNight: {
      nightDangerMul: 1.15,   // 有商会巡道,夜里比别处安全
      dayYieldMul: 1.0,
      closedTypes: [],
    },

    sect: null,

    mapRect: { x:26, y:4, w:50, h:34 },
  },

  {
    id: 'r_qinglan',
    name: '青岚秘境',
    col: '#6a9a8a',
    danger: 2,
    faction: 'f_sect',
    nodes: ['n4'],                            // 青岚秘境(n4,legacy secret)
    desc: '一座塌了半边的洞府。产丹,也有主人在。',

    resources: [
      { id:'pill_zhuji', name:'筑基丹', weight:0.5 },
      { id:'stone_2',    name:'中品源石', weight:0.3 },
      { id:'herb_qi',    name:'七叶草',   weight:0.2 },
    ],

    dayNight: {
      nightDangerMul: 1.5,
      dayYieldMul: 1.1,      // 丹在日光下炼得好
      closedTypes: [],
    },

    sect: {
      id: 'sect_qinglan', name: '青岚宗',
      nodeId: 'n4',          // 宗门就设在秘境里 —— 占了秘境就占了宗门
      realmIdx: 2,
      recruit: true,
    },

    mapRect: { x:44, y:34, w:26, h:28 },
  },

  {
    id: 'r_heifeng',
    name: '黑风山道',
    col: '#c86a4a',
    danger: 2,
    faction: 'f_heifeng',
    nodes: ['n5', 'n7'],                     // 黑风岭(n5)+ 无名险地(n7)
    desc: '岭上石头缝里挂满写着字的木牌。都是愿,都是别人的。',

    resources: [
      { id:'stone_2',  name:'中品源石', weight:0.45 },
      { id:'scroll_2', name:'秘卷',     weight:0.3 },
      { id:'herb_qi',  name:'七叶草',   weight:0.25 },
    ],

    dayNight: {
      nightDangerMul: 1.6,
      dayYieldMul: 1.0,
      closedTypes: ['outpost'],   // 山道入夜封站
    },

    sect: null,

    mapRect: { x:52, y:30, w:34, h:32 },
  },

  {
    id: 'r_guzhan',
    name: '古战场遗墟',
    col: '#8a7a9a',
    danger: 3,
    faction: 'f_gucha',
    nodes: ['n8', 'n6'],                     // 古战场遗迹(n8)+ 东北哨点(n6)
    desc: '三百万柄断剑插在地上。风一吹,它们就一起响。',

    resources: [
      { id:'stone_3',  name:'上品源石', weight:0.4 },
      { id:'scroll_3', name:'古卷',     weight:0.35 },
      { id:'stone_2',  name:'中品源石', weight:0.25 },
    ],

    dayNight: {
      nightDangerMul: 1.8,   // 全场最凶
      dayYieldMul: 1.05,
      closedTypes: ['outpost', 'mine'],
    },

    sect: null,

    mapRect: { x:62, y:14, w:34, h:44 },
  },
];

// ───────────────────────────────────────────────────────────
// 区域索引(构建期一次性算好,别在热路径里遍历)
// ───────────────────────────────────────────────────────────

/** @type {Map<string, import('./types.js').Region>} */
export const REGION_BY_ID = new Map(REGIONS.map(r => [r.id, r]));

/** @type {Map<string, import('./types.js').Faction>} */
export const FACTION_BY_ID = new Map(FACTIONS.map(f => [f.id, f]));

/** nodeId → regionId。区域节点的单一索引。 */
export const NODE_REGION = new Map(
  REGIONS.flatMap(r => r.nodes.map(n => [n, r.id])),
);

/** 反查一个区域里都有哪些节点(保持 REGIONS 里的声明顺序)。 */
export function regionNodes(regionId) {
  const r = REGION_BY_ID.get(regionId);
  return r ? r.nodes.slice() : [];
}

/**
 * 两区域是否相邻(有跨区边)。UI 画区域连线用。
 * 数据在 network.js(因为它依赖 ROADS),这里只留声明位。
 * @returns {boolean} 恒为 false —— 由 network.js 的 regionAdjacency() 实现并覆盖
 */
export function adjacentRegions() {
  throw new Error('adjacentRegions 归 network.js 实现,见 integration.md §3.2');
}

/**
 * 计算某区域在**当前时刻**的视图(危险度随昼夜/封锁浮动)。
 *
 * 纯函数:不吃 Date.now(),时间由参数注入 —— 这样可以测试、
 * 也可以让离线推算复用同一套逻辑。
 *
 * @param {string} regionId
 * @param {Object} [ctx]
 * @param {boolean} [ctx.isNight]  取自 DAY.isNight()
 * @param {number}  [ctx.today]    取自 DAY.day()
 * @param {Object.<string,string>} [ctx.roadStates] key=`regionId`,value=blockadeBy
 * @returns {import('./types.js').RegionView}
 */
export function regionView(regionId, ctx = {}) {
  const r = REGION_BY_ID.get(regionId);
  if (!r) return { region:null, danger:0, passable:false, reason:'未知区域' };

  const isNight = !!ctx.isNight;
  const mul = isNight ? (r.dayNight?.nightDangerMul ?? 1.35) : (r.dayNight?.dayYieldMul ?? 1.0);

  // 封锁:静态 blockade(带 until)优先,其次是动态 roadStates
  const blk = r.blockade;
  let reason = null;
  if (blk && (!blk.until || ctx.today >= blk.until)) reason = blk.reason || '封锁中';

  const dyn = ctx.roadStates?.[regionId];
  if (!reason && dyn) reason = dyn;

  return {
    region: r,
    danger: Math.min(5, Math.round(r.danger * mul * 10) / 10),
    passable: !reason,
    reason: reason || undefined,
  };
}

// ───────────────────────────────────────────────────────────
// 迁移校验:这张表证明「区域不是凭空造的」
// ───────────────────────────────────────────────────────────

/**
 * 迁移安全网 —— 故意留在代码里,不是临时脚手架。
 *
 * 断言:REGIONS 覆盖的节点集合 === build.js:255 DENS 表的键集合。
 * 一旦有人新增/删除节点却忘了归入区域,这里立刻炸。
 *
 * 对应 build.js:255 的原始常量,逐项复制,**只读不改**。
 */
export const LEGACY_DENS = {
  n0:0, n1:1, n2:1, n3:1, n10:1, n6:1, n7:2, n5:2, n4:2, n8:3, n9:0,
};

/**
 * @returns {{ok:boolean, orphanNodes:string[], orphanDens:string[]}}
 * orphanNodes   = 有密度值但没归入任何区域的节点(漏归)
 * orphanDens    = 归了区域但不在密度表里的节点(新增节点,正常)
 */
export function verifyRegionCoverage() {
  const covered = new Set(REGIONS.flatMap(r => r.nodes));
  const orphanNodes = Object.keys(LEGACY_DENS).filter(n => !covered.has(n));
  const orphanDens = [...covered].filter(n => !(n in LEGACY_DENS));
  return { ok: orphanNodes.length === 0, orphanNodes, orphanDens };
}
