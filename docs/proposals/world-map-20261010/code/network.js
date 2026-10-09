// ===== 路网层 · 数据结构与算法 =====
//
// 现状:world.js:48-57 的路网是**从坐标算出来的**,不是数据。
//   buildEdges() → 曼哈顿距离==1 → [[a,b]]
//   travel()     → {from,to,cost:1}   cost 是常数,不是距离
//   pathBetween()→ BFS,按**跳数**最短,不是按距离
//
// 这套东西能支撑「点一下相邻格子就过去」,撑不起「骑马赶路」。
// 赶路需要四样现在完全没有的东西:
//   1. **路程与耗时** —— 现在 cost 恒为 1,BFS 数跳数。
//      绕远路和抄近路现在等价,官道和野路现在等价。
//   2. **道路类型** —— 官道/野路/水路的速度与遭遇完全不同。
//   3. **路上的遭遇** —— 现在只有「抵达节点」才触发(rollEncounter),
//      「在去���的路上」是空白。
//   4. **封锁** —— 现在没有任何路能被封。
//
// 兼容性铁律:world.js 的 `edges:[[a,b]]` 继续保留并继续可读。
//   ui.js:819 还在遍历它画连线。本文件用 roadsFromLegacy() 做桥。
//
// 本文件**不 import nodes.js / regions.js** —— 那样会成环
// (区域要靠路网算跨区,路网要靠区域算归属)。
// 区域映射由装配层在启动时用 bindRegions() 注入。

// ───────────────────────────────────────────────────────────
// 一、时间与速度常量(单一真源)
// ───────────────────────────────────────────────────────────

/**
 * 1 tick = 75 秒真实时间。
 * 取自 clock.js:29 的 ACTION_MS(1 游戏日 = 15 分钟 = 12 次行动)。
 * ⚠️ 不要在这里另定一个「赶路一天多少分钟」——
 *    clock.js 的注释明确记录过四套计时互相打架的历史事故。
 *    赶路的 tick 就是 DAY.tick(),直接复用同一把尺子。
 */
export const TICK_MS = 75 * 1000;

/** 步行基础速度:里 / tick。 */
export const BASE_SPEED = 8;

/**
 * 道路类型。只决定**速度**;遭遇概率写在每条路的 `enc.rate` 上。
 *
 * 为什么没有「按类型统一乘遭遇系数」那一层:
 *   第一版是 `rate × encMul` 逐 tick 累乘,结果一条 64 里的路 pEncounter
 *   直接打满 1.0 —— 每走必遇,等于没这个系统。
 *   原因是 12 个 tick 各自独立掷骰,复合概率必然趋近 1。
 *   现在改成 **rate 是「每里」概率**,整条路一次算 `1-(1-rate)^dist`,
 *   并且把系数烘进作者手写的 rate 里。多一层乘法就多一个调坏的入口。
 *
 * @type {Object.<string, {id:string,name:string,speedMul:number,hue:string,desc:string,encPerLi:number}>}
 */
export const ROAD_KINDS = {
  road:   { id:'road',   name:'官道', speedMul:1.0, hue:'#8a7a5a', encPerLi:0.004,
            desc:'夯土压实,牛车能走。沿途有驿站,但也有税。' },
  trail:  { id:'trail',  name:'野路', speedMul:0.7, hue:'#7a8a5a', encPerLi:0.018,
            desc:'人踩出来的。快不了,但没人收钱。' },
  water:  { id:'water',  name:'水路', speedMul:1.3, hue:'#5a7a9a', encPerLi:0.010,
            desc:'顺流比走陆路快。但船家要看天。' },
  secret: { id:'secret', name:'秘径', speedMul:0.9, hue:'#9a6ab8', encPerLi:0.030,
            desc:'不是路。是知道路的人不走的那条。' },
};

/** 节点类型 → 默认道路类型的推断表。缺省为 trail(野路)。 */
const KIND_BY_TYPE = {
  village:'road', town:'road',
  field:'trail', elite:'trail', secret:'trail', boss:'road',
  rift:'secret', mine:'trail', outpost:'road', wonder:'trail', gate:'road',
};

// ───────────────────────────────────────────────────────────
// 二、遭遇事件表
// ───────────────────────────────────────────────────────────

/**
 * 路上的遭遇。**刻意做得非常薄** ——
 * 赶路遭遇的价值在于「打断节奏 + 给点风险」,不在于内容多。
 * 4 个事件够跑通循环了;真想加,加数据就行,不用改逻辑。
 *
 * @type {import('./types.js').EncounterDef[]}
 */
