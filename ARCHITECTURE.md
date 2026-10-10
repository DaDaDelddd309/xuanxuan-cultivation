# 架构说明

## 一、为什么要分两层

原版是一个完整的 Canvas 自动战斗游戏(`js/game/` `js/ui/` `js/core/`),约 3 万行。
修仙系统是后来叠加的,**核心约束是不许破坏原版**。

做法:
- 修仙层全部放在 `js/xiuxian/`,自成一个闭环
- 只在 `js/main.js` 末尾挂一个 `bootCult()` IIFE,做初始化和钩子
- 原版模块**一行未改**(唯一例外见下方「官方钩子」)

好处:原版自动战斗的稳定性由 39 项回归测试保证,修仙层随便改。

---

## 二、目录结构

```
rouge-offline/
├── index.html              # 单页,DOM 结构在这里
├── sw.js                   # Service Worker(离线缓存 + 版本管理)
├── manifest.webmanifest    # PWA 清单
├── css/
│   ├── style.css           # 原版样式
│   └── xiuxian.css         # 修仙层样式(作用域前缀 .xx-)
├── js/
│   ├── main.js             # 原版主入口 + 修仙层 bootCult()
│   ├── sprites.js          # 像素图渲染
│   ├── core/               # 引擎、相机、输入、存档、音频
│   ├── game/               # 玩家、地图、敌人、武器、刷怪、Boss、拾取、升级
│   ├── ui/                 # HUD、图鉴、屏幕、摇杆
│   ├── pix/                # 像素图数据(纯数据,无逻辑)
│   └── xiuxian/            # ← 修仙层,39 个模块(2026-10-10 实测)
└── assets/
    ├── portrait/           # 人物立绘(AI 生成)
    ├── mob/                # 通用怪立绘
    ├── legend/             # 传说妖立绘
    ├── bg/                 # 回合制场景背景
    └── bgm/                # ⚠️ 在用,不是弃用目录(2026-10-10 更正)
                           #   回合制专属 BGM: nemesis.mp3 / overlord.mp3(共 780K)
                           #   由 assets.js 加载并按 PRIO 表排队,见本文件第 208 行
                           #   原文这里写「已弃用,改用 WebAudio 合成」是错的。
```

### ⚠️ 本仓库有**两套音频系统并存**,别混为一谈

| 层 | 实现 | 用在哪 | 是否打包音频文件 |
|---|---|---|---|
| 原版/UI 层 | `js/core/audio.js` | 程序化音效、BGM 八步循环 | **否**,全 WebAudio 实时合成 |
| 修仙层 | `assets/bgm/*.mp3` | 回合制专属 BGM(nemesis / overlord) | **是**,780K mp3 |

所以「音效是 WebAudio 合成」这句话对**音效**成立,
但推不出「项目不打包任何音频文件」—— 回合制那两首是真实文件。

> 照着旧注释去清理 `assets/bgm/` 会直接打断回合制 BGM。
```

---

## 三、修仙层模块依赖图

```
                    ┌─────────────┐
                    │   index.js  │  集成层:对外唯一出口
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
     │ realms.js │   │  arts.js  │   │  world.js │  ← 纯数据+纯函数
     │ 境界/丹药 │   │ 神通/悟道 │   │  地图     │
     └───────────┘   └───────────┘   └───────────┘

     ┌───────────┐   ┌───────────┐   ┌───────────┐
     │ battle.js │   │ items.js  │   │ lore.js   │
     │ 回合制逻辑│   │ 道具/昼夜 │   │ 世界观文本│
     └───────────┘   └─────┬─────┘   └───────────┘
                           │
    ┌──────────┬───────────┼───────────┬──────────┐
    │          │           │           │          │
┌───▼───┐ ┌────▼────┐ ┌────▼────┐ ┌────▼────┐ ┌───▼────┐
│camp.js│ │family.js│ │build.js │ │merchant │ │story.js│
│篝火   │ │ 家族    │ │ 领地建造│ │ 流浪商人│ │ 叙事   │
└───┬───┘ └─────────┘ └─────────┘ └─────────┘ └───┬────┘
    │                                             │
