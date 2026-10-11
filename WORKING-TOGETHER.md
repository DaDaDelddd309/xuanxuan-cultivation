# 并行协作规约（Z8 手机侧 ↔ 桌面侧）

> 建立：2026-10-10 · Z8 侧
> 配套：[`VERSION-CONVENTION.md`](VERSION-CONVENTION.md)（版本号怎么协同）
> 本文件解决的是另一件事：**两边同时开工做同一件事**。

---

## 零、这份文件为什么存在

2026-10-10 发生过一次真实的撞车，代价是 **12 个文件冲突**：

```
分叉点 8a12fa7
├── 远端 origin/main 领先 18 个提交
└── 本地            领先 12 个提交
```

两边从同一个点出发，**各自独立地做了同一批工单**：

| 工单 | 本地做了 | 远端也做了 |
|---|---|---|
| XX-AUDIT-003 t82 | 改步数常量 | 改步数常量 |
| XX-AUDIT-004 t80/t81/t83 | 重写 | 重写 |
| XX-AUDIT-007 死导出 | 建检测器 + 基线 | 建检测器 + 基线 |
| XX-AUDIT-001 run-all | 孤儿检测 | 改调 `npm run lint` |
| XX-AUDIT-002 死资源 | 删 `foe.jpg` | 清部署路径死资源 |
| XX-AUDIT-017 点击无反应 | 防连点改 WeakMap | 同一个修复 |
| 版本号 | 没升 | 没升（且写了份规约） |

**没有一个人偷懒，也没有一个人做错** —— 两边都认真读了同一份工单库，
都判断出同一件事该做，然后都做了。这不是疏忽，是**流程缺一环**。

`VERSION-CONVENTION.md` 只解决了「版本号别撞」。
它没解决「**工单别撞**」—— 而那才是这次 12 个冲突的根因。

---

## 一、规则 1：动手前先 fetch，再认领

```bash
cd <repo>
git fetch origin                    # ← 少了这行，下面全是幻觉
git log --oneline -1 origin/main
git status -sb | head -1            # 看自己落后多少
```

**为什么这条排第一**：本轮我判断 `save-keys.js`「从不存在」，
依据是 `git log --all -- js/xiuxian/save-keys.js` 无输出。
但当时本地的 refs 还没 fetch 到那 18 个提交，`--all` 里的「全部」是幻觉。
真相是那个文件**在远端存在**（`3a618ee`），而且有 15 个模块 import 它。

我据此从 `sw.js` 预缓存清单里删掉了那条、还写了 12 行注释说它不存在 ——
**在源码里留了一条假陈述**，并且制造了一次离线 404。

> **「某东西不存在」是需要证据的一句话。**
> `git log --all` 看起来很充分，但它只覆盖**本地 refs 能到达的提交**。
> 判断存在性用：
> ```bash
> git cat-file -e origin/main:<path> && echo 存在
> git fetch && git log --all -- <path>
> ```

## 二、规则 2：认领工单 = 在 TICKETS.md 里标 🟡 并写认领者

**动手之前**，在对应工单标题行改成：

```markdown
## XX-AUDIT-0xx <标题> 🟡 Z8侧认领 2026-10-10
```

完工改成 `✅ 已修（<commit>）`。

**为什么要写进仓库而不是口头说**：两边不同时在线，靠的是仓库里的事实。
写进文件，另一个会话一 `git pull` 就看得见；不写就等于没认领。

**认领的粒度 = 一个工单**。不要按文件认领 ——
按文件认领挡不住「同一个工单从两个角度切入」。

### 规则 2 的补充：已在 ⬜ 待办的工单，能不能直接开工？

能，但**先做一件事**：在工单下追加一行

```markdown
> Z8侧 2026-10-10 开工事由：<为什么现在做这件事>
```

理由：待办工单可能已经被另一边看到了。你不动声色地做完提交上去，
对方按原计划也做一遍，就是这次 12 个冲突的复现。
**留下「我为什么做这个」的痕迹，比留「我做完了」更早生效。**

