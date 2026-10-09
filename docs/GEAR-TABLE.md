# 装备权威对照表 · 工单 XX-EQUIP-001

> 建表 2026-10-10。本文件是「哪只妖 → 哪张立绘 → 掉哪件装备」的唯一真源。
> **门禁**：`tests/lint-gear-table.mjs` 会拿这张表去核对真实代码，改错了会红。

---

## 〇、为什么必须先有这张表（不是形式主义）

`JOINT-DEV-PLAN.md` §0.2 记的那个风险是实在的：**方案里把三批不相干的东西混着用了**。
施工前不先定表，8 件装备会挂在不存在的敌人上，而且**测试会全绿** ——
因为没有任何一条断言检查「这件装备的掉落妖到底存不存在」。

本表落地时已实测核对三批 key，结论：**三批完全不相交，一处重合都没有**。

---

## 一、三批 key 的实测边界

这是全表的地基。三批各有各的立绘目录和出场场景，**不可混用**。

| 批次 | key 数 | 立绘目录 | 出场 | 数据源 |
|---|---|---|---|---|
| **A · 图鉴妖** | 8 | `assets/mob/`（5 个文件） | 砍杀局野外/精英/妖王 | `js/xiuxian/bestiary.js` |
| **B · 传说妖** | 8 | `assets/legend/`（8 个文件） | 支线结案，**不掉落** | `js/xiuxian/legend.js` |
| **C · 反派立绘** | 6 | `assets/portrait/villain-*.jpg` | 回合制对决（剧情） | `js/xiuxian/ui/portrait.js` |

### 批次 A：图鉴 8 妖（`BESTIARY`）

| key | 名 | 境界 | 立绘文件 |
|---|---|---|---|
| `wanderer` | 游荡散修 | 炼气 | `assets/mob/ghostfire.jpg` |
| `guard` | 山门执事 | 炼气 | `assets/mob/golem.jpg` |
| `yao` | 青岚妖王 | 筑基 | `assets/mob/ninehead.jpg` |
| `elder` | 青云长老 | 筑基 | `assets/mob/revenant.jpg` |
| `devil` | 黑风魔修 | 金丹 | `assets/mob/bloodriver.jpg` |
| `golem` | 炼骨傀 | 金丹 | `assets/mob/golem.jpg` ⚠️ 与 `guard` 共用 |
| `revenant` | 血河老祖 | 元婴 | `assets/mob/revenant.jpg` ⚠️ 与 `elder` 共用 |
| `ninehead` | 九幽妖尊 | 化神 | `assets/mob/ninehead.jpg` ⚠️ 与 `yao` 共用 |

> ⚠️ **立绘复用比预想严重：8 只妖只有 5 张图，`yao`/`elder`/`golem` 都与别妖撞图。**
> 这不是 bug（现有风格如此），但**做装备时不能假设「一妖一图」** ——
> 玩家在图鉴里看到青岚妖王和九幽妖尊是同一张脸时，会不会觉得装备挂错了妖，
> 是个需要先想清楚的问题，不是美术问题。
>
> 📌 数值（hp/dmg/drops 等）以 `js/xiuxian/bestiary.js` 为准，本表不复制 ——
> 数值会变，对应关系不变。

### 批次 B：传说 8 妖（`legend.js`）

| key | 名 | 立绘文件 |
|---|---|---|
| `hongyi` | 红衣女鬼 | `assets/legend/hongyi.jpg` |
| `laolao` | 黑山姥姥 | `assets/legend/laolao.jpg` |
| `baize` | — | `assets/legend/baize.jpg` |
| `dangkang` | — | `assets/legend/dangkang.jpg` |
| `qingqiong` | — | `assets/legend/qingqiong.jpg` |
| `jiangu` | — | `assets/legend/jiangu.jpg` |
| `shijiang` | — | `assets/legend/shijiang.jpg` |
| `dengshi` | — | `assets/legend/dengshi.jpg` |

- 出场：支线结案，`reward` 给道行 / 传承书。
- **现状：8 只在砍杀局里 0 掉落** —— 这正是装备系统要挂上去的地方。
- ⚠️ 路径笔误已修：提案 `equipment.js` 原写 `assets/portrait/legend/`，
  文件实际在 `assets/legend/`（13 处，已在本轮合并中改正，lint 现在盯着）。

### 批次 C：反派 6 立绘（`PORTRAIT`）

`heifeng` `shougu` `youfang` `shemie` `nvxia` `yaohou`

- 立绘：`assets/portrait/villain-*.jpg`（注意 `shemie` → 文件名是 `villain-shexie.jpg`）。
- 出场：回合制对决 `makeFoe()` 的专属 key。
- 数据侧：敌人元组第 6 位（`ui.js:712` 附近的 `foes` 数组）。

---

## 二、装备挂载位（待 XX-EQUIP-002 填词条）

> **本节在 XX-EQUIP-002 完成前保持为空**。空着是有意的 ——
> 先把「谁掉什么」定死，再填「掉了有什么用」。
> 反过来做就会出现「词条写完了才发现没有怪能掉它」。

| 装备 | 槽位 | 掉落来源（批次+key） | 机制一句话 | 状态 |
|---|---|---|---|---|
| — | — | — | — | ⬜ 待 XX-EQUIP-002 |

---

## 三、施工前必须先回答的三个问题

1. **装备只从哪一批掉？**
   提案写的是「红衣女鬼爆肚兜」→ 那是**批次 B（传说妖）**。
   但 B 批现在只在支线结案出现，**不进砍杀局** ——
   那装备就是纯支线奖励，不会被刷。这一条要先定，因为它决定稀有度会不会崩。

2. **批次 A 的妖要不要也能掉？**
   A 批 8 只每天刷得到，是砍杀局主力。若 A 批也能掉，稀有度必须另算，
   否则 `JOINT-DEV-PLAN` 线 A 的硬约束 1（绝不进普通池）就守不住。

3. **槽位 4 个，装备 8 件 —— 玩家必然做选择，那 4 件「不好」的怎么保住？**
   对策已定：**强化不降级、不做耐久、不做套装**（线 A 硬约束 3）。
   即每件装备在任何强化等级都不会变成垃圾，玩家只会在「装哪四件」上纠结。

---

## 四、门禁

```
node tests/lint-gear-table.mjs
```

它检查三件事，**任何一件不过就非零退出**：

1. 本表里出现的每个 `foeKey`，在真实数据源（`bestiary.js` / `legend.js`）里**真实存在**。
2. 本表引用的每个立绘文件**磁盘上真实存在**。
3. 三批 key 之间**没有误用**（例如拿 `heifeng` 当图鉴妖用）。

**它查什么、不查什么**（照 AGENTS.md §0A 三问）：

| | |
|---|---|
| ✅ 查 | 掉落来源的 key 是不是真的存在 —— 这正是旧方案会让装备挂在空气上的地方 |
| ✅ 查 | 立绘路径拼写对不对 —— 已真咬过一次（`assets/portrait/legend/` 笔误 13 处） |
| ❌ 不查 | 数值平衡（那是 XX-EQUIP-002 `gear-regression` 的事） |
| ❌ 不查 | 装备在战斗里生效（那是 XX-EQUIP-004 桌面侧的事，且必须反向验证） |
