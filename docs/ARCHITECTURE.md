# 功能架构总纲

> 本文件由 `tools/arch/extract.py` 从代码生成，**不要手改**。
> 判定依据是调用点数与符号存在性，不是人工描述。

图例：`vertical` 端到端 · `broken` 断在某节 · `decoration` 纯摆设

## 统计

- vertical **26** / broken **0** / decoration **1**
- 合计 **27** 条功能

## 功能树

### ⚔ 局内  (2)

```
局内
├─ [✓] F-SPIRIT-001     灵气(局内)
│     链路: install → tick → settle
├─ [✗] F-TURN-001       回合制战斗
│     链路: enterTurnBased → carryOver
```

### 🏯 修仙阁  (17)

```
修仙阁
├─ [✓] F-CAMP-001       篝火
│     链路: settle → light → feed → CAMP.burning
├─ [✓] F-BAG-001        行囊
│     链路: add → take
├─ [✓] F-REALM-001      境界/修为
│     链路: meditate → addExp → canBreakthrough → doBreakthrough
├─ [✓] F-PILL-001       丹药
│     链路: PILLS → mk-buy
├─ [✓] F-MARKET-001     集市
│     链路: buy → sellStone
├─ [✓] F-CRAFT-001      合成
│     链路: can → do
├─ [✓] F-ART-001        功法/神通
│     链路: rollChoices → applyChoice → Cult.syncArt → enlighten
├─ [✓] F-STAR-001       神通升星
│     链路: star → up
├─ [✓] F-TAVERN-001     酒馆招揽
│     链路: recruit → TAVERN.mods
├─ [✓] F-BUILD-001      领地
│     链路: replant → harvest
├─ [✓] F-FAM-001        家族
│     链路: found → addMember
├─ [✓] F-MOUNT-001      坐骑
│     链路: eff → MOUNT.eff
├─ [✓] F-COMP-001       灵伴
│     链路: beginRun → say → endRun
├─ [✓] F-TITLE-001      称号
│     链路: track → check → add
├─ [✓] F-WORLD-001      大地图
│     链路: travel → neighbors
├─ [✓] F-MINIMAP-001    小地图
│     链路: pathTo
├─ [✓] F-SUPER-001      超级神通
│     链路: SUPER_ARTS → findRecipe
```

### 📜 叙事  (7)

```
叙事
├─ [✓] F-QUEST-001      支线
│     链路: qtake → qdone
├─ [✓] F-SPINE-001      主线脉络
│     链路: observeLegend → observeQuest → phase
├─ [✓] F-STORY-001      秘境叙事
│     链路: readyList → sfinal
├─ [✓] F-DEX-001        怪物图鉴
│     链路: mark → has → renderList → renderInfo
├─ [✓] F-NEMESIS-001    宿敌
│     链路: Nemesis
├─ [✓] F-TOMB-001       墓
│     链路: enter → tomb-enter
├─ [✓] F-DUEL-001       回合制战役
│     链路: travel
```

### 🔧 基础设施  (1)

```
基础设施
├─ [✓] F-HASH-001       空间哈希
│     链路: SpatialHash
```

## 明细

### F-SPIRIT-001 · 灵气(局内) — `vertical`

- 层：局内　界面：HUD 顶部「灵」　工单：—
- 备注：砍杀唯一的产出通道，局末折道行+源石
- 模块外部调用点：spirit.js×5
- 链路：js/xiuxian/spirit.js:install → js/xiuxian/spirit.js:tick → js/xiuxian/spirit.js:settle

### F-CAMP-001 · 篝火 — `vertical`

- 层：修仙阁　界面：页签:营地 (light/feed)　工单：—
- 备注：源石是燃料，会被 Bag.take 消耗
- 模块外部调用点：camp.js×38
- 链路：js/xiuxian/spirit.js:settle → js/xiuxian/camp.js:light → js/xiuxian/camp.js:feed → js/main.js:CAMP.burning

### F-BAG-001 · 行囊 — `vertical`

- 层：修仙阁　界面：页签:行囊　工单：—
- 备注：所有物品的存取中枢
- 模块外部调用点：items.js×128
- 链路：js/xiuxian/items.js:add → js/xiuxian/items.js:take

### F-REALM-001 · 境界/修为 — `vertical`

- 层：修仙阁　界面：页签:境界 (meditate/break)　工单：—
- 备注：XX-FIX-017 修过：道行曾被门在跨年分支里
- 模块外部调用点：realms.js×28
- 链路：js/xiuxian/ui.js#act:meditate → js/xiuxian/realms.js:addExp → js/xiuxian/realms.js:canBreakthrough → js/xiuxian/realms.js:doBreakthrough

