# 大世界地图 · 集成说明(与现有系统的具体接点)

> 面向:动手改代码的人。每个接点都给了**文件:行号**和**改动前后的签名对照**。
> 前提:你已经读过 `types.js`,知道每种数据结构长什么样。

---

## 0. 一句话结论

**只改 3 个既有文件,新增 4 个文件。**

| 动作 | 文件 | 量 |
|---|---|---|
| 改 | `js/xiuxian/index.js` | +18 行(装配) |
| 改 | `js/main.js` | +22 行(`startRun` 加参数 + `runend` 桥接) |
| 改 | `js/xiuxian/ui.js` | +60 行(地图渲染 + travel 分支) |
| 改 | `js/xiuxian/world.js` | −14 行(删死代码 `travel()`) |
| 新增 | `world/regions.js` `world/nodes.js` `world/network.js` `world/extraction.js` | 数据为主 |
| 新增 | `world/state.js` | ~120 行,唯一写 localStorage 的地方 |

---

## 1. 存档键

实测全项目 **25 个 `xx_*` 键 + 1 个 `pxs_save` = 26 个**。
新系统**只加 2 个键**,一个都不改旧的。

```
xx_world_v0100    ← 新增:节点运行时状态 + 道路封锁 + 仓库
xx_raid_v0100     ← 新增:进行中的搜打撤(只有 1 个对象,不是数组)
```

### 1.1 为什么状态要拆成两个键

`xx_raid_v0100` 单独拆出来,是因为它的**写入频率和生命周期完全不同**:

- `xx_world_v0100`:慢慢写(占矿、封路、开仓)。丢掉 = 少占一个矿。
- `xx_raid_v0100`:每 tick 都要读(`isExpired` 轮询)。丢掉 = **这一局的物资凭空消失或凭空出现**。

把进行中的出击单塞进大存档里,意味着**每 75 秒就要重写整个世界存档** ——
localStorage 是同步阻塞的,扛不住。

### 1.2 与 `profile.js` 的关系

`profile.js` 已经把 8 个旧键合并进 `xx_profile_v081`(见其 `LEGACY` 表)。
**新键不要加进 `LEGACY`** —— 那张表是「旧 → 新」的迁移源,不是「全部存档清单」。

如果你想要统一的导出/存档面板,把新键加进 `Profile.collect()` 即可:

```js
// js/xiuxian/profile.js:126
collect(mods) {
  // ...现有逻辑...
  // 追加:
  // world: WORLDSTATE.s, raid: EXTRACT.s
}
```

⚠️ 但 `raid` **不能进导出包**。导出的是「一个存档点」,不是「一局的中途」。
带着 `state:'in_run'` 的存档导入回来,玩家会卡在一个不存在的局里。

---

## 2. 装配:index.js

`index.js` 是项目既定的集成层(文件头注释:「局外持久状态的读写、局内↔局外的结算桥接」)。
新模块挂在这里,不新建入口。

```js
// js/xiuxian/index.js —— 文件末尾追加

import { REGIONS, NODE_REGION } from './world/regions.js';
import { NODES, visibleNodes, FEATURE_FLAGS } from './world/nodes.js';
import { bindRegions, activeRoads } from './world/network.js';
import * as WORLDSTATE from './world/state.js';

// 循环依赖破除点:network 需要 NODE_REGION 才能算跨区,
// 而 regions 又不能 import network(会成环)。在这里接上。
bindRegions(NODE_REGION);

export const World = {
  flags: FEATURE_FLAGS,
  regions: REGIONS,
  nodes: visibleNodes(FEATURE_FLAGS),

  /** 赶路:算路线。UI 预览和实际执行走同一个函数,避免两套算法。 */
  plan: (from, to, opts) => planRoute(from, to, opts),

  state: WORLDSTATE,

  init() {
    this.state.load();
    return this;
  },
};
```

### 2.1 装配顺序(有依赖,不能乱)

```
Cult.init()            // 先读修为/境界 —— regionView 的危险度要看境界吗?(v1 不看)
  ↓
World.init()           // 读 xx_world_v0100
  ↓
bindRegions(NODE_REGION)
  ↓
UI 首次 render()
```

