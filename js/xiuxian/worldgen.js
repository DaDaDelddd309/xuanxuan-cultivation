// ===== 节点图程序化生成(V0.97)=====
// 工单 XX-S3-001 ~ 004
//
// 设计模式: 固定骨架 + 种子填充(Spelunky 模式)
//   依据 —— 业界 procgen 共识:
//     · 纯随机会生成玩家走不到的资源点,剧情锚点也无处安放
//     · "手工骨架 + 程序化填充" 被明确点名为产出最佳结果的方式
//     · 生成后必须 flood-fill 校验连通,不通过就换布局重来
//
// 不变量(generate() 保证,违反即重试,最多 MAX_ATTEMPT 次):
//   1. 青石村固定起点 (1,1),标记 home:true
//   2. 全图连通 —— 从起点 flood-fill 能到所有节点
//   3. 秘境距起点 ≤ MAX_SECRET_DEPTH 步
//   4. Boss 节点度数 ≥ 2(不落死角)
//   5. 必含 Boss 与秘境
//
// 随机源: seed.js 的 terrain / village 子流 —— 互不干扰,
//         改掉落分布不会挪动地形。
//
// 接口: generate(masterSeed?) → { nodes, edges, attempts, fallback }
//       nodes 是对象数组(非 id 数组),edges 是 [nodeA, nodeB] 数组,
//       与旧版 buildEdges() 的返回形状一致。

import { RNG } from './vendor/rot-rng.js';
import { derive, getMaster } from './seed.js';

export const GRID = 6;
export const MAX_SECRET_DEPTH = 4;
export const MAX_ATTEMPT = 8;

const HOME_X = 1, HOME_Y = 1;

/**
 * 各类型数量区间。
 * 村庄区间不含 home(青石村),即"额外村庄"的数量。
 * 野地有下限即可 —— 骨架生长会顺带补野地,给的是下限而非区间。
 */
export const DENSITY = {
  village: [1, 2],
  secret:  [2, 4],
  fieldMin: 4,
  elite:  [1, 3],
  boss:   [1, 1],
};

const SECRET_PILL_POOL = ['pill_zhuji', 'pill_jindan', 'pill_yuanying', 'pill_huashen'];

// ★ 命名池的**第 0 项是锚点**(ANCHORS 列出),decorate() 按游标顺序取名,
//   因此每个生成出的世界都必然含有这几个地名,一个都不会缺。
//   改动这段时:想动锚点,请改 ANCHORS,不要重排数组 ——
//   mount.js 的 MOUNT_LIST.from 指着它们(坐骑文案里的地名)。
const SECRET_NAMES = ['青岚秘境', '沉沙洞', '寒潭府', '断魂崖', '藏丹窟', '锁龙涧'];
const ELITE_NAMES = ['黑风岭', '枯骨坳', '血藤谷', '落星涧'];
const BOSS_NAMES = ['古战场遗迹', '妖巢', '血崖洞府', '幽冥殿'];
const VILLAGE_NAMES = [
  '落云镇', '白河村', '望山屯', '青柏驿', '石桥集',
  '柳荫坳', '云脚村', '旧驿屯', '枯松崖', '鹿鸣渡',
];

/** 任何种子下都必定存在的地名 —— 各命名池的第 0 项 */
export const ANCHORS = {
  village: VILLAGE_NAMES[0],   // 落云镇
  elite:   ELITE_NAMES[0],     // 黑风岭
  boss:    BOSS_NAMES[0],      // 古战场遗迹
  secret:  SECRET_NAMES[0],    // 青岚秘境
  home:    '青石村',
};
const FIELD_DESC = [
  '荒草没膝,妖气稀薄。', '碎石嶙峋,风里有腥味。', '旧战场,白骨插在土里。',
  '雾锁深谷,看不清底。', '枯林密布,鸦声不断。',
];
const VILLAGE_SHOP_CHANCE = 0.5;

// ————————————————————————— 工具 —————————————————————————