### F-PILL-001 · 丹药 — `vertical`

- 层：修仙阁　界面：页签:境界 (buy)　工单：—
- 备注：突破高境界的硬门槛，靠集市买
- 模块外部调用点：realms.js×28
- 链路：js/xiuxian/realms.js:PILLS → js/xiuxian/ui.js#act:mk-buy

### F-MARKET-001 · 集市 — `vertical`

- 层：修仙阁　界面：页签:集市 (mk-buy/mk-refresh)　工单：—
- 备注：货币是金币，只来自局内结算
- 模块外部调用点：market.js×10
- 链路：js/xiuxian/market.js:buy → js/xiuxian/market.js:sellStone

### F-CRAFT-001 · 合成 — `vertical`

- 层：修仙阁　界面：页签:集市 (craft-do)　工单：—
- 备注：XX-FIX-018 修过：缺料文案曾甩内部 id
- 模块外部调用点：craft.js×3
- 链路：js/xiuxian/craft.js:can → js/xiuxian/craft.js:do

### F-ART-001 · 功法/神通 — `vertical`

- 层：修仙阁　界面：页签:神通 (enlighten)　工单：—
- 备注：✅ XX-ARCH-006 已修(owner 选 A):局内升级池参悟神通 + 局末 syncArt 回写。实测 局内 guanglei:3 → 局末修仙阁 {jianqi:1, guanglei:3}。闸门 tests/lint-arts.mjs
- 模块外部调用点：arts.js×19
- 链路：js/game/upgrades.js:rollChoices → js/game/upgrades.js:applyChoice → js/main.js:Cult.syncArt → js/xiuxian/arts.js:enlighten

### F-STAR-001 · 神通升星 — `vertical`

- 层：修仙阁　界面：页签:神通 (art-star)　工单：—
- 备注：升星材料是传承书,来源为境界页溢出转化 —— 这条已确认可达
- 模块外部调用点：artstar.js×4
- 链路：js/xiuxian/artstar.js:star → js/xiuxian/artstar.js:up

### F-TAVERN-001 · 酒馆招揽 — `vertical`

- 层：修仙阁　界面：页签:集市 (mk-recruit)　工单：—
- 备注：同伴改规则，不只是加数值
- 模块外部调用点：tavern.js×13
- 链路：js/xiuxian/tavern.js:recruit → js/main.js:TAVERN.mods

### F-BUILD-001 · 领地 — `vertical`

- 层：修仙阁　界面：页签:领地 (plant/harvest/mine)　工单：—
- 备注：灵米种植→收获→出售/食用
- 模块外部调用点：build.js×42
- 链路：js/xiuxian/build.js:replant → js/xiuxian/build.js:harvest

### F-FAM-001 · 家族 — `vertical`

- 层：修仙阁　界面：页签:家族 (found/call/birth)　工单：—
- 备注：族人产出、结亲、传承
- 模块外部调用点：family.js×19
- 链路：js/xiuxian/family.js:found → js/xiuxian/family.js:addMember

### F-MOUNT-001 · 坐骑 — `vertical`

- 层：修仙阁　界面：页签:大地图　工单：—
- 备注：局内护栏加成
- 模块外部调用点：mount.js×17
- 链路：js/xiuxian/mount.js:eff → js/main.js:MOUNT.eff

### F-COMP-001 · 灵伴 — `vertical`

- 层：修仙阁　界面：局内跟随 + 气泡台词　工单：—
- 备注：台词受每局 ≤2 句预算约束
- 模块外部调用点：companion.js×32
- 链路：js/xiuxian/companion.js:beginRun → js/xiuxian/companion.js:say → js/main.js:endRun

### F-QUEST-001 · 支线 — `vertical`

- 层：叙事　界面：页签:支线 (qtake/qdone)　工单：XX-ARCH-003
- 备注：✅ XX-ARCH-003 实测通过:travel→STORY.see→met→autoTake 全通。注意验前必须先推进存档
- 模块外部调用点：quest.js×17
- 链路：js/xiuxian/ui.js#act:qtake → js/xiuxian/ui.js#act:qdone

### F-SPINE-001 · 主线脉络 — `vertical`

- 层：叙事　界面：页签:支线 (同步)　工单：XX-ARCH-004
- 备注：支线实测时同步推进过 arc;主线的 phase 单独验过没有
- 模块外部调用点：spine.js×6
- 链路：js/xiuxian/spine.js:observeLegend → js/xiuxian/spine.js:observeQuest → js/xiuxian/spine.js:phase