┌───▼──────┐  ┌──────────┐  ┌──────────┐   ┌────▼─────┐
│companion │  │duel.js   │  │ritual.js │   │legend.js │
│灵伴/怨灵 │  │回合制UI  │  │ 开局仪式 │   │ 传说妖谱 │
└────┬─────┘  └──────────┘  └──────────┘   └──────────┘
     │
┌────▼─────┐  ┌──────────┐  ┌───────────┐
│ bond.js  │  │ambience  │  │ profile.js│
│ 贴边/闪屏│  │ 昼夜氛围 │  │ 存档+种子 │
└──────────┘  └──────────┘  └───────────┘
```

**依赖原则**:底层(数据)不知道上层(UI),上层可以随意换 UI 实现。
`index.js` 是唯一被 `main.js` 依赖的修仙模块。

---

## 四、数据流

### 局内 → 局外(结算)
```
原版 run 结束
  → main.js 监听 runend
  → Cult.settle({kills, time, realmLayer})
      修为、道行、击杀数写入 Cult.s
      → Cult.commit() → localStorage
      → DAY.tick() 推进昼夜
      → 可能触发 CHRONICLE.year() 年度事件
```

### 局外 → 局内(带入)
```
修仙阁「砍杀」→ 原版菜单 → 开始游戏
  → Cult.get() 读境界
  → 修仙层钩子给敌人加倍率(怨灵/昼夜)
  → 局内正常跑
```

### 叙事推进
```
玩家在地图点节点
  → Hall.arrive(nodeId)
      → STORY.arrive(nodeId) 检查有没有线该露头
          → 返回 beats[] → 弹叙事卡 → STORY.s.beat[arc]++
      → 首次到达 → 弹传说妖卡 → STORY.see(key)
      → village → 休息 / field → 自动遭遇 / elite·secret·boss → 回合制