---

## 三、规则 3：合并时不要用 ours/theirs 一把梭

本轮 12 个冲突，**逐对分析后的结论是「8 取本地、2 并集、2 取并集但要改」**，
一把梭会丢掉：

- 远端 t83 里的**名单身份断言**和**立绘可达性断言**（本地只有长度断言，
  把 `momocha` 改名成 `momotea` 再同时增删一位 NPC，长度仍是 4，本地照样绿）
- 远端 sw.js 里的 **`save-keys.js` 预缓存条目**（本地刚把它删了）
- 远端 `onDayPhase` 的理由注释

**流程**：

```bash
git merge origin/main --no-commit --no-ff
git diff --name-only --diff-filter=U        # 先看清有几个

# 对每一个冲突文件：
git show HEAD:<file>          > /tmp/ours
git show origin/main:<file>   > /tmp/theirs
diff /tmp/ours /tmp/theirs   # 判断哪边强、是否互补
```

冲突多的批次（> 5 个文件）建议派子代理做**逐对分析**，
让它们给结论和「并集要点」，自己动手改 —— 12 个文件逐个读两版很容易看花眼。

### 3.1 分析时优先找这三样

1. **恒真断言**：`x===1 || x!==1` 这类对任意值都成立的式子。
   本轮远端 t81 就有一条（`hostBuff()===1||hostBuff()!==1`）。
2. **崩溃式写法**：调用了被改名/删除的方法。本轮远端 t82 调 `CHRONICLE.day()`，
   而本地已把 `day()` 改名 `action()` → 整个文件 TypeError，后面断言一条都没跑。
3. **实现侧归属**：谁改了被测的源文件，测试就必须跟着谁。
   本轮 `clock.js` / `chronicle.js` 只有本地改、远端没碰，
   所以远端那批测试**天然失去了它们依赖的实现** —— 这是「8 取本地」的根因。

---

## 四、规则 4：合并后必须跑完整基线，且要独立复核

```bash
bash tests/run-all.sh     # 必须 rc=0
node tests/lint-deadexport.mjs --list   # 「已不再是候选」应为 0
```

⚠️ **别在跑回归的同时改文件。** 本轮有一次 `run-all` 报 `❌ 有失败`，
原因是回归跑到一半我在删 `SECRET_PILL`、改基线 —— 读到的是中间态。
稳定后重跑，全绿。**「并发修改时看到的红」不是 bug，是噪音。**

---

## 五、规则 5：合并结论要留日志

合并不是「合上了」，是**做了一堆取舍**。取舍理由不写下来，
三个月后没人知道为什么基线是 17 条而不是 20 条、为什么 t83 有远端来的断言。

见 [`DECISIONS.md`](DECISIONS.md)。每个影响多文件的合并写一节：

- 冲突了哪些文件
- 每一对**为什么**这么取舍（要有实证：实测数字、崩溃信息）
- 留了哪些「还不知道对不对」的痕迹

---

## 六、检查清单（合并前后各过一遍）

**合并前**
- [ ] `git fetch` 过了
- [ ] 确认本地与 `origin/main` 的分叉程度（`git rev-list --left-right --count`）
- [ ] 冲突文件数心里有数（先 `--no-commit` 试一次）

**合并中**
- [ ] 每个冲突都**单独**判断过，不是一把梭
- [ ] 找过恒真断言
- [ ] 找过「调用了不存在的方法」
- [ ] 确认过实现侧的改动归属方

**合并后**
- [ ] `bash tests/run-all.sh` rc=0（且**不在跑的时候改文件**）
- [ ] 版本号按 `VERSION-CONVENTION.md` 升了
- [ ] `version.json` 重新生成
- [ ] `DECISIONS.md` 记了取舍
- [ ] 推送前再 fetch 一次，确认没有新提交进来

---

## 七、当前状态（2026-10-11 02:13 桌面侧更新）

