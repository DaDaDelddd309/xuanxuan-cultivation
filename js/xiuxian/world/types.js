// ===== 大世界数据模型 · 类型定义(单一真源)=====
//
// 这是整个扩展的**契约层**。regions.js / nodes.js / network.js / extraction.js
// 里的数据必须符合这里的 JSDoc;UI 层和逻辑层只读不猜。
//
// 约定(与项目一致):
//   · 纯数据 + 纯函数,无 DOM、无 Canvas、无 localStorage 写入
//   · 所有结构可 JSON.stringify —— 存档格式 = 运行时格式
//   · 2 空格缩进,中文注释,ESM export const
//
// ⚠️ 最重要的一条不变量(迁移的生命线):
//   **n0..n10 这 11 个节点 ID 永不改变、永不复用、永不重排。**
//   story.js 的 5 条叙事线(beats[].node)与 quest.js 的 8 条支线
//   (QUEST_COND[].where)硬编码引用了它们。扩世界只能"加",不能"改"。
//   新节点一律用 n11+ / 命名 id(如 's_qingyun'),绝不占用 n0-n10。

// ═══════════════════════════════════════════════════════════
// 0. 基础标量
// ═══════════════════════════════════════════════════════════

/**
 * @typedef {number} RealmIdx
 * 境界下标,对齐 realms.js 的 REALMS 数组(炼气=0 … 化神=n)。
 */

/**
 * @typedef {number} DangerTier
 * 危险等级 1..5。区域与道路共用一个刻度,便于统一比较。
 * 1 凡人能走 · 2 有妖 · 3 需结阵 · 4 需大宗 · 5 禁地
 */

/**
 * @typedef {string} NodeId
 * 形如 'n0'..'n10'(legacy,冻结) 或 'n11'.. / 语义 id(新增)。
 */

/**
 * @typedef {string} RegionId
 * 形如 'r_qingshi'。**新增维度,绝不与 NodeId 混用**——
 * 早期版本曾把两者都叫 'n_x',是 ID 空间混用的典型教训。
 */

/**
 * @typedef {string} FactionId
 * 势力 id。见 regions.js 的 FACTIONS。
 */

/** 昼夜相位。与 clock.js 的 CLOCK.phase() 对齐,不另造一套。 */
export const DAY_PHASE = /** @type {const} */ ({
  dawn:  'dawn',   // 黎明
  day:   'day',    // 白昼
  dusk:  'dusk',   // 黄昏
  night: 'night',  // 黑夜
});

// ═══════════════════════════════════════════════════════════
// 1. 区域层 Region
// ═══════════════════════════════════════════════════════════

/**
 * @typedef {Object} Faction
 * @property {string}   id
 * @property {string}   name      显示名
 * @property {string}   col       主色(与 PAL 对齐的水墨色)
 * @property {'neutral'|'good'|'evil'|'chaotic'} stance  对玩家的基本立场
 * @property {string}   desc      一句话设定
 * @property {number}   [power]   势力强度 1..5,决定封锁抵抗与征召
 */

/**
 * @typedef {Object} RegionResource
 * @property {string}  id        资源 id,对齐 items.js 的 STONES / GOODS / 丹药 id
 * @property {string}  name
 * @property {number}  weight    该资源作为该区域主要产出的权重 0..1
 * @property {number}  [p]       基础产出概率(可选,不填则不产)
 */

