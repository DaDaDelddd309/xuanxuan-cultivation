# 死成员门禁 · 首次普查的分类结论（2026-10-12）

`tests/lint-dead-member.mjs` 首次普查：107 个产品文件 / 152 个导出对象或表 / 1340 个成员，
判死 174 条（产品与测试都零读 103 · 只有测试在读 71）。

`tests/dead-member-baseline.json` 里的 174 条**逐条未复核**（`reviewed:false`）——
它的作用是让**新增**的可见，不是给存量的免责声明。

本文件只记**已逐条查过**的那两条。

---

## 1. `COMPANION.form()` —— 真结论：产品零读

- 声明：`js/xiuxian/companion.js:119`，一行转发 `return MUTATION.derive(this.s.mut)`
- 全仓读点：只有 `tests/mutation-regression.mjs`
- 连带：`MUTATION.derive()` 的**唯一**产品调用方就是 `form()`，
  于是 `EAR_TABLE / EYE_TABLE / SKIN_TABLE / RATIO_BY_STAGE` 这些量化表在产品里也一起悬空
- 为什么不删：mutation.js 开头把「一切可量化」写成三条设计原则之一，
  这些表是那条原则的载体。出图链路最后走的是手写角色卡，不是 `derive()`，
  所以表和出图之间断开了 —— **接回去还是砍掉是产品决策，不在门禁的职权内**。

复现：`node tests/lint-dead-member.mjs --why COMPANION`

## 2. `STAGES[].bg` —— 真结论：冗余 + 测试锁着，不是「没接线的美术档位」

先量事实：

- `bg` 在五行里**恒等于数组下标**（sealed=0 … true=4），与同一对象里的 `key` 重复表达同一件事
- 实际按阶段取图走的是 **key**：`js/xiuxian/ui/bag.js:81` 传 `MUTATION.STAGES[m.stage].key`
  → `companionPortrait(key)` → `COMPANION_PORTRAIT[key]`
- `bg` 的唯一读点是 `derive()` 里那一句 `bg: STAGES[st].bg`，
  而 `derive()` 只被零调用点的 `form()` 调用
- **但** `tests/mutation-regression.mjs:234,237` 明确断言 `derive()` 必须给出 `bg`、且 `bgStage 0~4`

所以它的正确分类是 **testonly（测试锁着、产品没用）**，不是 dead。

### 我做过一次删除，又撤回了

删掉 `STAGES[].bg` 与 `derive().bg` 之后，`npm test` 报两条红：

```
❌ derive 必须给出 bg
❌ bgStage 0~4
```

要让测试变绿就得改断言 —— 那是「削弱门禁换绿」，当场 `git checkout` 撤回。
**教训**：静态看得见的「零读」不等于「可删」。先看有没有测试把这条契约钉住，
有的话，它就不是死代码，是一条没人执行的产品决策。

---

## 3. 抽样复核（2026-10-11 子代理跑挂后我自己做的，**只覆盖 6/174**）

子代理（逐条复核 174 条）在跑到一半时被上游掐断，没留下产出。下面是我自己抽样查的
**六条**，结论按证据写；**剩下 168 条仍然 `reviewed:false`，本文件不替它们背书。**

先记一条方法上的教训：**裸 `grep` 数名字在这份清单上完全不可用**。
抽到 `Save.reset` 时裸 grep 得到「其他文件 40 处、测试 246 处」，
抽到 `SLOTS.desc` 得到 238 处 —— 全是 `reset` / `desc` / `get` / `power` 这些常见词撞上了。
必须用门禁自己的 `--why <实体>`，它走的是限定访问分析。

### 3.1 `MOUNT.pickupMul / speedMul / petAtk` —— 真死，但是**别名**不是死逻辑

```
js/xiuxian/mount.js:154-156
  pickupMul() { return this.eff().pickup; },
  speedMul()  { return this.eff().speed; },
  petAtk()    { return this.eff().atk; },
```

- 三个都是 `MOUNT.eff()` 的一行别名
- 产品的真实入口是 **`MOUNT.eff()` 本身**：`main.js:677`、`main.js:695`、`build.js:504`
  都直接调它并读原始字段；`companion.js:206,291` 读的也是原始 `MOUNT.s`
- 唯一读点是 `tests/t91.mjs:83-88`

结论：`kind=testonly` 定性正确。**不删** —— 它们是 `eff()` 的具名访问面，
删掉对玩家零影响但会让 `t91` 那组断言失去可读的名字；接线也不该做（`eff()` 已经是入口）。

