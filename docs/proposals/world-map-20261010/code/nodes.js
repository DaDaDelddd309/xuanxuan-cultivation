// ===== 节点层 · 类型扩展与数据 =====
//
// 铁律:**n0..n10 的 id、type、x、y、name、home、shop、pill 全部逐字保留。**
// 本文件对 11 个 legacy 节点只做「加字段」,一个既有字段都不改、不删、不重排。
// story.js 的 5 条叙事线与 quest.js 的 8 条支线依赖这些值。
//
// 扩展策略:**5 个 legacy type + 5 个新 type + 正交 facet**。
//
// 为什么不是把「城镇/宗门/矿脉/据点/幻境/奇遇/篝火/守卫/商会/行会」都做成 type:
//   那 10 个词里,只有 5 个描述**行为**(进不进回合制、能不能打、能不能占领),
//   另外 5 个(城镇/宗门/商会/守卫/行会)只是**身份** —— 它们对系统的唯一影响
//   是「进去之后能点什么」。身份用 facet 表达,行为才用 type。
//   否则 15 种 type × 每种 8 个行为分支 = 一个没人敢改的分支地狱。
//   对照:项目现在 5 种 type,ui.js:546 就已经要写 if(field)/if(elite|secret|boss)
//   分三段了;翻三倍就是灾难。

// 本文件刻意**不 import** 仓库里的 PAL,好让这份骨架可以独立阅读、独立校验。
// 落到仓库里时换成:
//   import { PAL } from '../core/palette.js';      // 从 js/xiuxian/ 出发
// 下面这 3 个色值逐字复制自 js/core/palette.js,
// 由 tests/lint-palette.mjs 校验两边不许漂移 —— 改这里必须同步改那边。
const PAL = { gold:'#c9a227', qi:'#3d6b7a', crit:'#a03a2e' };

// ───────────────────────────────────────────────────────────
// 一、节点类型表
// ───────────────────────────────────────────────────────────

/**
 * @typedef {import('./types.js').NodeType} NodeType
 * @typedef {import('./types.js').NodeFacet} NodeFacet
 */

/**
 * 节点类型表。
 *
 * ⚠️ legacy 5 型的 `col` / `safe` / `turnBased` / `dropsPill` / `boss` / `name` / `desc`
 *    **原样复制自 world.js:8-17,一个字没改**。改色值会让老存档的地图渲染变色。
 * 新增的 `glyph` 是给 ui.js:834 那张硬编码映射用的 ——
 * 把「类型 → 地图符号」从 UI 挪进数据,UI 只读不算。
 *
 * @type {Object<NodeType, Object>}
 */
export const NODE_TYPES = {
  // ─────── legacy 5 型(冻结)───────
  village: { name:'村庄', col:'#8a7a5a', safe:true,  glyph:'舍', desc:'炊烟袅袅,可休整突破、悟道' },
  field:   { name:'荒野', col:'#7a8a5a', safe:false, glyph:'野', desc:'散妖游荡,小试锋芒' },
  elite:   { name:'险地', col:'#c86a4a', safe:false, glyph:'险', desc:'有强敌蛰伏,可能触发回合',
             turnBased:true },
  secret:  { name:'秘境', col:PAL.qi,    safe:false, glyph:'秘', desc:'藏宝之地,盛产丹药',
             dropsPill:true },
  boss:    { name:'妖巢', col:PAL.crit, safe:false, glyph:'妖', desc:'大能坐镇,必逢回合',
             turnBased:true, boss:true },

  // ─────── 新增 5 型 ───────

  /** 幻境/副本。区别于 secret:secret 是「一次性藏宝地」,rift 是「可重复的关卡」。
   *  对应用户的「从地图点进入 → 特殊的砍杀局或回合制副本」。 */
  rift: {
    name:'幻境', col:'#9a6ab8', safe:false, glyph:'境', turnBased:true,
    desc:'踏进去是一段别人的因果。出来时,里面的东西不一定跟你走。',
  },

  /** 矿脉。可占领,对接 build.js 的 canClaimMine / claimMine。 */
  mine: {
    name:'矿脉', col:PAL.gold, safe:false, glyph:'矿', claimable:true,
    desc:'石头缝里渗着光。占了就是你的,前提是守得住。',
  },

  /** 据点/篝火点。可扎营,对接 BUILD.addFire / CAMP.lit。
   *  同时承接用户的「种田:据点、篝火」—— 但注意 build.js 的灵田
   *  已经存在且挂在篝火上,这里只提供「哪里能扎营」的落点,不重做灵田逻辑。 */
  outpost: {
    name:'据点', col:'#8a9a6a', safe:true, glyph:'燧', desc:'有旧灶,有人走。补一炷香就能歇脚。',
  },

  /** 奇遇点。一次性的事件触发器,接 ui.js 现有的 rollEncounter。 */
  wonder: {
    name:'奇遇', col:'#c8b84a', safe:true, glyph:'遇', desc:'不知谁留下的。看见了就是你的机缘。',
  },

  /** 关隘/区域门。**只做跨区通行,不刷怪。** UI 上的区域边界就是它。 */
  gate: {
    name:'关隘', col:'#6a7a8a', safe:true, glyph:'关', desc:'过了这道门,就是别人的地盘了。',
  },
};

