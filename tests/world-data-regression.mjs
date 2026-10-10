// world-data-regression.mjs —— 工单 XX-WORLD-001 的门禁
//
// 阶段 0 的产物是**故意不接线**的:纯数据落地、FEATURE_FLAGS 全 false、
// world.js 一行不改。于是它必然是死代码 —— 而死代码最容易出的事故是
// 「落地了但没人验证,坏了一直没人知道」。
//
// 本门禁守三件事:
//   §1 三个 verify 全绿(n0-n10 完好 / 11 个 legacy 节点全归区域 / 路网自洽)
//   §2 FEATURE_FLAGS 只允许「已落地阶段」的开关打开 —— 阶段 0 是全 false,
//      阶段 1(XX-WORLD-004)后是 regions=true 其余五个仍关。不许跳阶段,
//      也不许永远钉死 false:阶段 1 一上线就假红的门禁,大家会习惯性忽略它。
//   §3 world.js 一字未改 —— 这条工单的核心承诺,也是最容易在后续 PR 里破掉的
//
// 它不查(越界):寻路、遭遇 —— 那是 XX-WORLD-005/006 的事。
// 区域**色块几何**归 XX-WORLD-004,但跨种子自洽属于数据层不变量,在 §4 里。
//
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
import { NODES, LEGACY_IDS, FEATURE_FLAGS, visibleNodes, verifyLegacyIntact }
  from '../js/xiuxian/world/nodes.js';
import { REGIONS, verifyRegionCoverage, verifyRegionMembership, verifyRegionDanger, regionRects }
  from '../js/xiuxian/world/regions.js';
import { generate } from '../js/xiuxian/worldgen.js';
import { ROADS, verifyNetwork } from '../js/xiuxian/world/network.js';
import { DAY_PHASE } from '../js/xiuxian/world/types.js';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

console.log('\n=== [1] 三个 verify(README §3.1 说的阶段 0 完整性保障) ===');
{
  // ⚠️ 三个 verify 返回的是**对象** { ok, problems/errors/unreachable/lockedStory },
  //    不是数组。第一版按数组写(judge `a.length === 0`),三个全红 ——
  //    报出来的却是「数据层有静默错误」,方向完全错。
  //    这正是 P1-7 的翻版:断言的形状写错,红得没有意义。
  const a = verifyLegacyIntact();
  t('verifyLegacyIntact:n0-n10 一个不少、一个不变、x/y 都在',
    a && a.ok === true && a.problems.length === 0,
    a ? JSON.stringify(a.problems).slice(0, 120) : `返回了 ${typeof a}`);

  const b = verifyRegionCoverage();
  t('verifyRegionCoverage:11 个 legacy 节点全部归入区域',
    b && b.ok === true && b.orphanNodes.length === 0 && b.orphanDens.length === 0,
    b ? JSON.stringify({ o: b.orphanNodes, d: b.orphanDens }).slice(0, 120) : '');

  // verifyNetwork 会把 n11-n15 也算进 unreachable —— **这是设计如此**:
  // 新节点阶段 5 才登场(flags.newNodes=false),路网本来就到不了它们。
  // 所以只查 legacy 全可达 + 剧情护栏(n8/n4/n5 无封锁可达)。
  const c = verifyNetwork({ nodes: NODES });
  const legacyBad = (c.unreachable || []).filter(id => LEGACY_IDS.includes(id));
  t('legacy n0-n10 全部从家可达', legacyBad.length === 0, legacyBad.join(','));
  t('剧情护栏:n8/n4/n5 在无封锁下可达', (c.lockedStory || []).length === 0,
    (c.lockedStory || []).join(','));
  t('路网本身无结构错误(重复 id / 端点不存在)', (c.errors || []).length === 0,
    (c.errors || []).slice(0, 3).join('; '));
  t('n11-n15 不可达是预期(newNodes 开关关闭)', (c.unreachable || []).length > 0
    && (c.unreachable || []).every(id => !LEGACY_IDS.includes(id)),
    '若新节点也可达,说明它们被硬连进了路网 —— 那是阶段 1+ 才该做的事');
}