export const ENCOUNTERS = [
  { id:'e_bandit', name:'道上有劫', kind:'combat', weight:3,
    text:'灌木后跳出两个人,要过路钱。',
    effect:{ dao:-30, hp:-0.05 } },
  { id:'e_wander', name:'散妖拦路', kind:'combat', weight:4,
    text:'一头散妖横在路上,不让过。',
    effect:{ dao:20, exp:15, hp:-0.08 } },
  { id:'e_herb', name:'道旁药丛', kind:'event', weight:3,
    text:'路边岩缝里长着一丛七叶草。你停下,挖了出来。',
    effect:{ items:[{ id:'herb_qi', n:1 }], dao:5 } },
  { id:'e_cart', name:'翻车的老农', kind:'event', weight:2,
    text:'老农的车翻了。你帮他扶起来,他塞给你点东西。',
    effect:{ items:[{ id:'rice', n:2 }], dao:10 } },
];

/** 按权重抽一次遭遇。注入 rng 以便测试(对齐 profile.js 的 PRNG 接口)。 */
export function rollEncounter(encIds, rng = Math.random) {
  if (!encIds || !encIds.length) return null;
  const pool = encIds.map(id => ENCOUNTERS.find(e => e.id === id)).filter(Boolean);
  if (!pool.length) return null;
  const total = pool.reduce((a, e) => a + (e.weight || 1), 0);
  let r = rng() * total;
  for (const e of pool) { r -= (e.weight || 1); if (r <= 0) return e; }
  return pool[pool.length - 1];
}

// ───────────────────────────────────────────────────────────
// 三、路网数据
// ───────────────────────────────────────────────────────────

/** 方向无关的稳定路 id。n0→n1 和 n1→n0 是同一条路。 */
export const roadId = (a, b) => `r_${[a, b].sort().join('__')}`;

/**
 * 22 条路 = 15 条 legacy 边(world.js buildEdges() 的输出,逐条一致)
 *          + 7 条新节点的路。
 *
 * 这里给的是**显式数据**,不再从坐标算 —— 因为坐标推导表达不了
 * 「n5-n8 是官道、n4-n7 是野路」这种差异。
 * dist 单位:里。
 *
 * enc.rate 是**每里**遭遇概率(见 ROAD_KINDS 的注释)。
 *
 * @type {import('./types.js').Road[]}
 */
export const ROADS = [
  // ── r_qingshi 内部 ──
  { id: roadId('n0','n1'),  from:'n0', to:'n1',  kind:'road',  dist:12, enc:{ rate:0.004, table:['e_bandit'] } },
  { id: roadId('n0','n10'), from:'n0', to:'n10', kind:'trail', dist:6,  enc:{ rate:0.018, table:['e_herb','e_wander'] } },
  { id: roadId('n1','n3'),  from:'n1', to:'n3',  kind:'trail', dist:9,  enc:{ rate:0.018, table:['e_wander','e_bandit'] } },
  { id: roadId('n3','n10'), from:'n3', to:'n10', kind:'trail', dist:8,  enc:{ rate:0.018, table:['e_herb','e_wander'] } },

  // ── 跨区:r_qingshi ↔ r_luoyun ──
  //    n1 属 r_qingshi、n2 属 r_luoyun,所以 n1-n2 必然跨区。
  //    (别在「内部」段落里再写一次 —— 会和这条产生重复 id。)
  { id: roadId('n1','n2'),  from:'n1', to:'n2',  kind:'road',  dist:14, enc:{ rate:0.004, table:['e_bandit'] },
    crossesRegion:true },
  { id: roadId('n3','n9'),  from:'n3', to:'n9',  kind:'road',  dist:18, enc:{ rate:0.004, table:['e_cart'] },
    crossesRegion:true },

  // ── 跨区:→ r_qinglan ──
  { id: roadId('n2','n4'),  from:'n2', to:'n4',  kind:'trail', dist:14, enc:{ rate:0.020, table:['e_wander','e_bandit'] },
    crossesRegion:true },
  { id: roadId('n3','n4'),  from:'n3', to:'n4',  kind:'trail', dist:11, enc:{ rate:0.020, table:['e_herb','e_wander'] },
    crossesRegion:true },

  // ── 跨区:r_qinglan ↔ r_heifeng(秘境往后山)──
  { id: roadId('n4','n5'),  from:'n4', to:'n5',  kind:'secret', dist:15, enc:{ rate:0.045, table:['e_wander','e_bandit'] },
    crossesRegion:true },
  { id: roadId('n4','n7'),  from:'n4', to:'n7',  kind:'trail',  dist:13, enc:{ rate:0.024, table:['e_wander'] },
    crossesRegion:true },

  // ── 跨区:→ r_guzhan(主线区,标 story 让 UI 高亮)──
  { id: roadId('n5','n8'),  from:'n5', to:'n8',  kind:'road',   dist:20, enc:{ rate:0.012, table:['e_bandit','e_wander'] },
    crossesRegion:true, story:true },
  { id: roadId('n7','n8'),  from:'n7', to:'n8',  kind:'secret', dist:19, enc:{ rate:0.045, table:['e_wander'] },
    crossesRegion:true, story:true },

  // ── 回头路 ──
  { id: roadId('n5','n6'),  from:'n5', to:'n6',  kind:'trail', dist:17, enc:{ rate:0.018, table:['e_bandit','e_wander'] },
    crossesRegion:true },
  { id: roadId('n7','n9'),  from:'n7', to:'n9',  kind:'road',  dist:21, enc:{ rate:0.004, table:['e_cart','e_bandit'] },
    crossesRegion:true },

  // ── r_luoyun 内部(北向商道)──
  { id: roadId('n2','n6'),  from:'n2', to:'n6',  kind:'road',  dist:16, enc:{ rate:0.004, table:['e_cart'] } },
];