```

---

## 五、存档结构

`profile.js` 管理。**单一键 `xx_profile_v081`**,但为了不侵入各模块,`flush()` 会同时写回各模块的老键(各模块仍按自己接口读)。

```
xx_profile_v081 = {
  v, seed, savedAt,
  cult:      { realm, layer, exp, pills, dao, totalKills, artifacts, arts, current, visited }
  nemesis:   { met, battles, wins, grudge }
  titles:    { flags, active }
  bag:       { items, demon, charter }
  camp:      { lit, nodeId, fuelEnd, totalSec, members, warden }
  day:       { actions }
  merch:     { visits, lastAt }
  companion: { born, name, route, aff, pick, ghost, warden }
}
```

**世界种子**:所有"随机"应该走 `Seed.next()`,不是 `Math.random()`。
同种子 = 同一世界(奇遇、掉落、商人、怨灵、营地来客全一致)。
存档只存种子 + 进度,所以很省。

---

## 六、扩展指南

### 加一个新神通
1. 在 `arts.js` 的 `ARTS` 里加一条
2. (可选) 在 `RECIPES` 里加融合配方
3. 完事。战斗 UI 自动读取,不需要改 `duel.js`

### 加一只新怪
1. `bestiary.js` 的 `BESTIARY` 加一条(含 `img` / `drops`)
2. 如果有来历和故事,在 `legend.js` 加
3. 完事。图鉴自动收录

### 加一条新建筑
1. `bestiary.js` 的 `BUILDINGS` 加一条,**必须带 `eff` 对象**(否则是纯摆设)
2. 如果产东西,在 `BUILD.tickAll()` 里加结算
3. 在 `items.js` 的 `registerBuildings` 自动生效(整表注册的)

### 加一条新叙事线
1. `story.js` 的 `ARCS` 加一条,`beats` 至少 4 环
2. 每环必须有 `node`(锚定地图节点)、`text`、`rumor`、`reveal`
3. 最后一环必须有 `epilogue` 和 `epilogue2`(**两个不同**)
4. `mob` 字段指向一只 legend 里的妖

---

## 七、官方钩子(对原版的唯一改动)

`js/game/enemies.js` 里加了:

```js
export const ENEMY_MOD = { hp: 1, dmg: 1, spd: 1 };
export function setEnemyMod(m) { ... }
```

`spawnEnemy` 内部读取 `ENEMY_MOD` 叠加到传入参数。

**为什么不用 monkey-patch**:
```js
Enemies.spawnEnemy = function(...) {...}   // ❌ 报错
// TypeError: Cannot assign to property 'spawnEnemy' of [object Module]
```
ES module 的导出是**只读绑定**,不能赋值。必须从源头加钩子。

同理 `js/game/pickups.js` 的拾取由 `main.js` 里独立循环处理(灵伴自动拾取),不改原文件。

---

## 八、渲染方式

原版用 **Canvas 2D**,修仙层用 **DOM**。

两者叠在同一坐标系:
- `.xx-screen` / `.xx-duel` 等用 `position:absolute; inset:0`
- z-index 分层:原版 canvas 在底层,修仙层依次 60/70/72/74/76/80/85/88/200
- 打开修仙层时原版 canvas 仍在跑(不暂停),符合"不打断"设计

**不要**把修仙 UI 画进 canvas——会和原版渲染循环打架。

---

## 九、音频

| 用途 | 实现 |
|---|---|
| 原版音效 | `core/audio.js`(原版自带) |
| 回合制 BGM | `assets.js` → `assets/bgm/*.mp3`(AI 生成的原创曲) |
| 昼夜氛围 | `ambience.js` **WebAudio 实时合成**(布朗噪声风 + 振荡器) |
| 转场钟磬 | `ambience.js` `phaseChime()` |

**新增音频一律用 WebAudio 合成,不要打包外部音频文件。**

---

## 十、验证方法

```bash
# 0) 一次性跑全套(推荐,别逐个手敲)
bash tests/run-all.sh      # 逻辑测试 + e2e + 20 个 lint,任一失败即退出非 0
bash tests/run-browser.sh  # 浏览器回归(需要 playwright,见下)

# 1) 逻辑测试(不需要浏览器)
#    注意:目录是 tests/ 不是 scripts/;t80–t83 是 .js 不是 .mjs
node tests/t80.js   # 源石/篝火/道具/昼夜
node tests/t81.js   # 灵伴/怨灵/篝火护栏
node tests/t82.js   # 仪式/家族/存档种子/万年历
node tests/t83.js   # 领地建造/NPC 图鉴
node tests/t84.mjs   # 么么茶/掉落/护栏
node tests/t85.mjs   # 灵米闭环/建筑效果/契约
node tests/t86.mjs   # 传说妖/叙事/昼夜

# 2) 浏览器回归(移动端视口 412x915)
python3 tests/full79.py   # 全量
python3 tests/t86.py      # 叙事专项

# 3) import 符号校验(防「导入了不存在的导出」)
见 AGENTS.md
```

**每次改动后至少跑一遍 t80-t86 + 对应的浏览器测试。**
### `js/xiuxian/tomb.js`(V0.89 新增)
仙人墓独立地下层。`ROOMS` 是纯数据,`TOMB` 是状态机。
与 `story.js` 的关系:墓里 `settle('sj')` 触发叙事线最后一环,`finish(path)` 回写结局。
与 `quest.js` 的关系:支线「半句话」靠 `TOMB.s.done` 判定完成。无循环依赖(quest → tomb 单向)。

### `js/xiuxian/mount.js`(V0.91 新增)
坐骑与随行。纯数据(`MOUNTS`)+ 状态(`MOUNT`)。
接入点:`BUILD.ward()` / `COMPANION.wardRadius()` 加护栏;`main.js` 局内开局把
拾取/移速/攻击落到 `player.stats`。解锁靠 `checkUnlocks()` 查剧情状态。
依赖方向 mount → story/tomb/quest(单向,无环)。