| 项 | 值 |
|---|---|
| 当前版本 | `x099v`（**Z8 侧升的**，`v099u→v099v`，见 `e5e8528`） |
| 死导出基线 | **30 条**（原 17 条 + 13 条 XX-WORLD 阶段脚手架），候选 30/30，新增 0 |
| CI | `check` ✅ / `browser` ❌ **2/8**（run `38073937451`）—— **6 个红已全部定位，4 个完整定位，见第四节** |
| 合并 | ✅ Z8 侧已把 `origin/main` 合进 `merge-desktop`，12 个冲突逐对分析后解决 |
| XX-AUDIT-025 | ✅ 已修（桌面侧 2026-10-11）。**未升版** —— 实测证明非玩家可见变更，详见 TICKETS |
| 下次开工前 | **先 `git fetch`**，再看本文件规则 2 |

### 📬 交接给 Z8 侧（2026-10-11 02:13，桌面侧 mini）

> 这节只讲**还没解决**的事。已经做完的不重复 —— 见 `CHANGELOG.md` 与 `TICKETS.md`。
> 本地另有一份 `~/.tmp/HANDOFF-FROM-MINI.md`，内容相同，方便直接读。

#### 🔴 一、我在 `f743d33` 里的根因判断是错的，别照着走

我断言 XX-AUDIT-033 那 6 个浏览器测试红，是因为 5 份复制品里的本地 `unblock`
看不见 `.xx-duel` 全屏层。**CI 实测推翻**：

```
✓ check job    通过
✗ browser job  2 / 8 通过 —— ❌ t86 t87 t88 t89 audit-loop full79
```

**一个都没好。** 那个缺陷是真的（收敛成 `from _unblock import unblock` 是对的），
但它**不是**这些红的原因。

差的那一环是「这些测试里 `.xx-duel` 开着吗」——我没证。
当时说的是「大概率同源」，那是概率不是证据。推翻过程已记进 `TICKETS.md`。

#### 🔴 二、修的过程中我又制造了一个 bug，已修（`7dda64f`）

合并两处修复时把 `sys.path.insert(0, os.path.dirname(...))` 排在了 `import os` **之前**，
而那行自己就用 `os.path` —— 把刚修好的 `NameError` 又带了回来。
CI 上可见：`full79` 从「跑完 14 条断言」退化成 **0.15 秒就崩**。

而我当时写的验证是「`py_compile` 通过」。

> **`py_compile` 只查语法，查不出运行期名字解析。**
> 它对 `NameError` 完全无感 —— 而这恰恰是浏览器测试在本地唯一可能暴露的那类错。

#### ✅ 三、补了那条缺失的验证：`tests/lint-py-boot.py`

假 `playwright` 把 `sync_playwright()` 桩掉、打掉 `time.sleep`，
让每个 `.py` 从头执行一遍，只把 `NameError`/`ImportError`/`AttributeError` 当失败。
**反向验证过**（把 `import os` 挪回使用之后 → 报红并指出行号、exit 1）。
已接进 `npm run lint`。

**它不能证明断言对**（桩全判真），所以它全绿 ≠ 浏览器测试会过。

> **@Z8 侧：建议你也把它加进 `run-browser.sh` 开头**，在起 server 之前先跑一遍 ——
> 这样「脚本崩了」会在 browser job 里以明确形式报出来，
> 而不是混在一堆 `Page.click` 超时里。

#### 📍 四、6 个红全部定位完毕：**5 个是测试侧过期，0 个是玩家可见 bug**

上一版我写「真因仍未知，没有再猜」。这一版全部查完了，**结论比我预想的干净**：
红的原因几乎全在 `tests/` 里，**产品侧一个都不用改**。

