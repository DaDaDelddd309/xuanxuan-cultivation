// region-layer-regression.mjs —— 工单 XX-WORLD-004 的门禁
//
// XX-WORLD-004 承诺的可见效果一句话:**图上每一个点都有地方可归**(色块 + 危险度 + 势力名),
// 而且**只改渲染**。这两条都很容易悄悄破掉:
//
//   · 「只改渲染」破掉:哪天有人顺手在色块逻辑里塞了判定,玩家行为就变了,
//     而这类改动不会让任何现有测试变红 —— 原来的测试只管旧地图。
//   · 「每个点都有归属」破掉:区域表一改(加区域/删区域/挪节点),色块可能变 4 片或 6 片,
//     也可能挪到节点外面去。地图错位**不会报错**,只会让玩家看见荒诞的画面。
//
// 【2026-10-10 改口径】原文写的是「11 个点 → 5 片地方」。那个 11 来自
// world/nodes.js 的 11 个 legacy 节点,而地图实际画的是 WORLD.nodes 全部
// 十几个点 —— 于是 worldgen 多生成的那几个点谁都不认领,地图上留下
// 「有色块、有地标,唯独这个点无主」。11 是旧数据层的遗产,不是承诺。
//
// ⚠️ 这里记一个**门禁自身的结构性缺陷**,别再犯:
//   原来的覆盖率断言拿 `visibleNodes()` 过滤后的集合当分母,
//   而 regionLayer 内部用的是**同一个过滤** —— 断言与实现同源,
//   于是「有节点掉出色块」这件事它**永远抓不到**,一直是绿的。
//   现在改成拿**全量节点**当分母:与实现用的过滤集无关,才是独立断言。
//
// 本门禁直接 import 渲染函数本身,不用正则去抠 ui.js 源码 —— 抠源码格式的门禁
// 曾经整份失效过(lint-nodes 抠不到硬编码节点表却返回 exit 0),教训记在
// TECHDEBT.md。跑真函数,比跑正则可靠.
//
// 退出码:0 = 通过;非 0 = 不通过
import { readFileSync } from 'fs';
import { WORLD } from '../js/xiuxian/world.js';
import { generate } from '../js/xiuxian/worldgen.js';
import { regionLayer, regionLegend } from '../js/xiuxian/ui/map.js';
import { FEATURE_FLAGS, visibleNodes, NODES } from '../js/xiuxian/world/nodes.js';
import { REGIONS, regionRects, regionView, FACTION_BY_ID } from '../js/xiuxian/world/regions.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? '  — ' + d : ''}`); }
};

/**
 * 复刻 ui.js vMap 的坐标换算 —— 渲染层用的就是这把尺。
 * 门禁必须用**同一把尺**,否则测的不是真正上屏的几何。
 * 注意:节点必须来自 generate(seed),不能来自 NODES(见下面「坐标不是同一套」)。
 */
function posFactory(nodes) {
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = x1 > x0 ? 86 / (x1 - x0) : 0, sy = y1 > y0 ? 52 / (y1 - y0) : 0;
  return n => ({ x: 7 + (n.x - x0) * sx, y: 9 + (n.y - y0) * sy });
}

/** 门禁用的世界状态:全部已访问 / 一个都没访问。 */
const stateAll = { current: 'n0', visited: Object.fromEntries(WORLD.nodes.map(n => [n.id, true])) };
const stateNone = { current: 'n0', visited: {} };

console.log('\n=== [1] 开关:regions 开着才铺色块,关掉必须一片空白 ===');
{
  t('FEATURE_FLAGS.regions === true', FEATURE_FLAGS.regions === true,
    `实测 ${FEATURE_FLAGS.regions} —— 阶段 1 已落地,这个开关应当打开`);
  const pos = posFactory(WORLD.nodes);
  t('开关开着时 regionLayer 有输出',
    regionLayer(WORLD.nodes, pos, stateAll, false).length > 0);
}

