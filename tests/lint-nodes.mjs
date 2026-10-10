// lint-nodes.mjs —— 节点护栏(工单 XX-WORLD-003)
//
// ⚠️ 本文件的前身是 docs/proposals/world-map-20261010/lint-nodes.mjs。
// 那份**整份失效**了,而且失效方式很典型 —— 照抄过来会得到一个永远绿的假门禁。
//
// 【它为什么失效】
// 它用正则从 world.js 里抠硬编码节点表:
//     /\{ id:'(n?\w+)',\s*x:(\d+),\s*y:(\d+),\s*type:'(\w+)'/g
// 但 V0.97(工单 XX-S4-001)起 world.js 里**根本没有硬编码表**了,
// 地图改由 worldgen.js 按种子运行时生成。那条正则一个节点都抠不到 →
// 「0 个节点被解析」→ 它自己的保护分支会 exit 1,可是它 `process.exit(fail?1:0)`
// 写在文件末尾,而中途那句 exit 1 在 error 分支里…… 实测输出停在 §1 就没了。
// 更糟的是:就算抠到了,「静态正则查一张不存在的表」也证明不了任何东西。
//
// 【它真正该守什么】
// worldgen 自己声明了 5 条不变量(见 worldgen.js 头部),但**没人验证它们在
// 各种种子下都成立**。而真正会伤到玩家的不是不变量,是这一条:
//
//   ★ 剧情与支线按 nodeId **硬编码**位置:n0/n4/n5/n7/n8/n9…
//     story.js 的 `_advance()` 只比对 id 字符串,**不校验节点类型**。
//     而 n0-n10 由 worldgen 随机生成,只有 n0 被钉死成青石村。
//     实测 200 个种子:n4 有 78% 不是秘境(seed 99999 下 n4 甚至是另一个村庄),
//     n5/n7/n8/n9 的类型同样漂。
//     → 后果:玩家在野地触发「秘境深处,白泽在看你」,文本与实景直接矛盾;
//       更糟的是后续 beat 的 node 若落在玩家去不了的格子,这条剧情线就永远走不完。
//     而 node --check 和所有逻辑测试**全绿** —— 这就是 AGENTS.md §0A
//     「定义了但玩家拿不到」的镜像版本。
//
// 本门禁做三件事:
//   §1 生成器不变量:多个种子下逐条验 worldgen 声明的 5 条
//   §2 地标契约:剧情硬编码引用的 nodeId,其类型必须与剧情文本语义相符
//   §3 结构健康:节点数/ID 唯一/连通/无孤岛
//
// 📌 §2 当前是**红的**,这是有意留着的 —— 它记录的是一个真实缺陷,不是误报。
//   但要说清损害边界(实测 120 种子):
//     · 节点本身**都存在且从家可达**(0 次缺失/不可达)→ 剧情不会卡死
//     · 真正的损害:玩家在野地触发「秘境深处,白泽在看你」,文本与实景矛盾;
//       n9 被写成「落云镇」但实际可能是妖巢
//   修法见 TICKETS.md XX-WORLD-007(把地标 id 改成按类型寻址,而非按序号)。
//   在那之前,本条**必须保持红色** —— 它是这个缺陷的哨兵。
//   一旦有人把 worldgen 改成钉死地标类型,这条会自己转绿,不需要手动改门禁。
//
// 退出码:0 = 通过;非 0 = 不通过(CI 靠这个)
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
import { generate, validate, GRID, MAX_SECRET_DEPTH } from '../js/xiuxian/worldgen.js';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fail++;
};

// 采样多少个种子:够覆盖随机分布,又不至于让 lint 慢到没人愿意跑
const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);

console.log('\n=== [1] worldgen 不变量:120 个种子逐条验 ===');
{
  const violations = [];
  for (const s of SEEDS) {
    const w = generate(s);
    const v = validate(w.nodes, w.edges);
    if (!v.ok) violations.push(`seed=${s}: ${v.reasons.join('; ')}`);
  }
  ok('generate() 的不变量在所有采样种子下成立', violations.length === 0,
     violations.length ? violations.slice(0, 3).join(' | ') : '');

  // 不变量 1 单独立一条:青石村必须是 home 且坐标固定
  const homeOk = SEEDS.every(s => {
    const w = generate(s);
    const h = w.nodes.find(n => n.home);
    return h && h.x === 1 && h.y === 1 && h.type === 'village';
  });
  ok('青石村固定在 (1,1) 且类型为 village', homeOk);
}

console.log('\n=== [2] 地标契约:剧情硬编码的 nodeId 类型必须稳定 ★本门禁的核心 ===');
{
  // 每条:nodeId → 剧情文本对它的类型要求。
  // 来源是 story.js 里 beat 的 text 实际写了什么,不是猜的:
  //   at:2 node:'n4' 「秘境深处,白泽在看你」  → 必须 secret
  //   at:0 node:'n9' 落云镇                  → 必须 village
  const LANDMARKS = {
    n0: { type: 'village', why: '青石村 · 序章起点' },
    n4: { type: 'secret',  why: '青岚秘境 · 「秘境深处,白泽在看你」' },
    n5: { type: 'elite',   why: '黑风岭 · 愿牌散落处' },
    n9: { type: 'village', why: '落云镇 · 坊市/茶摊/霜清' },
  };
  for (const [id, exp] of Object.entries(LANDMARKS)) {
    const types = new Map();
    for (const s of SEEDS) {
      const n = generate(s).nodes.find(x => x.id === id);
      const t = n ? n.type : 'MISSING';
      types.set(t, (types.get(t) || 0) + 1);
    }
    const bad = [...types.entries()].filter(([t]) => t !== exp.type);
    const dist = [...types.entries()].map(([t, c]) => `${t}:${c}`).join(' ');
    ok(`${id} 恒为 ${exp.type}(${exp.why})`, bad.length === 0,
       bad.length ? `实测分布 ${dist} —— 有 ${bad.map(([t, c]) => `${t}×${c}`).join(',')} 不符,`
                       + `换种子后剧情会指向错误地点` : `(${dist})`);
  }
}