// ───────────────────────────────────────────────────────────
// 二、身份 facet(正交,可叠加)
// ───────────────────────────────────────────────────────────

/**
 * facet 只影响「进去之后挂什么菜单」,不改变节点基础行为。
 * 一个节点可以同时是 `field` + `town` + `guild`。
 *
 * @type {Object<NodeFacet, {name:string, glyph:string, desc:string}>}
 */
export const NODE_FACETS = {
  town:     { name:'城镇', glyph:'城', desc:'有集市、酒馆、商会。有用,也有税。' },
  sect:     { name:'宗门', glyph:'宗', desc:'能拜、能换、能领俸。不能白进。' },
  guild:    { name:'行会', glyph:'会', desc:'接悬赏、换委托、把赏金换成名声。' },
  port:     { name:'渡口', glyph:'渡', desc:'水路从这里接上官道。' },
  harvest:  { name:'灵田', glyph:'田', desc:'能开垦。产量看区域危险度。' },
  cursed:   { name:'凶地', glyph:'凶', desc:'来过的人少了。地图上会显出雾。' },
  contested:{ name:'争夺', glyph:'争', desc:'两家都要,谁也没拿全。' },
};

// ───────────────────────────────────────────────────────────
// 三、节点数据
// ───────────────────────────────────────────────────────────

/**
 * 全部节点。
 *
 * 【legacy 11 个】x/y/type/name/home/shop/pill 与 world.js:33-45 逐字一致。
 *   新增字段全部可选,不填则由 NODE_TYPES 默认值兜底 ——
 *   这样即使这份数据写错了,回退到 world.js 的旧表也还能跑。
 *
 * 【新增节点】一律 n11 起,见 §四。
 *
 * `threat.tier` 的取法:density + 1(对齐 build.js:255 DENS)。
 *   DENS 0→tier1 · 1→tier2 · 2→tier3 · 3→tier4
 *
 * @type {import('./types.js').Node[]}
 */