### F-STORY-001 · 秘境叙事 — `vertical`

- 层：叙事　界面：页签:支线 (sfinal)　工单：—
- 备注：看完后的抉择
- 模块外部调用点：story.js×39
- 链路：js/xiuxian/story.js:readyList → js/xiuxian/ui.js#act:sfinal

### F-DEX-001 · 怪物图鉴 — `vertical`

- 层：叙事　界面：页签:图鉴　工单：XX-ARCH-007
- 备注：✅ 已接收集感:enemy-death → mark → 未见剪影+引子,见过给背景故事/来历/要害/见了几只
- 模块外部调用点：bestiary.js×34, codex.js×9
- 链路：js/xiuxian/codex.js:mark → js/xiuxian/codex.js:has → js/ui/bestiary.js:renderList → js/ui/bestiary.js:renderInfo

### F-TITLE-001 · 称号 — `vertical`

- 层：修仙阁　界面：页签:称号 (0 可点)　工单：XX-ARCH-006
- 备注：⚠️ 授予链完好,但 4/8 条件 flag 无数据源
- 模块外部调用点：relations.js×14
- 链路：js/xiuxian/relations.js:track → js/xiuxian/relations.js:check → js/xiuxian/relations.js:add

### F-NEMESIS-001 · 宿敌 — `vertical`

- 层：叙事　界面：?　工单：—
- 备注：待查:是否有 UI 入口
- 模块外部调用点：relations.js×14
- 链路：js/xiuxian/relations.js:Nemesis

### F-TOMB-001 · 墓 — `vertical`

- 层：叙事　界面：页签:大地图　工单：—
- 备注：待查:进入条件
- 模块外部调用点：tomb.js×13
- 链路：js/xiuxian/tomb.js:enter → js/xiuxian/ui.js#act:tomb-enter

### F-WORLD-001 · 大地图 — `vertical`

- 层：修仙阁　界面：页签:大地图 (travel/mine)　工单：—
- 备注：✅ XX-ARCH-008 已接:pathBetween(BFS)做悬停最短路高亮 + 节点副标题(回合制/丹药/宿敌)。实测 悬停n8 亮起 n0→n1→n2→n4→n5→n8
- 模块外部调用点：world.js×5
- 链路：js/xiuxian/ui.js#act:travel → js/xiuxian/world.js:neighbors

### F-MINIMAP-001 · 小地图 — `vertical`

- 层：修仙阁　界面：无　工单：XX-ARCH-008
- 备注：✅ 已接:悬停点亮最短路
- 模块外部调用点：world.js×5
- 链路：js/xiuxian/ui.js:pathTo

### F-DUEL-001 · 回合制战役 — `vertical`

- 层：叙事　界面：无　工单：XX-ARCH-009
- 备注：⚠️ 更正:实为**已接线** —— 大地图走到险地/秘境/妖巢即 Duel.start()。零调用的是 battle.js 的 enterTurnBased(局内砍杀不转回合制)
- 模块外部调用点：duel.js×1
- 链路：js/xiuxian/ui.js#act:travel

### F-TURN-001 · 回合制战斗 — `decoration`

> enterTurnBased 0 调用

- 层：局内　界面：无　工单：XX-ARCH-009
- 备注：🔴 enterTurnBased 0 调用
- 模块外部调用点：battle.js×6
- 链路：js/xiuxian/battle.js:enterTurnBased → js/xiuxian/battle.js:carryOver

### F-SUPER-001 · 超级神通 — `vertical`

- 层：修仙阁　界面：无　工单：XX-ARCH-010
- 备注：✅ XX-ARCH-010 实测通过:10 个配方,悟道实测产出「万剑归宗」。knip 报的 0 调用是**外部**没人 import,模块内部在用 —— 又一次误判
- 模块外部调用点：arts.js×19
- 链路：js/xiuxian/arts.js:SUPER_ARTS → js/xiuxian/arts.js:findRecipe

### F-HASH-001 · 空间哈希 — `vertical`

- 层：基础设施　界面：无　工单：XX-ARCH-011
- 备注：⚠️ 不接(实测):正常对局 69 敌人 60 FPS;247 压满才掉到 7(且是慢容器)。这是性能优化不是补功能,应在真机量到掉帧再做,不该拿不可靠读数改碰撞逻辑
- 模块外部调用点：engine.js×37
- 链路：js/core/engine.js:SpatialHash
