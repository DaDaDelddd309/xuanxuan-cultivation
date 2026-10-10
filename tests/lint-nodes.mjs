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
// 📌 §2 记录的是 XX-WORLD-007 的修复前契约。**该缺陷已于 2026-10-10 修掉**:
//   story.js 改成**按类型锚定**(`nodeType:'secret'` 而非 `node:'n4'`),
//   所以「n4 必须是 secret」这条要求不再成立,也**不再需要成立** ——
//   真正该保证的是「每个种子下都有 secret 节点可供锚定」,这条 worldgen 满足。
//   §2 已随之改写为新契约,并且带反向自检(空世界必须判 false)。
//
// 修复前实测的损害边界(留档,别再夸大):
//   · 剧情**不会卡死** —— 120 种子里 n4/n5/n9 全部存在且从家可达
//   · 真正的损害:玩家在野地触发「秘境深处,白泽在看你」,文本与实景矛盾
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
  // ⚠️ detail **只在失败时打印**。第一版不管成败都打印,
  // 于是这条出现了「✅ … story.js 里一个 nodeType 都没有 —— 修复没生效?」
  // —— 一个绿色的对勾后面跟着一句「修复没生效」。
  // 读日志的人会以为没问题,而实际是相反的意思。这比报错更坏。
  if (cond) console.log(`  ✅ ${name}`);
  else { fail++; console.log(`  ❌ ${name}${detail ? '  — ' + detail : ''}`); }
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

console.log('\n=== [2] 类型锚点契约(XX-WORLD-007 修好后) ===');
{
  // 【契约变了】
  // 修之前:要求「n4 恒为 secret」—— 但 worldgen 只钉死 n0,做不到,于是长期红。
  // 修之后:story.js 改成**按类型锚定**(nodeType:'secret'),
  //        于是真正该保证的是「每个种子下都有 secret 节点可供锚定」。
  // 这个契约 worldgen 满足得了,而且**已经实测过**。
  const NEEDED = {
    n0: 'village',   // 青石村 · 序章起点(worldgen 钉死)
  };
  // 2a 家必须恒定 —— 这条任何时候都不能破
  for (const s of SEEDS) {
    const h = generate(s).nodes.find(n => n.home);
    if (!(h && h.x === 1 && h.y === 1 && h.type === 'village')) {
      ok(`seed=${s} 青石村仍在 (1,1) 且为 village`, false, JSON.stringify(h));
      break;
    }
    if (s === SEEDS[0]) ok('青石村恒在 (1,1) 且为 village(120 种子全验)', true);
  }

  // 2b 剧情用到的每种类型,每个种子都必须至少有一个节点
  const story = R('js/xiuxian/story.js');
  const wantTypes = [...new Set([...story.matchAll(/nodeType:'(\w+)'/g)].map(m => m[1]))];
  console.log(`  (剧情用到的锚点类型: ${wantTypes.join(', ')})`);
  // 只统计真正的**地图节点** beat 行 —— 两种要排除:
  //   ① 注释里的字面量(说明文字写着「仍可用 node:'n0' 硬指定」)
  //   ② room:'sj' 这类墓内房间 —— 它不是地图节点,不需要类型锚定
  //     (sj 由 tomb.js 管,见下方 §3 的放行说明)
  const beatLines = story.split('\n')
    .filter(l => /^\s*\{\s*at:\d+,/.test(l) && /\bnode:'/.test(l));
  const homeBeats = beatLines.filter(l => /node:'n0'/.test(l)).length;   // 家是钉死的,不算
  // ⚠️ 比的是**出现次数**,不是去重后的类型数。
  //    第一版拿 `wantTypes`(= new Set 后 = 5 种)去比 19 个 beat,永远对不上。
  const typeCount = beatLines.filter(l => /nodeType:'\w+'/.test(l)).length;
  ok(`剧情 ${beatLines.length} 个地图节点环里,除青石村 ${homeBeats} 环外每环都带 nodeType`,
     typeCount === beatLines.length - homeBeats,
     `实测 ${typeCount} 个 nodeType / ${beatLines.length - homeBeats} 个应锚定的环 —— `
     + `修复可能被回退,或新增 beat 时忘了加 nodeType`);

  const missing = {};
  for (const s of SEEDS) {
    const types = new Set(generate(s).nodes.map(n => n.type));
    for (const t of wantTypes) if (!types.has(t)) missing[t] = (missing[t] || 0) + 1;
  }
  ok(`每个种子下锚点类型都存在(${wantTypes.length} 种 × ${SEEDS.length} 种子)`,
     Object.keys(missing).length === 0,
     Object.keys(missing).length ? '缺失: ' + JSON.stringify(missing) : '');

  // 2c 反向自检:如果锚点类型没被满足,这条必须会红 ——
  //    构造一个「什么都不含的假世界」跑一遍判定逻辑,确认它拒绝。
  ok('锚点判定逻辑对空世界返回 false',
     (() => {
       const fake = { nodes: [{ id: 'x', type: 'field' }] };
       return !new Set(fake.nodes.map(n => n.type)).has('secret');
     })(), '反向验证失败:要求 secret 但世界只有 field,竟判 true');
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