// ───────────────────────────────────────────────────────────
console.log('\n=== [2] 图上每个点都有地方可归 ===');
{
  const pos = posFactory(WORLD.nodes);
  // ⚠️ 分母是**全量节点**,不是 visibleNodes() 过滤后的集合 ——
  //   原来的断言拿过滤集当分母,而 regionLayer 内部用的也是同一个过滤,
  //   断言与实现同源,于是「有节点掉出色块」永远抓不到。详见文件头。
  const all = WORLD.nodes;
  const rects = regionRects(all, pos);
  t(`恰好 5 块色块(实测 ${rects.length})`, rects.length === REGIONS.length);
  // split 在首尾各留一段:5 行 → 6 段,所以要 -1
  const legRows = regionLegend(WORLD.nodes, pos, false).split('xx-lg-row').length - 1;
  t(`图例行数与色块数一致(实测 ${legRows} 行 / ${rects.length} 块)`, legRows === rects.length);
  t(`覆盖全量 ${all.length} 个节点`,
    rects.reduce((a, r) => a + r.members.length, 0) === all.length,
    `实测 ${rects.reduce((a, r) => a + r.members.length, 0)}`);
  // 每个节点恰好落在一块色块里(区块可重叠,但成员不能缺席)
  const covered = new Set(rects.flatMap(r => r.members.map(m => m.id)));
  t('没有一个节点掉出色块(本条就是 XX-WORLD-004 那个"无主之地"的守门)',
    covered.size === all.length,
    [...all.filter(v => !covered.has(v.id)).map(v => v.id)].join(','));
  // 节点自带 region 必须在名册里,否则色块认不出它
  const REGION_IDS = new Set(REGIONS.map(r => r.id));
  const badRegion = all.filter(n => n.region && !REGION_IDS.has(n.region)).map(n => n.id);
  t('每个节点的 region 都在 REGIONS 名册内', badRegion.length === 0, badRegion.join(','));
}

console.log('\n=== [2b] 跨种子:每个点都有归属 ===');
{
  // 原缺陷就是"默认种子没事、换个种子多出无主点",所以必须多种子验。
  const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 20261010, 777, 31337, 5, 10086];
  let orphan = 0, noRegion = 0, total = 0;
  for (const seed of SEEDS) {
    const g = generate(seed);
    const pos = posFactory(g.nodes);
    const rects = regionRects(g.nodes, pos);
    const cov = new Set(rects.flatMap(r => r.members.map(m => m.id)));
    total += g.nodes.length;
    for (const n of g.nodes) {
      if (!n.region) noRegion++;
      if (!cov.has(n.id)) orphan++;
    }
  }
  t(`${SEEDS.length} 个种子 / ${total} 个节点:无一掉出色块`, orphan === 0, `${orphan} 个无主`);
  t(`${SEEDS.length} 个种子:每个节点都带 region`, noRegion === 0, `${noRegion} 个缺 region`);
}