| 测试 | 失败断言 | 有 Traceback | 判定 |
|---|---|---|---|
| `t86` | 6 | 无 | ✅ **测试侧，完整定位** |
| `t87` | 3 | 有 | ⚠️ 定位 1/3（第 1 条） |
| `t88` | 3 | 有 | ✅ **测试侧，完整定位** |
| `t89` | 1（17 条只错 1） | 有 | 🟡 **缩到 DOM 层，未闭合** |
| `audit-loop` | 2 | 有 | 🟡 **两条同源，已归约，诱因未闭合** |
| `full79` | **0** | 有 | ✅ **测试侧，完整定位** |

##### ① `t86` —— 写错了字段（写的是**镜像**，真源在别处）

`tests/t86.py:76` 循环里写 `DAY.s.actions`，然后读 `A.phase()`。
但 `items.js:192` 的 `phase()` 只是转发：`return CLOCK.phase()`，
而 `clock.js:116` 的 `hour()` = `floor(dayProgress()*24)`，
`dayProgress()` 读的是 **`CLOCK.s.ms`**。

> `DAY.s.actions` 是个**镜像字段**，`items.js:184-190` 的 `load/save` 才会把它同步过去。
> 测试直接写它，`phase()` 压根不读 —— 4 次循环返回同一个 key，实得 `['night']`。

改用 `CLOCK.s.ms = h/24*CLOCK_CONST.DAY_MS` 后，6→晨 / 12→昼 / 18→暮 / 22→夜，
4 个 key 齐全。另外 3 条比较断言**本来就能过**（`ambience.js:9-22` 的 PHASES：
`night.fog .42>day .06`、`night.mul 1.65>day 1.0`、`dawn.mul .82<day 1.0`）。
**6 条失败 = 1 个根因，产品侧零改动。**

##### ② `t88` —— 按写死的 id 走，而 id 的类型**随种子漂**

本地跑 200 个种子实测（`worldgen.generate(seed)`）：

```
hongyi.beat[0] 要 n0          → 200/200 (100.0%)
hongyi.beat[2] 要 n4(secret)  →  44/200 ( 22.0%)   ⚠️ 随种子漂
hongyi.beat[3] 要 n5(elite)   →  18/200 (  9.0%)   ⚠️ 随种子漂
laolao.beat[0] 要 n4(secret)  →  44/200 ( 22.0%)   ⚠️ 随种子漂
laolao.beat[1] 要 n5(elite)   →  18/200 (  9.0%)   ⚠️ 随种子漂
tomb.beat[0]   要 n8(boss)    →   5/200 (  2.5%)   ⚠️ 随种子漂
```

`worldgen.js:234` 按 `(y,x)` 排序逐个发 id，布局随种子变 → **同一 id 的类型每张图都不一样**
（`n4` 实测分布：field 244 / secret 88 / elite 28 / village 22 / boss 18）。

实测 `beat=2` 正好卡在 `beat[2]`（要 n4=secret），后两环因 `beats[i]` 不前进而连锁失败。

> **但这不是玩家可见 bug。** `story.js:273` 的第二分支 `_typeMatches` 允许
> **任意同类节点**触发（`_typeMatches` 实测退化成 `_nodeTypeOf(nodeId)===wantType`，
> 它不限定 id）。所以真实玩家走到**任何一个** secret 节点都能推进 —— 那段代码的注释
> 还专门记着「同线不同环不许挤在同一节点」这条旧规则是错的、已删。
> **是测试只按写死的 `b.node` 走**（`t88.py:50` 的 `for(const b of beats) STORY.arrive(b.node)`），
> 于是 78% 的种子过不去。测试没钉种子。

**这条不是读代码推的，是实测的。** 用真实 `worldgen` 挑一个 `n4=field / n5=secret`
的种子（seed 0），同一个 `STORY` 实例跑两种走法：

```
种子 0(真实 worldgen)
  n4=field  n5=secret   ← beat[2] 要 n4=secret, beat[3] 要 n5=elite
  这张图里真正的 secret 节点=n5   elite 节点=n6

  按写死 id 走(t88 现在的写法)      beat=3/4  readyFinish=false   ❌ 推不完
  走同类节点(玩家的真实做法)        beat=4/4  readyFinish=true    ✅ 推完
```

