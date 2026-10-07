// ===== 大世界地图 · 骑马与砍杀式探索 =====
// 设计:开放节点地图。玩家在节点间移动(赶路),抵达节点触发遭遇。
// 节点类型:村庄(安全,突破/悟道/炼丹)、野地(小怪)、精英(强敌,可能切回合制)、
//           秘境(丹药/材料)、Boss(必定回合制剧情)。
// 契约:纯数据 + 纯函数。渲染由 ui/world 模块负责。

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

// 秘境出产哪种丹
export const SECRET_PILL = {
  secret1: 'pill_zhuji', secret2: 'pill_jindan',
  secret3: 'pill_yuanying', secret4: 'pill_huashen',
};

// 手工设计一张主地图(网格坐标,保证连通)
const MAP = [
  { id:'n0',  x:1, y:1, type:'village', name:'青石村', home:true },
  { id:'n1',  x:2, y:1, type:'field' },
  { id:'n2',  x:3, y:1, type:'field' },
  { id:'n3',  x:2, y:2, type:'field' },
  { id:'n4',  x:3, y:2, type:'secret', pill:'pill_zhuji', name:'青岚秘境' },
  { id:'n5',  x:4, y:2, type:'elite', name:'黑风岭' },
  { id:'n6',  x:4, y:1, type:'field' },
  { id:'n7',  x:3, y:3, type:'elite' },
  { id:'n8',  x:4, y:3, type:'boss', name:'古战场遗迹' },
  { id:'n9',  x:2, y:3, type:'village', name:'落云镇', shop:true },
  { id:'n10', x:1, y:2, type:'field' },
];

// 边:相邻(曼哈顿距离1)
export function buildEdges() {
  const E = [];
  for (let i=0;i<MAP.length;i++) for (let j=i+1;j<MAP.length;j++) {
    const a=MAP[i], b=MAP[j];
    if (Math.abs(a.x-b.x)+Math.abs(a.y-b.y) === 1) E.push([a.id,b.id]);
  }
  return E;
}

export const WORLD = { nodes: MAP, edges: buildEdges(), grid: 6 };

export function nodeById(id) { return WORLD.nodes.find(n=>n.id===id); }
export function neighbors(id) {
  return WORLD.edges.filter(([a,b]) => a===id || b===id)
    .map(([a,b]) => a===id?b:a);
}
export function homeNode() { return WORLD.nodes.find(n=>n.home).id; }

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
  return { from:fromId, to:toId, cost:1 };
}

// BFS 最短路(供小地图提示)
export function pathBetween(fromId, toId) {
  if (fromId===toId) return [fromId];
  const prev={}, q=[fromId]; prev[fromId]=null;
  while(q.length){
    const cur=q.shift();
    for(const nb of neighbors(cur)){
      if(nb in prev) continue;
      prev[nb]=cur;
      if(nb===toId){ const path=[toId]; let p=toId; while(prev[p]!==null){p=prev[p];path.unshift(p);} return path; }
      q.push(nb);
    }
  }
  return null;
}