复现：`node tests/lint-dead-member.mjs --why MOUNT`

### 3.2 那批 `reset()` —— 是**测试夹具 API**，不是死代码

清单里有 11 个模块各带一个零产品读点的 `reset()`
（`CHRONICLE` / `BUILD` / `Nemesis` / `SPINE` / `Titles` / `COMPANION` / `FAMILY` / `DAY` / `MOUNT` / `Seed` / `Save`）。

逐个查调用方，**全部在 `tests/`**，`js/` 里一处都没有：

```
tests/t80.js:80,101,105   DAY.reset()
tests/t82.js:10           FAMILY.reset()      tests/t82.js:69   CHRONICLE.reset()
tests/t83.js:135          BUILD.reset()
tests/t84.mjs:79          COMPANION.reset()   tests/t93.mjs:54 COMPANION.reset()
tests/e2e-cult.mjs:112    SPINE.reset()       tests/test-clock.mjs:112  DAY.reset()
```

它们做的事一律是 `localStorage.removeItem(K)` 或 `this.s = defaultState()`
—— **测试装置**：跑断言前把存档擦干净。产品重开一局走的是别的路径
（`main.js:415` 的 `engine.reset()` 加上各模块自己的 `load()`）。

结论：这 11 条里绝大多数应归 **`testonly`**，标成 `dead` 是把「产品不用」和「没人用」混为一谈。
**不删**：删了要重写十几处旧测试的装置，而它们没有替代入口。

### 3.3 两张 `ENCOUNTERS` 表的 `name/text/effect/log/options` —— 阶段性数据，**故意没接**

这是清单里看着最像死代码的一批：两个不同文件各有一张同名表，显示与逻辑字段**全部零读**。

- `js/xiuxian/lore.js:66` —— 字段零读，但 `id` 活（`world/network.js:99` 在用）
- `js/xiuxian/world/network.js:81` —— 同上

实查：两处都被 `FEATURE_FLAGS.encounters` 挡着，而那个开关是 **`false`**：

```js
// js/xiuxian/world/nodes.js:239
encounters: false,  // 阶段 2 的另一半 —— 本轮**故意不开**。
                    // ENCOUNTERS 里 kind:'combat' 那两条要不要进回合制是个设计决定,
                    // 会与 XX-DUEL-006 新接的 Duel 出口耦合,不在赶路这一轮里发明。
```

`ui.js:373` 也写了同一句理由。这和本文件第 1 节的 `COMPANION.form()` 是同一类：
**数据层先落地、玩法后接**，中间断开是刻意的。

结论：**不删、不接线**。清掉等于把一个已经想清楚的产品决策从代码里抹掉；
接上去等于在没定「combat 遭遇要不要进 Duel」之前替产品做决定。

### 3.4 抽样方法与它**没能**回答的问题

- 上面 6 条全部靠 `--why <实体>` 的限定访问分析，不是裸 grep
- 剩下 168 条**没有**逐条查。清单仍然是「让新增可见」，不是「存量已审」
- 特别提醒：3.2 那 11 条 `reset()` 揭示的是**一类**问题（`kind` 标错），
  很可能还有同类。要把 71 条 `testonly` 全部定准，需要的是
  「按调用方位置重新分类」而不是逐条看 —— 这活可以脚本化，本轮没做

复现：`node tests/lint-dead-member.mjs --why MOUNT` / `--why ENCOUNTERS` / `--why SLOTS`

---

## 门禁自身的三次反向注入

| 注入 | 结果 |
|---|---|
| 往 `COMPANION` 塞一个零调用方法 | `--strict` EXIT=1，精确报出该成员 ✔ |
| 往 `SLOTS` 塞一个零读字段 | `--strict` EXIT=1，R2 规则生效 ✔ |
| 抹掉 `SLOTS.map(s => s.icon)` 这处唯一读点 | **EXIT=0（没报）** ✘ |

第三条没报，原因是**故意选的**保守方向：同名回调参数按「一名对多」处理，
`gearIcons.js` 里另一个回调的 `s`（`const s = SLOT_BY_KEY.get(k)`，与 SLOTS 无关）
让 `s#icon` 一并回译到了 SLOTS。宁可漏报不可误杀。
这也正是本门禁默认 report-only 的理由 —— 见文件头【已知局限】。
