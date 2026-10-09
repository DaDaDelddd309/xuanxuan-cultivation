// ===== 大世界地图 · 骑马与砍杀式探索 =====
// 设计:开放节点地图。玩家在节点间移动(赶路),抵达节点触发遭遇。
// 节点类型:村庄(安全,突破/悟道/炼丹)、野地(小怪)、精英(强敌,可能切回合制)、
//           秘境(丹药/材料)、Boss(必定回合制剧情)。
// 契约:纯数据 + 纯函数。渲染由 ui/world 模块负责。
//
// V0.97:地图本体改由 worldgen.js 按种子生成(工单 XX-S4-001)。
//   · 原先这里是 11 个节点的硬编码表,换种子地图纹丝不动 —— 假随机。
//   · 现在由 worldgen 保证不变量:全连通 / 秘境≤4步 / Boss非死角 / 青石村固定起点。
//
// ★ 对外接口一字未改,ui.js 等调用方零改动:
//   NODE_TYPES / ENEMY_POOL / SECRET_PILL / buildEdges / WORLD
//   nodeById / neighbors / homeNode / rollEnemy / travel / pathBetween

import { generate, GRID, DENSITY, MAX_SECRET_DEPTH } from './worldgen.js';
import { getMaster, setMaster } from './seed.js';

export const NODE_TYPES = {
  village: { name:'村庄',  col:'#8a7a5a', safe:true,  desc:'炊烟袅袅,可休整突破、悟道' },
  field:   { name:'荒野',  col:'#7a8a5a', safe:false, desc:'散妖游荡,小试锋芒' },
  elite:   { name:'险地',  col:'#c86a4a', safe:false, desc:'有强敌蛰伏,可能触发回合',
             turnBased:true },
  secret:  { name:'秘境',  col:'#4a9de0', safe:false, desc:'藏宝之地,盛产丹药',
             dropsPill:true },
  boss:    { name:'妖巢',  col:'#8a3ac8', safe:false, desc:'大能坐镇,必逢回合',
             turnBased:true, boss:true },
};

export const ENEMY_POOL = {
  field:  [ {k:'wanderer',r:0.55}, {k:'guard',r:0.35}, {k:'yao',r:0.10} ],
  elite:  [ {k:'yao',r:0.5}, {k:'elder',r:0.4}, {k:'devil',r:0.10} ],
  secret: [ {k:'elder',r:0.6}, {k:'devil',r:0.2}, {k:'yao',r:0.2} ],
  boss:   [ {k:'devil',r:1.0} ],
};

// 秘境出产哪种丹 —— 实际取值由 worldgen 写在节点的 pill 字段上
export const SECRET_PILL = {
  secret1: 'pill_zhuji', secret2: 'pill_jindan',
  secret3: 'pill_yuanying', secret4: 'pill_huashen',
};

// —— 生成当前世界 ——
// 不用模块级常量:WORLD 的节点需要能随换种子重建(V0.97 的核心需求)。
// 用可变绑定 + 访问器,既保住 `import { WORLD }` 的用法,又支持换世重生。
let _world = buildWorld(getMaster());

function buildWorld(masterSeed) {
  const { nodes, edges, attempts, fallback } = generate(masterSeed);
  // 边的形状必须是 [idA, idB] 字符串 —— neighbors()/pathBetween() 依赖这一点
  const idEdges = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (Math.abs(nodes[i].x - nodes[j].x) + Math.abs(nodes[i].y - nodes[j].y) === 1)
        idEdges.push([nodes[i].id, nodes[j].id]);
  return { nodes, edges: idEdges, grid: GRID, attempts, fallback };
}

/**
 * 边的导出(WORLD.edges 就是它算出来的)。
 * @param {Array} [nodes] 缺省用当前世界节点
 */
export function buildEdges(nodes) {
  const list = nodes || _world.nodes;
  const E = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) E.push([a.id, b.id]);
  }
  return E;
}

/** 换种子后重建世界。ui.js 的「换一世」会调它。 */
export function regenerate(seed) {
  if (seed !== undefined) setMaster(seed);
  _world = buildWorld(getMaster());
  return _world;
}

/** 活的世界对象(不可直接 import WORLD —— 它是换世前的快照) */
export const WORLD = new Proxy({}, {
  get(_, k) { return _world[k]; },
  ownKeys() { return Reflect.ownKeys(_world); },
  getOwnPropertyDescriptor(_, k) {
    return { value: _world[k], enumerable: true, configurable: true };
  },
});

/** 生成元信息(调试面板/工单验收用) */
export const WORLD_INFO = {
  get seed() { return getMaster(); },
  get attempts() { return _world.attempts; },
  get fallback() { return _world.fallback; },
  get nodeCount() { return _world.nodes.length; },
};

export function nodeById(id) { return _world.nodes.find(n => n.id === id); }
export function neighbors(id) {
  return _world.edges.filter(([a, b]) => a === id || b === id)
    .map(([a, b]) => a === id ? b : a);
}
export function homeNode() { return _world.nodes.find(n => n.home).id; }

// 按玩家境界决定「能打多强的怪」
export function rollEnemy(nodeId, realmId) {
  const node = nodeById(nodeId);
  if (!node) return null;
  const pool = ENEMY_POOL[node.type];
  if (!pool) return null;
  const r = Math.random();
  let acc = 0;
  for (const e of pool) { acc += e.r; if (r <= acc) return e.k; }
  return pool[0].k;
}

// 移动:返回 {from,to,cost} 或 null(不可达/已在原地)
export function travel(fromId, toId) {
  if (fromId === toId) return null;
  if (!neighbors(fromId).includes(toId)) return null;
  return { from: fromId, to: toId, cost: 1 };
}

// BFS 最短路(供小地图提示)
export function pathBetween(fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = {}, q = [fromId]; prev[fromId] = null;
  while (q.length) {
    const cur = q.shift();
    for (const nb of neighbors(cur)) {
      if (nb in prev) continue;
      prev[nb] = cur;
      if (nb === toId) {
        const path = [toId];
        let p = toId;
        while (prev[p] !== null) { p = prev[p]; path.unshift(p); }
        return path;
      }
      q.push(nb);
    }
  }
  return null;
}