console.log('\n=== [2c] 端到端:真正上屏的色块必须盖住每个点 ===');
{
  // ⚠️ 这一段是被**注入验证逼出来的**。
  //   上面 [2] 直接调 regionRects(all, ...),绕过了 regionLayer → visibleOf
  //   这条真实渲染路径 —— 于是「把 map.js 退回 legacy 白名单」这种改动
  //   [2] 全绿,而**实际渲染会退回 11 个点有颜色**。假绿。
  //   所以这里改从 regionLayer 的**输出 HTML** 里抠几何:
  //   每个节点按同一把尺换算坐标,必须落在至少一块色块内。
  //   断言对象从"内部函数"换成"玩家看见的东西",与实现不再同源。
  const pos = posFactory(WORLD.nodes);
  const html = regionLayer(WORLD.nodes, pos, stateAll, false);
  const rects = [...html.matchAll(/left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%/g)]
    .map(m => ({ x:+m[1], y:+m[2], w:+m[3], h:+m[4] }));
  t(`从 HTML 抠到 ${rects.length} 块色块(应等于 ${REGIONS.length})`, rects.length === REGIONS.length);

  const uncovered = WORLD.nodes.filter(n => {
    const p = pos(n);
    return !rects.some(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  }).map(n => n.id);
  t(`上屏的色块盖住全部 ${WORLD.nodes.length} 个点`, uncovered.length === 0,
    uncovered.join(','));

  // 未探索态也要一样盖住 —— 迷雾只改**文案**,不改几何。
  // 要是哪天有人为了"不剧透"把未探区域的色块整个不画,这里会红。
  const htmlNone = regionLayer(WORLD.nodes, pos, stateNone, false);
  const rectsNone = [...htmlNone.matchAll(/left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%/g)]
    .map(m => ({ x:+m[1], y:+m[2], w:+m[3], h:+m[4] }));
  const uncoveredNone = WORLD.nodes.filter(n => {
    const p = pos(n);
    return !rectsNone.some(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  }).map(n => n.id);
  t('未探索态色块数量不减(迷雾只改文案不改几何)', rectsNone.length === rects.length,
    `${rectsNone.length} vs ${rects.length}`);
  t('未探索态同样盖住全部点', uncoveredNone.length === 0, uncoveredNone.join(','));
}

console.log('\n=== [3] 几何必须包住成员(跨种子自洽) ===');
{
  // 这是本门禁最要紧的一条。若几何来自任何静态坐标,换种子必错位且不报错。
  // 反向验证记录见文件末尾 §5。
  const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 20261010, 777, 31337, 5, 10086];
  let outside = 0;
  for (const seed of SEEDS) {
    const g = generate(seed);
    const pos = posFactory(g.nodes);
    const vis = g.nodes.filter(n => visibleNodes().some(v => v.id === n.id));
    for (const { rect, members } of regionRects(vis, pos)) {
      for (const n of members) {
        const p = pos(n);
        if (p.x < rect.x || p.x > rect.x + rect.w || p.y < rect.y || p.y > rect.y + rect.h) outside++;
      }
    }
  }
  t(`${SEEDS.length} 个种子 × 全部成员都在自己色块内`, outside === 0,
    `${outside} 个节点落在框外 —— 几何不是按当前种子的真实落点算的`);
}

console.log('\n=== [4] 危险度与势力名(且昼夜会变) ===');
{
  const pos = posFactory(WORLD.nodes);
  const html = regionLayer(WORLD.nodes, pos, stateAll, false);
  const leg = regionLegend(WORLD.nodes, pos, false);

  // 势力名:五个区域的名字与五个势力的名字都得出现
  const missingR = REGIONS.filter(r => !html.includes(r.name)).map(r => r.id);
  t('五个区域名都上屏', missingR.length === 0, missingR.join(','));
  const facNames = [...new Set(REGIONS.map(r => (FACTION_BY_ID.get(r.faction) || {}).name))];
  const missingF = facNames.filter(n => n && !leg.includes(n));
  t('势力名都在图例里', missingF.length === 0, missingF.join(','));

  // 危险度:白天的数字必须等于 regionView 的白天值
  const wrong = REGIONS.filter(r => {
    const v = regionView(r.id, { isNight: false });
    return !new RegExp(`危\\s*${v.danger}`).test(html);
  }).map(r => r.id);
  t('白天的危险度数字与 regionView 一致', wrong.length === 0, wrong.join(','));

  // 昼夜必须真的有差别 —— 反向验证时把 mul 写死就能骗过上面那条
  const day = REGIONS.map(r => regionView(r.id, { isNight: false }).danger);
  const night = REGIONS.map(r => regionView(r.id, { isNight: true }).danger);
  t('夜里比白天凶(每个区域都不低于白天)',
    night.every((v, i) => v >= day[i]),
    `白天 ${day.join(',')} / 夜里 ${night.join(',')}`);
  t('夜间危险度确实整体上浮(不是原样返回)',
    night.some((v, i) => v > day[i]),
    `白天 ${day.join(',')} / 夜里 ${night.join(',')}`);

  // 【反向验证挖出来的漏网】上面几条全都拿 regionView 的返回值当期望值,
  // 等于让被检查的函数给自己作证:把 regionView 的白天分支改回
  // `dayYieldMul`(那个真实的语义 bug)之后,上面几条**照样全绿**——
  // 因为渲染值和期望值是同一个函数算的,它坏了两边一起坏。
  // 独立期望:白天危险度必须等于区域**申报的基础值** r.danger。
  // 没有任何区域声明 dayDangerMul,所以白天就是不该有任何浮动。
  // 尤其 r_qinglan(dayYieldMul 1.1)与 r_guzhan(1.05)最容易被带偏。
  const wrongBase = REGIONS
    .filter(r => regionView(r.id, { isNight: false }).danger !== r.danger)
    .map(r => `${r.id}: 白天 ${regionView(r.id, { isNight: false }).danger} ≠ 基础 ${r.danger}`);
  t('白天危险度 = 区域基础值(不掺产出倍率)', wrongBase.length === 0,
    `${wrongBase.join('; ')} —— 产出倍率(dayYieldMul)混进危险度了`);

  t('图例夜间文案跟着切',
    regionLegend(WORLD.nodes, pos, true).includes('夜深') !== regionLegend(WORLD.nodes, pos, false).includes('夜深'));
}

console.log('\n=== [5] 迷雾:没去过的区域不报名字 ===');
{
  const pos = posFactory(WORLD.nodes);
  const html = regionLayer(WORLD.nodes, pos, stateNone, false);
  t('全未探索时没有区域名', !REGIONS.some(r => html.includes(r.name)),
    '区域名会剧透:n4 所在区域叫「青岚秘境」,而 n4 本身是 secret');
  t('全未探索时显示「未探之地」', html.includes('未探之地'));
  t('全未探索时也不报危险度(那同样是情报)', !/危\s*\d/.test(html));

  const htmlAll = regionLayer(WORLD.nodes, pos, stateAll, false);
  t('全部探索后区域名出现', REGIONS.every(r => htmlAll.includes(r.name)));
}

console.log('\n=== [6] 本门禁自身的反向自检(防断言写太松) ===');
{
  // 【踩过的坑,记在这里】第一版门禁用 visibleNodes() 的节点去配
  // pos() 的边界换算,结果 12 个种子全部「通过」——
  // 因为 NODES 的 x/y 与 generate(seed) 产出的布局不是同一套
  // (实测 11 个 legacy 节点里 7 个坐标不同),两边坐标系错开之后,
  // 块和节点一起平移,相对关系居然还对,断言就抓不到错位了。
  // 换成同一批节点后才立刻暴露。这条断言把该前提钉死。
  const mism = visibleNodes().filter(v => {
    const w = WORLD.nodes.find(n => n.id === v.id);
    return !w || w.x !== v.x || w.y !== v.y;
  });
  t(`NODES 与 WORLD 坐标确实不同源(实测 ${mism.length}/${visibleNodes().length} 个不同)`,
    mism.length > 0,
    '若哪天两套坐标变成一致了,请把这条断言删掉并更新 §5 的说明 —— 那说明前提变了');

  // 色块必须真的出现在 map 容器里,而不是自己飘在外面
  const pos = posFactory(WORLD.nodes);
  const html = regionLayer(WORLD.nodes, pos, stateAll, false);
  // 只数**块本身**:块是 class="xx-rgn" 或 "xx-rgn xx-rgn-cur",
  // 子元素是 xx-rgn-nm / xx-rgn-sub / xx-rgn-fa,前缀匹配会把它们一起数进来。
  const blocks = html.match(/class="xx-rgn[\s"]/g) || [];
  t('输出的是 5 个 .xx-rgn 块', blocks.length === 5, `实测 ${blocks.length}`);
  t('色块带 data-region 标识', (html.match(/data-region="/g) || []).length === 5);

  // 色块若吃掉点击,节点就点不动了 —— 这是「只改渲染」最容易弄坏玩法的地方。
  // pointer-events:none 写在 .xx-rgn 规则里,少写一个字母就是线上事故。
  const css = readFileSync(new URL('../css/xiuxian.css', import.meta.url), 'utf8');
  const rule = (css.match(/\.xx-rgn\{[^}]*\}/) || [''])[0];
  t('.xx-rgn 规则存在', rule.length > 0, 'CSS 里找不到 .xx-rgn —— 色块会完全没样式');
  t('.xx-rgn 不吃点击(pointer-events:none)',
    /pointer-events:\s*none/.test(rule),
    rule);
  // 色块必须压在节点(z-index 5)与连线(z-index 0)之间,否则盖住连线或被节点压住
  t('.xx-rgn 的 z-index 低于 .xx-node(5)',
    (() => {
      const z = (rule.match(/z-index:\s*(\d+)/) || [])[1];
      return z !== undefined && Number(z) < 5;
    })(), rule);
}

if (fail === 0) {
  console.log(`\n✅ XX-WORLD-004 区域层通过:${pass} 项(色块 / 危险度 / 势力名 / 跨种子几何 / 迷雾)`);
  process.exit(0);
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 区域层与承诺的可见效果对不上`);
  process.exit(1);
}