console.log('\n=== [3] 剧情/支线引用的 nodeId 必须真的存在 ===');
{
  const ids = new Set(generate(1).nodes.map(n => n.id));
  const story = R('js/xiuxian/story.js');
  const refs = [...new Set([...story.matchAll(/(?:node|room):'(n?\w+)'/g)].map(m => m[1]))];
  const missing = refs.filter(r => r !== 'sj' && !ids.has(r));   // sj = 墓内房间,非地图节点
  ok(`剧情引用的 ${refs.length} 个 id 都在地图里`, missing.length === 0,
     missing.length ? '缺失: ' + missing.join(', ') : refs.join(' '));

  const quest = R('js/xiuxian/quest.js');
  const qrefs = [...new Set([...quest.matchAll(/where:\[([^\]]+)\]/g)]
    .flatMap(m => m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''))).filter(Boolean))];
  const qmiss = qrefs.filter(r => !ids.has(r));
  ok(`支线的 ${qrefs.length} 个 where 节点都在地图里`, qmiss.length === 0,
     qmiss.length ? '缺失: ' + qmiss.join(', ') : qrefs.join(' '));
}

console.log('\n=== [4] 结构健康:规模/唯一/连通 ===');
{
  const sizes = SEEDS.map(s => generate(s).nodes.length);
  const min = Math.min(...sizes), max = Math.max(...sizes);
  ok('节点数在合理区间(10~30)', min >= 10 && max <= 30, `实测 ${min}~${max}`);

  const dupS = SEEDS.filter(s => {
    const ids = generate(s).nodes.map(n => n.id);
    return new Set(ids).size !== ids.length;
  });
  ok('无重复 nodeId', dupS.length === 0, dupS.length ? `种子 ${dupS.slice(0,5).join(',')}` : '');

  // ⚠️ edges 的形状:worldgen.generate() 返回的是**节点对象**数组,
  //    不是 [idA, idB](world.js 里 buildWorld() 才把它转成 id 对)。
  //    第一版按 id 对来写 → adj 全空 → 「所有种子都有孤岛」,自己把自己骗了。
  const island = SEEDS.filter(s => {
    const w = generate(s);
    const adj = new Map(w.nodes.map(n => [n.id, []]));
    for (const e of w.edges) {
      const a = e[0] && e[0].id !== undefined ? e[0].id : e[0];
      const b = e[1] && e[1].id !== undefined ? e[1].id : e[1];
      if (adj.has(a) && adj.has(b)) { adj.get(a).push(b); adj.get(b).push(a); }
    }
    const home = w.nodes.find(n => n.home)?.id;
    const seen = new Set([home]); const q = [home];
    while (q.length) for (const n of adj.get(q.shift()) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    return seen.size !== w.nodes.length;
  });
  ok('无孤岛(从家可达全部节点)', island.length === 0,
     island.length ? `种子 ${island.slice(0,5).join(',')}` : '');

  // grid 直接读模块导出,不靠正则抠源码 —— world.js 里是 `grid: GRID`(来自 worldgen),
  // 正则 `/grid:\s*(\d+)/` 匹配不到,因为右边不是字面数字。
  const worldMod = await import('../js/xiuxian/world.js');
  ok('WORLD.grid 与 worldgen.GRID 一致', worldMod.WORLD.grid === GRID,
     `world.js=${worldMod.WORLD.grid} worldgen=${GRID}`);
}

console.log('\n=== [5] 本 lint 自身没失效(反向自检) ===');
{
  // P1-7:断言跟着配置走 = 永远不会红。
  // 这里钉一个**与上面任何检查无关的常量** —— 如果哪天 worldgen 的导出名变了,
  // 这条会立刻红,而不是让上面几条悄悄变成 no-op。
  ok('MAX_SECRET_DEPTH 有合理值(≥2 且 ≤6)', MAX_SECRET_DEPTH >= 2 && MAX_SECRET_DEPTH <= 6,
     `实测 ${MAX_SECRET_DEPTH}`);
  const sample = generate(1);
  ok('generate() 返回 nodes+edges+attempts', !!(sample.nodes && sample.edges !== undefined
     && sample.attempts !== undefined), JSON.stringify(Object.keys(sample)));
  ok('节点带 id/x/y/type 四要素', sample.nodes.every(n =>
     n.id !== undefined && Number.isFinite(n.x) && Number.isFinite(n.y) && !!n.type));
}

if (fail === 0) {
  console.log('\n✅ 节点护栏通过:生成器不变量 + 地标类型契约 + 结构健康');
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标`);
  console.log('   若全部来自 §2 地标类型契约 —— 那是**已知缺陷**(XX-WORLD-007),');
  console.log('   损害是文本与实景矛盾,不是剧情卡死(节点可达性 §4 已验)。');
  console.log('   本条保持红色直到 worldgen 钉死地标类型。');
  process.exit(1);
}
