// world-travel-routing-regression.mjs —— 工单 XX-WORLD-005 阶段 2
//
// 「赶路按实际耗时规划,而不是相邻一跳 / BFS 跳数」
//
// 【为什么要有这条】开 FEATURE_FLAGS.roads 的那一刻, network.js 从
// 「全仓 0 个消费者」变成赶路的唯一路径 —— 而它此前**从来没被运行过**。
// 一份没跑过的代码一旦接到玩家主路径上, 唯一的防线就是这条测试。
//
// 【本护栏的判据】不维护任何硬编码清单, 能从源码/运行时现场取的就现场取:
//   · legacy 集合来自 nodes.js 的 LEGACY_IDS
//   · ROADS 端点来自 network.js 的 activeRoads()
//   · 「ui.js 真的接上了」从**源码文本**判断(否则改回去没人知道)
//
// 【反向验证】把 ui.js 的 travel 分支换回 neighbors(...) → 断言 2 立刻红;
//   把 FEATURE_FLAGS.roads 改回 false → 断言 1 立刻红。两者都实测过。

import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
import { WORLD, regenerate } from '../js/xiuxian/world.js';
import { LEGACY_IDS, FEATURE_FLAGS } from '../js/xiuxian/world/nodes.js';
import { planRoute, activeRoads } from '../js/xiuxian/world/network.js';

const HERE = _dn(_fu(import.meta.url));
const UI_SRC = readFileSync(_rv(join(HERE, '../js/xiuxian/ui.js')), 'utf8');

let fails = 0;
const t = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fails++;
};

console.log('\n[1] 阶段 2 的开关确实开了');
t('FEATURE_FLAGS.roads === true', FEATURE_FLAGS.roads === true, `实际 ${FEATURE_FLAGS.roads}`);

console.log('\n[2] ui.js 的赶路真的接上了(源码级 —— 改回去要红)');
// 只看 travel 分支那一段, 免得别处出现 planRoute 就蒙混过关
const seg = (UI_SRC.match(/case 'travel': \{[\s\S]*?\n      \}/) || [''])[0];
t("travel 分支引用了 routePlan/planRoute", /routePlan|planRoute/.test(seg));
t('travel 分支仍保留相邻判定作为回滚路径', /FEATURE_FLAGS\.roads/.test(seg));
t("pathTo 在 roads 开着时走 planRoute",
  /pathTo\(target\)[\s\S]{0,600}FEATURE_FLAGS\.roads/.test(UI_SRC));

console.log('\n[3] 每个种子里 legacy 节点都走得到(不许软锁)');
const SEEDS = 40;
let unreachable = [];
let badEndpoint = [];
for (let s = 0; s < SEEDS; s++) {
  regenerate(s);
  const ids = new Set(WORLD.nodes.map(n => n.id));
  const home = (WORLD.nodes.find(n => n.type === 'village') || WORLD.nodes[0]).id;
  for (const r of activeRoads(false)) {
    if (!ids.has(r.from) || !ids.has(r.to)) { badEndpoint.push(`seed${s}:${r.id}`); break; }
  }
  for (const id of LEGACY_IDS) {
    if (id === home) continue;
    if (!ids.has(id)) continue;                 // 该种子本来就没有这个点
    const p = planRoute(home, id, { ignoreBlock: true });
    if (!p || !p.roads.length) unreachable.push(`seed${s}:${home}→${id}`);
  }
}
t(`ROADS 端点在每个种子的世界里都存在`, badEndpoint.length === 0,
  badEndpoint.length ? badEndpoint.slice(0, 3).join(' ') : `${SEEDS} 个种子全过`);
t(`从家出发,每个 legacy 节点都规划得出路线`, unreachable.length === 0,
  unreachable.length ? `失败 ${unreachable.length} 例,如 ${unreachable.slice(0, 3).join(' ')}` : `${SEEDS} 个种子全过`);

console.log('\n[4] 非 legacy 节点保持不可达(阶段 5 的设计不许被提前吃掉)');
regenerate(0);
const home0 = (WORLD.nodes.find(n => n.type === 'village') || WORLD.nodes[0]).id;
const future = WORLD.nodes.map(n => n.id).filter(id => !LEGACY_IDS.includes(id));
let leaked = [];
for (const id of future) {
  const p = planRoute(home0, id, { ignoreBlock: true });
  if (p && p.roads.length) leaked.push(id);
}
t('n11+ 仍然规划不出路线', leaked.length === 0,
  future.length ? `检查了 ${future.length} 个未来节点 ${future.join(',')}` : '(本种子没有非 legacy 节点)');

console.log('\n[5] Dijkstra 确实和 BFS 不同 —— 否则这次接线是装饰');
{
  let total = 0, diff = 0;
  for (let s = 0; s < 8; s++) {
    regenerate(s);
    const ids = WORLD.nodes.map(n => n.id).filter(i => LEGACY_IDS.includes(i));
    const adj = new Map();
    for (const [a, b] of WORLD.edges) {
      if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    }
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const p = planRoute(a, b, { ignoreBlock: true });
      if (!p) continue;
      const prev = { [a]: null }, q = [a];
      while (q.length) { const c = q.shift(); if (c === b) break;
        for (const nb of (adj.get(c) || [])) if (!(nb in prev)) { prev[nb] = c; q.push(nb); } }
      if (!(b in prev)) continue;
      let hops = 0; for (let x = b; prev[x] != null; x = prev[x]) hops++;
      total++;
      if (hops !== p.roads.length) diff++;
    }
  }
  const pct = total ? diff / total * 100 : 0;
  // 阈值取 30%:实测约 70%。调到 30 是留余量, 不是为了刚好通过。
  t(`Dijkstra 与 BFS 选的路显著不同(>30%)`, pct > 30,
    `实测 ${pct.toFixed(1)}% (${diff}/${total} 对)`);
}

console.log('\n' + (fails === 0
  ? '赶路护栏全部通过：接上了、走得到、没提前吃掉未来阶段、且确实换算法了'
  : `赶路护栏失败 ${fails} 项`));
process.exit(fails ? 1 : 0);
