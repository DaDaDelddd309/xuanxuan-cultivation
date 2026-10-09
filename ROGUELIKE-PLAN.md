# 轩轩修仙传 · 肉鸽化改造方案

> 调研日期：2026-10-08
> 决策：**不引入新框架，只摘取 rot.js 的 RNG 模块**
> 依据：业界 procgen 共识 + 现有代码实测

---

## 一、调研结论：业界怎么做（不是拍脑袋）

### 1.1 行业共识（多方来源一致）

| 共识 | 出处 |
|---|---|
| **绝不用全局随机，必须用带种子的独立 RNG 实例** | procedural-gen skill、Defold 实践、GD-Agentic |
| **种子要分层派生子种子**（地形/物品各一条流） | lillytechsystems：改物品种子不该影响地形生成 |
| **生成后必须校验连通性**，失败则重生成 | 全来源一致：flood-fill from spawn |
| **手工骨架 + 程序化填充** 是最佳组合 | Spelunky 模式，明确被点名为"produces the best results" |
| **必须有 pity/保底机制** 防坏手气 | weighted table 单独用会出 unfair streaks |
| **种子要显示给玩家**以便分享 | Minecraft 模式 |

> 原文关键句（Spelunky 模式）：
> *"Mix handcrafted and procedural: The Spelunky approach — hand-designed
> room templates assembled procedurally — often produces the best results."*

### 1.2 rot.js 评估

| 项 | 结论 |
|---|---|
| 许可证 | **BSD-3-Clause**，可商用可改 |
| 社区 | 2.7k stars，267 forks，持续维护 |
| 成熟度 | 自述 feature-complete，v2.2.1 |
| 依赖 | **零依赖**，纯 ES 模块，`lib/` 有预编译产物 |

**关键能力：**
- `RNG` 4 种实现（Simple / Rotated / Passes / Xoroshiro128）
- `getState()` / `setState()` / `clone()` — **RNG 状态可序列化**
- `getWeightedValue()` — 加权抽取，直接对应我们的类型分布
- 地图生成器：digger / cellular / uniform / dividedmaze / ellermaze

### 1.3 为什么**不**整体引入 rot.js

| 理由 | 说明 |
|---|---|
| **架构冲突** | rot.js 是 ASCII 网格 + 回合制；轩轩是**节点图 + 实时动作** |
| **用不上 80%** | Display / FOV / Path / Scheduler / Lighting 我们都不用 |
| **渲染层完全不同** | 我们是 DOM/CSS 插画风，不是 ASCII 终端 |
| **引入成本** | 要改造整个渲染管线 |

**只摘 `rng.js` 一个文件（约 4KB），零耦合。**

---

## 二、决策：采纳什么

### 2.1 采纳

**rot.js `RNG` 模块**——因为它解决的是我们最难自己写对的部分：
1. 状态可序列化（存档只需存 seed + state，不用存整个世界）
2. `clone()` 支持**多子流并行**（地形/村庄/敌人各一条，互不干扰）
3. `getWeightedValue()` 已经是正确的加权实现
4. BSD 许可，无污染风险

### 2.2 不采纳

- 不引入 Display / FOV / Path / Scheduler（架构不匹配）
- 不重写成 ASCII 网格（那会毁掉美术方向）
- 不用 rot.js 的地图生成器（我们生成的是**节点图**不是地牢）

### 2.3 自己写的部分

节点图生成是这个游戏的特色，rot.js 没有对应物，必须自研——但**用 rot.js 的 RNG 作为随机源**，保证确定性和可测试性。

---

## 三、架构：固定骨架 + 种子填充（Spelunky 模式）

### 3.1 为什么不是"完全随机"

| 问题 | 完全随机 | 固定骨架+填充 |
|---|---|---|
| 剧情线锚点 | 无处安放（宝宝、宗门剧情绑世界） | 锚点固定 |
| 生成翻车 | 资源点走不到 | 约束保证 |
| 平衡 | 难度不可控 | 分布可控 |
| 可测试 | 难 | 种子固定即可复现 |

### 3.2 分层种子（借鉴业界）

```
masterSeed (玩家可见，可分享)
  ├─ terrainSeed   → 节点位置、数量
  ├─ villageSeed   → 村庄分布与命名
  ├─ lootSeed      → 资源/矿脉分布
  └─ eventSeed     → 随机事件
```

改 loot 种子不影响地形——这是 lillytechsystems 明确建议的做法。

### 3.3 生成约束（保证每局可玩）

1. 青石村固定为起点（`home:true`），不可移动
2. 每个节点至少 1 条边（flood-fill 校验）
3. 秘境距起点 ≤ 4 步（不至于太远拿不到）
4. Boss 不生成在死角（度数 = 1 的节点）
5. 村庄数量 2-3、秘境 2-4、野地 5-8（保证资源密度）

---

## 四、落地清单

| 步骤 | 文件 | 内容 |
|---|---|---|
| 1 | `js/xiuxian/vendor/rot-rng.js` | 从 rot.js 摘 RNG（含 BSD 许可声明） |
| 2 | `js/xiuxian/seed.js` | 分层种子管理 + 存档序列化 |
| 3 | `js/xiuxian/worldgen.js` | 节点图生成 + 约束校验 + flood-fill |
| 4 | `js/xiuxian/world.js` | 改为调用 worldgen，保留 `WORLD` 接口不破坏现有调用方 |
| 5 | `tests/test-worldgen.mjs` | 批量种子回归测试（1000 个种子必须全连通） |

---

## 五、测试策略（业界标准做法）

> *"Run your generator thousands of times with different seeds."*

- **回归测试**：1000 个随机种子 → 断言全部连通、约束全部满足
- **黄金种子**：固定几个种子存基准输出
- **性能**：生成耗时 < 50ms（节点图很小，不需 Worker）

---

## 六、还查出来的问题（本次一并处理）

| 问题 | 现状 | 决定 |
|---|---|---|
| 种子是死的 | 只存不用 | **步骤 2 修复** |
| 地图硬编码 11 点 | 手工 | **步骤 3 修复** |
| 矿脉不存在 | 只有注释 | 随 worldgen 一起加 |
| 篝火 | **真实**（有逻辑链） | 保留不动 |
| NPC | 只 2 个 | 后续随 villageSeed 分布 |
| 插画接线 | 按页签 id 硬映射 | **改为按地点类型绑定** |

---

## 七、不做的事

明确不做，避免又变成简单 1+1：

- ❌ 不重写整个地图渲染 UI
- ❌ 不引入 rot.js 的 ASCII 渲染
- ❌ 不做完整 ECS 重构（现有架构能用）
- ❌ 不在这一轮做双结局/奴棣剧情线（先把地基打对）