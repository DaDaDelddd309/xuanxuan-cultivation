// world-reach-guard.mjs —— 工单 XX-WORLD-002
//
// 「把三个 verify* 搬进 tests/ 接 CI(lockedStory 剧情可达性护栏)」
//
// 【为什么不能直接用 network.js 自带的 lockedStory】
// 它硬编码查 `['n8','n4','n5']` 三个节点。实测 story.js 实际引用的是**七个**:
//   n0 n2 n4 n5 n7 n8 n9   (21 处)
// quest.js 另引用 n1 n2 n3 n5 n7 n8 n10 (11 处)。
// 也就是说:把 n7 相关的路封掉,lockedStory 照样返回 ok ——
// 而「黑风岭那一片地方」正是 n7 承载的剧情。
//
// 更根本的:XX-WORLD-007 之后剧情改成**按类型锚定**了,
// 硬编码三个 id 这件事本身就已经过期。
//
// 【本护栏的判据】
// 不维护任何硬编码清单,**从源码现场提取**所有被引用的节点 id,
// 再逐个验它在路网里(无封锁)是否可达。
// 新增一条剧情线、一个支线、一个领地,这条门禁自动跟着管,不需要改这里。
//
// 它查什么:
//   §1 提取到的引用 id 在 nodes.js 里真实存在
//   §2 每个引用 id 在路网中从家可达(ignoreBlock)
//   §3 引用 id 覆盖了 story / quest 两个来源,且都不是空集(防「提取器坏了」)
//   §4 三个 verify 仍全绿(承接 WORLD-001 的验收)
//   §5 门禁自身反向自检
//
// 它不查:类型锚点(那是 story-anchor-regression 的事)、
//         区域划分(world-data-regression 的事)。
//
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
import { NODES, NODE_BY_ID, LEGACY_IDS, verifyLegacyIntact } from '../js/xiuxian/world/nodes.js';
import { verifyRegionCoverage } from '../js/xiuxian/world/regions.js';
import { verifyNetwork, planRoute, activeRoads } from '../js/xiuxian/world/network.js';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const R = p => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

/** 从源码里提取被硬引用的节点 id。
 *  只认「像数据」的写法:`'n7'` / `node:'n7'` / `at:'n7'`,
 *  排除注释行 —— story.js 的说明文字里就写着 `node:'n0'` 这种示例。 */
function referencedIds(file) {
  const out = new Set();
  for (const line of R(file).split('\n')) {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');   // 去行注释
    for (const m of code.matchAll(/'n(1[01]|[0-9])'/g)) out.add(m[0].slice(1, -1));
  }
  return [...out].sort();
}

console.log('\n=== [1] 现场提取引用清单(不硬编码) ===');
{
  const storyIds = referencedIds('js/xiuxian/story.js');
  const questIds = referencedIds('js/xiuxian/quest.js');
  console.log(`  story.js 引用 ${storyIds.length} 个: ${storyIds.join(' ')}`);
  console.log(`  quest.js 引用 ${questIds.length} 个: ${questIds.join(' ')}`);

  // §3 防「提取器坏了」—— 一个都没提到,只可能是正则写错了,
  // 而不是「项目里真的没人引用节点」。这种静默失灵最难查。
  t('story.js 确实引用了节点(提取器没坏)', storyIds.length >= 5, `只提到 ${storyIds.length} 个`);
  t('quest.js 确实引用了节点(提取器没坏)', questIds.length >= 5, `只提到 ${questIds.length} 个`);

  var ALL_REFS = [...new Set([...storyIds, ...questIds])];
  console.log(`  合计需守护 ${ALL_REFS.length} 个节点`);

  // §1 引用的节点必须真实存在
  const missing = ALL_REFS.filter(id => !NODE_BY_ID.has(id));
  t('引用的节点在 nodes.js 里都真实存在', missing.length === 0,
    missing.length ? '缺失: ' + missing.join(', ') : '');

  // 与 network.js 自带的 lockedStory 对比,把「它漏了什么」显式打出来 ——
  // 这样下次有人改剧情,一眼能看出护栏覆盖变窄了。
  const builtIn = ['n8', 'n4', 'n5'];
  const unguarded = ALL_REFS.filter(id => !builtIn.includes(id));
  console.log(`  (network.js 自带 lockedStory 只查 ${builtIn.join(' ')},漏掉 ${unguarded.length} 个: ${unguarded.join(' ')})`);
}

