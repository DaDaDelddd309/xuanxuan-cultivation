// 换世重置 —— 地图换了,一切**锚在地图上**的状态都得跟着换
//
// 【XX-PLAY-012】ui.js 的 `setseed` 原来只做三件事:
//   Seed.set(v) → regenerate(新种子) → clearActive()
// clearActive() 清的是 runcfg 的本局参数(那部分是对的,注释也写了
// 「本局参数随之失效,回到默认」)。但**节点作用域**的状态一个都没动:
//   · Cult.s.current   玩家当前所在的节点
//   · Cult.s.visited   「去过哪些地方」
//   · BUILD.s.land     占领的领地
//   · BUILD.s.fires    篝火坐标
//   · BUILD.s.placed   灵田位置
//   · CAMP.s.nodeId    营地扎在哪
//
// 而节点 id 是 worldgen 按 (y,x) 排序**逐种子重发**的(见 worldgen.js:237)。
// 实测 200 组种子(A→B 换世),玩家原本站在 n3:
//
//   站的节点**类型**变了          122/200 = 61.0%
//   换世前有名字、换世后没了       49/200 = 24.5%   (青岚秘境 → 无名野地)
//   直接被丢在妖巢门口              5/200 =  2.5%
//
// 另有更隐蔽的一条:`visited` 是**整张表**带过去的,而旧世界的「去过」里必然
// 包含新世界妖巢所在的那个 id —— 于是「已探索」凭空多出一个妖巢,
// 凡是依赖 `visited` 的剧情与支线都会**自动放行**。玩家没打过,系统说打过。
//
// 【为什么只重置「节点作用域」,不动别的】
// 修为、灵石、背包、「见过哪些妖」这些**不是**锚在地图上的,换了张图也还成立,
// 不该跟着清。边界就一条:**这个状态是不是在指某个具体地点**。
// 是 → 清;不是 → 留。

import { Cult } from './index.js';
import { BUILD } from './build.js';
import { CAMP } from './camp.js';
import { WORLD } from './world.js';

/** 当前世界的家节点 id。换世后玩家的落脚点必须是它。 */
function homeId() {
  try {
    const n = WORLD && WORLD.nodes ? WORLD.nodes.find(x => x.home) : null;
    return n ? n.id : 'n0';
  } catch { return 'n0'; }
}

/**
 * 把所有锚在地图上的状态重置到新世界上。
 * @returns {{home:string, cleared:Object}} 落点与被清掉的项(给提示文案用)
 */
export function resetWorldScope() {
  const home = homeId();
  const cleared = {};

  // —— 位置与足迹 ——
  const cs = Cult.get();
  if (cs.current !== home) cleared.current = cs.current;
  cs.current = home;
  // visited 必须重置:旧 id 表带过去会把新妖巢算成「去过」(见文件头实测)
  cs.visited = { [home]: true };
  cleared.visited = true;
  Cult.commit();

  // —— 领地 / 篝火 / 灵田:都是具体坐标上的东西 ——
  const bs = BUILD.s;
  if (bs.land && bs.land.length) cleared.land = bs.land.length;
  if (bs.fires && bs.fires.length) cleared.fires = bs.fires.length;
  if (bs.placed && bs.placed.length) cleared.placed = bs.placed.length;
  bs.land = [];
  bs.fires = [];
  bs.placed = [];
  BUILD.save && BUILD.save();

  // —— 营地 ——
  if (CAMP.s && CAMP.s.nodeId) { cleared.camp = CAMP.s.nodeId; CAMP.s.nodeId = null; }
  CAMP.save && CAMP.save();

  return { home, cleared };
}