/**
 * 7 条新节点的路 —— 属于 n11+ 那批节点,**阶段 5 之前不生效**。
 * 单独拆出来而不是混在 ROADS 里,是为了让「当前该走哪一批」变成一个
 * 显式开关(activeRoads),而不是靠调用方自己记得过滤。
 *
 * 路网本身保持自洽:即使节点还没登场,这些路也是对的 ——
 * 这样 verifyNetwork() 在任何阶段都是绿的,不会出现
 * 「阶段 2 校验通过、阶段 5 一开就炸」这种薛定谔的校验。
 *
 * @type {import('./types.js').Road[]}
 */
export const ROADS_PENDING = [
  // n11 青岚幻境 —— 秘境背后的那扇门,秘径直达
  { id: roadId('n4','n11'), from:'n4', to:'n11', kind:'secret', dist:6,
    enc:{ rate:0.030, table:['e_wander'] } },

  // n12 落云矿脉 —— 镇子往南的废矿道
  { id: roadId('n9','n12'), from:'n9', to:'n12', kind:'trail', dist:9,
    enc:{ rate:0.018, table:['e_bandit','e_herb'] } },

  // n13 河湾旧驿 —— 村外旧驿 + 跨区到落云镇
  { id: roadId('n10','n13'), from:'n10', to:'n13', kind:'trail', dist:7,
    enc:{ rate:0.012, table:['e_herb'] } },
  { id: roadId('n13','n9'), from:'n13', to:'n9', kind:'road', dist:13,
    enc:{ rate:0.004, table:['e_cart'] }, crossesRegion:true },

  // n14 无字碑 —— 岭上拐角的小路
  { id: roadId('n7','n14'), from:'n7', to:'n14', kind:'trail', dist:5,
    enc:{ rate:0.020, table:['e_wander'] } },

  // n15 青岚关 —— 关隘本身:河谷进秘境的正经门
  { id: roadId('n3','n15'), from:'n3', to:'n15', kind:'road', dist:10,
    enc:{ rate:0.004, table:['e_bandit'] }, crossesRegion:true, story:true },
  { id: roadId('n15','n4'), from:'n15', to:'n4', kind:'road', dist:4,
    enc:{ rate:0.004, table:['e_bandit'] } },
];

/**
 * 当前生效的路网。**所有寻路都必须经过这个函数拿数据**,
 * 不要直接用 ROADS —— 否则阶段 5 一开,玩家在阶段 2 就提前看到新路了。
 *
 * @param {boolean} [withPending] 等价于 nodes.js 的 FEATURE_FLAGS.newNodes
 * @returns {import('./types.js').Road[]}
 */
export function activeRoads(withPending = false) {
  return withPending ? [...ROADS, ...ROADS_PENDING] : ROADS;
}

// ───────────────────────────────────────────────────────────
// 四、索引与兼容层
// ───────────────────────────────────────────────────────────

const pairKey = (a, b) => [a, b].sort().join('__');

