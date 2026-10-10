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
 * 5 个初始区域。danger 的真实定义是「**成员节点 DENS 的最大值**」——
 * 不是逐节点对齐,那张 11 行的 DENS 表是节点级的,区域是聚合。
 * 5 个区域实测全部满足该规则,由 `verifyRegionDanger()` 守门,
 * 所以 `fieldBonus()` 退回按区域查 danger 时行为仍然一致。
 *
 * ⚠️ 这里**没有**地图坐标(原 mapRect 已删)。V0.97 起地图按种子生成:
 *   实测 8 个种子 → 8 种布局(n2 在 seed=1 落在 (1,2),在 seed=42 落在 (1,4))。
 *   任何手写矩形都只对某一个种子成立 —— 原值在当前默认种子下就有
 *   12/15 个节点落在框外,换种子更是全错。
 *   区域色块改由 `regionRects()` 在渲染时按真实落点推导。
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

  },

  {
    id: 'r_guzhan',
    name: '古战场遗墟',
    col: '#8a7a9a',
    danger: 3,
    faction: 'f_gucha',
    // n6 望驿台曾被误列在这里。nodes.js:153 里它的 region 是 r_luoyun(官道分岔),
    // 而且它同时出现在 r_luoyun.nodes —— 一个节点占两个区域会让 NODE_REGION
    // 靠「后写覆盖先写」决定归属,与节点自身声明矛盾。已按 nodes.js 为准移出。
    nodes: ['n8'],                           // 古战场遗迹(n8)
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
  // 危险度只认**危险度倍率**。
  // 原来这里白天乘的是 dayNight.dayYieldMul —— 那是**产出**倍率
  // (types.js:103 写得很清楚),拿它缩放 danger 的后果:
  // 青岚秘境白天 2 × 1.1 = 2.2、古战场 3 × 1.05 = 3.15,
  // 「白天出丹多」被翻译成了「白天更凶」。
  // 产出与危险本就该能反向调(白天更安全但夜里更凶),两个字段互不干涉。
  const mul = isNight
    ? (r.dayNight?.nightDangerMul ?? 1.35)
    : (r.dayNight?.dayDangerMul ?? 1.0);

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

/**
 * 区域归属唯一性 + 与节点自身声明一致。
 *
 * `verifyRegionCoverage()` 用 Set 去重,**看不见重复**:一个节点被写进两个
 * 区域时,覆盖集合照样是那 11 个,ok 照样 true,重复彻底隐形。而 NODE_REGION
 * 是 `flatMap` 建的,重复节点会被**后写的区域静默夺走**,解析结果与
 * nodes.js 里 `region:` 字段矛盾 —— 这正是 n6 的遭遇。
 *
 * 断言两条:
 *   1. 任一节点最多属于一个区域;
 *   2. REGIONS 里的归属 === nodes.js 里该节点的 `region` 字段(nodes.js 为准)。
 *
 * @param {Object.<string,string>} nodeRegionById nodeId → regionId(nodes.js 的说法)
 * @returns {{ok:boolean, duplicated:Array<{node:string, regions:string[]}>, mismatched:Array<{node:string, inRegions:string, inNodes:string}>}}
 */
export function verifyRegionMembership(nodeRegionById = {}) {
  const seen = new Map();
  for (const r of REGIONS) for (const n of r.nodes) {
    if (!seen.has(n)) seen.set(n, []);
    seen.get(n).push(r.id);
  }
  const duplicated = [...seen]
    .filter(([, rs]) => rs.length > 1)
    .map(([node, regions]) => ({ node, regions }));

  const mismatched = [];
  for (const [node, rs] of seen) {
    const declared = nodeRegionById[node];
    // nodes.js 没表态(新节点可能尚未归区)时不报,免得把正常推进当错误
    if (declared && declared !== rs[0]) {
      mismatched.push({ node, inRegions: rs[0], inNodes: declared });
    }
  }
  return { ok: duplicated.length === 0 && mismatched.length === 0, duplicated, mismatched };
}

/**
 * 区域危险度 === 成员节点 DENS 的最大值。
 *
 * 这是区域 danger 的**唯一口径**,让 `fieldBonus()` 之类按区域查危险度的
 * 代码与节点级 DENS 保持行为一致,而不是靠「手填的时候记得对齐」。
 * 5 个区域实测:1/1/2/2/3,全部等于各自成员的最大值。
 *
 * @returns {{ok:boolean, bad:Array<{region:string, danger:number, expected:number}>}}
 */
export function verifyRegionDanger() {
  const bad = [];
  for (const r of REGIONS) {
    const vals = r.nodes.map(n => LEGACY_DENS[n]).filter(v => v !== undefined);
    if (!vals.length) continue;               // 全是新节点,没有可比基准
    const expected = Math.max(...vals);
    if (r.danger !== expected) bad.push({ region: r.id, danger: r.danger, expected });
  }
  return { ok: bad.length === 0, bad };
}

/**
 * 区域色块的几何 —— **渲染时按真实落点推导**,不再有静态坐标。
 *
 * 地图按种子生成,手写矩形注定只对一个种子成立(实测 8 种子 8 布局)。
 * 这里取每个区域**当前可见节点**的包围盒再外扩 `pad`,换种子自动跟随。
 *
 * 已知取舍:包围盒是近似,区域之间**会重叠**(节点在网格上交错时尤其明显)。
 * 这是有意的 —— 诚实的近似好过一张精确但骗人的图。渲染层用低透明度
 * 填充 + 虚线描边表达,重叠读作「势力交壤」。
 *
 * @param {Object[]} nodes   当前可见节点(需含 .id)
 * @param {(n:Object)=>{x:number,y:number}} posOf 节点 → 百分比坐标(与 ui 的 pos() 同一把尺)
 * @param {number} [pad]     外扩百分比,默认 7
 * @returns {Array<{region:Object, rect:Object, members:Object[]}>} 无可见成员的区域不返回
 */
export function regionRects(nodes, posOf, pad = 7) {
  const byId = new Map(nodes.map(n => [n.id, n]));

  // 归组方式:优先用**节点自带的 region**,读不到才退回静态 id 名册。
  //
  // 为什么不一直用静态名册(XX-WORLD-004 补):那份名册是 ['n0','n10','n1','n3'] 这种
  // 手写 id 列表,而 id 由 worldgen 按 (y,x) 排序**逐种子重发**(worldgen.js:237)。
  // 实测 200 个种子,n1~n16 的类型全部随种子变 —— 名册认领到的多半是另一个地方,
  // worldgen 自己多生成的节点则一个都认领不到,地图上就留下无主的点。
  // worldgen 现在给每个节点都赋了 region(见 worldgen.js assignRegions),
  // 这里的静态名册降级为**读不到 region 时的兜底**(单测假世界 / 旧数据层仍能用)。
  const byRegion = new Map();
  for (const n of nodes) {
    if (!n.region) continue;
    if (!byRegion.has(n.region)) byRegion.set(n.region, []);
    byRegion.get(n.region).push(n);
  }

  const out = [];
  for (const region of REGIONS) {
    const members = byRegion.has(region.id)
      ? byRegion.get(region.id)
      : region.nodes.map(id => byId.get(id)).filter(Boolean);
    if (!members.length) continue;            // n11+ 未开启时它们本就不在图上
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of members) {
      const p = posOf(n);
      if (p.x < x0) x0 = p.x;  if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;  if (p.y > y1) y1 = p.y;
    }
    out.push({
      region,
      members,
      rect: {
        x: Math.max(0, x0 - pad),
        y: Math.max(0, y0 - pad),
        w: Math.min(100, x1 + pad) - Math.max(0, x0 - pad),
        h: Math.min(100, y1 + pad) - Math.max(0, y0 - pad),
      },
    });
  }
  return out;
}