> **兜底分支确实有效。** 玩家推得动主线，推不动的是测试的走法。
> 所以这条**不要**按产品缺陷报出去 —— 那会把「测试写错了」说成「游戏坏了」。

##### ③ `full79` —— 点了个被冻结掉的按钮

`tests/full79.py:82` 无条件 `click('[data-act=meditate]')`，
而 `index.js:57` 是 `MEDITATE_FROZEN: true`，`ui/realm.js:56` 据此**不渲染**该按钮
（改渲染「吐纳已冻结 —— 修为只由砍杀产出」）。按钮不存在 → `Page.click` 30s 超时 → 退出码 1。

##### ④ `t87` —— 魔数没跟（3 条里的第 1 条已定位）

`tests/t87.py:43` 断言 `.xx-tab` 数量 `== 12`，`ui.js:65` 的 `TABS` 已 **14** 个
（后加 `build` 领地、`dex` 图鉴）。

另外 2 条（`弹出结案卡`、`两个结局选项`）**我排除了静态原因，但没闭合**：

- `ui.js:450` 的 `qdone` 有两条渲染路径 —— `askSpecial`（`ui/story.js:197`）和
  `askPath`（`ui/story.js:179`），**两条都会产出 `.xx-storycard` + 2 个 `.xx-sc-go[data-p]`**；
- 模板依赖的 `LEGEND.hongyi.quest.title/desc` 实测都在（`legend.js:18`），
  `specialPrompt('hongyi')` 因无 `special` 字段返回空，落到 `askPath`；
- t87 的前置是 `QUEST.autoTake()` 而非 `STORY.readyFinish`，**与 t88 的种子漂移不是同一条线**
  （CI 里 `红衣女鬼进度=1 可结案=True` 是过的）。

所以它只剩「点击没落到 DOM 上」这一类，与 `t89` 同形，同样需要一次带诊断的 CI 才能定。

##### ⑤ `audit-loop` —— 两条失败同源于 `SPIRIT.TALLY.ling === 0`

`spirit.js:124` 是 `dao = round((ling*0.5 + kills*1.2) * boost)`。
实测 `道行 0→24` 且 `kills=20` → 反推出 **`ling=0`、`boost=1`**；
而 `spirit.js:130` 的 `if (stones > 0) Bag.add(...)` 在 ling=0 时不发石头
→ `源石真的进背包了` 必挂。**两条失败 = 一个 `ling=0`。**

`ling` 只在 `spirit.js:100`「这一帧消失 = 被磁吸收走」时累加。
**诱因（为什么一个都没吸到）未闭合**，原因见下面这条基础设施问题。

##### ⑥ `t89` —— 缩到 DOM 层，差最后一步

`ui/tomb.js:97` 开头 `if (!TOMB.canFinish()) { toast(...); return; }` —— 提前返回就
一个 `[data-w]` 都不渲染，随后 `click('[data-w="1"]')` 必然超时，**1 失败断言 + 1 超时同源**。

我在**模块层**复现了它的走动序列（造桩绕过 DOM），状态机是通的：

```
enter() ok=true at=dk → move('qd') ok → move('ce') ok → move('qd') ok → move('sj') ok
>>> canFinish() = true      （t89 期望 true）
```

导入链也正常（`ui.js:26` 的 `askTombWordsImpl`、`ui/tomb.js:13` 的 `TOMB_WORDS` 别名都对）。
**所以 t89 的锅不在墓逻辑，剩下的只有「点击没落到 DOM 上」这一类**，需要浏览器才能定。
在断言前加一行 `ok("canFinish", TOMB.canFinish())`，下一次 CI 就能一次说清。

---

#### 🔧 顺带查出两个基础设施问题（这才是 CI 一直查不出来的真正原因）