/** 建索引。内部用,按批建好缓存 —— ROADS 是模块级常量,建一次就够。 */
function indexRoads(list) {
  const byId = new Map(list.map(r => [r.id, r]));
  const byPair = new Map(list.map(r => [pairKey(r.from, r.to), r]));
  const byNode = new Map();
  for (const r of list) {
    for (const n of [r.from, r.to]) {
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n).push(r);
    }
  }
  return { byId, byPair, byNode };
}

const IDX_CORE = indexRoads(ROADS);
const IDX_ALL  = indexRoads([...ROADS, ...ROADS_PENDING]);

/** @type {Map<string, import('./types.js').Road>} 生效路的 id 索引 */
export const ROAD_BY_ID = IDX_CORE.byId;
/** @type {Map<string, import('./types.js').Road>} 生效路的端点对索引 */
export const ROAD_BY_PAIR = IDX_CORE.byPair;

/** 取生效索引。withPending 对应 FEATURE_FLAGS.newNodes。 */
export function roadIndex(withPending = false) {
  return withPending ? IDX_ALL : IDX_CORE;
}

/** 某节点连出的所有**生效**路。 */
export function roadsFrom(nodeId, withPending = false) {
  return (withPending ? IDX_ALL : IDX_CORE).byNode.get(nodeId) || [];
}

/**
 * ⚠️ 兼容 shim —— 这是 ui.js:260 现在依赖的形状:
 *
 *     case 'travel': {
 *       const from = Cult.get().current;
 *       const path = neighbors(from);
 *       if (!path.includes(v)) { toast('路不通'); return; }
 *
 * `neighbors()` 必须继续返回**直接相邻的节点 id 数组**,内容必须与
 * world.js:60-63 一致,否则 ui.js 的 travel 分支会误判「路不通」。
 *
 * 阶段 2 完成后 ui.js 改调 planRoute(),这个函数即可删。
 */
export function neighbors(nodeId, withPending = false) {
  return roadsFrom(nodeId, withPending).map(r => r.from === nodeId ? r.to : r.from);
}

/**
 * 从 world.js 的旧 edges:[[a,b]] 生成 Road。
 *
 * 用途:通用转换器。默认值让转换结果与旧行为**完全等价**:
 * cost 恒为 1、BFS 跳数最短、不触发遭遇。
 * 如果将来想让 ROADS 少写点(只写关键几条,其余自动生成),走这条。
 *
 * @param {[string,string][]} legacyEdges world.js buildEdges() 的输出
 * @param {Object<string,{type:string,x:number,y:number}>} [nodesById]
 * @returns {import('./types.js').Road[]}
 */
export function roadsFromLegacy(legacyEdges, nodesById = {}) {
  return legacyEdges.map(([a, b]) => {
    const na = nodesById[a] || {}, nb = nodesById[b] || {};
    const md = Math.abs((na.x ?? 0) - (nb.x ?? 0)) + Math.abs((na.y ?? 0) - (nb.y ?? 0));
    return {
      id: roadId(a, b),
      from: a, to: b,
      kind: KIND_BY_TYPE[nb.type] || KIND_BY_TYPE[na.type] || 'trail',
      dist: md || 1,
      enc: { rate: 0, table: [] },      // 默认不触发 —— 保持旧行为
    };
  });
}

// ───────────────────────────────────────────────────────────
// 五、运行时道路状态(进存档)
// ───────────────────────────────────────────────────────────

/**
 * 道路封锁状态。**静态(sealed)与动态(blocked)分开放**:
 *   sealed  = 世界设定,永不解封(目前只用于剧情锁)
 *   blocked = 会变的(妖潮/宗争/封矿),带 until(GameDay),到期自解
 * 混在一起会导致「剧情锁被妖潮时间到解掉」这种灾难。
 *
 * ⚠️ 下面是**演示数据**,不是默认值。
 *    n5-n8 封、n7-n8 留 —— 演示「同一个目标两条路,一条被占一条能走」。
 *    阶段 0/1/2 上线时请置空 `{}`;封锁逻辑随阶段 3 才真正启用。
 *    特别注意:绝不能封死**所有**通往 n8 的路 —— n8 挂着 5 条叙事线里的 4 条
 *    (story.js 的断剑冢 / 青穹 / 古战场三线,以及白泽线的终环)。
 *
 * @type {Object.<string, import('./types.js').RoadState>}
 */
export const ROAD_STATE = {
  'r_n5__n8': { blocked:true, blockedBy:'古朝遗族', until:0 },
  'r_n7__n8': { blocked:false, blockedBy:null,    until:0 },
};

/**
 * 这条路现在走不走得通。
 * @returns {{ok:boolean, reason?:string}}
 */