**`bindRegions` 必须在任何 `regionAdjacency()` 之前。**
漏了不会崩,只是 `regionAdjacency()` 返回空表 —— 这是个**静默失败**,
所以 `verifyNetwork()` 里有一条断言会告诉你。

---

## 3. 与 world.js 的关系

### 3.1 阶段 0:world.js **一行都不改**

`world.js` 保持原样,新代码只读它。这是「零风险阶段」的含义。

### 3.2 阶段 1:删死代码

```js
// js/xiuxian/world.js:79 —— 全项目零调用点(已核实)
export function travel(fromId, toId) { ... }
// cost 恒为 1,且 ui.js:258 的 travel 分支根本没调它(自己写了 neighbors + 改 current)
```

删掉。同时删 `WORLD.grid`(`=6` 但坐标只到 4,`ui.js:807-813` 早已绕开)。

删完后 `WORLD` 退化为:

```js
export const WORLD = { nodes: MAP, edges: buildEdges() };
```

### 3.3 `neighbors()` 的兼容期

**这是整个迁移里最容易踩的坑。**

`ui.js:260` 现在这样写:

```js
case 'travel': {
  const from = Cult.get().current;
  const path = neighbors(from);              // ← world.js 的 neighbors
  if (!path.includes(v)) { toast('路不通'); return; }
  Cult.get().current = v;
  ...
}
```

新的 `network.js` 也导出 `neighbors()`,形状必须**完全一致**(直接相邻节点 id 数组)。
阶段 2 之前,让 `world.js` 的 `neighbors()` 转发到 `network.js` 的,或者反过来 —— 二选一,别留两份实现。

阶段 2 完成后,`ui.js:258` 改成:

```js
case 'travel': {
  const from = Cult.get().current;
  const plan = planRoute(from, v);           // Dijkstra,不是邻居检查
  if (!plan) { toast('路不通'); return; }
  if (plan.ticks > 1) {                      // 要走好几步 → 弹确认
    showTravelConfirm(plan); return;
  }
  doTravel(plan);                            // 单步直达
  break;
}
```

---

## 4. 与 main.js(砍杀局)的集成

### 4.1 `startRun` 加可选参数 —— 不破坏现有 3 个调用点

现有调用点(已核实):

| 位置 | 调用 |
|---|---|
| `main.js:173` | `onAgain: () => startRun(lastChar)` |
| `main.js:295` | `onPick: (id, unlocked) => ... startRun(id)` |
| `main.js:367` 附近 | `setEndless(engine)` 走的是别的路径 |

**全部是单参数调用。** 所以加一个带默认值的第二参数是安全的:

```js
// 改前
function startRun(charId) { ... }

// 改后
/**
 * @param {string} charId
 * @param {Object} [opts]
 * @param {string} [opts.sceneId]   场景/副本 id
 * @param {number} [opts.dangerMul] 危险系数,接 Director
 * @param {boolean}[opts.fromRaid]  是否由搜打撤发起
 * @param {Object} [opts.onEnd]     (result) => void,搜打撤的结算桥
 */
function startRun(charId, opts = {}) {
```

函数体里**只有一处需要真的改**:

```js
// main.js:308 附近
Director.setMateMods(TAVERN.mods());
// ↓ 追加
if (opts.dangerMul) Director.setDangerMul(opts.dangerMul);
```

其余 15 行(`engine.reset()` / `new Player` / `companion.begin()` …)原样不动。
砍杀局本身完全不知道自己在被搜打撤调用 —— 这是有意的隔离。

### 4.2 `runend` 桥接 —— 搜打撤的结算入口

```js
// 改前(main.js:120)
Bus.on('runend', ({ victory }) => endRun(victory));

// 改后
Bus.on('runend', ({ victory }) => endRun(victory, runOpts));
```

`runOpts` 是 `startRun` 调用时存下的模块级变量(和现有 `lastChar` 同样的做法)。

然后在 `endRun()` **最末尾**加:

```js
// main.js:endRun 内,最后一屏弹出之前
if (runOpts?.fromRaid && raidActive()) {
  const r = victory
    ? EXTRACT.extractSuccess(currentRaid(), Bag.s, { nodeType: curNodeType() })
    : EXTRACT.death(currentRaid(), Bag.s);
  toast(r.msg);
  World.state.saveRaid(null);     // 清掉这局
  runOpts.onEnd?.(r.result);
}
```