1. **`tests/run-browser.sh:81` 把所有诊断输出丢掉了**
   ```
   grep -E "✅|❌|JS错误" "$tmp" | sed 's/^/  /'
   ```
   测试自己打的 `print()`（比如 audit-loop 的 `内部累计:` / `场上灵气拾取物:`）**一行都进不了 CI 日志**。
   我拉完整日志时才发现这些行根本不存在 —— 难怪前面几轮都在盲猜。

2. **`tests/run-browser.sh:87` 见到 Traceback 就判失败，与断言无关**
   ```
   grep -qE "Traceback|TimeoutError" "$tmp" && bad=1
   ```
   这就是 `full79` **断言全绿却算红**的机制。

> 建议把 `run-browser.sh` 改成失败时**回显该测试的完整输出**（而不只是 ✅/❌ 行）。
> 这两条比修 6 个测试本身更值钱 —— 修完之后，下一个问题不会再查不出来。

---

#### 📍 需要你定的：只有归属

| | 说明 |
|---|---|
| **A**（我倾向） | **测试侧归我** —— ①②③④ 我已能直接改，且会像 `lint-py-boot.py` 那样**反向验证**过再推。⑤⑥ 各补一行诊断断言，让下一次 CI 自己说清楚。**全程只碰 `tests/`**，不碰 `js/`，不与你正在做的 XX-AUDIT-005（ui.js 拆分）冲突 |
| **B** | 你接 ⑤⑥ 里疑似与玩法相关的部分（灵气吸取、墓道结局），我只交付 ①②③④ |

要 B 的话请在 `TICKETS.md` 的 XX-AUDIT-033 标 🟡 并留一句，我照你的来。

#### ✅ 八、④ 那四条我已经动手修了（只碰 `tests/`，一个字符没动 `js/`）

你没标 🟡 反对，我按上面 A 走。**只改 `tests/`**，与你的 XX-AUDIT-005 / 035 / 036 / 037 不重叠。

| 文件 | 改法 | 反向验证（本地，跑得起来的那部分） |
|---|---|---|
| `t86.py` | 改写 `CLOCK.s.ms = h/24*CLOCK_CONST.DAY_MS` | ✅ **真跑了同一个探针的旧/新两版**：旧写法 `keys=["night"] len=1` ❌，新写法 `["dawn","day","dusk","night"] len=4` ✅，且另 3 条比较断言全过（fog .18/.06/.22/.42、mul .82/1/1.25/1.65） |
| `t88.py` | 按 `nodeType` 找目标节点，找不到才退回写死 id | ✅ **实测**：同一 `STORY`，按写死 id 走 beat=3/4，按类型走 4/4 |
| `t87.py` | 不再写死 12 —— 从 `fetch` 到的 `ui.js` 源码解析 `TABS`，同时比对 key 集合 | ✅ **复现了旧断言的失败**：源码解析出 14 个 key，`14==12` 为假，正是 CI 报红的那一枪 |
| `full79.py` | 跟随 `Cult.MEDITATE_FROZEN` 分支；冻结时改断言「按钮不渲染」并直接落一个非零 exp 供持久化用 | ⚠️ **只能静态验**（见下） |

> ⚠️ **诚实标注验证强度**：`t86`/`t88`/`t87` 三条我做的是**模块级/源码级实测**
> （纯 JS 可跑，不依赖浏览器），这部分是真跑出来的。
> `full79` 那条**跑不了** —— playwright 在本机结构性装不上，
> 我只能保证它**语法正确**（4 个文件 `py_compile` 全过 + `lint-py-boot` 绿）。
> **它到底转不转绿，要 CI 说话**，别当成已验证。

> `t87` 那条我特意没把 12 改成 14 —— 那样下次产品再加标签它照样红，
> 只是把「已经错了」换成「以后还会错」。改成从源码推导 + 比 key 集合，
> 比原来的「等于某个数」更强。

#### 🐛 顺带报两条小的

1. **`TICKETS.md` 里 XX-AUDIT-033 有两个 `##` 标题**，第 6715 行那条
   「⬜ 待办（2026-10-11 桌面侧立）」是**孤儿** —— 它下面没有任何内容，
   紧接着 6716 行就是新的「根因已定位」。看着像是追加新节时没删旧标题。
   **后果**：工单列表里会永远挂着一条 ⬜ 待办，而它其实已经定位完了。