/**
 * @typedef {Object} Region
 * 区域 = 一片有**统一规则**的地盘。节点是坐标,区域是规则。
 * 危险、资源、昼夜影响、势力、昼夜封锁 —— 全部挂在区域上,
 * 这样新增 50 个节点不需要为每个节点重新填一遍规则。
 *
 * @property {RegionId}    id
 * @property {string}      name      显示名
 * @property {string}      col       地图着色(与 NODE_TYPES 同源的水墨色)
 * @property {DangerTier}  danger    区域基准危险等级
 * @property {FactionId}   faction   归属势力('f_none' = 无主)
 * @property {string[]}    nodes     归属节点 id 列表(NodeId)。
 *                                  存的是 id 不是对象 —— 单一真源在 nodes.js,
 *                                  这里只做索引,避免双向引用。
 * @property {string}      desc      一句话区域描述
 *
 * —— 资源 ——
 * @property {RegionResource[]} [resources] 主要产出
 * @property {string[]}  [consumes]  当地消耗品/特产(决定商队是否值得来)
 *
 * —— 昼夜 ——
 * @property {Object}     [dayNight]
 * @property {number}     [dayNight.nightDangerMul]  夜间危险倍率,默认 1.35
 *                    与 items.js DAY.bonus() 的 1.35 保持一致 —— 同一套昼夜经济学,
 *                    不要让地图和背包各算各的。
 * @property {number}     [dayNight.dayYieldMul]     白天产出倍率,默认 1.0
 * @property {number}     [dayNight.dayDangerMul]     白天危险倍率,默认 1.0
 *                    ⚠️ 与 dayYieldMul 是**两回事**,别互相顶替:
 *                    「白天出丹多」不等于「白天更凶」。只影响产出/危险各自一条线。
 * @property {string[]}   [dayNight.closedTypes]      入夜后关闭的节点类型(如 outpost)
 * @property {boolean}    [dayNight.nightOnly]        该区域只在夜晚可进入(如某些幻境)
 *
 * —— 宗门 / 驻军 ——
 * @property {Object}     [sect]
 * @property {string}     [sect.id]        宗门 id
 * @property {string}     [sect.name]      宗门名
 * @property {string}     [sect.nodeId]    宗门驻地节点(NodeId)
 * @property {RealmIdx}   [sect.realmIdx]  宗门实力,决定其区域控制强度
 * @property {boolean}    [sect.recruit]   是否可拜入(接 tavern 招募池)
 *
 * —— 封锁 ——
 * @property {Object}     [blockade]
 * @property {FactionId}  [blockade.by]      封锁发起势力
 * @property {string}     [blockade.reason]  '妖潮' | '宗争' | '封矿' | '天灾'
 * @property {number}     [blockade.until]   GameDay 数值,到期自动解封
 *                                  存「游戏日」而不是 Date.now() ——
 *                                  clock.js 已有绝对日刻度(CLOCK.absoluteDay()),
 *                                  用它才能和昼夜对齐;存墙钟时间会与离线推算打架。
 *
 * —— 视觉 ——
 * ⚠️ 这里**刻意没有** mapRect。V0.97 起地图按种子生成(实测 8 种子 8 布局),
 *    静态矩形只对某一个种子成立,且与节点真实落点无关。
 *    区域色块的几何由 regions.js 的 `regionRects()` 在渲染时推导,
 *    数据层只保留语义(name/danger/faction/resources),不碰坐标。
 */

/**
 * 区域查询结果。
 * @typedef {Object} RegionView
 * @property {Region|null} region
 * @property {number} danger        当前危险 = base × 昼夜修正 × 封锁修正
 * @property {boolean} passable     是否可进入
 * @property {string}  [reason]     不可进入的原因(给 UI 提示用)
 */

// ═══════════════════════════════════════════════════════════
// 2. 节点层 Node
// ═══════════════════════════════════════════════════════════

/**
 * 节点类型。**5 个 legacy + 5 个新增 = 10 个。**
 *
 * 为什么只有 10 个而不是 15 个(城镇/宗门/矿脉/据点/幻境/奇遇/篝火/守卫/商会/行会
 * 各来一个):
 *   「城镇」「宗门」「商会」这些**不是行为,只是身份**。
 *   它们对系统的唯一影响是「进��之后能点什么」,而那由 §facets 表达。
 *   把身份塞进 type 会让 if/else 爆炸(10 种 type × 12 种行为 = 分支地狱)。
 *
 * 只有**行为真正不同**的才配拥有 type。
 *
 * legacy(行为不可改,改了就是破坏剧情):
 *   village 安全。突破/悟道/炼丹。永不刷怪。
 *   field   自动遭遇,不打断,直接结算(ui.js:547)。
 *   elite   进回合制 Duel(ui.js:576)。
 *   secret  首次进回合制且满血(duel.js:53 的 autoRatio=1.0),盛产丹药。
 *   boss    必进回合制,BGM 切换。
 *
 * @typedef {'village'|'field'|'elite'|'secret'|'boss'
 *          |'rift'|'mine'|'outpost'|'wonder'|'gate'} NodeType
 */

/**
 * 身份标签(正交,可叠加)。只影响 UI 挂什么菜单,不改变节点的基础行为。
 * @typedef {'town'|'sect'|'guild'|'port'|'harvest'|'cursed'|'contested'} NodeFacet
 */