export function passable(road, state = ROAD_STATE) {
  if (!road) return { ok:false, reason:'无此路' };
  if (road.sealed) return { ok:false, reason:'不通' };
  const st = state[road.id];
  if (!st || !st.blocked) return { ok:true };
  return { ok:false, reason: st.blockedBy || '封锁中' };
}

// ───────────────────────────────────────────────────────────
// 六、路线规划(取代 BFS 跳数最短)
// ───────────────────────────────────────────────────────────

/**
 * Dijkstra,按**实际耗时**找最短路,而不是按跳数。
 *
 * 为什么必须换:15 条边的小图上 BFS 和 Dijkstra 结果常常一样,
 * 但一旦加了 dist(官道 20 里 vs 秘径 6 里),「跳数最少」就完全错了 ——
 * 玩家会看到系统让他走 5 段野路去 100 里外,而官道只要 2 段 60 里。
 *
 * @param {string} fromId
 * @param {string} toId
 * @param {Object} [opts]
 * @param {Object.<string,import('./types.js').RoadState>} [opts.state]
 * @param {number} [opts.speedMul] 外部速度加成(坐骑),默认 1
 * @param {boolean} [opts.ignoreBlock] true = 只算时间不管封锁(给 UI 画「红路线」)
 * @returns {import('./types.js').TravelPlan|null}
 */
export function planRoute(fromId, toId, opts = {}) {
  const state = opts.state || ROAD_STATE;
  const mountMul = opts.speedMul ?? 1;
  const idx = roadIndex(opts.withPending ?? false);

  if (fromId === toId) return { from:fromId, to:toId, roads:[], dist:0, ticks:0,
                                 encounterAt:[], pEncounter:0 };

  // 小图,用数组版 Dijkstra(n<500 完全够用,不要引第三方库)
  const dist = new Map([[fromId, 0]]);
  const prevRoad = new Map();
  const done = new Set();

  for (;;) {
    let cur = null, best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) { best = d; cur = id; }
    }
    if (cur === null || cur === toId) break;
    done.add(cur);

    for (const r of (idx.byNode.get(cur) || [])) {
      if (done.has(r.from === cur ? r.to : r.from)) continue;
      if (!opts.ignoreBlock && !passable(r, state).ok) continue;

      const next = r.from === cur ? r.to : r.from;
      const speed = BASE_SPEED * (ROAD_KINDS[r.kind]?.speedMul ?? 1) * mountMul;
      const ticks = Math.max(1, Math.ceil((r.dist ?? 1) / speed));
      const nd = best + ticks;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prevRoad.set(next, r.id);
      }
    }
  }

  if (!dist.has(toId)) return null;

  // 回溯
  const roads = [];
  let cur = toId;
  while (cur !== fromId) {
    const r = idx.byId.get(prevRoad.get(cur));
    if (!r) return null;
    roads.unshift(r);
    cur = r.from === cur ? r.to : r.from;
  }

  const totalDist = roads.reduce((a, r) => a + (r.dist ?? 1), 0);

  // 注意:这里**不掷骰**。plan 必须是确定性的 —— 否则 UI 每次重绘路线提示
  // 都会跳一次遭遇。遭遇在**真正执行赶路时**由 rollTravelEncounters() 掷。
  // 这里只回报「全程的遭遇概率」,让 UI 能在出发前提示风险。
  //
  // 跨路要**连乘**,不能相加。
  //   p_total = 1 - Π(1 - p_i)
  // 第一版写成了 Σp_i,66 里的长途直接算出 0.9(几乎必遇)。
  // 相加等价于假设「各路段互相独立且都可以各自触发一次」,
  // 而实际是一次都没触发才走完全程 —— 应该连乘。
  let survive = 1;
  for (const r of roads) {
    if (!r.enc?.rate || !r.enc.table?.length) continue;
    const p = 1 - Math.pow(1 - Math.min(0.99, r.enc.rate), r.dist ?? 1);
    survive *= (1 - p);
  }
  const pEncounter = Math.round((1 - survive) * 100) / 100;

  return {
    from:fromId, to:toId,
    roads: roads.map(r => r.id),
    dist: totalDist,
    ticks: dist.get(toId),
    encounterAt: [],                                  // 保留字段以兼容 TravelPlan
    pEncounter: Math.round(Math.min(1, pEncounter) * 100) / 100,
  };
}

