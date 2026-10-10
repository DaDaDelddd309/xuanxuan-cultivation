// XX-PLAY-006 回归门禁 —— 地标锚点不得随种子漂移
//
// 背景(实测 200 个种子,不是推测):
//   worldgen.decorate() 按 (y,x) 排序**逐种子重新发 id**(worldgen.js:237),
//   除 n0(家,恒为 village)外 n1~n16 的**类型都随种子变**。
//   剧本 beats 里写死的 node:'n8' nodeType:'boss' 只有 3.5% 的种子真的是 boss。
//   旧代码只比 id 字符串、不看类型 → 玩家在野地走进 n8 就触发
//   「古战场遗迹最深处,有一座没在图上的墓」,文本与实景矛盾。
//
// 本门禁跑的是**真实逻辑**(STORY.arrive + 真实 worldgen 世界),
// 不是源码正则 —— 断言独立于被检查的实现。
//
// 运行: node tests/xx-play-006-regression.mjs
//
// build.js 会经 assets.js 摸 document(音频解锁),本门禁要驱动 fieldBonus,
// 所以先补最小 DOM 桩 —— 与 t83 等测试同一套做法,不是新发明。
globalThis.document = {
  addEventListener(){}, createElement:()=>({ style:{}, classList:{add(){},remove(){}},
    appendChild(){}, focus(){} }),
  body:{ appendChild(){} }, getElementById:()=>null,
};
globalThis.window = {};
globalThis.Audio = function(){ this.play=()=>Promise.resolve(); this.pause=()=>{}; };

import { STORY, ARCS } from '../js/xiuxian/story.js';
import { WORLD, regenerate } from '../js/xiuxian/world.js';

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; failed.push(name + (detail ? ' :: ' + detail : '')); }
}

const N = 120;
console.log(`\n[XX-PLAY-006] ${N} 个种子的地标锚点漂移检查`);
console.log(`            (每条线的每一环,都必须落在类型相符的节点上)`);

const drift = [];      // 类型不符的触发明细
const stalled = [];    // 走遍全图仍推不完的线
const typeDriftIds = new Map(); // id -> 出现过的类型集合

for (let i = 0; i < N; i++) {
  const seed = 'xxplay006-' + i;
  regenerate(seed);

  // 记录 id → 类型,证明"id 的含义确实随种子漂"(本门禁的前提)
  for (const n of WORLD.nodes) {
    if (!typeDriftIds.has(n.id)) typeDriftIds.set(n.id, new Set());
    typeDriftIds.get(n.id).add(n.type);
  }

  STORY.reset();
  try { STORY.load(); } catch {}

  for (const key of Object.keys(ARCS)) {
    STORY.start(key);
    // 反复走遍全图,直到这一条线再也推不动(有些线同一节点连推多环)
    let last = -1;
    for (let round = 0; round < 6; round++) {
      for (const n of WORLD.nodes) {
        let fired = [];
        try { fired = STORY.arrive(n.id) || []; } catch (e) {
          drift.push(`${seed}/${key}@${n.id}: arrive 抛异常 ${e.message}`);
        }
        for (const f of fired) {
          const beat = ARCS[f.arc].beats[f.beat];
          if (!beat || !beat.nodeType) continue;      // 没声明类型的环不做类型断言
          if (n.type !== beat.nodeType) {
            drift.push(`${seed}/${key} 第${f.beat}环 在 ${n.id}(${n.type}) 触发,但要求 ${beat.nodeType}`);
          }
        }
      }
      const cur = STORY.s.beat[key] || 0;
      if (cur === last) break;
      last = cur;
    }
    // 墓内房间触发的环(tomb 第 4 环键 room:'sj')走的是 arriveRoom,
    // 地图行走永远到不了 —— 那是 tomb.js 在 boss 战里调的,不是卡环。
    // 这里如实驱动它,否则会把"harness 盲区"误报成"产品推不完"。
    for (let guard = 0; guard < ARCS[key].beats.length + 2; guard++) {
      const i = STORY.s.beat[key] || 0;
      const b = ARCS[key].beats[i];
      if (!b || !b.room) break;
      try { STORY.arriveRoom(b.room); } catch (e) {
        drift.push(`${seed}/${key} 房间 ${b.room}: arriveRoom 抛异常 ${e.message}`);
      }
    }
    if ((STORY.s.beat[key] || 0) < ARCS[key].beats.length) {
      stalled.push(`${seed}/${key} 只推到 ${STORY.s.beat[key] || 0}/${ARCS[key].beats.length} 环`);
    }
  }
}