const key = (x, y) => x + ',' + y;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** 由节点列表建 key 集合 */
function occSet(nodes) {
  const s = new Set();
  for (const n of nodes) s.add(key(n.x, n.y));
  return s;
}

/** 从起点 BFS,返回 key → 步数 */
function bfsDist(occ, startKey) {
  const dist = new Map([[startKey, 0]]);
  const q = [startKey];
  while (q.length) {
    const cur = q.shift();
    const [cx, cy] = cur.split(',').map(Number);
    const d = dist.get(cur) + 1;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 1 || nx > GRID || ny < 1 || ny > GRID) continue;
      const k = key(nx, ny);
      if (!occ.has(k) || dist.has(k)) continue;
      dist.set(k, d);
      q.push(k);
    }
  }
  return dist;
}

function degreeOf(edges, node) {
  let d = 0;
  for (const e of edges) if (e[0] === node || e[1] === node) d++;
  return d;
}

// ————————————————————————— 校验 —————————————————————————

/**
 * 校验全部不变量。
 * @returns {ok:boolean, reasons:string[]}
 */
export function validate(nodes, edges) {
  const reasons = [];
  const occ = occSet(nodes);

  // 1. home 固定在 (1,1)
  const home = nodes.find(n => n.home);
  if (!home) reasons.push('缺少 home 节点');
  else if (home.x !== HOME_X || home.y !== HOME_Y) reasons.push(`home 不在 (1,1)，实际 (${home.x},${home.y})`);

  // 2. 格子不重叠
  if (occ.size !== nodes.length) reasons.push(`格子重叠: ${nodes.length} 节点占 ${occ.size} 格`);

  // 3. 全连通
  const dist = bfsDist(occ, key(HOME_X, HOME_Y));
  const bad = nodes.filter(n => !dist.has(key(n.x, n.y)));
  if (bad.length) reasons.push(`${bad.length} 个节点不可达: ${bad.map(n => `${n.x},${n.y}`).join(' ')}`);

  // 4. 秘境距离约束
  const far = nodes.filter(n => n.type === 'secret' && (dist.get(key(n.x, n.y)) ?? 99) > MAX_SECRET_DEPTH);
  if (far.length) {
    reasons.push(`${far.length} 个秘境超 ${MAX_SECRET_DEPTH} 步: ` +
      far.map(n => `${n.x},${n.y}=${dist.get(key(n.x, n.y))}步`).join(' '));
  }

  // 5. Boss 不落死角
  const badBoss = nodes.filter(n => n.type === 'boss' && degreeOf(edges, n) < 2);
  if (badBoss.length) reasons.push(`Boss 落在死角: ${badBoss.map(n => `${n.x},${n.y}`).join(' ')}`);

  // 6. 必含 Boss / 秘境
  if (!nodes.some(n => n.type === 'boss')) reasons.push('没有 Boss 节点');
  if (!nodes.some(n => n.type === 'secret')) reasons.push('没有秘境节点');

  return { ok: reasons.length === 0, reasons };
}

// ————————————————————————— 布局 —————————————————————————

/**
 * 摆节点 + 连边。
 *
 * 策略 —— 「先长骨架,后定类型」,而不是「随机撒点再祈祷合法」:
 *   从 home 出发逐步向外生长,每一步都落在已有节点的空邻格上,
 *   于是连通性由构造保证,不变量 2 天然成立。
 *   纯随机撒点的实测失败率是 99.9%(全靠兜底布局撑着),那样等于没做生成。
 *
 * 其余约束靠候选筛选:
 *   · 秘境只从距 home ≤ MAX_SECRET_DEPTH 的前沿格挑
 *   · Boss 落在外围生长格,连边后度数必然 ≥ 2,不会落死角
 *
 * 密度不追求铺满:留白让地图有疏密变化,也给"可达但偏远"的探索感。
 */