/**
 * 执行赶路时掷遭遇。整条路**最多触发一次**遭遇(不是每 tick 一次)——
 * 一趟路撞上三拨劫匪,没人想玩。
 *
 * @param {import('./types.js').TravelPlan} plan
 * @param {number} [rng]
 * @returns {{roadId:string, at:import('./types.js').EncounterDef}|null}
 */
export function rollTravelEncounters(plan, rng = Math.random, withPending = false) {
  if (!plan || !plan.ticks || !plan.roads?.length) return null;
  if (rng() >= (plan.pEncounter ?? 0)) return null;
  const byId = roadIndex(withPending).byId;

  // 按里程加权挑一条路,再用那条路的事件表抽事件
  const total = plan.roads.reduce((a, rid) => a + (byId.get(rid)?.dist ?? 0), 0) || 1;
  let r = rng() * total;
  for (const rid of plan.roads) {
    r -= byId.get(rid)?.dist ?? 0;
    const enc = rollEncounter(byId.get(rid)?.enc?.table, rng);
    if (enc && r <= 0) return { roadId:rid, at:enc };
  }
  // 兜底:最后一条有事件表的
  for (const rid of plan.roads) {
    const enc = rollEncounter(byId.get(rid)?.enc?.table, rng);
    if (enc) return { roadId:rid, at:enc };
  }
  return null;
}

// ───────────────────────────────────────────────────────────
// 七、区域相邻(靠注入,避免与 regions.js 成环)
// ───────────────────────────────────────────────────────────

/**
 * nodeId → regionId。由装配层注入(见 integration.md §3.2)。
 * null 时 regionAdjacency() 返回空表 —— 允许先只上线路网不上线区域。
 * @type {Map<string,string>|null}
 */
export let NODE_REGION_REF = null;

/** 装配层调用。必须在任何 regionAdjacency() 之前调用一次。 */
export function bindRegions(nodeRegionMap) {
  NODE_REGION_REF = nodeRegionMap;
}

/** 区域相邻表,由 crossesRegion 的路推导。 */
export function regionAdjacency() {
  const adj = new Map();
  if (!NODE_REGION_REF) return adj;
  for (const r of activeRoads(true)) {
    if (!r.crossesRegion) continue;
    const a = NODE_REGION_REF.get(r.from);
    const b = NODE_REGION_REF.get(r.to);
    if (!a || !b || a === b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return adj;
}

// ───────────────────────────────────────────────────────────
// 八、完整性校验(测试用,别删)
// ───────────────────────────────────────────────────────────

/**
 * 路网自检。四件事:
 *   1. 道路 id 不重复   —— 第一版就踩了(n1-n2 写了两遍,Map 静默吞掉一条)
 *   2. 道路端点都存在   —— 拼错节点 id 是最常见的手写错误
 *   3. 从 n0 能到所有节点 —— 断了地图就没有意义
 *   4. 通向 n8 的路至少留一条 —— n8 挂着 4 条叙事线,封死了就是剧情锁死
 *
 * @param {{nodes:Array<{id:string}>}} worldN 应当传 nodes.js 的 visibleNodes(flags)
 * @param {boolean} [withPending] 与节点集保持一致
 * @returns {{ok:boolean, errors:string[], unreachable:string[], lockedStory:string[]}}
 */
export function verifyNetwork(worldN, withPending = false) {
  const errors = [];
  const list = activeRoads(withPending);
  const ids = new Set();
  for (const r of list) {
    if (ids.has(r.id)) errors.push(`重复的路 id: ${r.id}`);
    ids.add(r.id);
  }

  const known = new Set(worldN.nodes.map(n => n.id));
  for (const r of list) {
    if (!known.has(r.from)) errors.push(`${r.id} 的 from 节点不存在: ${r.from}`);
    if (!known.has(r.to))   errors.push(`${r.id} 的 to 节点不存在: ${r.to}`);
  }

  // 连通性(忽略封锁的图)
  const home = 'n0';
  const seen = new Set([home]);
  const q = [home];
  while (q.length) {
    for (const nb of neighbors(q.shift(), withPending)) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
  }
  const all = worldN.nodes.map(n => n.id);
  const unreachable = all.filter(id => !seen.has(id));

  // 剧情可达性:n8 / n4 / n5 在**无封锁**状态下必须可达
  const lockedStory = ['n8', 'n4', 'n5']
    .filter(id => !planRoute(home, id, { ignoreBlock:true, withPending }));

  return {
    ok: errors.length === 0 && unreachable.length === 0 && lockedStory.length === 0,
    errors, unreachable, lockedStory,
  };
}