/**
 * @typedef {Object} Node
 *
 * —— 身份(不可变,定稿后不改)——
 * @property {NodeId}    id      冻结。n0..n10 永久保留。
 * @property {string}    name    显示名。未命名的 legacy 节点留空,由 UI 兜底。
 * @property {NodeType}  type
 * @property {RegionId}  region  所属区域(**新增字段**;legacy 节点由 regions.js 回填)
 *
 * —— 布局(legacy 沿用 x/y 网格,新系统不再依赖)——
 * @property {number}    [x]     旧网格列(1..4)。保留是为了旧存档/旧 UI 继续能读。
 * @property {number}    [y]     旧网格行
 * @property {number}    [mx]    新百分比坐标 0..100,给大地图用
 * @property {number}    [my]
 *
 * —— 展示 ——
 * @property {string}    col     主色。legacy 从 NODE_TYPES 继承。
 * @property {NodeFacet[]} [facets] 身份标签
 * @property {string}    [glyph]  地图上的一字/符号。legacy 沿用 ui.js:834 的映射。
 * @property {string}    [desc]   一句话描述
 *
 * —— 行为开关(全部可选,不填=用类型默认值)——
 * @property {boolean}   [safe]        是否绝对安全(不刷怪)
 * @property {boolean}   [turnBased]   是否进 Duel 回合制
 * @property {boolean}   [boss]
 * @property {boolean}   [dropsPill]   掉落丹药
 * @property {string}    [pill]        秘境特产丹药 id
 * @property {boolean}   [home]        家园节点(n0)
 * @property {boolean}   [shop]        可交易(n9)
 * @property {boolean}   [claimable]   可被占领(build.js claimMine 接这个)
 *
 * —— 新增:战斗/遭遇调参 ——
 * @property {Object}    [threat]
 * @property {DangerTier} [threat.tier]      基准威胁等级
 * @property {string[]}  [threat.enemies]    敌人 key 列表(对齐 ENEMY_POOL 的 k)
 * @property {number}    [threat.density]    怪物密度 0..3。**build.js:255 的 DENS 表
 *                                就是要被这个字段取代的东西**——那张硬编码表
 *                                是没有区域概念时的妥协产物。
 *
 * —— 新增:出入口(节点 → 特殊玩法)——
 * @property {Object}    [entry]
 * @property {'shoot'|'duel'|'raid'} [entry.mode]
 *                 'shoot' = 进砍杀局(吃肉鸽主循环)→ main.js startRun
 *                 'duel'  = 进回合制(单场)        → duel.js Duel.start
 *                 'raid'  = 进搜打撤出击           → extraction.js EXTRACT.deploy
 * @property {string}    [entry.sceneId]  场景/副本 id,给 rift 用
 * @property {string}    [entry.foeKey]   回合制对手 key(duel.js 的 makeEnemy 参数)
 * @property {number}    [entry.minRealmIdx] 进入所需的最低境界
 *
 * —— 新增:产出/驻军(据点、篝火、矿脉)——
 * @property {Object}    [site]
 * @property {number}    [site.ward]        篝火护栏半径(px),对齐 camp.js / mount.js
 * @property {string}    [site.resType]     驻军兵种 key
 * @property {number}    [site.resCount]
 * @property {string}    [site.resId]       矿脉产出的 STONES id
 * @property {number}    [site.resQty]
 * @property {number}    [site.buildMax]    可放置建筑格数上限(接 build.js 的 placed)
 */

/**
 * 运行时节点状态(进存档,与静态 Node 数据分离)。
 * 静态数据是「世界长什么样」,运行时状态是「玩家把世界改成什么样了」。
 *
 * @typedef {Object} NodeState
 * @property {boolean}  [visited]    是否到过(对齐 Cult.s.visited)
 * @property {boolean}  [unlocked]   是否已解锁显示
 * @property {string}  [claimedBy]  被谁占领('player' | FactionId | null)
 * @property {number}  [clearedAt]   清剿完成的 GameDay
 * @property {boolean} [burned]      篝火是否燃着(对齐 CAMP.s.lit)
 * @property {number}  [lootAt]      上次结算时间戳(挂机产出节流)
 * @property {number}  [respawnAt]   刷怪重置时间戳
 */

// ═══════════════════════════════════════════════════════════
// 3. 路网层 Road Network
// ═══════════════════════════════════════════════════════════

/**
 * 道路类型。决定**速度、遭遇率、能否被封锁**。
 * @typedef {'road'|'trail'|'water'|'secret'} RoadKind
 */