ok(`${N} 个种子 × ${Object.keys(ARCS).length} 条线:没有任何一环在类型不符的节点上触发`,
   drift.length === 0, drift.length ? `${drift.length} 次漂移,首个: ${drift[0]}` : '');

ok(`${N} 个种子:每条线走遍全图都能推完(不卡环)`,
   stalled.length === 0, stalled.length ? `${stalled.length} 条卡住,首个: ${stalled[0]}` : '');

// 前提校验:确认 id 的类型确实随种子漂 —— 若将来 worldgen 改成按语义发号,
// 这条会失败,提示本门禁的前提变了、该重新评估锚点方案。
const drifting = [...typeDriftIds.entries()].filter(([, s]) => s.size > 1).map(([id]) => id);
const stable = [...typeDriftIds.entries()].filter(([, s]) => s.size === 1);
ok('前提:确实存在"类型随种子变"的 id(否则本门禁的前提已变)',
   drifting.length > 0, `drifting=${drifting.join(',')}`);
ok('前提:n0 恒为 village(家节点稳定,可继续硬指定)',
   stable.some(([id, s]) => id === 'n0' && s.has('village')),
   `stable=${stable.map(([id, s]) => id + '=' + [...s][0]).join(' ')}`);

console.log(`\n     类型随种子变的 id: ${drifting.length} 个 (共 ${typeDriftIds.size} 个)`);
console.log(`     类型恒定的 id    : ${stable.map(([id, s]) => id + '=' + [...s][0]).join(' ') || '(无)'}`);

// —— 同一个病根的第二处受害者:灵田密度 ——
//
// build.js 的 fieldBonus() 原来查一张**按 id 硬编**的密度表
// ({n8:3, n9:0, ...}),照着 world/nodes.js 那张手写表写的。
// id 逐种子重发 ⇒ 「妖巢附近产量更高」实际变成了「碰巧编号是 n8 的节点产量高」,
// 而 n8 真是妖巢的种子只有 3.5%。默认种子下 n8 是片野地,却按 3 倍产灵米。
//
// 这里断言的是**按类型的密度表本身**:对每个种子,同类型的节点必须同密度,
// 且密度随危险度单调递增。断言用**类型**分组,不碰 id —— 与 id 漂移正交。
console.log(`\n[XX-PLAY-006 连带] 灵田密度按类型而非按 id(${N} 个种子)`);
{
  const { BUILD } = await import('../js/xiuxian/build.js');
  let sameTypeDiffers = 0, notMonotonic = 0, unknownType = 0;
  for (let i = 0; i < N; i++) {
    const seed = 'xxplay006d-' + i;
    regenerate(seed);
    BUILD.setWorld(WORLD);
    const byType = new Map();
    for (const n of WORLD.nodes) {
      const b = BUILD.fieldBonus(n.id);
      if (byType.has(n.type)) { if (byType.get(n.type) !== b) sameTypeDiffers++; }
      else byType.set(n.type, b);
    }
    const g = t2 => byType.get(t2);
    if (g('boss') === undefined || g('village') === undefined || g('field') === undefined) {
      unknownType++; continue;
    }
    // 妖巢 > 秘境/险地 > 野地 > 村
    if (!(g('boss') > g('field') && g('field') > g('village'))) notMonotonic++;
  }
  ok('同一类型的节点密度恒定(密度由类型决定,不由 id 决定)',
     sameTypeDiffers === 0, `${sameTypeDiffers} 处同类型不同密度`);
  ok('密度随危险度单调:妖巢 > 野地 > 村落',
     notMonotonic === 0, `${notMonotonic} 个种子不满足单调`);
  ok('每个种子都能取到 妖巢/野地/村 三种节点做比较',
     unknownType === 0, `${unknownType} 个种子缺类型`);
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (failed.length) { console.log('\n失败明细:'); for (const f of failed) console.log('  ✗ ' + f); }
process.exit(fail ? 1 : 0);