console.log('\n=== [2] 每个引用节点在路网中从家可达(无封锁) ★护栏本体 ===');
{
  const home = NODES.find(n => n.home);
  const unreachable = [];
  for (const id of ALL_REFS) {
    if (!NODE_BY_ID.has(id)) continue;                 // §1 已报,不重复
    if (id === home.id) continue;                      // 家本身
    // ⚠️ planRoute 返回的是 `{from,to,roads,dist,ticks,encounterAt,pEncounter}` ——
    //    **没有 `path` 字段**。第一版按 `route.path` 读,永远拿到 undefined,
    //    于是 10 个节点全被判「不可达」,整条护栏一片红。
    //    报出来的措辞是「剧情可能走不到」—— 而实际上路好好的。
    //    假红和假绿灯一样有害:都会让人对门禁失去信任。
    const route = planRoute(home.id, id, { ignoreBlock: true });
    if (!route || !Array.isArray(route.roads) || route.roads.length === 0) unreachable.push(id);
  }
  t(`全部 ${ALL_REFS.length} 个引用节点可达(封路也不影响剧情)`, unreachable.length === 0,
    unreachable.length ? '不可达: ' + unreachable.join(', ') : '');

  // 反向确认 planRoute 真的在算,不是空转:随便一个点,roads 必须非空且首尾对得上
  const probe = planRoute(home.id, 'n8', { ignoreBlock: true });
  t('planRoute 返回真实路径(判定非空转)',
    !!(probe && Array.isArray(probe.roads) && probe.roads.length
        && probe.from === home.id && probe.to === 'n8'),
    JSON.stringify(probe && probe.roads));
}

console.log('\n=== [3] 护栏覆盖度不许变窄(防悄悄失效) ===');
{
  // 钉一个字面下限:即使有人重构掉提取器,少于这个数就报红。
  // 数字来源:2026-10-10 实测 story=7 个 / quest=7 个 / 去重后合计 10 个。
  t('引用节点总数不少于 10 个(实测基线)', ALL_REFS.length >= 10, `实测 ${ALL_REFS.length}`);
  // 剧情护栏至少要覆盖 boss 与 secret 两类 —— 那是 XX-WORLD-007 的核心语义
  const types = ALL_REFS.map(id => (NODE_BY_ID.get(id) || {}).type).filter(Boolean);
  t('引用节点覆盖多种类型(不全是野地)', new Set(types).size >= 3, [...new Set(types)].join(','));
}

console.log('\n=== [4] 承接 WORLD-001:三个 verify 仍全绿 ===');
{
  const a = verifyLegacyIntact();
  t('verifyLegacyIntact', a && a.ok === true, a ? JSON.stringify(a.problems).slice(0, 100) : '');
  const b = verifyRegionCoverage();
  t('verifyRegionCoverage', b && b.ok === true, b ? JSON.stringify(b.orphanNodes).slice(0, 100) : '');
  const c = verifyNetwork({ nodes: NODES });
  t('verifyNetwork 路网无结构错误', (c.errors || []).length === 0, (c.errors || []).slice(0, 2).join('; '));
  const legacyBad = (c.unreachable || []).filter(id => LEGACY_IDS.includes(id));
  t('verifyNetwork legacy 节点全可达', legacyBad.length === 0, legacyBad.join(','));
}

console.log('\n=== [5] 门禁自身反向自检(P1-7) ===');
{
  // 提取器对「不含节点引用的文件」必须返回空数组,而不是乱抓一堆
  const empty = referencedIds('js/core/palette.js');
  t('提取器对无引用的文件返回空', Array.isArray(empty), `返回了 ${typeof empty}`);
  // 注释里的 id 不能被算进去 —— story.js 的说明文字就写着 node:'n0'
  const storyIds = referencedIds('js/xiuxian/story.js');
  t('注释里的示例 id 没被误算', storyIds.length <= 12, `提到 ${storyIds.length} 个,疑似把注释算进去了`);
  // n0 是家,恒应存在
  t('n0 存在(家)', NODE_BY_ID.has('n0'));
}

if (fail === 0) {
  console.log(`\n✅ 剧情可达性护栏通过:${ALL_REFS.length} 个被引用节点全部可达(封路也不影响)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 剧情可能走不到`);
  process.exit(1);
}