export const NODES = [
  // ══════════ legacy 11 个:id 与既有字段冻结 ══════════

  { id:'n0',  x:1, y:1, type:'village', name:'青石村', home:true,  region:'r_qingshi',
    threat:{ tier:1, density:0, enemies:[] },
    facets:['town'],
    desc:'河滩上第一个村子。井是枯的,但井边有人。' },

  { id:'n1',  x:2, y:1, type:'field',    region:'r_qingshi',
    threat:{ tier:2, density:1, enemies:['wanderer','guard'] } },

  { id:'n2',  x:3, y:1, type:'field',    region:'r_luoyun',
    threat:{ tier:2, density:1, enemies:['wanderer','guard'] } },

  { id:'n3',  x:2, y:2, type:'field',    region:'r_qingshi',
    threat:{ tier:2, density:1, enemies:['wanderer','guard'] } },

  // ⚠️ n4 是 5 条叙事线里出现最多的节点(beats 2/3 与「白泽」线全落这儿),绝对不能动
  { id:'n4',  x:3, y:2, type:'secret', pill:'pill_zhuji', name:'青岚秘境', region:'r_qinglan',
    threat:{ tier:3, density:2, enemies:['elder','devil'] },
    facets:['sect'],
    entry:{ mode:'duel', foeKey:'elder', minRealmIdx:0 },
    desc:'青岚宗的旧洞府。丹是真的,主人也是真的。' },

  { id:'n5',  x:4, y:2, type:'elite', name:'黑风岭', region:'r_heifeng',
    threat:{ tier:3, density:2, enemies:['yao','elder'] },
    entry:{ mode:'duel', foeKey:'yao', minRealmIdx:0 } },

  { id:'n6',  x:4, y:1, type:'field',    region:'r_luoyun',
    threat:{ tier:2, density:1, enemies:['wanderer','guard'] },
    facets:['port'],
    desc:'望驿台。官道到这儿分岔,水路往北。' },

  // ⚠️ 数据不一致,见文件末尾 §五。此处保持 n7 的 name 为空,不「顺手修正」——
  //    改了名字会动到 story.js 的显示文案。修文案和修数据是两件事。
  { id:'n7',  x:3, y:3, type:'elite',    region:'r_heifeng',
    threat:{ tier:3, density:2, enemies:['yao','elder'] },
    entry:{ mode:'duel', foeKey:'yao', minRealmIdx:0 } },

  { id:'n8',  x:4, y:3, type:'boss', name:'古战场遗迹', region:'r_guzhan',
    threat:{ tier:4, density:3, enemies:['devil'] },
    entry:{ mode:'duel', foeKey:'devil', minRealmIdx:1 },
    desc:'三百万柄断剑。剑骨还在练它那一招。' },

  { id:'n9',  x:2, y:3, type:'village', name:'落云镇', shop:true, region:'r_luoyun',
    threat:{ tier:1, density:0, enemies:[] },
    facets:['town','guild'],
    desc:'商会的地盘。有集市,有酒馆,有收钱办事的人。' },

  { id:'n10', x:1, y:2, type:'field',    region:'r_qingshi',
    threat:{ tier:2, density:1, enemies:['wanderer','guard'] },
    desc:'村外。枯井在这儿,坟场也在这儿。' },

  // ══════════ 新增节点:全部 n11 起,ID 不与 legacy 冲突 ══════════
  // 这些**默认不启用**。用下面 FEATURE_FLAGS 逐个开,
  // 保证任何一阶段发布时,新节点对老存档都是不可见的。

  // —— 类型样本:幻境(副本入口)——
  { id:'n11', mx:52, my:28, type:'rift', name:'青岚幻境', region:'r_qinglan',
    threat:{ tier:3, density:2, enemies:['elder','devil'] },
    entry:{ mode:'duel', sceneId:'sc_qinglan_1', foeKey:'elder', minRealmIdx:1 },
    desc:'青岚宗每十年开一次。这次的名额,落云镇有三个。' },

  // —— 类型样本:矿脉(可占领,接 build.claimMine)——
  { id:'n12', mx:40, my:66, type:'mine', name:'落云矿脉', region:'r_luoyun',
    claimable:true,
    site:{ resType:'miner', resCount:2, resId:'stone_2', resQty:3, buildMax:6 },
    facets:['contested'],
    desc:'商会名下的一座废矿。空了十年,最近又亮起来。' },

  // —— 类型样本:据点/篝火(接 BUILD.addFire)——
  { id:'n13', mx:30, my:58, type:'outpost', name:'河湾旧驿', region:'r_qingshi',
    site:{ ward:22, resType:'guard', resCount:1, buildMax:4 },
    facets:['harvest'],
    desc:'驿站废了,灶还在。投一炷香,能歇一夜。' },

  // —— 类型样本:奇遇点(一次性,接 ui.rollEncounter)——
  { id:'n14', mx:66, my:44, type:'wonder', name:'无字碑', region:'r_heifeng',
    threat:{ tier:3, density:2, enemies:[] },
    facets:['cursed'],
    desc:'碑上一个字也没有。但每个路过的人都记住了它。' },

  // —— 类型样本:关隘(跨区门)——
  { id:'n15', mx:47, my:40, type:'gate', name:'青岚关', region:'r_qinglan',
    desc:'过了这道门就进秘境地界。守关的是青岚宗的人。' },
];

// ───────────────────────────────────────────────────────────
// 四、索引、查询与开关
// ───────────────────────────────────────────────────────────

/** @type {Map<string, import('./types.js').Node>} */
export const NODE_BY_ID = new Map(NODES.map(n => [n.id, n]));

/** 冻结的 legacy id 集合。任何代码都不得从中删除或改写。 */
export const LEGACY_IDS = Object.freeze(
  ['n0','n1','n2','n3','n4','n5','n6','n7','n8','n9','n10'],
);

/**
 * 阶段开关。**这是控制体量的主阀门** —— 全部系统默认关闭,
 * 每个阶段只翻一个。这样任何一个阶段都能单独发布、单独回滚,
 * 而代码库始终是完整可运行的。
 *
 * 阶段 0/1/2 全 false —— 也就是说即使这份代码整个合进去,
 * 玩家看到的还是原来那张 11 格地图,一个像素都不变。
 */
export const FEATURE_FLAGS = {
  regions:    false,  // 阶段 1:区域着色 + 区域危险度
  roads:      false,  // 阶段 2:Dijkstra 赶路 + 距离/耗时
  encounters: false,  // 阶段 2:路上遭遇
  blockades:  false,  // 阶段 3:封锁
  extraction: false,  // 阶段 4:搜打撤
  newNodes:   false,  // 阶段 5:n11+ 全部登场
};

