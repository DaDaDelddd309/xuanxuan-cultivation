// 修仙阁 · 地图区域层 —— 工单 XX-WORLD-004（阶段 1）
//
// 目标一句话:**11 个点 → 5 片地方**。原来地图上散着 11 个孤立的圆点,
// 「危险度」「产出」「势力」这些规则要么硬编码在逻辑里,要么根本没建模。
// 这一层只做三件事:铺色块、写危险度、挂势力名 —— **不改任何玩法判定**。
//
// ⚠️ 为什么几何是算出来的而不是写死的
// V0.97 起地图按种子生成(worldgen.generate),实测 8 个种子 → 8 种布局。
// 数据层曾经给每个区域手写过一个 mapRect,结果是:当前默认种子下就有
// 12/15 个节点落在自己的框外面,换种子更是整张图错位。
// 所以这里一律调 regions.js 的 regionRects(),按**当前可见节点的真实落点**
// 现算包围盒 —— 换种子自动跟随,永远不会过期。
//
// 已知取舍:包围盒是近似,区域之间会重叠(节点在网格上交错时尤其明显)。
// 这是有意的:低透明度填充 + 虚线描边,重叠读作「势力交界」。
// 精确但骗人的图,比诚实的近似更糟。
import { FEATURE_FLAGS, visibleNodes } from '../world/nodes.js';
import { regionRects, regionView, FACTION_BY_ID } from '../world/regions.js';
import { esc } from './dom.js';

/** 危险度 → 一眼能懂的三档。不写 1~5 颗星,是因为 0.1 的小数没法塞进星星里。 */
function dangerClass(d) {
  if (d >= 3) return 'xx-dg-3';
  if (d >= 2) return 'xx-dg-2';
  return 'xx-dg-1';
}

/**
 * 把**真正被渲染的那批节点**过一遍可见性过滤。
 *
 * ⚠️ 这里踩过一个坑,记下来别再踩:
 *   `visibleNodes()` 返回的是 world/nodes.js 的 NODES,而地图上画的节点来自
 *   `WORLD.nodes`(worldgen 按种子生成)。**两者坐标不是同一套** ——
 *   实测 11 个 legacy 节点里有 7 个坐标不同(n1 在 NODES 是 (2,1),
 *   生成出来是 (5,1))。NODES 的 x/y 是一套早已和生成器脱节的旧手写布局。
 *   所以:几何必须用 WORLD.nodes 算,visibleNodes() 只配当**id 白名单**用。
 *   拿 NODES 的坐标去配 pos() 的边界换算,色块会整体错位,而且不报错。
 *
 * 【XX-WORLD-004 补】但这个 id 白名单**不能**再用来决定「谁上色」。
 *   地图画的是 WORLD.nodes 全部十几个点,而白名单只放行 nodes.js 的 11 个 legacy id,
 *   于是 worldgen 多生成的那几个点谁都不认领 —— 地图上出现
 *   「有色块、有地标,唯独这个点无主」(实测 15 个点只有 11 个有色块)。
 *   现在 worldgen 给每个节点都赋了 region,所以:**画了几个点就要有几块色块**。
 *   读不到 region 时(单测假世界 / 旧数据层)才退回 id 白名单。
 *
 * @param {Object[]} nodes WORLD.nodes(实际渲染的那批)
 * @returns {Object[]} 能上色的节点,坐标原样保留
 */
function visibleOf(nodes) {
  if (nodes.some(n => n.region)) return nodes;
  const allow = new Set(visibleNodes().map(n => n.id));
  return nodes.filter(n => allow.has(n.id));
}

/**
 * 一行地图下方的势力/危险度图例。
 * 色块上已经写了名字,这里补的是**排序后的强弱**,给玩家一个横向参照。
 *
 * @param {Object[]} nodes WORLD.nodes
 * @param {(n:Object)=>{x:number,y:number}} posOf
 * @param {boolean} isNight
 * @returns {string} HTML
 */
export function regionLegend(nodes, posOf, isNight) {
  const rects = regionRects(visibleOf(nodes), posOf);
  if (!rects.length) return '';
  const rows = rects
    .map(({ region }) => {
      const f = FACTION_BY_ID.get(region.faction);
      const v = regionView(region.id, { isNight });
      return `<div class="xx-lg-row">
        <i class="xx-lg-dot" style="background:${esc(region.col)}"></i>
        <span class="xx-lg-nm">${esc(region.name)}</span>
        <span class="xx-lg-fa">${esc(f ? f.name : '无主')}</span>
        <span class="xx-dg ${dangerClass(v.danger)}">危 ${v.danger}</span>
      </div>`;
    })
    .join('');
  return `<div class="xx-legend"><div class="xx-label">四 方</div>${rows}
    <div class="xx-dim" style="margin-top:6px;font-size:11px">${
      isNight ? '夜深,各路都凶些。' : '日头正好。'
    }</div></div>`;
}

/**
 * 铺在地图底下的区域色块层。
 *
 * 迷雾规则:**没去过的区域不写名字**,只写「未探之地」。
 * 区域名会剧透 —— n4 的区域叫「青岚秘境」,而 n4 本身是 secret,
 * 玩家没探到之前直接把地名铺在图上,等于把伏笔提前拆了。
 * 这是渲染层的事,不该由玩法逻辑来背,所以在这里挡一道。
 *
 * @param {Object[]} nodes  WORLD.nodes(实际渲染的那批)
 * @param {(n:Object)=>{x:number,y:number}} posOf 与 ui.vMap 同一把尺
 * @param {Object} s 游戏状态(只读 visited / current)
 * @param {boolean} isNight
 * @returns {string} HTML,空串表示开关关闭
 */
export function regionLayer(nodes, posOf, s, isNight) {
  if (!FEATURE_FLAGS.regions) return '';

  const rects = regionRects(visibleOf(nodes), posOf);

  const blocks = rects.map(({ region, rect, members }) => {
    const f = FACTION_BY_ID.get(region.faction);
    const v = regionView(region.id, { isNight });
    // 成员一个都没去过 → 不报名字,也不报危险度(那也是情报)
    const known = members.some(n => s.visited && s.visited[n.id]);
    const cur = members.some(n => s.current === n.id);

    const label = known
      ? `<div class="xx-rgn-nm">${esc(region.name)}</div>
         <div class="xx-rgn-sub">
           <span class="xx-rgn-fa">${esc(f ? f.name : '无主')}</span>
           <span class="xx-dg ${dangerClass(v.danger)}">危 ${v.danger}</span>
         </div>`
      : `<div class="xx-rgn-nm xx-rgn-unknown">未探之地</div>`;

    return `<div class="xx-rgn${cur ? ' xx-rgn-cur' : ''}"
      style="left:${rect.x}%;top:${rect.y}%;width:${rect.w}%;height:${rect.h}%;
             --xx-rgn-col:${esc(region.col)}"
      data-region="${esc(region.id)}"
      title="${known ? esc(region.desc) : ''}">
      ${label}
    </div>`;
  }).join('');

  return blocks;
}

export { regionLegend as vRegionLegend };