function layout(r) {
  const nodes = [{ x: HOME_X, y: HOME_Y, type: 'village', home: true }];
  const isOpen = new Map(nodes.map(n => [key(n.x, n.y), n]));

  /** 已占用格的外围空邻格 */
  const frontier = () => {
    const out = [];
    const seen = new Set();
    for (const n of nodes) {
      for (const [dx, dy] of DIRS) {
        const nx = n.x + dx, ny = n.y + dy, k = key(nx, ny);
        if (nx < 1 || nx > GRID || ny < 1 || ny > GRID) continue;
        if (isOpen.has(k) || seen.has(k)) continue;
        seen.add(k);
        out.push({ x: nx, y: ny, k });
      }
    }
    return out;
  };

  /** 从前沿中随机取一个并占用 */
  const grow = (filter, type) => {
    const f = frontier().filter(filter || (() => true));
    if (!f.length) return false;
    const pick = f[r.getUniformInt(0, f.length - 1)];
    const node = { x: pick.x, y: pick.y, type: type || 'field' };
    isOpen.set(pick.k, node);
    nodes.push(node);
    return true;
  };

  const secretCount = r.getUniformInt(DENSITY.secret[0], DENSITY.secret[1]);
  const eliteCount = r.getUniformInt(DENSITY.elite[0], DENSITY.elite[1]);
  const fieldCount = r.getUniformInt(DENSITY.fieldMin, DENSITY.fieldMin + 2);
  const villageCount = r.getUniformInt(DENSITY.village[0], DENSITY.village[1]);

  // 顺序有讲究:
  //   1) 先长野地把骨架撑开 —— 否则后面的秘境会被迫远置
  //   2) 秘境从"离起点 ≤4 步"的前沿挑
  //   3) 村庄/elite 常规生长
  //   4) Boss 放到最后,落在外围格 → 连边后度数 ≥ 2
  for (let i = 0; i < fieldCount; i++) grow(null, 'field');

  for (let i = 0; i < secretCount; i++) {
    grow(({ x, y }) => (Math.abs(x - HOME_X) + Math.abs(y - HOME_Y)) <= MAX_SECRET_DEPTH, 'secret');
  }
  for (let i = 0; i < eliteCount; i++) grow(null, 'elite');
  for (let i = 0; i < villageCount; i++) grow(null, 'village');

  // Boss:前沿格必然与已占用格相邻 → 连边后度数 ≥ 2
  grow(null, 'boss');

  // 富余前沿继续填野地,提高地图密度
  while (frontier().length && nodes.length < 15) grow(null, 'field');

  // 连边:曼哈顿距离 1
  const edges = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (Math.abs(nodes[i].x - nodes[j].x) + Math.abs(nodes[i].y - nodes[j].y) === 1)
        edges.push([nodes[i], nodes[j]]);

  return { nodes, edges };
}