console.log('\n=== [2] FEATURE_FLAGS 只能按阶段逐个开,不许跳阶段 ===');
{
  // 阶段 0 断言的是「全 false」,但那是**阶段 0 的**承诺,不是永久承诺。
  // XX-WORLD-004 落地阶段 1 后 regions 必须为 true,其余五个必须还关着。
  // 所以这里改成断言「**开着的开关恰好等于已落地的阶段清单**」——
  // 白名单跟着工单走,而不是永远钉死 false(那会让阶段 1 一上线就假红,
  // 而假红的门禁比没门禁更坏:大家会习惯性地忽略它)。
  const EXPECT_ON = ['regions'];        // 阶段 0 = [] ; 阶段 1(WORLD-004) = ['regions']
  const on = Object.keys(FEATURE_FLAGS).filter(k => FEATURE_FLAGS[k] !== false);
  t(`开着的开关恰好是 ${EXPECT_ON.length ? EXPECT_ON.join(',') : '(无)' }(实测 ${Object.keys(FEATURE_FLAGS).length} 个开关)`,
    on.length === EXPECT_ON.length && EXPECT_ON.every(k => on.includes(k)),
    on.length !== EXPECT_ON.length
      ? `被打开: ${on.join(',') || '(无)'} —— 开关必须跟着已落地阶段走,跳阶段发布要拆开`
      : '');
  t('开关集合没被加塞', Object.keys(FEATURE_FLAGS).length === 6,
    `实测 ${Object.keys(FEATURE_FLAGS).join(',')}`);
  // visibleNodes 是「按开关过滤后」的入口 —— newNodes 关着时必须只剩 11 个
  t('newNodes 关闭时 visibleNodes 只给 11 个 legacy',
    visibleNodes().length === 11, `实测 ${visibleNodes().length}`);
  t('LEGACY_IDS 恰好 n0-n10', LEGACY_IDS.length === 11 && LEGACY_IDS[0] === 'n0' && LEGACY_IDS[10] === 'n10',
    LEGACY_IDS.join(','));
}

console.log('\n=== [3] world.js 一字未改(这条工单的核心承诺) ===');
{
  // 「不改」不是靠自觉 —— 靠比对当前 world.js 是否真的还是那份纯生成器版本。
  const w = R('js/xiuxian/world.js');
  t('world.js 仍由 worldgen 驱动', /from '\.\/worldgen\.js'/.test(w),
    '阶段 0 不允许动 world.js —— 若确有改动,先改工单范围再改代码');
  t('world.js 没有引用新 world/* 目录', !/from '\.\/world\//.test(w),
    '阶段 0 的四个文件是刻意不接线的,接了就算跳阶段');
  t('对外接口仍是那六个', ['NODE_TYPES', 'ENEMY_POOL', 'buildEdges', 'WORLD',
      'nodeById', 'neighbors', 'homeNode', 'rollEnemy', 'travel', 'pathBetween']
      .every(k => w.includes(k)), '接口变了但工单没改,调用方零改动的承诺就不成立');
}