/**
 * @typedef {Object} Road
 * 一条边(无向)。world.js 旧的 `edges:[[a,b]]` 是它的退化形态:
 * 无 kind、无 dist、无遭遇 → 全部走默认值。
 *
 * @property {string}    id        稳定 id,形如 'r_n0__n1'
 * @property {NodeId}    from
 * @property {NodeId}    to
 * @property {RoadKind}  [kind]     默认按两端节点类型推断
 * @property {number}    [dist]     路程「里」。默认按曼哈顿距离 × 系数。
 * @property {number}    [speedMul] 速度系数。官道 1.0 / 野路 0.7 / 水路 1.3(顺流)
 *                        / 秘径 0.9
 *
 * —— 遭遇 ——
 * @property {Object}    [enc]
 * @property {number}    [enc.rate]        每里触发遭遇的基础概率 0..1
 * @property {string[]}  [enc.table]        遭遇事件 id 列表(指向 network.js 的 ENCOUNTERS)
 * @property {boolean}   [enc.nightMul]     夜间倍率,默认取区域 dayNight.nightDangerMul
 *
 * —— 跨界 ——
 * @property {boolean}   [crossesRegion]  是否跨区域(UI 画双线)
 *
 * —— 门禁 ——
 * @property {Object}    [gate]
 * @property {number}    [gate.minRealmIdx] 最低境界(拦低境界)
 * @property {string}    [gate.key]         需要持有的通行物(如令牌 id)
 *
 * —— 叙事锁(关键:保护剧情线)——
 * @property {boolean}   [sealed]     真·封锁,永远不可通行。**唯一允许硬锁的路**
 * @property {string}    [sealedBy]   'story:<key>' 说明这是剧情锁,
 *                                  封路逻辑必须放行 sealedBy 以 'story:' 开头的边
 *
 * —— 剧情标记 ——
 * @property {boolean}   [story]      是否是叙事线必经之路(UI 高亮)
 */

/**
 * 道路运行时状态(进存档)。静态封路 vs 动态封锁在这里分开:
 * 静态 = 世界设定;动态 = 妖潮/宗争这类会变的。
 *
 * @typedef {Object} RoadState
 * @property {boolean}  [blocked]    被封锁
 * @property {string}  [blockedBy]   '妖潮' | '宗争' | '封矿' | FactionId
 * @property {number}  [until]       GameDay,到期自动解封;0/absent = 永久
 * @property {number}  [lastTravelAt] 上次通过时间戳(节流遭遇用)
 */

/**
 * 赶路结果。
 * @typedef {Object} TravelPlan
 * @property {NodeId}    from
 * @property {NodeId}    to
 * @property {RoadId[]}  roads      经过的道路 id 序列
 * @property {number}    dist       总路程(里)
 * @property {number}    ticks      总耗时(行动点数)。1 tick = 75 秒真实时间,
 *                                  对齐 clock.js 的 ACTION_MS
 * @property {number[]}  encounterAt 每个可能在第几 tick 触发遭遇
 */

// ═══════════════════════════════════════════════════════════
// 4. 搜打撤层 Extraction
// ═══════════════════════════════════════════════════════════

/**
 * 出击状态机。**6 态,其中 3 个是终态。**
 *
 *   prepare ──deploy()──> deployed ──startRun()──> in_run
 *                              │                        │
 *                              │(取消,全额退回)        ├──extractSuccess()──> extract_success
 *                              ▼                        ├──extractFail()─────> extract_fail
 *                        (回到 prepare)                └──death()───────────> death
 *
 * ⚠️ 关键区别:**extract_fail 不等于 death**。
 *   失败撤离 = 东西丢了但人活着,可以再打一局;
 *   死亡     = 人没了,额外损失(装备耐久归零/雇工死亡/灵田被掠)。
 *   把两者合并成一个「失败」是搜打撤设计里最常见的致命简化 ——
 *   它让「再试一次」没有代价。
 *
 * @typedef {'prepare'|'deployed'|'in_run'|'extract_success'|'extract_fail'|'death'} RaidState
 */

/**
 * 战利品槽位分类。决定死亡时怎么赔。
 *
 *  secured  入包物资。带出去 = 真赚。死在半路 = **全损**。
 *           这是搜打撤的核心张力来源,不做就不能叫搜打撤。
 *  insured  保价物资。带出去 = 真赚。死亡 = 赔 60%(付了保费)。
 *           保价费在 deploy 时先扣,不是死亡时才扣。
 *  keep     命根子:装备/功法/身份牌。**永不作为战利品损失**,
 *           但死亡会掉耐久/声望。这是「死了不至于重头再来」的兜底。
 *
 * @typedef {'secured'|'insured'|'keep'} SlotKind
 */

/**
 * @typedef {Object} Slot
 * @property {SlotKind}  kind
 * @property {string}    itemId   对齐 items.js:Bag 用的是 {items:{},demon,charter}
 * @property {number}    n        数量
 * @property {number}    [value]  估值,算保额/赔率用。可选,缺省按 STONES 表算。
 */