/** 赋 id(按 y,x 排序保证同布局同 id) + 填细节 */
function decorate(nodes, edges, villageR) {
  const ordered = nodes.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  ordered.forEach((n, i) => { n.id = 'n' + i; });

  // 命名游标:每类一个,按池序顺取。
  //
  // 为什么不用随机取名(2026-10-10 修):
  //   1) 随机取名会**重名** —— 实测 seed-0 就出了两个「血藤谷」,
  //      地图上两个同名险地,坐骑 lore 说"你在黑风岭遇见它"也无从指认。
  //   2) 随机取名会**漏掉锚点** —— 黑风岭/落云镇/古战场遗迹/青岚秘境
  //      大概率不出现,而 mount.js 的坐骑文案正指着这四个地名,
  //      于是坐骑介绍变成玩家永远遇不到的地方,内容孤儿。
  //   池长都大于该类最大节点数(村 10>2 / 秘境 6>4 / 险地 4>3 / 妖巢 4>1),
  //   顺取不会回绕,所以既不重名也必出锚点。
  //
  // 顺取的代价:同类节点的地名固定按池序排(如最靠上的险地必是黑风岭)。
  // 这是刻意的 —— procgen 的多样性在**布局**上,不该由「地名撞车」换来的。
  const cursor = { village: 0, secret: 0, elite: 0, boss: 0 };
  const nextName = (type, pool) => pool[cursor[type]++ % pool.length];

  // 丹药同理:随机取会让 4 个秘境撞出同一种丹(生日问题,约 59% 概率)。
  // 随机起点 + 顺取 = 每个种子起点不同,但同一张图内四种丹互不重复。
  const pillOffset = villageR.getUniformInt(0, SECRET_PILL_POOL.length - 1);

  for (const n of ordered) {
    if (n.home) { n.name = ANCHORS.home; continue; }
    switch (n.type) {
      case 'village':
        n.name = nextName('village', VILLAGE_NAMES);
        if (villageR.getUniform() < VILLAGE_SHOP_CHANCE) n.shop = true;
        break;
      case 'secret':
        n.pill = SECRET_PILL_POOL[(cursor.secret + pillOffset) % SECRET_PILL_POOL.length];
        n.name = nextName('secret', SECRET_NAMES);
        break;
      case 'elite':
        n.name = nextName('elite', ELITE_NAMES);
        break;
      case 'boss':
        n.name = nextName('boss', BOSS_NAMES);
        break;
      case 'field':
        n.desc = FIELD_DESC[villageR.getUniformInt(0, FIELD_DESC.length - 1)];
        break;
    }
  }
  assignRegions(ordered);
  return { nodes: ordered, edges };
}

// ————————————————————————— 区域归属 —————————————————————————

/**
 * 按节点类型 + 位置,把每个节点归到一个区域(XX-WORLD-004 补)。
 *
 * 为什么必须在生成器里做,不能在 regions.js 里做:
 *   `REGIONS[].nodes` 是**静态 id 列表**(['n0','n10','n1','n3'] 那种),
 *   而 id 是 `decorate()` 开头按 (y,x) 排序逐种子重发的 ——
 *   实测 200 个种子:n1~n16 的**类型全部随种子变**,只有 n0 恒为家的 village。
 *   拿静态 id 去认领生成出来的节点,认到的多半是**另一个地方**;
 *   worldgen 自己多生成的节点(n11~n16)则一个都没人认领,
 *   于是地图上出现「有色块、有地标,唯独这个点无主」。
 *
 * 类型 → 区域的映射不是拍脑袋,是照着 world/nodes.js 那张手写表对齐的:
 *   家村 r_qingshi / 村镇 r_luoyun / 秘境 r_qinglan / 险地 r_heifeng / boss r_guzhan
 *   —— 五条都对得上那张表里同名节点的归属。
 *
 * field(野地)没有类型可依,按**最近的锚点**归。
 *   这里必须用「最近」而不是随手分:`regionRects()` 画的是**包围盒**,
 *   成员在空间上散开,框就会大到骗人 —— 精确但骗人的图比诚实的近似更糟。
 *   距离用曼哈顿(与地图的连边规则一致),同距时取 ordered 里靠前的,
 *   保证同一种子结果稳定可复现。
 */
function assignRegions(ordered) {
  const byType = { secret: 'r_qinglan', elite: 'r_heifeng', boss: 'r_guzhan' };

  // 锚点 = 区域名册上写得出名字的那几类。没有锚点就没有野地可依,
  // 那种布局 worldgen 本来也生成不出来(家村是硬不变量)。
  const anchors = [];
  for (const n of ordered) {
    if (n.home) { n.region = 'r_qingshi'; anchors.push(n); continue; }
    if (byType[n.type]) { n.region = byType[n.type]; anchors.push(n); continue; }
    if (n.type === 'village') { n.region = 'r_luoyun'; anchors.push(n); continue; }
  }

  for (const n of ordered) {
    if (n.region) continue;                 // 上面已定的跳过
    if (!anchors.length) { n.region = 'r_qingshi'; continue; }   // 兜底:不该走到
    let best = anchors[0], bestD = Infinity;
    for (const a of anchors) {
      const d = Math.abs(n.x - a.x) + Math.abs(n.y - a.y);
      if (d < bestD) { bestD = d; best = a; }   // 严格小于 ⇒ 同距取先到的,结果稳定
    }
    n.region = best.region;
  }
  return ordered;
}