2. **订正我自己上一轮的预测**：我说「`703549d` 的 `check` job 预计会红」——
   **错了，实际是 `check` ✅ / `browser` ❌**。本地 `npm run check` 确实因
   `[6]` 挂了，但 CI 那边 RNG 状态不同就过了 —— 这恰好印证 `f178bab` 那条
   **是概率性断言**（见第七节），不是确定性失败。所以第七节我把「卡住所有人」
   这句也收窄一下：它不会稳定卡 CI，但**会让本地 check 时红时绿**，
   对按本地基线判断的人才是真的坑。

#### 🚨 七、另外：`f178bab`（village 经验 P0）把一条测试变成了**抛硬币**

这不是我的改动，是合并你 `e5e8528` 时跑基线撞见的（`check` rc=1），但它会卡住所有人，先报你。

**症状**：`test-runcfg-loot-wiring` 的 `[6]` 在**完整 `npm run check` 里挂**，单独跑却过：

```
完整 check:   ❌ 五种节点的掉落画像互不相同 — 4/5 唯一
                 village  gemXp=2400  coin=303  meat=9   chest=0
                 field    gemXp=2400  coin=303  meat=9   chest=0     ← 与 village 完全相同
单独跑该文件: ✅ PASS (17 通过 / 0 失败)
                 village  gemXp=2400  coin=290  meat=11  chest=0
                 field    gemXp=2400  coin=320  meat=6   chest=0     ← 不同
```

**根因**：`f178bab` 把 `runcfg.js` 的 village `loot` 从 `{0,0,1.0,1.0}` 改成 `{1.0,1.0,1.0,1.0}`，
于是 **village 与 field 的倍率完全相同**。而 `[6]`（`tests/test-runcfg-loot-wiring.mjs:146-153`）
是用**共享 RNG** 每种采一次 `killBatch(600, MOB)`，签名取
`[gemXp, coin, meat, chest]`：

- 改之前：village 的 `gemBias=0` 让它 `gemXp=0`，**结构上**就不可能和 field 撞 → 永远过；
- 改之后：两者倍率一样，签名唯一性**只能靠随机计数恰好不同** → **抛硬币**。

> 所以准确的说法不是「[5] 和 [6] 互相矛盾」，而是
> **这个 P0 修得对，但顺手把一条确定性断言变成了概率性断言。**
>
> 📌 **实测补充**：`npm run check` 本地跑挂过，但 CI 上 `check` job **是绿的**
> ——同一个提交、同一个断言，只因 RNG 状态不同就过了。
> 所以它**不会稳定卡 CI**，真正受害的是**按本地基线判断的人**
> （本地时红时绿会让人怀疑自己刚合的东西）。

**两个方向，你定**（我没动 `runcfg.js`）：

| | 做法 | 代价 |
|---|---|---|
| **i** | village 保留 `gemBias=1`（P0 照修），但给 `coinBias`/`meatBias` 一个和 field 不同的值 | 既保住 P0，又保住 `[6]` 的「五种画像互不相同」设计意图 |
| **ii** | 承认 village ≡ field 是设计（`note` 写的就是「从村庄出发·平稳开局」），把 `[6]` 改成只比 `field/elite/secret/boss` 四种，外加一条显式断言 village ≡ field | 更诚实，但等于承认村庄在掉落上不再有独立画像 |

> 顺带：`[6]` 的标题写「**四种**节点掉落画像」，实际断言的是**五种**（`sig.size === 5`）。
> 改的时候一并修掉。

#### 五、推代码不用再经我中转

`github.com:443` 的 HTTPS 不通（TCP 超时），但
**`ssh.github.com:443` 和 `github.com:22` 都通** —— 就是提交历史里记的
「故障在 IP 间漂移」。mini 上已配好 SSH 直推（公钥 `mini-termux-20261011`）。
**你也可以这么配**，之后不用绕。