### 4.3 ⚠️ 必须抑制的重复结算

**`endRun` 里已经有一整套结算**(`main.js:122-176`):

```js
COMPANION.markRun({...});
Cult.settle({kills, time, ...});   // 修为
SPIRIT.settle(g0(), s);            // 道行 + 源石
Screens.showResult({...});
```

搜打撤模式下,这些**要按 `opts.fromRaid` 全部跳过或改道**,否则会双倍发放:

| 现有结算 | 搜打撤模式下 |
|---|---|
| `Cult.settle()` 修为 | **照发** —— 修为是命脉,死了也得涨,否则不敢出门 |
| `SPIRIT.settle()` 道行/源石 | **跳过** —— 源石在搜打撤里是货物,由 `extraction.js` 管 |
| `COMPANION.markRun()` | **跳过** —— 死亡已经由 extraction 结算了,不能记两次 |
| `Bag.rollStone()` 局内掉落 | **改道进 `raid.looted`**,不进背包 |

第 4 条是最容易漏的:**局内掉落物必须先进 `raid.looted`,不能直接进 `Bag`**。
否则玩家死了,背包里的东西还在 —— 搜打撤就完全失效。

### 4.4 死亡额外损失的钩子

`extraction.js` 死亡结算里有一行 `__mate__` 的假损失占位。具体要接:

- `MOUNT.s` 里当前坐骑 → 掉耐久(项目目前**没有耐久字段**,见 README §6 不要做的清单)
- `TAVERN.mods()` 里在队同伴 → 标记 `absent` 至某日(`COMPANION` 已有「连死 3 次不出场」的先例可抄)

v1 建议**都不接**,先把「secured 全损」这一条做扎实。

---

## 5. 与 duel.js(回合制)的集成

`Duel.start()` 的签名**已经够用,不需要改**:

```js
// js/xiuxian/duel.js:43
Duel.start(cfg)
// cfg = { node, hero, foe, hpRatio, onWin, onLose }
```

`ui.js:576` 已经用它做「地图点 → 回合制」:

```js
Duel.start({
  node: n,                              // 节点对象
  hero: { name, img, realmIdx },
  foe: _foe,
  onWin: (r) => {...},
  onLose: (choice) => this.applyDefeat(choice),
});
```

**新节点类型接进回合制的映射**(在 `ui.js` 的 `arrive()` 里加一段):

```js
// ui.js:574 附近,现有的 elite/secret/boss 分支之前
const m = nodeProp(n, 'entry');          // 读 entry.mode
if (m?.mode === 'duel') {
  const foe = makeFoe(n, s, m.foeKey);   // foeKey 现在从节点数据来,不再硬编码
  return Duel.start({ node: n, hero: heroOf(s), foe,
                      onWin: ..., onLose: ... });
}
```

关键收益:`duel.js:53-56` 现在硬编码了「boss→devil / elite→yao / 其他→wanderer」。
有了 `node.entry.foeKey`,幻境的 `elder`、矿脉守卫的 `guard` 才不用去改 duel.js。

---

## 6. 与 items.js(Bag / DAY)的集成

### 6.1 Bag

`extraction.js` 直接操作 `Bag.s`,因为 `Bag.s` 就是 `{items:{}, demon, charter}`
(见 `items.js:172`),和 `Stash.items` **同构**:

```js
// 搬运不需要转换层
stash.items = { ...bag.items };
```

⚠️ 但 `Bag.s.demon` 和 `charter` 是**随身专属**,不进仓库。
所以搬运要逐字段挑,不能整个 `Object.assign`:

```js
function moveToStash(bag, stash) {
  for (const [k, v] of Object.entries(bag.items || {})) stashPut(stash, k, v);
  bag.items = {};            // 注意:不碰 demon / charter
}
```

### 6.2 DAY(时钟)

赶路的 tick **必须**复用 `DAY.tick()`:

```js
// network.js 的 TICK_MS = 75_000,与 clock.js:29 的 ACTION_MS 同源
// 赶路消耗一个行动点时:
DAY.tick();      // ← 这一下同时推进昼夜 / 年表 / 篝火燃料
```