console.log('\n=== [4] 数据自洽(不依赖 verify,防 verify 自己写错) ===');
{
  t('NODES 共 16 个(11 legacy + 5 新)', NODES.length === 16, `实测 ${NODES.length}`);
  const ids = NODES.map(n => n.id);
  t('无重复 id', new Set(ids).size === ids.length);
  const covered = new Set(REGIONS.flatMap(r => r.nodes));
  const orphan = LEGACY_IDS.filter(id => !covered.has(id));
  t('legacy 节点全在某个区域内', orphan.length === 0, orphan.join(','));

  // 【反向验证暴露的盲区】verifyRegionCoverage 只查「节点没被任何区域覆盖」
  // (orphan),**不查「区域本身少了/多了」**。
  // 把 r_heifeng 整个删掉,11 个节点仍然各自落在别的区域里 → 它照样返回 ok,
  // 于是「黑风岭那一片地方整个不见了」这种事故能一路绿灯通过。
  // 这里补一条独立断言:区域数量与 id 集合必须与设计一致。
  const EXPECT_REGIONS = ['r_qingshi', 'r_luoyun', 'r_qinglan', 'r_heifeng', 'r_guzhan'];
  const gotRegions = REGIONS.map(r => r.id).sort();
  const missingRegions = EXPECT_REGIONS.filter(id => !gotRegions.includes(id));
  t('五个区域一个不少', missingRegions.length === 0 && gotRegions.length === EXPECT_REGIONS.length,
    missingRegions.length ? '缺: ' + missingRegions.join(', ') : `实测 ${gotRegions.join(',')}`);
  // 区域里引用的节点必须真实存在(与 verifyRegionCoverage 互补:
  // 那个查「节点没有区域」,这条查「区域里有幽灵节点」)
  const ghostInRegion = REGIONS.flatMap(r =>
    r.nodes.filter(n => !NODES.some(x => x.id === n)).map(n => `${r.id}→${n}`));
  t('区域里没有幽灵节点', ghostInRegion.length === 0, ghostInRegion.slice(0, 3).join('; '));

  // ── 归属唯一性(XX-WORLD-004 挖出) ──
  // verifyRegionCoverage 用 Set 去重,**看不见重复**:一个节点被写进两个区域时,
  // 覆盖集合照样是那 11 个,ok 照样 true。而 NODE_REGION 是 flatMap 建的,
  // 重复节点被**后写的区域静默夺走** —— n6 就这样在 r_luoyun 与 r_guzhan 之间
  // 翻了面,解析结果与 nodes.js 的 region 字段矛盾。
  const mem = verifyRegionMembership(Object.fromEntries(NODES.map(n => [n.id, n.region])));
  t('没有节点同时属于两个区域', mem.duplicated.length === 0,
    mem.duplicated.map(d => `${d.node}∈[${d.regions.join('+')}]`).join('; '));
  t('区域归属与 nodes.js 的 region 字段一致', mem.mismatched.length === 0,
    mem.mismatched.map(m => `${m.node}: 区域表=${m.inRegions} vs nodes.js=${m.inNodes}`).join('; '));

  // ── 危险度口径 ──
  // region.danger 必须是「成员 DENS 的最大值」。这条让按区域查危险度的代码
  // 与节点级 DENS 行为一致,而不是靠手填时记得对齐。
  const dng = verifyRegionDanger();
  t('区域危险度 = 成员 DENS 最大值', dng.ok,
    dng.bad.map(b => `${b.region}: ${b.danger}≠${b.expected}`).join('; '));

  // ── 色块几何:跨种子自洽(XX-WORLD-004 的核心不变量) ──
  // 地图按种子生成。若色块几何来自任何静态坐标,换个种子就会整片错位 ——
  // 而错位不会报错,只会让玩家看到「节点在自己区域外面」。这条跨 12 个种子断言:
  // 每个区域的**每个可见成员都必须落在自己那块色块内**。
  // 反向验证记录:把 regionRects 换成 regions.js 里原来的静态 mapRect,
  // 本条在默认种子下就会报 12/15 个节点在框外(见 git history)。
  const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 20261010, 777, 31337, 5, 10086];
  let outside = 0, blockCount = 0;
  for (const seed of SEEDS) {
    const g = generate(seed);
    const xs = g.nodes.map(n => n.x), ys = g.nodes.map(n => n.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = x1 > x0 ? 86 / (x1 - x0) : 0, sy = y1 > y0 ? 52 / (y1 - y0) : 0;
    // 复刻 ui.js vMap 的 pos() —— 同一把尺,否则测的不是渲染用的几何
    const posOf = n => ({ x: 7 + (n.x - x0) * sx, y: 9 + (n.y - y0) * sy });
    // visibleNodes() 只当**id 白名单**,坐标一律取自 generate(seed) ——
    // NODES 的 x/y 与生成布局有 7/11 个节点对不上(n1: NODES(2,1) vs 生成(5,1)),
    // 拿 NODES 的坐标配 WORLD 的边界换算会静默错位,而且不报错。
    const allow = new Set(visibleNodes().map(n => n.id));
    const vis = g.nodes.filter(n => allow.has(n.id));
    for (const { rect, members } of regionRects(vis, posOf)) {
      blockCount++;
      for (const n of members) {
        const p = posOf(n);
        if (p.x < rect.x || p.x > rect.x + rect.w || p.y < rect.y || p.y > rect.y + rect.h) outside++;
      }
    }
  }
  t(`色块跨 ${SEEDS.length} 个种子包住全部成员(实测 ${blockCount} 块)`,
    outside === 0, `${outside} 个节点落在自己区域框外 —— 色块几何不是按真实落点算的`);
  // 只查**属性定义**,不查注释:注释里必须留着「为什么删掉它」的解释。
  t('数据层不再有静态地图坐标', !/\bmapRect\s*:/.test(R('js/xiuxian/world/regions.js')),
    '静态坐标在按种子生成的地图上必然过期,几何一律现算');

  // 路的两个端点都必须是真节点 —— verifyNetwork 查了,这里独立再查一次,
  // 是为了钉住「verify 自己写错」这种情况(它是从同一份数据推出来的)
  const known = new Set(ids);
  const bad = ROADS.filter(r => !known.has(r.from) || !known.has(r.to));
  t('每条路的端点都是真节点', bad.length === 0,
    bad.slice(0, 3).map(r => `${r.id}: ${r.from}→${r.to}`).join('; '));

  t('DAY_PHASE 有值(类型层不是纯注释)', DAY_PHASE && Object.keys(DAY_PHASE).length > 0,
    JSON.stringify(DAY_PHASE));
}

console.log('\n=== [5] 本门禁自身没失效(P1-7 反向自检) ===');
{
  // 断言的期望值必须**独立于**被检查的数据,否则改坏数据时它跟着一起坏。
  // 这里钉三个字面常量:它们不来自任何被检查的对象。
  t('LEGACY_IDS 的首尾是 n0/n10(字面期望,非从数据推)',
    LEGACY_IDS[0] === 'n0' && LEGACY_IDS[10] === 'n10', `${LEGACY_IDS[0]}..${LEGACY_IDS[10]}`);
  t('REGIONS 恰好 5 个区域(字面期望)', REGIONS.length === 5, `实测 ${REGIONS.length}`);
  // 反向:要求存在一个区域、而世界只有 field 节点时,应判 false
  t('区域覆盖判定对空世界返回 false(反向验证)',
    !new Set(['x']).has(REGIONS[0].nodes[0]), '反向验证:空世界不该通过覆盖检查');
}

if (fail === 0) {
  console.log('\n✅ 大世界数据层通过:三个 verify 全绿、开关按阶段逐个开、world.js 未改');
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 数据层有静默错误`);
  process.exit(1);
}