/**
 * @typedef {Object} RaidLoadout
 * 一次出击的完整物资清单。
 * @property {Slot[]} secured   硬通货。死亡全损。
 * @property {Slot[]} insured   保价。死亡赔 60%。
 * @property {string[]} keep     保留 id 列表(不参与战利品结算)
 * @property {string[]} [mates]  随队雇工 id(对齐 tavern.js MATES 的 key)
 * @property {number}   [mateHp] 雇工血量余量 %。0 = 已折损
 */

/**
 * @typedef {Object} Stash
 * 藏身处/仓库。搜打撤的全部意义:把「外面的东西」和「家里的东西」分开。
 * ⚠️ **必须是有限格子**,不能是无限背包 —— 有限容量是搜打撤的第二条命脉
 * (第一条是有限时间)。
 *
 * @property {string}  id        通常等于 NodeId(仓库就在某个节点上)
 * @property {NodeId}  nodeId
 * @property {Object}  items     { [itemId]: number } —— 与 Bag 同构,便于直接搬运
 * @property {number}  [cap]     格子上限,默认 30
 * @property {number}  [lastVisitAt]
 */

/**
 * @typedef {Object} Raid
 * 一次出击的完整运行时状态。**这是唯一进存档的新增结构。**
 *
 * @property {string}   id
 * @property {RaidState} state
 * @property {NodeId}   originNode  出击出发点(必须是安全节点)
 * @property {NodeId}   targetNode  目标区域内的节点
 * @property {RegionId} region
 * @property {RaidLoadout} loadout
 *
 * —— 时间 ——
 * @property {number}   deployedAt  出发时间戳(Date.now)
 * @property {number}   extractBy   撤离窗口截止时间戳。**超了就是 extract_fail**
 * @property {number}   ticksLeft   剩余行动点(可与时间双轨,建议只留一条)
 *
 * —— 局内 ——
 * @property {number}   [kills]
 * @property {number}   [looted]    局内已拾取的 { [itemId]: n }
 * @property {number}   [hpRatio]   剩余血量比 0..1(撤离成功率的主要输入)
 *
 * —— 结算 ——
 * @property {Object}   [result]
 * @property {string}   [result.reason]
 * @property {Slot[]}   [result.kept]     实际带出的
 * @property {Slot[]}   [result.lost]     实际损失的
 * @property {number}   [result.exp]
 * @property {number}   [result.dao]
 */

// ═══════════════════════════════════════════════════════════
// 5. 跨层杂项
// ═══════════════════════════════════════════════════════════

/**
 * 遭遇事件表项(network.js 用)。
 * @typedef {Object} EncounterDef
 * @property {string}  id
 * @property {string}  name
 * @property {'combat'|'event'|'trade'|'hazard'} kind
 * @property {string}  [text]     直接结算类事件的描述
 * @property {Object}  [effect]   { dao, exp, items, hp } 数值结算
 * @property {number}  [weight]
 */

/**
 * 世界存档(唯一新增的 localStorage 载荷)。
 * 形状与运行时对象**完全一致** —— 存档即状态,不做序列化转换。
 *
 * @typedef {Object} WorldSave
 * @property {number}     v        存档版本号,迁移用。当前 1
 * @property {Object.<NodeId, NodeState>} nodeStates
 * @property {Object.<RoadId, RoadState>} roadStates
 * @property {Object.<string, Stash>}     stashes
 * @property {Raid|null}  raid      进行中的搜打撤。null = 不在局内
 * @property {number}     [seenRegions]  已解锁区域 id 列表
 */

// ═══════════════════════════════════════════════════════════
// 6. 兼容层:旧结构 → 新结构
// ═══════════════════════════════════════════════════════════

/**
 * 旧结构(必须继续可读,直到迁移完成)。
 * @typedef {Object} LegacyWorld
 * @property {{id:NodeId,x:number,y:number,type:NodeType,name?:string,home?:boolean,shop?:boolean,pill?:string}[]} nodes
 * @property {[NodeId,NodeId][]} edges   无向边对
 * @property {number} grid                ⚠️ 历史 bug:声明 6,实际坐标只到 4
 */

/**
 * 纯数据读取器 —— 供迁移与 UI 共用。
 * 这些函数是**本设计里唯一允许读 localStorage 的地方**,
 * 且只读不写;写入集中在 world-state.js(见 integration.md)。
 *
 * @typedef {Object} WorldReader
 * @property {Region[]}    regions
 * @property {Node[]}      nodes
 * @property {Road[]}      roads
 * @property {EncounterDef[]} encounters
 * @property {RegionView}  (nodeId:NodeId) => RegionView
 * @property {Road[]}      (nodeId:NodeId) => Road[]
 * @property {Node|null}   (nodeId:NodeId) => Node
 */