#### 六、v099s 那个 P0，值得你知道

实测**线上** `sw.js` 里 `world/network.js` 出现次数为 **0** ——
离线白屏当时就在生产环境里。已补上并升版，`check` job 从红转绿。

根因不是「忘了加」，是**那条检查本地根本跑不到**：
反向那个方向只存在于 `ci.yml` 的一段内联 `node -e` 里。
现已搬进 `npm run lint`（`tests/lint-precache-reverse.mjs`）。

---

<details>
<summary>（已完结的交接 — 2026-10-11 00:50 那版，保留备查）</summary>

**已推送到 main，版本升到 `x099r`。** 你下次 `git fetch` 就能看到。

**你本地的两个文件会和这次合并撞**（我在同一批里也动了它们）：

```
M TICKETS.md          ← 我加了 XX-AUDIT-025 完工节 + P1-2 增量节
M package.json        ← 我这边没有实质改动，但合并会带进别的变化
```

处理方式（**别一把梭**，见规则 3）：

```bash
git fetch origin
git rebase origin/main        # 或 merge
git diff --name-only --diff-filter=U
```

TICKETS.md 理论上能自动合上（两边加的是**不同章节**），
但你那条 XX-PLAY 槽位组合的工单如果也在末尾附近，可能要手工排一下顺序。

**另一件事：你的 `sw.js` 版本号长期没升。**
`XX-LINK-001`（局外节点倾向接入局内刷怪与掉落）是玩家可见改动，
却一直挂在 `v099q` 上。这正是 `VERSION-CONVENTION.md` 开篇要治的病。
本次由合并方统一升到 `v099r`，**以后你直接往 main 推玩家可见改动时请自己升版**，
不要假设合并方会兜。

**我这边接下来要做的**：XX-WORLD-005 阶段 2（Dijkstra 赶路，**动 `ui.js` travel 分支**）。
`WORKING-TOGETHER.md` 里记着你认领了 XX-AUDIT-005（`ui.js` 拆分），
**那两条会撞在同一个函数上**。开工前请在 TICKETS.md 标 🟡 并告诉我先后顺序。

</details>

### ⚠️ 2026-10-11 新增一条判据（桌面侧踩到并记录）

`lint-deadexport` 报出的「新增候选」**不等于**「待清理的死代码」。

本轮冒出 13 个新候选，全部来自 `js/xiuxian/world/`。它们零引用是因为
`nodes.js` 的 `FEATURE_FLAGS` 把大世界分 5 个阶段、逐个开阀 ——
后续阶段的出口**天然**没人调用。若按「未分类 = 待清理」删掉，
拆掉的就是 XX-WORLD-005/006 的地基，而那两张工单在 `JOINT-DEV-PLAN.md` §三
明确派给桌面侧。

> **判「真死」之前先读 `FEATURE_FLAGS` 这类显式阶段开关，别只数 grep 命中。**
> 这条已写进 `tests/deadexport-baseline.txt` 头部。

### 📌 下一步分工（2026-10-11）

| 工单 | 谁做 | 备注 |
|---|---|---|
| **XX-WORLD-005** 阶段 2（Dijkstra 赶路，动 `ui.js` travel 分支） | **桌面侧** | 基线里那 13 条正是它的地基 |
| **XX-AUDIT-005** P0-3 `ui.js` 拆分 | Z8 侧（2026-10-10 已认领） | ⚠️ 与上面那条**都动 `ui.js` travel 分支**，**不要并行** |
| XX-EQUIP-001~003 | Z8 侧 | |
| XX-EQUIP-004~005 | 桌面侧 | 不碰 `endRun` 结算链 |

> 上表是给两边对齐用的。若你（Z8 侧）正要动 `ui.js` 的 travel 分支，
> 请先在 `TICKETS.md` 对应工单标 🟡 认领，避免重演 12 文件冲突。