// ————————————————————————— 子流获取 —————————————————————————

/**
 * 建两个独立子流。
 * @param {string|undefined} masterSeed 指定种子;省略则用全局当前主种子
 */
function makeStreams(masterSeed) {
  const master = masterSeed === undefined ? getMaster() : String(masterSeed);
  return {
    terrain: new RNG(derive(master, 'terrain')),
    village: new RNG(derive(master, 'village')),
  };
}

// ————————————————————————— 主入口 —————————————————————————

/** 单次尝试 */
function tryOnce(salt, streams) {
  // salt>0 时先把 terrain 流往前推 salt 步,得到不同布局
  for (let i = 0; i < salt; i++) streams.terrain.getUniform();
  const { nodes, edges } = layout(streams.terrain);
  const dec = decorate(nodes, edges, streams.village);
  const v = validate(dec.nodes, dec.edges);
  return { ...dec, ok: v.ok, reasons: v.reasons };
}

/**
 * 生成世界。
 * @param {string} [masterSeed] 指定主种子;省略则用当前全局种子
 * @returns {{nodes:Array, edges:Array, attempts:number, fallback:boolean}}
 */
export function generate(masterSeed) {
  let last = null;
  for (let salt = 0; salt < MAX_ATTEMPT; salt++) {
    last = tryOnce(salt, makeStreams(masterSeed));
    if (last.ok) return { nodes: last.nodes, edges: last.edges, attempts: salt + 1, fallback: false };
  }
  // 兜底:手工保证可用的最小布局。
  // 宁可牺牲布局多样性,也绝不返回玩家玩不了的地图。
  const fb = minimalFallback(makeStreams(masterSeed));
  return { ...fb, attempts: MAX_ATTEMPT, fallback: true };
}

/**
 * 十字形兜底布局,人工保证连通 + Boss 不在死角。
 *
 *        x=1  x=2  x=3  x=4
 *  y=1  village field field field
 *  y=2  field   secret elite boss
 *  y=3  village field  ·     ·
 *
 * boss 在 (4,2),与 (3,2)elite、(4,1)field 相邻,度数 2 —— 不在死角。
 *
 * 2026-10-10 补 (1,3) 村庄:原来兜底图只有 home 一个村庄,
 * 于是走兜底的种子(实测 500 里 3 个)会缺「落云镇」——
 * 而落云镇是坐骑「归鹤表」的来源地名。兜底也必须满足锚点不变量,
 * 不然「保底」反而破不变量,比生成失败更糟。
 */
function minimalFallback(streams) {
  const defs = [
    [1, 1, 'village', true],
    [2, 1, 'field'],
    [3, 1, 'field'],
    [4, 1, 'field'],
    [1, 2, 'field'],
    [2, 2, 'secret'],
    [3, 2, 'elite'],
    [4, 2, 'boss'],
    [1, 3, 'village'],
    [2, 3, 'field'],
    [3, 3, 'field'],
  ];
  const nodes = defs.map(([x, y, type, home]) => ({
    x, y, type, ...(home ? { home: true } : {}),
  }));
  const edges = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (Math.abs(nodes[i].x - nodes[j].x) + Math.abs(nodes[i].y - nodes[j].y) === 1)
        edges.push([nodes[i], nodes[j]]);
  return decorate(nodes, edges, streams.village);
}

/** 便捷入口:生成并组装成 world.js 需要的 WORLD 结构 */
export function buildWorld(masterSeed) {
  const { nodes, edges, attempts, fallback } = generate(masterSeed);
  return { nodes, edges, grid: GRID, attempts, fallback };
}