**不要自己 `setTimeout`。** `clock.js` 的文件头记录了这个项目已经因为
「四套互不相干的计时」付过一次账(见其 V0.99 工单说明)。
再加第五套就是复发。

---

## 7. UI 层(ui.js)

### 7.1 地图渲染:两处硬编码必须挪走

| 位置 | 现状 | 改成 |
|---|---|---|
| `ui.js:834` | `const t = { village:'舍', field:'野', ... }[n.type]` | `nodeGlyph(n)` — glyph 已进 `NODE_TYPES` 数据 |
| `ui.js:809-813` | 手算 `x0/x1/y0/y1` + 硬编码 `86`/`52` | `layout()` 抽成函数,支持区域色块 |

### 7.2 区域着色

```js
// 阶段 1:地图按区域上色
for (const n of visibleNodes(flags)) {
  const rg = REGION_BY_ID.get(n.region);
  const col = rg?.col || NODE_TYPES[n.type].col;
  // 危险度:夜里的区域整体压暗
  const v = regionView(n.region, { isNight: DAY.isNight() });
  ...
}
```

### 7.3 赶路确认弹窗(唯一的新 UI)

```
┌─ 前往「黑风岭」 ────────────┐
│ 官道 → 野路 → 秘径          │
│ 距 32 里 · 耗 6 次行动     │
│ 途中风险:低                │
│         [取消]  [出发]      │
└─────────────────────────────┘
```

**就这一个弹窗。** 赶路的 tick 直接批量推进 + `DAY.tick()` 调 N 次,
不做「点一下走一格」的逐格动画 —— 那是另一个游戏的核心玩法,不是这个的。

---

## 8. 装配清单(照着抄)

```js
// js/xiuxian/index.js
import { REGIONS, NODE_REGION } from './world/regions.js';
import { NODES, visibleNodes, FEATURE_FLAGS } from './world/nodes.js';
import { bindRegions, planRoute } from './world/network.js';
import * as WORLDSTATE from './world/state.js';

bindRegions(NODE_REGION);

// Cult.init() 之后:
export const World = {
  flags: FEATURE_FLAGS, regions: REGIONS, nodes: visibleNodes(FEATURE_FLAGS),
  plan: planRoute, state: WORLDSTATE,
  init() { this.state.load(); return this; },
};
```

```js
// js/main.js —— startRun
function startRun(charId, opts = {}) {
  runOpts = opts;                                  // +1 行
  ...
  if (opts.dangerMul) Director.setDangerMul(opts.dangerMul);   // +1 行
}

// main.js:120
Bus.on('runend', ({ victory }) => endRun(victory, runOpts));
```

```js
// js/xiuxian/ui.js:258
case 'travel': {
  const plan = planRoute(Cult.get().current, v);
  if (!plan) { toast('路不通'); return; }
  plan.ticks > 1 ? showTravelConfirm(plan) : doTravel(plan);
  break;
}
```

---

## 9. 测试挂钩

项目已有 `tests/` 目录。三个校验函数是**专门为 CI 写的**,可直接搬过去:

```js
// tests/map.test.mjs
import { NODES, verifyLegacyIntact } from '../js/xiuxian/world/nodes.js';
import { verifyNetwork } from '../js/xiuxian/world/network.js';
import { verifyRegionCoverage } from '../js/xiuxian/world/regions.js';
import { verifyRaid } from '../js/xiuxian/world/extraction.js';

test('n0-n10 一个都不能少、一个都不能变', () => {
  assert.deepEqual(verifyLegacyIntact().problems, []);
});

test('路网自洽且剧情节点可达', () => {
  const r = verifyNetwork({ nodes: visibleNodes() });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('11 个 legacy 节点全部归入区域', () => {
  assert.equal(verifyRegionCoverage().ok, true);
});

test('搜打撤:成功撤离零损失、死亡必有损失', () => {
  assert.equal(verifyRaid(successRaid).ok, true);
  assert.equal(verifyRaid(deathRaid).ok, true);
});
```

最后一条(死亡必有损失)是**经济护栏**:
一旦有人把赔率改成「死亡也不亏」,这个断言会立刻挂掉。
搜打撤一旦不再让人怕,就不该存在。