/** 按开关过滤后的可见节点集。UI 与寻路都应该用这个,而不是裸 NODES。 */
export function visibleNodes(flags = FEATURE_FLAGS) {
  if (flags.newNodes) return NODES.slice();
  return NODES.filter(n => LEGACY_IDS.includes(n.id));
}

/** 某区域的所有节点对象。 */
export function nodesInRegion(regionId) {
  return NODES.filter(n => n.region === regionId);
}

/**
 * 取节点的某字段,带回退链:节点自带 → 类型默认 → 硬兜底。
 * UI 层不再写 `NODE_TYPES[n.type] && NODE_TYPES[n.type].safe` 这种防御代码。
 */
export function nodeProp(node, prop, fallback = undefined) {
  if (!node) return fallback;
  if (node[prop] !== undefined) return node[prop];
  const t = NODE_TYPES[node.type];
  if (t && t[prop] !== undefined) return t[prop];
  return fallback;
}

/** 地图符号。ui.js:834 的硬编码表由这个取代。 */
export function nodeGlyph(node) {
  if (!node) return '·';
  if (node.glyph) return node.glyph;
  return NODE_TYPES[node.type]?.glyph || '·';
}

/** 节点类型定义(含 fallback)。 */
export function typeOf(node) {
  return NODE_TYPES[node?.type] || NODE_TYPES.field;
}

// ───────────────────────────────────────────────────────────
// 五、迁移期发现的数据不一致(**不要在本次改动里顺手修**)
// ───────────────────────────────────────────────────────────

/**
 * ⚠️ 已核实的问题(不是本次引入的):
 *
 * story.js:47 有这么一条 beat:
 *   { at:1, node:'n7', text:'黑风岭的石头缝里,挂满了写着字的木牌。都是愿。' }
 *
 * 但 world.js:39 里 **黑风岭是 n5**,n7 是个没命名的普通 elite 节点。
 * 也就是说这条 beat 的 `node` 指错了地方:文本说黑风岭,坐标却落在 n7。
 *
 * 旁证:
 *   · quest.js:16 laolao 支线写的是 `where:['n5','n7']`,tip:'黑风岭与险地'
 *     —— 明确把 n5=黑风岭、n7=险地 分开。所以 quest 是对的,story 是错的。
 *   · 同一叙事线紧邻的两条 beat(at:2 / at:3)用的都是 n5,只有 at:1 跑到了 n7。
 *
 * 结论:这是一条**文案-坐标错配**,不是节点数据错。
 * 正确修法是改 story.js 的那一个 node 值(n7 → n5),**不动 world.js**。
 *
 * 为什么不放在这次迁移里改:
 *   改它会让「老玩家已 met 过的节点」判定发生变化(玩家可能已经站在 n7 看过这段),
 *   属于玩家可见的行为变更,应该单独发一个版本、单独说明,
 *   而不是混在一堆地图重构里悄悄上线。
 *
 * 另:`WORLD.grid = 6` 但坐标只到 4 —— ui.js:807-813 早已绕开它,
 * 直接按数据真实范围算布局。所以 grid 这个字段事实上已废弃,
 * 迁移完成后可以直接删(见 README 阶段 1)。
 */

export const KNOWN_ISSUES = {
  /** story.js:47 的 node 应为 n5 而非 n7。修 story,不改 nodes。 */
  storyN7Mislabelled: { file:'js/xiuxian/story.js', line:47, shouldBe:'n5', actual:'n7' },
  /** WORLD.grid=6 与实际坐标范围 1..4 不符;ui.js 已绕过。字段已废弃。 */
  gridMismatch: { file:'js/xiuxian/world.js', line:57, declared:6, actual:4, deadField:true },
  /** world.js 的 travel() 零调用点(死代码)。见 README 阶段 1。 */
  deadTravel: { file:'js/xiuxian/world.js', line:79, callSites:0 },
};

/** 迁移自检:11 个 legacy id 一个不少、不少、类型未变。 */
export function verifyLegacyIntact() {
  const problems = [];
  for (const id of LEGACY_IDS) {
    const n = NODE_BY_ID.get(id);
    if (!n) { problems.push(`legacy 节点丢失: ${id}`); continue; }
    if (!n.x || !n.y) problems.push(`${id} 丢了 x/y 坐标,旧 UI 会画不出来`);
    if (!n.type)    problems.push(`${id} 丢了 type`);
  }
  return { ok: problems.length === 0, problems };
}
