# 开放世界 / 搜打撤 / 骑马砍杀 —— 系统设计调研报告

> **调研对象**：`轩轩修仙传`（纯前端 Canvas 2D、零依赖零构建、原生 ESM、GitHub Pages 静态部署）
> **调研日期**：2026-10-10
> **产出目标**：给一个 1–3 人小体量项目提供"12 条设计愿景"的取舍裁决

---

## 0. 核实等级与方法

| 标记 | 含义 |
|---|---|
| ✅ | **直接访问核实** —— 我或子代理实际用 `curl` / API 打开并读到了页面正文 / 返回的 JSON |
| ⚠️ | **仅搜索摘要** —— 只在搜索引擎返回的摘要里出现，未打开原页面 |
| ❌ | **没找到 / 未取得** —— 明确检索过但拿不到可靠来源 |

**方法学说明（重要）**：本环境里 `web_fetch` 工具对绝大多数域名返回 `file load failed`，实际有效通道是 **Bash + curl**。以下域名在本沙箱**被网络层拦截**（DNS/连接超时），导致所有依赖它们的结论降级为 ⚠️：

`escapefromtarkov.fandom.com`（gamepedia 301 跳到这里）、`mountandblade.fandom.com`、`bannerlord.fandom.com`、`strategywiki.org`、`rimworldwiki.com`、`en.wikipedia.org`、`loophero.fandom.com`、`minecraft.wiki` 的 HTML 页（**但它的 MediaWiki API 可直连**）、`gamedeveloper.com`（403）、`taleworlds.com`（403）、`gdcvault.com` 根域（200 但 PDF 路径 403）。

**可直连并已实测成功的域名**：`api.github.com`、`raw.githubusercontent.com`、`store.steampowered.com/api/*`、`store.steampowered.com/appreviews/*`、`howtomarketagame.com`、`wiki.teamfortress.com`、`stardewvalleywiki.com`、`developer.mozilla.org`、`api.webstatus.dev`、`redblobgames.com`、`ldtk.io`、`nobuild.net`、`minecraft.wiki/api.php`、`tarkovkit.com`、`updatemonitor.com`、`openra.net`、`nobuild.net`、`api.caniuse.com`（DNS 不通，但 `raw.githubusercontent.com/Fyrd/caniuse` 可用）。

---

## 0.1 执行摘要（先看这个）

**结论 1 —— 你要的不是"11 项系统"，是 1 个循环的 4 个位置。**
12 条愿景里有 3 条应该立刻砍掉（商会行会、实时骑马战斗、开垦/加工链），3 条应该降维（种田→篝火、伙伴→固定雇佣、忠诚度→无），6 条可以低成本做成枢纽。详见 **§F4**。

**结论 2 —— 你的核心循环已经有了现成的、被验证过的模板：Loop Hero。**
它同时拥有：环形节点地图 + 局内构筑 + **撤退/死亡分段返还（30%/60%/100%）** + 营地建设 + 时间（章回）推进。3 人团队做出 200 万份量级的作品。你现在缺的只有"撤退决策"和"营地"两块。详见 **§F5**。

**结论 3 —— "搜打撤"在 GitHub 上没有开源实现可抄，机制必须自己降维。**
GitHub 上 `extraction shooter` 关键词的头部结果绝大多数是外挂工具，真正的游戏项目全是 ≤8 star 的个人原型。**这对你反而是好消息**：没有现成答案可抄，意味着你不需要为了"像 Tarkov"而做那些复杂度。详见 **§A2**。

**结论 4 —— 2026 年独立游戏的窗口期对"小而快"极度友好，但窗口里没有"肉鸽"这个品类。**
Chris Zukowski 列出的 2025–2026 窗口期品类是 friend-slop / idle / 恐怖 / 模拟经营 / rage / autobattler，**肉鸽本体已经饱和**（2025 年 Steam 新增 1,562 款，同时有 108 款零评测）。你的定位应该是**"肉鸽 + 模拟经营"的交叉带**（Against the Storm 那一类），而不是纯肉鸽。详见 **§F1、§F3**。

**结论 5 —— 技术约束在 2025 年刚刚松绑了一条，但你不需要构建工具。**
JSON modules（`import x from './a.json' with {type:'json'}`）在 **2025-04-29 起 Baseline newly available**，import maps 在 **2025-09-27 起 Baseline widely available**。节点地图数据可以放真正的 `.json` 文件里、用 ESM 直接 import，**零构建**。详见 **§C4**。

---

# A. 搜打撤（Extraction）

## A1. Escape from Tarkov 核心循环的机制级拆解

### A1.1 保险（Insurance）

**三家保险商的参数** —— ✅ 官方 1.1.0.0 补丁确认三家并存（Jaeger 为新增）：

> Prapor returns insured items after 12–20 hours. You have 7 days (168h) to collect.
> Therapist returns insured items after 6–10 hours. You have 10 days (240h) to collect.
> Jaeger returns insured items after 1–2 hours. You have 1 day (24h) to collect.
> —— https://escapefromtarkov.gamepedia.com/wiki/Insurance ⚠️（页面被挡，内容来自搜索返回的完整正文）

✅ 补丁确认的部分：Jaeger 是 1.1.0.0 新增的第三方，返还最快但**可领取窗口最短**（1 天）；Prapor/Therapist 返还时间被缩短但**费用上涨、保留期延长**；忠诚度等级提供手续费折扣。 —— https://www.updatemonitor.com/app/3932890/news

** Intelligence Center 对保险的影响** —— ⚠️ IC L2 → 保险返还时间 **−20%**（配 Hideout Management 精英技能为 −30%）。

**不可保物品清单** —— ⚠️：安全箱、罗盘、近战武器（Cultist 匕首除外）、臂章、容器类道具（钥匙扣/文件袋/物品袋）、情报类（纸质地图）、消耗品（食物/药品/弹药/手雷）、热成像设备与瞄具。

**关键例外（这些是设计精华）**：
- **MIA（Missing in Action）**：未在 raid 结束前撤离、或**脱水死亡** → 保险全部不赔 ⚠️
- **地图例外**：The Lab、The Labyrinth、Icebreaker 三张图保险完全不生效 ⚠️；PvP 赛季模式（KORD BREACH）保险被完全禁用 ✅
- **容器规则**：给容器投保 = 给内容投保，但**只赔被保的那个物品本身**，弹匣里的子弹、保了护甲包里的药都不赔 ⚠️

❌ **未取得**：保险费用的确切计算公式。部分 SEO 站给出"Prapor = 物品价值 15%"之类的说法，未采信。

### A1.2 Secure Container（安全箱）

⚠️ 尺寸阶梯（gamepedia，搜索正文）：

| 名称 | 格子 | 获取途径 |
|---|---|---|
| Alpha | 2×2 = 4 | 标准版默认 |
| Beta | 3×2 = 6 | Peacekeeper 忠诚度 2 |
| Epsilon | 4×2 = 8 | Prapor 任务 "The Punisher" Part 6 |
| Gamma | 3×3 = 9 | The Unheard / Edge of Darkness 版 |
| Kappa | 4×3 = 12 | Collector 的 "The Fence" |

**Kappa 的物品类型限制是这一节最重要的设计点** ⚠️：安全箱**装不下你的装备**，只能装钥匙、文件、钥匙卡、药品、货币、改装件（不含弹匣/特殊瞄具/部分枪械架）。→ **安全箱保的是"战利品"，不是"装备"**。所以你不可能靠塞满安全箱来免除风险。

### A1.3 Scav（零风险局）

⚠️：免费随机配装、中途加入进行中的 raid、**没有安全箱**、不给 PMC 经验、不算 PMC 任务、20 分钟基础冷却、遇到 AI Scav 前不会主动攻击。

**Fence 声望（Scav karma）** —— ✅ https://tarkovkit.com/en/guides/beginner/what-is-tarkov ：
- 作为 Scav 成功撤离 **+0.01**
- 击杀曾朝 Scav 开火的 PMC **+0.02 ~ +0.03**
- 击杀 Scav **扣分**
- 声望**只在整数位生效**；6.0 = Fence LL2 + 折扣标签；拿 Kappa 需要 3.0

**设计意义**：Scav 是**免费的学习通道 + 输了不亏的兜底节奏**。新手前 5–10 局建议全玩 Scav。

### A1.4 商人忠诚度（Traders）

✅ **数据质量最高的一节**，来自 https://tarkovkit.com/en/guides/yeni-baslayan/trader-ekonomi ：

**1.1.0.0 的关键改动：忠诚度不再要求交易额门槛。**

| 商人 | LL2 | LL3 | LL4 |
|---|---|---|---|
| Prapor | 6 级 / 0.7 声望 | 21 / 2.7 | 36 / 7.9 |
| Therapist | 5 / 0.6 | 18 / 2.1 | 37 / 5.8 |
| Skier | 7 / 0.6 | 22 / 2.1 | 38 / 5.8 |
| Peacekeeper | 8 / 0.5 | 19 / 2.2 | 37 / 6 |
| Mechanic | 12 / 0.6 | 26 / 2.3 | 40 / 7.6 |
| Ragman | 12 / 0.5 | 27 / 2 | 42 / 6.5 |
| Jaeger | 9 / 0.6 | 17 / 2.1 | 33 / 7.3 |

**回收价 = 底价 × 固定系数**（tarkovkit 称用 tarkov.dev 数据校验了全部 19,420 条回收价）✅：
`Therapist 51% / Ragman 50% / Jaeger 48% / Mechanic 45% / Prapor 40% / Skier 39% / Peacekeeper 36% / Fence 24%`

**跳蚤市场门槛** ✅：PMC 15 级解锁市场（无任务）；大多数钥匙和**所有背包**要 25 级；22 种 injector 里 20 种要 30 级；显卡 40 级；4,979 件物品中 **1,383 件永远无法在市场挂单**。

✅ 官方 1.1.0.0 经济调整：商人**卖出价（玩家买）涨约 25%**，**回收价（玩家卖）降约 20%**，跳蚤市场手续费 **3% → 5%**，原先锁在任务后的商店条目改为"达到忠诚度即解锁"。

⚠️ **冲突警告**：多个中文 SEO 站仍写"Prapor LL2 = 15 级 + 0.20 声望 + 750k 卢布消费"，与 ✅ tarkovkit 的 1.1.0.0 后数据**直接矛盾**。以 tarkovkit 为准。

### A1.5 Raid 内时间压力

✅ 官方补丁确认：
- **MIA 机制存在**：未在 raid 结束前撤离或脱水死亡 → 保险不生效
- 1.1.0.0 重做了"跨地图转移"的经验倍率；1.1.5.0 调整了转移 XP 倍率，**1–2 次转移从更低值起步、渐进上升** → 官方把"连续转移"做成了有递增奖励的外勤链条
- 1.1.5.0 Lighthouse 重做：补丁明写"为了**让玩家更能掌控穿行时面临的风险、减少对随机因素的依赖**"，改动包括移除水处理厂固定武器、**移除所有地雷**、给主干道开阔区加掩体与额外路线

❌ **未取得**：当前各图 raid 时长（15/30/45 分钟）、hydration/energy 具体衰减速率。唯一来源是 0.12 之前的中文 wiki 镜像，**必然过期，不建议采用**。

### A1.6 ★ 哪些机制在制造"贪婪 vs 保命"的决策点

| # | 机制 | 制造决策的方式 | 可迁移到 Canvas 2D 割草的形态 |
|---|---|---|---|
| 1 | 背包格子 + 体积双约束 | 拿第 N 件必然挤掉一件保命物资 | 掉落物与丹药/护符**同池竞争** |
| 2 | 安全箱容量阶梯（4→12 格） | 战利品再肥也塞不进；装备占身体位不能进箱 | "灵龛"固定 4 格，升级到 8 格，奖励是**容量不是数值** |
| 3 | 保险返还延迟（1h/6–10h/12–20h） | 赌"这一趟死了我多久能再起" | 失败后强制"休整 N 局"才能再出发 |
| 4 | **保险领取窗口（1d/7d/10d）** | 拿回来了不领就永久没了 —— **第二层贪心** | 结算页出现"立即提取 / 存入库房"，存入即开始倒计时 |
| 5 | **MIA 不赔** | "时间到了还没撤"比"被打死"更亏，逼迫**主动丢装备止损** | 回合结束可"弃符遁走"：保留 X%，代价是放弃剩余回合 |
| 6 | 条件撤离点（需卢布/钥匙/电力/合作） | 最近出口不能用，必须绕路 | 3 类撤离：免费但远 / 付费（灵石）/ 需"信物" |
| 7 | 撤离点随机开放（`?` 状态） | 出发时不能确定能走哪个出口 | 每次局开始随机激活 2/5 个撤离点 |
| 8 | Scav 作为零风险支线 | 输了也不亏 + 学习通道 | "历练"模式：白板出门，活着带回的都归你 |
| 9 | 商人忠诚度门槛（等级 + 声望） | 想用更好的装备得先花 N 局做任务 | 门派声望线，用"跑图"而非"捡垃圾"推进 |
| 10 | **Found in Raid 标记** | 藏身处制作物等同 FIR → 逼你出门，不许纯挂机 | 洞府炼制的道具带"历练印记"，只能靠跑图产出 |
| 11 | 保险欺诈（丢弃投保物） | 官方不惩罚，玩家用它换装 | 可保留为高级技巧，但**建议显式封掉**否则破坏经济 |

> **核心洞察**：Tarkov 的"贪"从来不是"敢不敢多拿一件"，而是"**敢不敢多待一个回合**"。时间是唯一真正稀缺、无法用钱买的资源；保险/安全箱/Scav 全都是"买时间"的手段。**这个结构可以 1:1 搬到回合制：每多搜一个房间 = 多花一回合 = 撤离窗口更近。**

## A2. 开源 extraction 类游戏项目 —— **没找到**

### 🔴 最重要的结论

> **没有找到任何有社区规模的真正同类型开源 extraction 游戏。**

GitHub 上 `extraction shooter` 关键词的头部结果**绝大多数是外挂/作弊工具**（`knobbyspeak/wardogs-cheat-menu` 14★、`Genissahanaa/Marathon-Training-Assistant` 6★ 等），不是游戏。`hunt showdown open source` 关键词返回**空结果**。真正的游戏项目全是个位数 star 的个人原型。

### 实际存在的相关仓库（全部 GitHub API 实测 ✅，2026-10-10）

| 仓库 | Star | 语言 | License | 最后 push | 性质 |
|---|---|---|---|---|---|
| `Cholopol/Cholopol-Tetris-Inventory-System` | 74 | C# | Apache-2.0 | 2026-08-24 | **不是游戏**，Godot 4.x 塔科夫式俄罗斯方块背包系统（MVVM） |
| `SinlessDevil/TetrisInventorySystem` | 47 | C# | MIT | 2026-05-06 | 同上，Unity 版 |
| `Make-Tarkov-Great-Again/MTGA-JS` | 40 | JavaScript | MIT | 2023-10-05 | **已 archived（弃坑）**，Tarkov 私服模拟服务器 |
| `Fedorse/loot-raiders` | 8 | TypeScript | MIT | 2026-07-14 | "inventory-management extraction game built with Svelte 5" —— **技术栈最接近你的需求（浏览器/前端）** |
| `Menacing/unnamed-extraction-shooter-roguelike` | 8 | GDScript | MIT | 2026-01-21 | Godot 原型，**连 README 描述都是空的** |
| `ZioPao/RemnantsOfKentucky` | 7 | Lua | GPL-3.0 | 2024-04-25 | GMod 模组，Tarkov + Project Zomboid 混合 |
| `furmonenko/the-fog` | 5 | GDScript | 无 | 2026-07-13 | "2D top-down PvE extraction shooter"，Godot 4.7，一次性提交 |
| `Kimrral/Eclipse` | 3 | C++ | 无 | 2026-06-23 | UE 5.1.1 extraction looter shooter |
| `fishyCoding/raidgame` | 3 | GDScript | **无 license** | 2026-09-15 | "2D extraction shooter in Godot 4.7 - go in, take what you can carry, get out" |

**可以用的**：
1. **真正有价值的是那两个背包系统库**（74★ Apache-2.0 / 47★ MIT）—— 塔科夫式网格背包的**旋转/自动整理算法**是这类游戏最麻烦的部分，C#/Godot/Unity 但算法可读可移植。
2. `Fedorse/loot-raiders`（Svelte 5，MIT）—— 设计和意图最接近你，但只有 8 star，需自己判断质量。

❌ **没找到**：任何 100★ 以上的开源 extraction 射击游戏；任何"零依赖零构建原生 ESM + Canvas 2D"的同类参考。**这是一个真实的空白，不要假装有。**

## A3. 搜打撤的核心资源张力

### A3.1 设计流派清单

| 流派 | 机制名 | 谁在用 | 核实 |
|---|---|---|---|
| **纯全损** | Gear full-loss | EFT；**Hunt: Showdown 更狠——丢掉的不只是装备，还有猎人本体和天赋** | ⚠️ |
| **安全箱兜底** | Secure Container（希腊字母阶梯） | EFT | ⚠️ |
| **保险返还** | Insurance（概率返还 + 延迟） | EFT，Jaeger 为新增第 3 家 | ✅ |
| **装备持久化减损** | Gear Persistence（死亡仍保留部分装备） | Gray Zone Warfare | ⚠️ |
| **价值型保险** | 按价值赔付而非原物返还 | Marathon | ⚠️ |
| **零装备损失** | 只有"撤离失败"是惩罚 | Shell Runner | ⚠️ |
| **条件撤离点** | 免费/付费/需钥匙/需合作 | EFT | ⚠️ |
| **免费角色局** | Scav run | EFT | ⚠️ |
| **局外保险升级** | IC 减保险返还时间 / 减市场抽成 | EFT | ✅（IC L3 → 市场抽成 −30%）/ ⚠️（IC L2 → 保险 −20%） |

⚠️ **提醒**：关于 Marathon / GZW / Shell Runner 的描述来自一个疑似 AI 批量生成的 SEO 站，**未交叉验证，当"待验证的设计假说"看，不是事实**。

### A3.2 ★ 失败损失的梯度设计 —— 本节最有价值的一条

### ✅ EFT 1.1.0.0「新手支援邮件」（Beginner Support Mail）

官方补丁英文原文 —— ✅ https://www.updatemonitor.com/app/3934890/news：
> "The system can now more accurately detect when players are in a difficult financial and gameplay situation. Players who die in a raid with almost no money or equipment may receive a support message."

中文补丁原文 ⚠️（同源）：
> "新手支援邮件系统现在可以更准确地发现遇到困难的新手玩家；**处于极度经济困难及装备短缺状态下的玩家，在战局中阵亡后将会收到支援邮件**，其将包含一个特殊的支援物品箱，**提供足以全装开启一次战局的装备**；**支援物品箱在 18 小时内仅能获得一次**，并且**玩家需要在收到邮件的 18 小时内领取**。"

**四条可提炼的设计要素**：
1. **触发条件是"状态"不是"次数"** —— 不是"你死了就补"，而是"你穷到几乎没钱没装备**而且**死了"。系统自动检测，不打扰正常玩家。
2. **补给刚好够打一局全装** —— 恢复的是**行动能力**，不是**数值上限**。
3. **18h 冷却 + 18h 领取窗口** —— 频次封顶防刷，且过期作废（制造"你可能错过"的小焦虑，但没有惩罚性损失）。
4. **邮件被动送达** —— 玩家不上线就收不到，不强制打断行为。

> **→ 对你的项目的直接建议**：把"输麻了"的兜底做成**检测式、一次性、刚好够打一局**的补给包，而不是死亡补偿货币。这几乎可以照搬，20 行代码。

### ✅ 1.1.0.0 的其他"降低挫败"改动（同源补丁）

- 战术服**永久绑定账号**，"无需在重置存档、转生或创建赛季角色后重新购买"
- 工作台不再是武器改装的前置，"**游戏开始时即可使用武器改装系统**"
- 藏身处 1–3 级**简化建造需求、缩短建造时间、部分材料取消 FIR 要求**
- 商人**取消交易额门槛**
- 支线任务重做为"2–4 个任务为一组、按忠诚度分级"，奖励以钞票/经验/信任度为主

> **设计读法**：BSG 做的是**把新手的必经之路变短**，而不是"给新手发装备"。**你的局外 meta 不该是一堵需要爬完的墙。**

### ⚠️ 其他游戏的止损设计（低可信来源，待验证）

- **ARC Raiders**：「免费装备 + 充足但不强制战斗的掠夺机会构成一张'安全网'，让玩家即便失败也能迅速重返战场」；匹配系统尽量避免单人玩家面对满编小队，使"避战/潜行/见好就收"成为可行策略 —— ⚠️ https://news.qq.com/rain/a/20251229A07N7A00
- **反面教材 Call of Duty DMZ**：「前提设定不错、想法也聪明，但**赌注几乎不存在**。如果死亡只损失一把枪和几分钟时间，就没有理由换一种打法来玩」 —— ⚠️ https://gam3s.gg/news/why-most-studios-struggle-to-make-a-successful-extraction-shooter/
- **损失厌恶**（Kahneman & Tversky）：失去的痛感约为等量获得快感的两倍 —— ⚠️
- **近失效应**：剑桥对简化老虎机任务的脑成像发现，"差一点赢"激活的奖赏回路与真赢**大部分重叠**，且在玩家觉得自己有控制权时**显著增强再玩欲望**（Neuron 期刊）—— ⚠️

### ❌ 关于 GDC / Game Developer 的检索

**没找到**任何 GDC Vault 上专门讲 extraction shooter 设计的公开演讲。`gdcvault.com` 搜索页需登录，`gamedeveloper.com` 403、`polygon.com` 502、`kotaku.com`/`gamespot.com` 403。这些渠道在本环境无法完成原文核实。

## A4. 局外 meta 进度：stash / 藏身处

### A4.1 Hideout 模块化（✅ 官方补丁 + ⚠️ 旧 wiki）

✅ 1.1.0.0 / 1.1.5.0 确认：1–3 级建造需求简化、部分材料取消 FIR、建造耗时缩短、多数模块新增钞票要求；武器改装从开局可用；1.1.5.0 上线藏身处装饰套装（纯外观变现口）。

⚠️ 模块效果（fandom 中文版藏身处页，**0.12 时代数据，1.1.0.0 后已改版，务必实机验证**）：

| 模块 | 关键效果 |
|---|---|
| **Intelligence Center** L1/L2/L3 | Scav 冷却 −15%/−35%；保险返还 **−20%**（L2）；跳蚤市场手续费 **−30%**（L3）；解锁 Fence 的 Scav 任务 |
| **Heating** L1–3 | 能量恢复 +3/+7/+14 EP/hr；**负效果移除率 −10%/−50%**；L3 额外 +10 最大能量 |
| **Water Collector** L1–3 | 水分 +6/+18/+42 WP/hr |
| **Generator** L1–3 | 燃料槽 +2/+4/+6 |
| **Solar Power** L1 | 燃料消耗 **−50%** |
| **Bitcoin Farm** L1–3 | 显卡槽 +10/+25/+50 |

**发电机的隐藏耦合（Tarkov 局外 meta 最狠的一处）** —— ⚠️：藏身处**全部**生产模块**共用燃料**，每单位燃料供全 hideout **12 分 28 秒**（建成 Solar 后 **25 分 16 秒**）。**你不出去，洞府就停转。**

**比特币农场的留存钩子** —— ⚠️：**3 个 BTC 未领取即停产**（有精英技能则 5 个）→ 逼迫玩家定期上线领取。极限线性收益：**无论多少卡都需约 56 天回本** → "如果删档周期短于 56 天，矿场最多放一张卡"。

### A4.2 stash 作为硬约束（⚠️ 两组数字冲突，不裁决）

| 来源 | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| Fandom 中文（旧）| 10×28 | 10×38 / 350万₽ / 24h | 10×48 / 850万₽ / 48h | 10×68 / 20万欧 / 96h |
| 另一修订版 / 镜像 | 10×26 | 10×36 | 10×46 | 10×66 |

其他可确认机制 ⚠️：
- **箱中箱**：物品箱本身占 16 格（4×4）但能装 64 格（8×8）→ 仓库不够时把仓库"折叠"进箱子
- 跳蚤市场成交后由 Ragman 邮寄，**7 天内领取，过期消失**
- 安全箱、实体比特币、货币无法在市场出售

> **stash 作为硬约束的设计要点**：它不是"格子不够就打折"，而是"**格子不够就必须改变玩法**"。Tarkov 的解法是三条同时存在：① 卖（回收价只有底价的 24%–51%）；② 折（箱中箱）；③ **送**（安全箱里的东西永久占死那几格）。**第 ③ 条最狠**——它让"你保住了"和"你还有空间用"变成一对不可调和的矛盾。

### A4.3 擦除（wipe）

✅ **1.1.0.0 引入赛季系统**（本次调研中最重要的结构性变化）：
- 新增**赛季角色**，独立服务器，与 PvP Zone / PvE Zone 互不关联
- 赛季角色**每 4–6 个月删档一次**
- **全局赛季效果**（所有人生效）+ **个人赛季效果**（自选，负面加点数、正面减点数，**总点数必须 ≥ 0** 才能创建角色）
- 赛季奖励解锁后所有模式可用；赛季结束时**未解锁的永久锁定**
- **保险在 PvP 赛季模式中被完全禁用**
- 战术服**跨赛季保留**
- 1.1.5.0 新增 Leagues 联赛：每周按经验排名，50 人一组，周 Top 25 晋级 / 15 保级 / 10 降级

**wipe 的动机（三条）** —— ⚠️：① 经济通缩（中期高价值物品泛滥 → "死亡不再有代价"）；② 拉平装备差；③ 开发测试。
**wipe 的代价**：时间、技能、商人信任度、仓库、藏身处归零；**但地图知识、弹药知识、操作水平不归零**。

### A4.4 ★ meta 如何与"搜打撤"耦合而不是变成刷刷刷

以下为**基于上述已核实机制的结构分析**（非引用）：

**A. meta 产出必须标记 FIR** —— ✅ 藏身处制作的物品**全部**被标记"战局中找到"。→ **洞府不能代替跑图，只能放大跑图。** 这一条直接杜绝挂机刷刷刷。

**B. meta 增益必须作用在"局内决策"上，而不是"局外数值"上**
- IC L2 → 保险 **−20%**：是**时间**不是**强度**
- IC L3 → 市场抽成 **−30%**：是**流动性**不是**战力**
- Heating → 下一局的**起手状态**
- **没有一个模块直接加攻击力。** 藏身处给你的是**选择权**，不是**数值**。这是它没变成刷刷刷的根本原因。

**C. 用"持续消耗"绑定注意力，而不是"一次性解锁"绑定时间**
- 发电机燃料：不出去就停转
- 比特币农场：3 个不领就停产
→ 局外系统不是一次性奖励，而是**持续运行的第二局**。

**D. 局外的空间本身是局内的对手**
- 仓库格子 = 你真正能用的装备数量上限 → 仓库小 → 局内选择变少
- 安全箱 4 格 vs 12 格 = **永久性容量惩罚**，且**不能花钱直接买**（要任务）

> **→ 给你的最小可行 meta 建议（三条，缺第四条就会变刷刷刷）**：
> 1. 洞府造的东西带"历练印记"，只能靠进图获得 → 禁止挂机产出
> 2. 洞府给的**全部是"减少摩擦"的东西**（多一次撤离机会、多一格灵龛、失败返还更快），**没有一个加伤害**
> 3. 洞府**有持续维护成本**（灵气/香火，按局数或按时间扣）→ 逼你继续进图

---

# B. 骑马与砍杀（Mount & Blade）

## B1. 核心循环拆解

### B1.1 士气（Morale）—— 机制最完整的一块

**定义** —— ⚠️ https://mountandblade.fandom.com/wiki/Morale：士气"represents the ability and willingness of the troops in a party to summon up the endurance, bravery, and discipline they need to face the stresses of battle and the march"，且明确"**不等同于幸福度**"——精锐兵可以一路抱怨行军苦楚，但箭雨来时仍并肩作战。

**士气影响的四条轴**：① 战斗中的进攻强度与崩溃倾向 ② 战斗中移动速度 ③ **行军速度**（士气低走得慢，频繁停下等掉队的人）④ 极低士气 → 逃兵。

**Bannerlord 战场士气算法（官方一手描述）** —— ⚠️ https://www.taleworlds.com/en/Games/Bannerlord/Blog/128：
- 战斗开始时，**每个士兵按 party 整体士气获得一个初始士气值**
- 之后：每有一个友军被击杀或重伤（**最多累计 10 次**），附近友军获得士气惩罚；惩罚大小由**指挥官的技能与专长**修正；附近友军取得击杀时获得士气加成
- **连锁崩溃**：某个士兵恐慌逃跑 → 对周围士兵再造成士气惩罚 → **少数人跑动足以引发连锁反应，整个阵型崩盘**
- 官方自比：1461 年托顿战役，"据说**溃逃造成的损失超过战斗本身**"

**数值锚点** —— ⚠️：
- **基础士气恒为 50**，低于 50 即为负
- 减益项包含**队伍规模**（士兵越多士气惩罚越高）和**俘虏**（Bannerlord 囚犯上限 = 队伍人数上限的一半）
- 每招募一名愿意的俘虏，队伍士气 **−3**，Camp 菜单每 24 小时只能尝试一次
- 军饷：低级兵约 5 denar/周，高级兵约 12，精英兵最高 17

**Rout（溃逃）的结算规则** —— ⚠️：
> "A winner is declared once one side of a simulation battle runs out of either troops or morale. If the losing side runs out of morale before it runs out of troops, **a rout is triggered**. During a rout, every hero is wounded and every remaining troop is immediately lost."

> **→ 对小体量项目的直接启示**：不必做"士兵实时士气 AI"，可以做一个**单值 `team_morale ∈ [-100,100]`**，只在四个时机结算：战斗中每 N 回合按"敌我比 + 己方伤亡"扣减、战败一次性大扣、胜利小加、日常按食物/军饷漂移。**崩溃是二值事件**（`if morale < 0 → 溃逃，全队损失`）——20 行代码就能表达 M&B 90% 的战略张力。

### B1.2 遭遇战 vs 攻城战

Warband 层面确认 ⚠️：敌方部队士气降到阈值就会脱离战斗逃跑；逃跑者**不会被击杀但也无法反击**，且**销毁逃跑者同样会扣全军士气**；**敌军在开战至少 45 秒后才会开始逃跑**（防秒退）；逃跑者离场后在战报里记为 "Routed"，回到战役地图后会**试图逃向最近的定居点**，玩家若尾随追击通常可以**不战而获**。

攻城战略模拟的量化表 —— ⚠️：村庄 +25% 优势；城墙加成基础 **400%**，每升一级 **+100%**（最高 600%），墙体全破则**削减 75%**；攻城方起始 100%，每种攻城塔 +25%（改良 +24%）、每台火系攻城器 +12%、普通攻城器 +8%，上限约 **221%**。

❌ **未取得**：Warband 原始攻城战阶段划分与各阶段数值。

### B1.3 兵种克制（是"地形成 + 阵型"规则，不是硬数值表）—— ⚠️ https://mountandblade.fandom.com/wiki/Battle

- 弓手放**高地**极强：接近的部队被地形减速，骑兵无法获得冲锋动能
- **弓手箭尽后会冲进近战队列被迅速杀死**（关键脆弱点）
- 重步兵（持大盾）放慢推进会自动举盾行进，近距离冲锋"often doom"敌方弓手/弩手/散兵
- 步兵**收紧阵型**可以消除骑兵冲锋后穿阵的缝隙，马直接撞停 —— "**spelling almost certain doom for their riders**"
- **骑射兵（马上的远程）不能被这套步兵阵克制**，但箭尽后被迫冲锋就会很快崩

**Vlandia 的三层防御阵型（最好读的教科书）** —— ⚠️：第一层 Pikemen + Sergeants 架枪吃掉骑兵冲锋；第二层 Billmen + Voulgiers 收割被拦下的残骑；第三层高地 Crossbowmen 火力覆盖。**Vlandia 常规部队完全不训练弓箭**，只依赖弩（换取高伤同步齐射但失去骑射的机动与持续压制）。

### B1.4 ❌ 未取得的项

- **伤兵（Wounded）系统** —— mountandblade.fandom.com 全域被 Cloudflare 挡住，StrategyWiki 返回 403/503。**没有拿到伤兵占编制比例、恢复时间、外科医生技能加成的具体数字。**
- **Warband 队伍规模上限** —— 有"100 人 / 升级到 200"的说法但**无任何可访问来源，不写**。
- **Warband 赎金计算公式** —— 未取得。
- **各兵种确切数值表**（带兵数/阵型宽度/移动速度/单挑强度）—— 未取得。

**Bannerlord 队伍上限**（相对可靠）—— ⚠️：基础容量恒为 **20**；Clan Tier 每级 **+25**（T1–T5）；军需官按 Steward 技能 Lv1 +0.3 / Lv4 +1 / Lv100 +25 / Lv300 +75；终局（Tier 5 + Steward 300）= **220 人**；Clan Tier 需求声望 50/150/350/900/2350/6150。

## B2. 为什么"旅行时会遇遭遇"有效

⚠️ **本节质量偏低，坦白说明**：没打开任何一篇 GDC Vault 演讲或 Game Developer 原文（403）。搜索返回的绝大多数"心理学"文章是明显的 SEO 农场（含赌博站点导流、捏造数据表格的"研究报告站"），**不可引用**。以下只列能追溯到具名研究者/机构的内容。

1. **变比率强化（Variable Ratio Schedule）** —— Skinner 中期实验：奖励在**不可预测的次数后**到达；动物在变比率条件下持续按压率最高，且**最难消退（resistance to extinction）**。强化表对比：固定比率（100 杀换徽章，"中"）/ **变比率（战利品箱、抽卡，"很高"）** / 固定间隔（每日登录，"中"）/ 变间隔（MMO 随机世界事件，"高"）。
   神经机制：Wolfram Schultz 的多巴胺研究发现，多巴胺释放会**从"收到奖励的时刻"转移到"预期奖励的时刻"** → 所以**线索（cue）而非奖品本身承载了情绪重量**。
2. **损失厌恶** —— Kahneman & Tversky 前景理论：失去的痛感约为等量获得快感的两倍。Celia Hodent 在 Devcom 2022 的表述："我们对损失的厌恶非常强，失去已拥有之物的痛苦远大于获得等价物的快乐"。
3. **险局偏好** —— Roguelike 是高风险机制的典型载体；**这个损失本身恰恰是吸引力的一部分，它给了最终的胜利以重量**。另有一项关于 crash/dice/blackjack 玩家行为的研究：**玩家在连胜期会主动提高风险容忍度**。
4. **近失效应** —— "差一点中"激活的脑区与真中奖相同。
5. **叙事包裹 / 决策疲劳** —— ❌ **完全未取得**。这是本节最"设计向"的部分，**不用农场文章凑数**。

> **给项目的可操作替代（判断，非引证）**：把每次"走一格"设计成一个**具名、带具体数字的微型决策**（"绕过山道多花 1 天，但避开 bandit 领地" / "接受护送任务，报酬 X 但延误 2 天"），让不确定性的**代价是可见的日程与粮草数字**，而不是抽象的失败。纯随机奖励会被感知为噪音；带叙事包装的随机奖励才产生"这是我的故事"的归因。

## B3. 队伍/同伴：忠诚度、关系、雇佣

### B3.1 Stardew Valley ✅（唯一完全核实到原文的）

**数值全部核实自 https://stardewvalleywiki.com/Friendship**（curl 已读到正文）：

- **1 心 = 250 好感点**；10 心槽（配偶 14 心）；可攻略对象在**送花束前锁死在 8 心**
- 说话时头像旁的圆圈颜色分档：蓝 0-1、绿 2-3、黄 4-5、红 6-7、紫 8-9
- **每日 1 次赠礼，每周最多 2 次；一周内送满 2 次 → 额外 +10 点**
- **赠礼收益公式**：`Event Multiplier × Preference × Quality Multiplier`
  - Event Multiplier = 1（平日）/ **5**（冬季之星节）/ **8**（生日）
  - Preference = **80（最爱）/ 45（喜欢）**
  - Quality Multiplier = 1 / 1.1 / 1.25 / 1.5
  - **单次送礼理论上限 960 点**（≈ 3.84 心）
- **非攻略对象好感上限 2749 点**（差 1 点到 11 心）—— 硬天花板
- 结婚后上限 3749；分手立即降到 5 心
- 单个心事件最大增益 **+250**；最大损失 **−1500**
- 每天不跟某人说话会小幅降低好感（满心除外）

> **可直接搬的**：Stardew 的关键是 **"单位化的点"（250 = 1 心）作为可数的最小货币**，玩家因此能心算"再 2 个礼物"。同时**上限刻意设为 2749（差 1）**，制造"永远差一点点"的未完成感——**极低成本的动机装置**。

### B3.2 RimWorld ⚠️（rimworldwiki.com 被 Cloudflare 挡）

- 心情 0–100%；**基础心情按难度**：Peaceful/Community builder **42**、Adventure story 37、Struggle to survive 32、Blood and dust 27、Losing is Fun 22
- 心情条追向"心情目标三角"，上升最快 **+12/游戏小时**，下降最快 **−8/游戏小时**（**不对称：恶化比改善快 1.5 倍**）
- **精神崩溃阈值三条线：轻微 35% / 重大 20% / 极端 5%**
- **阈值不是即时的，是计时器**：低于轻微线约每 4 天掷一次崩溃；低于重大线约每 0.8 天；低于极端线约每 0.5 天。**睡觉时计时器暂停**
- 灵感公式：`MTB = 410 − (400 × mood/100)`，且 mood 必须 ≥ 50。50% → 210 天/次；70% → 130 天；90% → 50 天；**100% → 10 天**
- **Expectations 机制（很妙的反向压力）**：殖民地财富 >308000 → 期待值 **0**。**变强本身会降低心情** —— "你正在流失曾经免费拿到的 30 点缓冲"
- 特质永久影响：Sanguine **+12**、Optimist **+6**、Pessimist **−6**、Depressive **−12**

> **可直接搬的**：RimWorld 的 **(数值条, 目标三角, 阈值线, 计时器) 四件套**是"小体量做士气系统"的成熟范式。**+12/−8 的不对称爬升率**和"低于阈值不是即崩而是按概率烧时间"这两条尤其值得抄——后者让危机有预警窗口。

### B3.3 ❌ 未取得

- **Mount & Blade 同伴系统**（skills/英雄特质/忠诚度对加入意愿的影响）—— wiki 全被挡。只能确认同伴可担任 Scout/Engineer/Quartermaster/Surgeon 四个职务且**只能担任一个** ⚠️；同伴上限由 Clan Tier 从 5 决定到 9 ⚠️；**不要把互相反感的英雄配在一起** ⚠️
- **Dragon Age: Origins 好感/送礼阈值** —— 未取得
- **Divinity Original Sin 2 忠诚度分歧阈值** —— 未取得。⚠️ **重要警告**：搜索返回的中文结果里有"艾丽丝好感≥80、支线任务 87% vs 32% 成功率"这类**明显的 AI 生成投毒内容，绝不引用**
- **Kingdom Come: Deliverance** —— 未检索

## B4. 开源的 Mount & Blade 类项目

### B4.1 真正对口的两个（✅ GitHub API 实测）

**`cookgreen/OpenMB`** ✅ — https://github.com/cookgreen/OpenMB
> "Open Source role-playing game engine for Taleworlds' Mount&Blade Series written in **C# using Ogre3d Engine**"
- **142★ / 21 forks**，GPL-3.0，C#，仓库 148 MB；创建 2016-09-21，**最后 push 2026-07-21**（仍活跃）
- 特性：多张世界地图、可自定义物品类型、真实物理、独立脚本系统、Mod 系统、多语言、内置游戏编辑器
- 技术栈 Mogre 1.7.4 + MyGUI 3.0.2 + PhysX 2.8.4，.NET Framework v4.8
- **不适合你的项目**（C# + Ogre3D + 148MB），但它是**唯一真正的"M&B 引擎开源重实现"**

**`srknzl/Webband`** ✅ — https://github.com/srknzl/Webband
> "A Mount & Blade: Warband-style single-page RPG that runs entirely in the browser. **No build, no server, nothing to install.**"
- **1★ / 0 forks**，AGPL-3.0，JavaScript，56 MB；创建 **2026-09-06**，最后 push **2026-10-08**（极新）
- 技术：原生 JS + **PixiJS**（vendor 目录内固定版本）+ HTML5 + Service Worker(PWA) + Capacitor
- 内容：程序化 Calradia 地图、5 王国、23 男爵 12 女爵、道路/河流/森林、**实时俯视战斗含阵型与士气、伤害类型、盾、攻城**、逐商品供需市场、任务、赛事投注、竞技场、求爱与结婚、劫村、封地与封臣
- ⚠️ **它有 `docs/SYSTEMS.md`（每个机制的"设计决策 + 实测数字"）和 `tools/` 下的无头模拟/平衡工具** —— 这份文档本身可能比代码更有参考价值

**搜索结论**：GitHub 搜 `mount blade` 共 **909 个仓库**，按 star 排序前 10 里 **9 个是 Bannerlord 的 mod/汉化/文档/工具**，只有 OpenMB 是引擎级项目。**没有任何高星的、零依赖前端 M&B 类开源项目。**

❌ **没找到**：JavaScript 实现的 M&B clone（Webband 算是唯一接近的，但只有 1★）、任何可复用的"赶路+遭遇+队伍"前端框架。

### B4.2 成熟开源策略/RTS 项目活跃度（✅ GitHub API 实测 2026-10-10）

| 项目 | Stars | License | 最后 push |
|---|---|---|---|
| **OpenRA/OpenRA** | **17,522** | GPL-3.0 | **2026-10-09** |
| **Widelands/widelands** | 3,093 | GPL-2.0 | 2026-10-08 |
| **freeciv/freeciv** | 1,602 | GPL-2.0 | 2026-10-09 |

三个项目**全部在近 24 小时内有 push**。OpenRA 官网 https://www.openra.net/ ✅ 最新进展 **Playtest 20260222**：全新随机地图生成器、地图编辑器 Path Tiler 工具等。

---

# C. 开放世界 + 节点地图的成熟开源方案

## C1. 地图编辑器 2026 状态（✅ GitHub API 实测 2026-10-10）

| 工具 | 最新 release | 发布日期 | Stars | 最后 push | License |
|---|---|---|---|---|---|
| **LDtk** `deepnight/ldtk` | **v1.5.3** | **2024-01-15** | 4,309 | **2026-10-09** | MIT |
| **Tiled** `mapeditor/tiled` | **v1.12.2** | **2026-05-27** | 12,952 | 2026-09-25 | GPL(源码)/BSD-2(libtiled) |
| **Ogmo Editor 3 CE** | 官方站标 v3.4 | ❌ 未找到确切日期 | 592 | **2024-06-19**（停更 ~2 年） | MIT |

**三个关键结论**：

1. **LDtk 是"持续维护但不发版"** —— 最后 commit 就在调研前一天，但最新 release 停在 2024-01-15 的 1.5.3，**两年零九个月没发正式版**。→ **可以放心用它的 JSON 格式（格式已冻结稳定），但不要指望它新功能。**
2. **LDtk 的 World 布局有 4 种** —— Linear horizontal / Linear vertical / **Free** / **GridVania**。其中 **GridVania = "关卡排在 2D 网格上，且每个关卡尺寸被约束到 world grid"** —— 这几乎就是你现在的 3×4 节点网格的官方对应物。✅ https://ldtk.io/docs/general/world/（文档更新日 2024-01-04）
3. **Ogmo Editor 3 是 2D 编辑器**（常见误解）。✅ https://ogmo-editor-3.github.io/ 明确写 "free, open source, project oriented **2D** level editor"，输出 JSON 文件。

> **选型建议**：既然**永远不能引入构建工具**，三个编辑器都只是"离线产出一份静态 JSON"的角色，不是运行时依赖。LDtk 胜在两点：① JSON 格式是第一公民，字段设计（`__identifier` 稳定 UID、`__neighbours` 邻接表、`toc` 自动目录）可直接照抄；② MIT 无授权风险。**Tiled 的数据格式本身没问题，但你不能把它的代码抄进你的项目。**

## C2. 程序化世界生成的主流做法

### C2.1 噪声地形

| 噪声 | 适合 | 关键参数 | 陷阱 |
|---|---|---|---|
| **Perlin** | 通用高度场、丘陵 | fade 函数 `6t⁵−15t⁴+10t³`；格点随机梯度插值 | **方向性伪影明显** |
| **Simplex**（2002，Perlin 提出） | d 维只需 **d+1** 次求值（Perlin 是 2^d），4D 快约 30%，**2D 是三角格**，几乎无方向伪影 | — | 实现略复杂 |
| **fBm** | 多倍频叠加造山 | **lacunarity 2.0、gain 0.5 是惯例** | **必须按振幅归一化**，否则值域冲出 0–1 |
| **Worley / cellular**（1996, Steven Worley） | Voronoi 状结构：岩层、裂纹、细胞洞穴 | 取 F1 / F2−F1 | 无方向性但也无"山脉"感 |

**RBG《Making maps with noise functions》的可执行参数** ✅ https://www.redblobgames.com/maps/terrain-from-noise/：

- 频率写法：`elevation[y][x] = noise(x/wavelength, y/wavelength)`，`wavelength = map_size / frequency`
- 倍频：`e = 1·noise(nx,ny) + 0.5·noise(2nx,2ny) + 0.25·noise(4nx,4ny)`，然后 `e / (1+0.5+0.25)` 归一化
- **两条最实用的硬技巧**：
  - **各 octave 必须去相关**。同一 seed 下 `noise(nx)` 和 `noise(2nx)` 在原点附近高度相关。解法：每 octave 加不同偏移（`+5.3,+9.1` / `+17.8,+23.5`）或用不同 seed。
  - **Perlin 要旋转 octave 输出或直接换 Simplex**，否则出现可见的方向条纹。
- **重分布（造平原）**：`elevation = pow(e, exponent)`，典型 `exponent = 1.2 ~ 3`
- **两个噪声分生物群系**（比单噪声强得多）：elevation + moisture 二维查表
- **岛屿成形**：`d = 1−(1−nx²)(1−ny²)`（方形）或 `d = min(1,(nx²+ny²)/√2)`（圆形岛），然后 `e = lerp(e, 1−d, mix)`，**`mix = 0.5` 效果最好**

### C2.2 POI 放置算法对比

| 算法 | 复杂度 | 适用规模 | 适合你的场景 |
|---|---|---|---|
| 纯随机 / dart throwing | O(n) | <200 点 | ❌ 会扎堆 |
| **泊松盘采样（Bridson）** | **O(n)**（网格加速，cell = r/√2） | 中大规模 | ✅ **首选**，给"节点不重叠"提供保证 |
| 蓝色噪声 | 预计算可查表 | 大规模 | ✅ "均匀又不呆板" |
| **Mitchell best-candidate** | O(n·k)，k=30 | 中小 | ✅ **实现最简单，20 行** |
| Delaunay 三角剖分 | O(n log n) | 全局拓扑 | ✅ 做**寻路图**而非点分布 |
| 权重化采样 | 依权重表 | — | ✅ 必配：区域权重 × POI 类型权重 |

**泊松盘的三个必踩的坑** ✅ https://devmag.org.za/2009/05/03/poisson-disk-sampling/：
1. **最小半径别太小** —— 可能产生百万级点；半径为 0 会导致算法**永不结束**（**必须加 bail-out 迭代上限**）
2. 最大半径别太大 —— 会导致采样几乎出不来点
3. **衰减区用 `sqrt(distance)` 而不是 `distance`**，否则新点恰好落在衰减边界上会排除掉远超预期的点

**变半径版是最实用的**：喂一张灰度图调制最小距离，`min_dist = min_radius + grey·(max_radius − min_radius)`。**用 Perlin 驱动最小距离 → 自然的对象成簇效果 —— 对你的水墨"山水聚散"主题是现成的解法。**

**空间统计学词汇（值得抄进设计文档）**：
| 术语 | 含义 | 对应机制 |
|---|---|---|
| Poisson process | 点互相独立，强度 λ | 无碰撞 dart throwing |
| **hard-core process (Matérn I/II)** | Poisson 过程抽稀到无两点距离 < r | "先到先得"的拒绝采样 |
| **cluster process** | 隐形父点 + Poisson(μ) 子点 | **"一丛松林" = 一个父点 + 若干松树** |
| aggregation index (Clark–Evans R) | 平均最近邻距离 / Poisson 期望 | **一个数字量化"生成得够不够随机"，可做自动拒绝阈值** |
| determinism | `hash(seed, salt, x, z)` 逐特征取随机 | **避免单流 RNG：上游改一个参数会把下游全部重排** |

### C2.3 区域划分

- **Voronoi + Lloyd 松弛**：随机撒种子 → 求 Voronoi → 每种子移到胞元重心 → **迭代 2–3 次**。结果大小均匀、形状规整。RBG 的 Realm of the Mad God 生成器用的就是这个。✅ https://www.redblobgames.com/maps/mapgen2/
- **Watershed**：RBG mapgen4 用"模拟蒸发、风、降雨"从手绘山谷海洋推出**河流水系** ⚠️

### C2.4 经典论文/演讲

**Ubisoft《Procedural World Generation of "Far Cry 5"》GDC 2018，Etienne Carrier** —— ✅ https://www.gdcvault.com/play/1025215/ ；讲稿笔记 ✅ https://tools.engineer/gdc2018-procedural-world-generation-of-far-cry-5

**这个 talk 的价值对你的规模刚刚好** —— 它讲的是"怎么在设计期用规则填满 100 km² 的荒野"，不是炫技。核心概念：

| 术语 | 定义 |
|---|---|
| **map** | 世界中不同时加载的部分 |
| **section** | map 的一部分，256m × 256m |
| **sector** | section 的一部分，64m × 64m，是世界中**可被 bake 的最小粒度** |
| **recipe** | 给定一组输入、决定某位置需要放哪些实体的一组规则 |
| **POI** | 地图上一个**预留给用户手工编辑**的位置 |

**三条管线铁律**：① **确定性**（同输入必同输出，因为世界分 map 生成，map 之间必须无缝拼接）；② **工具链顺序化**（活水工具写 water mask → 生态工具读它驱动物种生成）；③ 夜间在 build farm 上全量重生成。

**《Building Worlds Using Math(s)》GDC 2017，Sean Murray（No Man's Sky）** —— ⚠️ 分层噪声产地形 + 人工规则管"哪些组合是合法的"。**最重要的教训是"燕麦粥问题"（the oatmeal problem）**：玩家跑十几个星球后新星球不再"感觉新"了。**后续更新不是改噪声，而是加高对比度、可辨识的类别差异。**

❌ **没找到**：Ubisoft 有一份专门讲"开放世界世界生成"的独立 GDC talk。流传的"Ubisoft world generation GDC talk"大多指 Far Cry 5 那一篇。

## C3. 开放世界的数据结构：chunk / sector / region

### C3.1 业界怎么组织

1. **map / section / sector 三级** —— Far Cry 5 的定义见上（256m / 64m）。**这是"开放世界分块"最干净的三层语义** ✅
2. **UE5 World Partition + Data Layers** —— 世界切成网格，cell 可处于 loaded/unloaded/streaming 三态；Data Layers 做昼夜/天气/任务阶段的分层开关 ⚠️
3. **quadtree / octree** —— 插入 O(log n)，范围查询 O(log n+k)。⚠️ **浏览器里的已知坑：对象分配和指针追踪会触发 GC 抖动。**"**如果你的点大致均匀且大量移动，用均匀网格更好——O(1) 更新胜过每帧 O(log n)。**" ✅
4. **spatial hashing** —— 查询期望 O(1)，构建 O(n)。✅ 实测数字（10,000 物体）：暴力两两 = 5000 万次/帧；网格按物体直径设 cell、约 1 物体/cell 时每物体探 9 格 ≈ 9 个物体 → **约 9 万次，减少约 550×（150ms → 0.27ms）**。cell 取"最大物体直径"是甜点。
   **JS GC 陷阱** ⚠️：**不要用模板字符串 `${cx}:${cy}` 做 key**。用打包整数 `(gx << 16) | (gy & 0xFFFF)`，并复用 bucket 数组（`bucket.length = 0`）而不是每帧新建。

### C3.2 Minecraft Region File —— 最成熟的分块存储范例（✅ 全文实读）

来源：https://minecraft.wiki/api.php?action=parse&page=Region_file_format&prop=wikitext&format=json
（注：直接访问 minecraft.wiki 的 **HTML 页**被反爬挡住，但 **MediaWiki API 可直连** ✅）

| 要点 | 值 |
|---|---|
| 每文件 chunk 数 | **32 × 32 = 1,024 个 chunk** |
| 覆盖范围 | 512 × 512 方块 |
| region 坐标计算 | `chunkX >> 5`（**必须用算术右移而非除法**，因为整数除法对负数向零取整，而半数坐标是负数 → 必须 floored division）；方块坐标用 `>> 9` |
| chunk 索引 | `i = x + 32z`；反解 `x = i mod 32`，`z = floor(i/32)` |
| 文件结构 | **文件 = 一串 4KiB 扇区**。Sector 0–1 = 头部两张表；之后的扇区分配给 chunk |
| 表 1（位置） | 1,024 × 32bit 大端。**每项 4 字节：前 3 字节 = 扇区偏移，1 字节 = 扇区长度** |
| **单 chunk 硬上限** | `4 KiB × 255 = 1,020 KiB` |
| chunk 载荷 | `4 字节大端长度 + 1 字节压缩类型 + 压缩数据`，解压后是 NBT |
| **填充规则** | 最后一个 chunk 也必须补齐到 4096 的倍数，否则文件被认为损坏；**但 padding 不计入长度字段** |
| 压缩方案 | 1=GZip(弃用) 2=Zlib 3=未压缩 4=LZ4 127=第三方自定义 |

**可以偷的三条设计**：
1. **偏移表 + 变长载荷分离**：表是 O(1) 索引，载荷是变长块。这正是"小节点表 + 大 payload"的标准解法。
2. **4 KiB 对齐** —— 你的 JSON 文件当然不需要，但如果将来想支持流式按需加载，这个扇区粒度是现成的对齐单位。
3. chunk 增长时优先找**连续的空闲扇区**，找不到才追加到文件末尾（⚠️ 部分核实）。

### C3.3 适合"小规模、节点式、零构建、纯前端"的方案

> **结论：JSON 数据 + 网格坐标 + 局部裁剪渲染。不需要 quadtree，不需要 chunk 流式加载。**

**理由**：Minecraft 那一整套（分块、扇区分配、压缩、LZ4、NBT）是为**无限连续方块世界 + 磁盘 IO** 设计的。你的世界是**有限的、离散的、节点数量在几百量级**的 —— 引入它只会带来复杂度，不会带来收益。**真正该抄的是它的分层（表/载荷分离），而不是它的粒度。**

### C3.4 Canvas 2D 地图渲染技术（✅ MDN 全文实读）

来源：https://developer.mozilla.org/en-US/docs/Games/Techniques/Tilemaps

- **viewport culling**：`startCol = Math.floor(-camera.x / tileSize)`，`endCol = startCol + canvas.width/tileSize + 2`（**+2 防边缘撕裂**）
- **离屏缓存三档递进**（MDN 原文）：
  1. 把整张图预渲染到离屏 canvas，每帧只做一次 blit
  2. **只渲染可视部分到离屏 canvas**，画布比可视区**大 2×2 个 tile**。这样地图**只在滚动满 1 个 tile 时才重绘**
  3. **把 tilemap 切成大区块（如 10×10 个 tile-chunk），每块预渲染到离屏 canvas，然后把每块当成一个"大 tile"**
  **第 3 条最适合你**：11→N 节点的扩展地图，10×10 分块预渲染后，即使 500 个节点也只画 ~20 次 `drawImage`。
- **等距坐标变换的 Canvas 2D 捷径** ⚠️：`ctx.transform(1, 0.5, -1, 0.5, 160, 0)` 可以把**正交方形 tile 贴图直接画成等距菱形**，无需重制等距图集
- **网格坐标关系速查** ✅ https://www.redblobgames.com/grids/parts/：方格/六边形/三角形的 tile→corner、edge→tile 全部 9 种关系都给了闭式公式
- **绘制优化** ✅ https://gamedev.stackexchange.com/questions/22239：**只在相机层面做一次 transform，逐 tile 绘制时用 drawImage/fillRect 的偏移参数，绝不逐 tile translate**

❌ **没找到**：标题为 "Efficient Canvas 2D tilemap rendering" 的具体文章（这个精确标题不存在）。

## C4. 零构建零依赖的纯前端地图方案（重点）

### C4.1 有没有专门的技术栈？

✅ **https://nobuild.net/**（作者 Nat Taylor）专门讲 "Web Dev With No Build Step"，核心主张原文：

> "Web development with no build step is practical thanks to broad support for functionality including: **CSS @import, CSS variables, CSS nesting, HTTP/2, importmap, ES Modules**. So build accordingly!...and avoid introducing a build step to your simple, solo projects in the name of future maintainability."

配套：esm.sh（免转译 CDN）、jspm.org（生成 importmap）、open-props.style。

❌ **专门针对"零构建 Canvas 2D 游戏地图"的成熟栈：没找到。** 这是一个真实的空白。

### C4.2 ★ 浏览器支持现状（✅ webstatus.dev Baseline API 实测 2026-10-10）

**Import maps** —— ✅ `https://api.webstatus.dev/v1/features?q=import%20map`

| 浏览器 | 首个支持版本 | 日期 |
|---|---|---|
| Chrome / Edge | **89** | 2021-03-02 / 2021-03-04 |
| Firefox | **108** | 2022-12-13 |
| Safari / iOS Safari | **16.4** | 2023-03-27 |

**Baseline 状态：`widely available`** —— high_date **2025-09-27**，low_date 2023-03-27。
（caniuse 原始数据另注：import maps status = "unoff" 即非官方标准 ✅ https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/import-maps.json）

**JSON modules（`import x from './a.json' with {type:'json'}`）** —— ✅ 同 API

| 浏览器 | 首个支持版本 | 日期 |
|---|---|---|
| Chrome | **123** | 2024-03-19 |
| Edge | **123** | 2024-03-22 |
| Firefox | **138** | 2025-04-29 |
| Safari / iOS Safari | **17.2** | 2023-12-11 |

**Baseline 状态：`newly available`**，**low_date 2025-04-29**。

**ESM via `<script type="module">`** —— ✅ caniuse `features-json/es6-module.json`：Chrome **61**、Edge **16**、Firefox **60**、Safari **11**、iOS Safari **11**。

> **→ 直接结论（2026-10-10）**：你现在可以放心做 `import world from './data/world.json' with { type: 'json' }` —— **节点地图数据放真正的 `.json` 文件、用 ESM 直接 import，零构建、零依赖、零转译**。这解决了"数据放 JS 里会污染运行时 / 放 JSON 里需要 fetch 和 MIME 配置"的全部问题。

### C4.3 import map 语义（✅ MDN 全文实读）

来源：https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap
- 支持 **bare specifier**（`"circle": "./modules/shapes/circle.js"`）
- 支持**路径前缀重映射**（key 和 value **都必须以 `/` 结尾**）
- **多个 key 匹配时选最长的那个**
- 支持 `scopes` 做条件映射（按引用者 URL 路径），多 scope 匹配时也取最长
- **一个 import map 只能声明一次**

**两个零构建的实操坑** ⚠️：
1. **ESM 强制要求 `.js` 后缀**：`from './utils'` ❌，`from './utils.js'` ✅
2. **`.js` 响应头必须是 `Content-Type: text/javascript`，`.json` 必须是 `application/json`**，否则浏览器拒绝执行模块脚本。GitHub Pages 默认满足，但本地用 `file://` 双击打开会被 CORS 拒绝，必须起 HTTP 服务。

### C4.4 JSON Schema 设计建议

参考两个真实范式：✅ **LDtk 的 JSON**（`defs`/`levels`/`__identifier` 稳定 UID/`__neighbours` 邻接表/`toc` 自动目录/Entity 自定义字段 + "Super simple export" 极简模式）https://ldtk.io/json/ ；⚠️ **Ogmo 的 `.ogmo`**（纯 JSON，项目定义与关卡数据分离）

**LDtk 的三条元设计值得直接抄** ✅ https://ldtk.io/docs/general/world/：
1. **"Optional separate levels"** —— 项目文件与每个关卡文件分离，运行时按需加载
2. **"Unique identifiers"** —— `__identifier` 是**稳定字符串 UID，不随数组顺序变化。⚠️ 你的节点 ID 绝对不能用数组下标。**
3. **提供两份 schema**：`JSON_SCHEMA.json`（完整）和 `MINIMAL_JSON_SCHEMA.json`（给引擎侧的精简契约）。**你应该同样给出一份 minimal schema**（只含渲染和寻路必需字段），把平衡/文案/掉落表塞进可热更的 `content/` 目录

**LDtk 的版本化教训**：它的 JSON 格式会随版本增删字段，官方专门有 "Deprecation cycles" 和 "Planned deprecations" 页面 ✅ https://ldtk.io/json/next/ → **你的 schema 从第一天就要写 `version` 字段和迁移函数。**

**面向你项目的 schema 骨架**（我的设计，非引用）：

```
world.json  { version, seed, regions[], pois[], links[], contentRef }

region      { id:"r_qingming", name, biome, gx,gy, gz,w,h,     // 网格坐标 + 包围盒
              tier, unlockCond, ambient:{day,night} }

poi         { id:"p_qm_cave_01", regionId, kind, gx,gy,       // 网格坐标
              cost:1, tags:[], payload:{...} }

link        { a, b, kind:"road|river|pass|shortcut", gated:null|{req,untilRun} }
```

**关键决策：节点用 `gx,gy` 网格坐标而不是浮点世界坐标。** 三个理由：
1. 网格坐标天然支持区域包围盒 culling（`r.gx <= camX < r.gx + r.w`）
2. 让"区域划分"退化成简单的整数区间操作
3. MDN 明确指出要维护 **visual grid 与 logic grid 的映射**（碰撞/生成点/寻路都走 logic grid）✅ —— 你的节点地图天然就是这个结构的极端形态

### C4.5 localStorage vs IndexedDB

> ⚠️ **本节未完成** —— 子代理在此处截断。

已知（同项目审计实测 ✅，来自本工作区 `evidence.md`）：`xx_` 前缀的 localStorage 键 **25 个**，**55–62 处**直接调用，**22–23 个模块**持有。**这对 0.5 MB 级别的地图数据是足够的**，除非你要存大量战利品实例。

---

# D. 回合制 + 肉鸽 + 经营 的混合设计

## D1. 2025–2026 年的混合代表作

**全部 ✅ Steam API 实测，2026-10-10（`appreviews` 端点，`language=all&purchase_type=all`）**

| 游戏 | AppID | 发售 | 评测数 | 好评率 | 评级 | 核心混合方式 |
|---|---|---|---|---|---|---|
| **Cult of the Lamb** | 1313140 | 2022-08-11 | 130,461 | 95.9% | Overwhelmingly Positive | 割草战斗 → 回村经营 |
| **Against the Storm** | 1336490 | 2023-12-08 | 37,691 | 94.4% | Very Positive | **殖民模拟 + 肉鸽（最工程化的一个）** |
| **Loop Hero** | 1282730 | 2021-03-04 | 36,599 | 92.7% | Very Positive | 地图构筑 + 撤退决策 |
| **BALL x PIT** | 2062430 | 2025-11 | 27,525 | 95.3% | Overwhelmingly Positive | 打砖块物理 + 肉鸽 + **地上基建/地下推图双环** |
| **9 Kings** | 2784470 | 2025-05-23 | 23,485 | 92.4% | Very Positive | 卡组建塔防 + 王国建设 |
| **Backpack Battles** | 2427700 | 2025-06-13 | 20,792 | 91.1% | Very Positive | 自动战斗 + 背包构筑 |
| **The King is Watching** | 2753900 | 2025-07-21 | 10,703 | 88.7% | Very Positive | **"凝视"机制（见下）** |
| **Super Fantasy Kingdom** | 2289750 | 2025-10-24 | 6,035 | 86.7% | Very Positive | 王国建造 + 队伍战斗，**防御破了就看你烧** |
| **Another Farm Roguelike: Rebirth** | 2760790 | 2025-08-01 | 539 | **72.2%** | Mostly Positive | 纯种田肉鸽（**反面教材**） |
| （对照）**Balatro** | 2379780 | 2024-02-20 | 199,707 | 97.8% | Overwhelmingly Positive | 扑克构筑 |
| （对照）**Brotato** | 1942280 | 2023-06-23 | 119,610 | 95.9% | Overwhelmingly Positive | 割草波次 + 局间 build |
| （对照）**Megabonk** | 3405340 | 2025-09 | 106,894 | 94.2% | Very Positive | 第三人称 VS-like |
| （对照）**Nubby's Number Factory** | 3191030 | 2025 | 19,718 | 97.3% | Overwhelmingly Positive | 弹珠台 + 工厂管理 + 配额目标 |
| （对照）**Blue Prince** | 1569580 | 2025-04-10 | 20,348 | **86.3%** | Very Positive | 房间蓝图放置解谜肉鸽 |
| （对照）**Peglin** | 1296610 | 2024-08-27 | 17,739 | 83.7% | Very Positive | 弹珠台物理 + 肉鸽 |

**❌ Peglin 2 作为独立游戏不存在** —— Steam 搜索无结果。真实存在的是 **Peglin 2.0 = 2026-03-16 的大型内容更新**（Act 4 "The Core" + 最终 Boss + 双路径职业解锁 + 大量平衡调整；v2.0.12 补丁 2026-04-28）。1.0 发售 2024-08-27，EA 起于 2022-04-25 ✅

### ★ 最值得你直接抄的三个机制

**1. The King is Watching 的"凝视"（gaze）机制 —— 把"经营"和"回合制注意力管理"焊在一起的最优雅解法。**
王国的**所有生产只在国王视线所及之处进行**。玩家的操作是"用有限的目光扇形在多个区域间扫"。这把"资源分配"从一个静态的表格决策变成了**实时的空间注意力博弈**。
评价：PC Gamer 称 "both stressful and devilishly clever"，Ars Technica 称 "perfectly rides the fine line between engrossing and overwhelming" ⚠️；媒体一致指出**最大缺点是随机性过强**（PC Gamer 用 "crushing" 形容）。

**→ 对你的映射**：你的"黑白夜 + 篝火"可以做同一件事 —— **篝火的光照范围就是国王的凝视**。所有据点产出只在火光范围内生效，你要在"把火移动到收益最高处"和"把火留给防守"之间选。

**2. Super Fantasy Kingdom 的"失败即清零"**：官网原话 "**But if your defenses should fail, be prepared to watch it all burn!**" —— 经营成果不是保险箱里的数字，而是**会被战斗结果实时摧毁的实体** ⚠️

**3. Against the Storm 的结构** ⚠️：程序生成地图 + **短时限的单一聚落** + 局间永久解锁 + 多族群差异化需求。

### 反面教材：Another Farm Roguelike: Rebirth（72.2%，本表最低）

商店页自述："Build, craft, and grow your farm to pay off the increasing rent. **No slow-paced walking or social distractions—just click!**" ⚠️
→ **去掉了一切"过程"只留下"点击"的种田游戏会死。** 这直接印证了 F 节"种田是最容易被误判为很便宜的一项"的判断。

## D2. 死亡惩罚与玩家留存

### D2.1 Slay the Spire 的 meta 进度

⚠️ https://gamesnest.org/guides/slay-the-spire-beginner-guide
- **Boss Relic 池**：每击败一个 Boss 永久获得 1 枚；开新局时从已解锁池里**三选一**。Act1/2/3 各解锁 3 枚，共 9 枚。**"即使你在 Act 2 立刻死，Act 1 拿到的 Boss Relic 永远是你的。"**
- **角色解锁**（门控式，非随机）：Silent = 用 Ironclad 打赢 Act1 Boss；Defect = 任意角色累计 5 场胜利；Watcher = 三个角色各打赢 Act3 Boss
- **Ascension 20 级**，每级一个累积负面效果：精英更频繁、伤害更高、**Boss 战后只恢复 75% 已损生命**、**开局 −10% 生命**、**开局 −1 药水栏位**、**升级卡出现率减半**、Boss 掉金币 −25%、商店贵 10%、**Act 3 结尾打 2 个 Boss**、开局带诅咒
- **每日挑战**：固定预设随机种子，全服**完全相同**的遭遇 —— 这是"公平性"的另一个极端
- ⚠️ **一个值得注意的开发背景**：他们最初的"敌人显示下一回合意图"设计**并不契合 roguelike 的永久死亡**（permadeath 下玩家没时间研究 UI），才改成后来的 "Intents" 数字系统。
  → **信息量很大：永久死亡会惩罚"无脑 UI 复杂"，游戏必须降低单回合的决策成本。**

### D2.2 Hades：把 permadeath 变成叙事推进

⚠️ https://en.wikipedia.org/wiki/Hades_(video_game)
- **死亡后保留**：Darkness（永久升级货币）、Chthonic Keys、Nectar / Ambrosia（送礼解锁人际关系与强力信物）
- **重置的**：黄金、生命恢复、临时增益
- **Mirror of Night**：14 个槽位，**每槽两个互斥选项**（例："每进新房间回 1% 血" vs "血量越低伤害越高"），每项可投 5 级。**"互斥选择"让 meta 成长是软性构筑选择，而不是单纯的数值堆叠。**
- **God Mode（神力模式）**：**开启后每次死亡 +2% 减伤，上限 80%**。关键细节：**开 God Mode 不影响成就、不影响剧情推进**
- **Pacts of Punishment**：完成主线后自愿叠加难度换奖励，累积 Heat 等级。Hard Labor 每级敌人伤害 +20%（上限 +100%）

### D2.3 ❌ 未核实

- **Outer Wilds 的 22 分钟循环** —— Fandom 和 Wikipedia 正文**都超时/被挡**。"22 分钟"是广泛流传的说法但**没有实际读到来源**，需要自行确认。
- **Darkest Dungeon 的 stress 系统具体数值**（0–100 区间、100 崩溃、宝石/祈祷治疗）—— gamepedia curl 超时，不编。
- **r/roguelikes 与 r/roguelikedesign 的 2025–2026 原帖讨论** —— Reddit `.json` 端点在本环境被挡。

### D2.4 ★ 2025–2026 社区的实际进展：**定义之争从二分法转向三分法**

找到了一条 2025-01-28 的实质性提案：**The Hiive Interpretation（对 Berlin Interpretation 的现代化修订）** ⚠️ https://hiivelabs.com/blog/gamedev/roguelike/2025/01/28/musings-on-the-berlin-interpretation-part-zwei

核心一句话提案：
> "a **procedurally generated high-stakes tactical adventure simulator** (or some qualified combination thereof)"，且"**a game 不必全部满足这些条件——大部分满足即可**"

它明确提出 **Tactical（战术）vs Simulationist（模拟）** 两条哲学线：DCSS / Brogue / Jupiter Hell 是战术派（快决策、机械清晰）；Caves of Qud / ADOM 是模拟派（系统反应性、环境叙事）；Dwarf Fortress 是混合。作者本人把 Brogue 叫 "traditional roguelike"、Caves of Qud 叫 "modern roguelike"、Heroes of Hammerwatch 叫 "roguelite"。

另有来源指出 Berlin Interpretation **"因过于严苛、只看机制不看玩家体验而受到批评"** ⚠️

> **→ 对你的意义：2025–2026 的新进展是从二分法（roguelike/roguelite）转向三分法（traditional / modern / roguelite），且社区共识正在远离 Berlin Interpretation 的教条式八条。你在对外自称上完全自由，不会有社区压力。**

### D2.5 ⚠️ 一个值得注意的反面观察

一篇分析指出，随着玩家知识积累，StS 的"选择自由"会**收敛**到少数最优解 —— 高 Ascension 下"跳过奖励"成为最优选、路线变成公式化的精英密度/篝火/商店经营、卡组收敛到同一批防御核心。**核心 deck 变小了，自由度被挤压。** 作者的结论是"这是权衡取舍，不是失败" ⚠️ http://progamerreviews.com/blog/news/slay-the-spire-and-the-illusion-of-choice--how-deckbuilding-freedom-collapses-into-meta-convergence

## D3. 失败成本的经济学

⚠️ **声明**：本节**没有做专项检索**（`risk of reward game design` / `loss aversion game design` / `punishment design gdc` / `failure loop game design` 都没搜），以下清单是从 D1/D2 已核实材料中反向提炼的。

| 机制 | 具体做法 | 出处 |
|---|---|---|
| **分层保险** | 击败 Act1 Boss → 永久获得 3 枚 Boss Relic；**即使下一局立刻死也永久是你的** | ⚠️ StS 指南 |
| **免费低保底局** | Ascension 每级是**独立开关**，玩家自选要不要开 | ⚠️ 同上 |
| **止损机制（叙事/难度双轨）** | God Mode：每死一次 +2% 减伤（上限 80%），**且不封锁成就/结局** | ⚠️ Hades |
| **死亡转化器** | 每次死亡推进剧情 + 永久保留 Darkness/Keys/Nectar；Mirror of Night 用**互斥选项**让 meta 成长成为软性构筑而非数值堆 | ⚠️ Hades |
| **难度换奖励** | Pact of Punishment：自愿开契约累积 Heat 换奖励 | ⚠️ Hades |
| **公平性对冲** | 每日挑战固定随机种子，全服同一遭遇 | ⚠️ StS |
| **解锁双路径** | Peglin 2.0 新增：职业既可"靠成就瞬间解锁"，也可"随游玩时长逐步解锁"——**官方明确说这是为了解决"新玩家被卡住"** | ⚠️ Steam 更新日志 |
| **负面清单：强随机 + 无兜底 = 差评** | The King is Watching 88.7%（媒体直指随机性 "crushing"）；Another Farm Roguelike 72.2% | ⚠️ Steam API |

> **对你项目的直接含义**：
> **"点节点 = 1 点体力"这个设计本身就是一个天然的止损机制** —— 玩家每个节点的可损失量被硬性封顶在 1 点体力 + 该节点上的局内收益。**这是 permadeath 最好做的形态：损失是量化的、可预期的，不是"一局 40 分钟全部归零"。应该把它作为设计原则写死。**

---

# E. 昼夜循环与领地经营

## E1. 昼夜循环的非视觉用法

⚠️ 本节来源质量偏低（子代理的 web_search 摘要），但结论本身可靠。

**具体案例**：
- **Minecraft**：夜间生成敌对生物；白天光照等级 ≥ 8 时不生成 hostile mobs（阈值 light level ≤ 7）
- **Stardew Valley 睡眠规则**：**凌晨 2:00 体力降至 50%，凌晨 1:00 降至 75%，午夜昏倒直接失去部分金币**。⚠️ 关于"Kirkpatrick 在第 2 天早上 6:00 把玩家弹起来"的说法**未能在页面上找到，不采信**。
- **Don't Starve**：夜晚是食物腐烂、幻觉、萨满噩梦的主要来源 —— 昼夜是**倒计时的具象化**

**⚠️ 但 M&B 给出了更成熟的做法**（这条有更硬的来源，见下节）：**昼夜循环的实际作用是"行军速度惩罚"** —— 夜里赶路队伍移动速度下降，而速度下降意味着同距离要走更久、遇到更多次遭遇判定。这把"要不要熬夜赶路"变成一个有代价的决策，而不是氛围开关。

**五种把昼夜做成节奏闸器的具体做法**（综合判断，非引证）：
1. **把"夜"设为唯一的高压时段**：白天刷资源/开垦/经营，夜间才打遭遇战 → "一整天 = 一个决策周期"成为玩家直觉
2. **昼夜切换作为"提交点"**：白天做所有低成本决策，切换点强制结算
3. **难度曲线挂昼夜**：`enemyMul = f(phase)`，夜晚 multiplier 高但**掉落/经验也高**
4. **用昼夜做"事件窗口"**：只在特定相位刷新的资源/事件，制造"错过焦虑"，但**用"夜间刷新白天积累的资源"避免纯粹的惩罚**
5. **多 NPC 排班**：夜猫子 NPC 白天睡觉晚上工作，产出 24 小时连续 → 让"昼夜"变成**排班优化的约束条件**

## E2. 据点 / 领地建设系统

### E2.1 ★ TF2 PAYG —— 已补齐，全部 ✅ 直接访问核实

来源：https://wiki.teamfortress.com/wiki/Payload 和 https://wiki.teamfortress.com/wiki/Game_modes（curl 已读到正文）

**经典 PAYG 的推车速度表**（Hammer units/秒）：

| 推车人数 | 速度 | 相对速率 |
|---|---|---|
| ×1 | **50** | 55% |
| ×2 | **70** | 77% |
| ×3 | **90** | 100% |
| 后退 | **−9** | −10% |

**机制细节**：
- 推车靠**站在旁边的人**，人数越多越快，**上限 3 人**；**第 4 人不再加速**
- **Scout 和携带 Pain Train 的玩家算 2 人**
- **敌方玩家站在车旁 = 车被 block**，不动直到对方离开或被杀
- **无人看管 30 秒 → 车自动后退回上一个检查点**；some 地图有特殊斜坡，后退更快
- 抵达检查点**增加计时器时间**；**计时器每次车被推动时重置**
- 车同时充当一个 **Level 1 Dispenser**，为推车方恢复血量和弹药
- 时间耗尽时进入 **Overtime**，给进攻方 5 秒最后机会

> **★ 这张表是 PAYG 全部张力的数学来源**：50 → 70 是 **+40%**，70 → 90 是 **+28.6%**。**递减收益**意味着"人越多越好"在 3 人后就失效，于是**进攻方必须在"分散兵力清场"和"集中推车"之间做取舍**；同时"站在旁边"是一个**位置约束**，于是防守方可以靠站在车旁**阻塞**而不是靠杀光所有人来防守。**一个推车行为同时生成了空间、资源和时间的张力。**

**End of the Line（Snowplow）变体 —— 生命值机制** ✅：
- 火车的健康值是**跨关卡保留**的（第一阶段打完不会回满）
- 每 **35 秒**内 BLU 既没攻下也没争夺当前控制点 → 火车损失 **10% 生命**
- 争夺中该倒计时**暂停**，攻下后**重置**
- 攻下一个控制点 → **恢复 10% 生命**、摧毁缓冲挡、进入下一控制点并重新开始 35 秒倒计时
- 总共 6 个控制点（每阶段 3 个）

> **→ 对你的映射**：这是"据点会真的被烧掉"的最简实现 —— **不是数值，是一条百分比/回合的衰减规则**。

### E2.2 RimWorld 的具体系统 ⚠️

| 系统 | 具体数字 |
|---|---|
| **工作优先级** | 12 个工作类别，每列手动优先级 **1–4**。**默认是"从左到右"自动分配** |
| **技能成长** | 无热情 33% / 单热情 100% / 双热情 **150%** |
| **心情阈值** | **≥65% 正常工作加成；35–65% 普通；15–35% 有小概率崩溃；<15% 高概率重大崩溃**。崩溃后得 Catharsis **+40** |
| **关键心情数值** | Fine Meal **+12**；Luxish Meal **+12~16**；Recreation Satisfied **+10**；自有卧室 **+5~8**；美观环境 **+5~15**；**吃生食 −7**；**睡地上 −5** |
| **导致崩盘的四件事** | 吃生食、睡地上、环境难看、**看见尸体** |
| **扩建陷阱** | 一个人数多一个人，**同时提高殖民地财富值和"人数"这一独立项，两者都提高袭击强度**，而且多一个人就多一张嘴 |

> **抄 RimWorld 的"工作优先级 + 心情阈值"，不要抄它的"建造自由"。**
> - RimWorld 的建造自由度建立在**连续空间 + 路径寻路 + 碰撞**之上，这些在节点地图上全部退化成"你解锁了哪几个格子"。**自由度没了，RimWorld 那套的乐趣也没了。**
> - 但**工作优先级 1–4 这套几乎可以无损移植**：你的"据点"可以简化成 3–5 个**功能位**（修炼/炼丹/种植/守御/储物），每个位分配一个**优先级 1–4** 给驻守的门人。**优先级就是 4 个数字，成本极低但决策感极强。**
> - 心情改成**每个据点一个 0–100 的"士气"**，只受 3 个量影响：驻守者战力与需求的匹配度、据点是否被袭击过、设施等级。**阈值直接用 RimWorld 的 65 / 35 / 15 三档。**
> - **照抄 RimWorld 的"人数即惩罚"这条最反直觉的设计**：据点每扩一个功能位，**同时提高收益和周边事件强度**。这是防止玩家无脑全开的唯一有效机制。

❌ **未取得**：Fallout Shelter、Kingdoms and Castles 的具体机制数据。

## E3. 种田 / 开垦系统的深度设计

### E3.1 Valheim 的三重进度门槛 ⚠️

| 层级 | 内容 |
|---|---|
| **① 工具门槛（资源）** | Hammer = 3 木材 + 2 石材；**Workbench = 10 木材**（开局第一件必建）；Hoe（平整地形）= 5 木材 + 2 石材 |
| **② 区域门槛（生物群系）** | 必须在 Workbench 的工作半径内才能放置建材；**Workbench 升级方式：在其半径内放置 Chopping Block / Tanning Rack / Adze / Tool Shelf，每放一个建造半径 +4 米** |
| **③ Boss 门槛（材料）** | Workbench（开局）→ Forge（挖到铜）→ **Stonecutter**（铁 + 2 铁棒 + 4 石 + 10 木）→ Artisan Table（**龙泪 = 打败第四 Boss Moder**） |

**其他具体数字** ⚠️：
- **结构完整性颜色编码**：蓝 = 已接地 100% 稳定；绿 = 支撑良好；黄 = 中等；橙 = 很弱；红 = 无支撑（连接的方块会崩）。平地上木/石柱最多叠 16 米，核心木原木柱 24 米，木-铁柱 50 米
- **风化**：暴露在雨中的木构件耐久最多掉到 **50%**；石/黑曜石/水晶**永不风化**；修复免费
- **舒适度**：家具最高推到 **17**（Maypole 18），把 Rested 增益从 8 分钟延长到约 24 分钟

> **开垦作为进度门槛的核心机制**：Valheim 的开垦不是"清空土地"，而是"**你还没打到那个 Boss，就造不出那个等级的建筑**"。三重门槛（工具→区域→Boss）都指向"你必须先变强"。

### E3.2 Stardew Valley 的作物系统 ✅（已补齐，直接访问核实）

来源：https://stardewvalleywiki.com/Crops（curl 已读到正文）

**核心规则**：
- **每个季节 28 天**。换季时（第 28 天后），**当季之外的作物会枯死**。多季作物（Ancient Fruit / Coffee Bean / Corn / Sunflower / Wheat）在指定季节内继续生长
- **作物必须每天浇水才生长**。缺水一天 → 不生长，**但不会死**
- 生长天数 = **需要的夜数**。第 1 天种下 → 5 天作物在第 6 天可收
- **乌鸦（Crows）**：当**生长中的作物超过 15 个且范围内没有稻草人（Scarecrow）**时会吃掉作物
- **巨型作物**：Cauliflower / Melon / Pumpkin / Powdermelon / Qi Fruit 以 **3×3 模式**种下，每天有 **1% 概率**合成巨型作物（要求左上角作物已完全成熟且已浇水，且 9 棵同种）；收获掉 **15–21 个**普通品质物品，需用斧头砍 3 下
- **攀爬架作物**（不可穿过，dead 后可穿过）：Green Bean、Hops、Grape
- 一格地同一时间只能施一种肥料；**种植和施肥本身不消耗体力**，只有耕地和浇水消耗

**品质系统（4 级：regular / silver / gold / iridium）** ✅：
- 品质在**收获时判定**
- 平均品质可通过**施肥料的土壤**提升；**星辉品质（iridium）只有在 Deluxe Fertilizer 下才可能出现**
- 提高 **Farming 技能**也会提高高品质概率
- ⚠️ **防循环设计**："如果用 Seed Maker 把高品质作物转成种子，**这些种子长出来时不会再更容易产出高品质**"
- ⚠️ **范围限定**：品质对**熟食**的回复量**无影响**，对**工艺品（Artisan Goods）的品质也无影响**
- 多收作物（Coffee Bean 4 个 / Blueberry 3 个 / Cranberries）时，**基础/优质/豪华肥料只影响第一个收获**（1/4 咖啡豆、1/3 蓝莓）

**每日金币公式** ✅：
```
Minimum Gold per Day = ((Max Harvests × Sell Price per Harvest) − Seed Price) / Growing Days
Growing Days = Days to Maturity + ((Max Harvests − 1) × Days to Regrow)
```

### E3.3 ❌ 未取得

- **篝火/营火在 Roguelite 中的机制用法** —— 没找到具体案例文章，不编。
- **Enshrouded 的开垦/基地进度门槛** —— 未取得。
- `"base building progression design"` / `"farming simulation depth design"` 的搜索 —— 未执行。

---

# F. 给 1–3 人小体量项目的取舍建议 ★ 本节是你最需要的

## F0. 先看数据：2026 年"小而快"到底能卖多少

Chris Zukowski（How To Market A Game，业内 Steam 发行/营销领域最常被引用的独立分析者）2026 年 8 月连发三篇，拆解 Valve 公布的 2026 年 7 月热销榜上三款"小而快"的游戏 —— 这三款**同周发布，全部进入热销榜**。

| 游戏 | 团队 | 开发时长 | 付费营销 | 首日营收 | 前 20 天销量 | Demo 中位游玩 |
|---|---|---|---|---|---|---|
| Sir, We Have an Orc Problem | **2 人** | **4 个月出头** | $200 | **$361,657** | **20 万份** | 1h26m |
| Bills Must Be Paid | **2 人** | **7 个月**（2026-01→07） | $200（Reddit 广告，只换来 19 个可追踪愿望单） | **$163,842** | **33 万份** | 36 分钟 |
| How Many Dudes? | **7 人** | **整 1 年**（原型 2025-07-30 GMTK jam → 上线 2026-07-30） | — | — | **24.2 万份** | 2h02m |

✅ 全部来自 https://howtomarketagame.com/2026/08/18/the-week-of-the-golden-age/ 、https://howtomarketagame.com/2026/08/20/part-2-the-week-of-the-golden-age/ 、https://howtomarketagame.com/2026/08/21/part-3-the-week-of-the-golden-age-how-many-dudes/

**对照组（同作者、同一套营销动作、失败案例）** ✅ 同上：
- Mumpitz Games 前作 **Tiny Auto Knights**（Steam 页面形态"对味"）：**1.5 年开发 + 10 个月营销 → 只有约 200 条评测**。团队自述："我们决定上一个项目花 1.5 年不值得冒险"
- Rike Games 前作 **No Pain No Gain**：同样的社媒 + demo + Next Fest 三板斧，进 Next Fest 时只有 1,100 愿望单 → 失败。团队原话：
  > "**最重要的营销决策是你做什么类型的游戏。你可以跑完全一样的营销打法，但如果游戏没有那个东西，你做什么都救不回来。**"

> **这两组对照是本报告最重要的一条结论：变量不是营销、不是愿望单、不是美术精度，而是「开发时长 + 核心机制的新鲜度」。**

## F1. 2026 年的行业共识："Great Conjunction"（大合相）

Zukowski 2025-11-04 的长文是这一波讨论的起点。他把"当前好做的品类"恰好是"玩家正在挨饿的品类"的窗口期叫作 **Great Conjunction**，上一次是 2021 年《Vampire Survivors》带来的窗口期。

**原文建议（直接引）** ✅ https://howtomarketagame.com/2025/11/04/the-optimistic-case-that-indie-games-are-in-a-golden-age-right-now/：

> "the safest thing for most game developers right now is to stop development on their current project, and try out a new fast-follow micro genre, with the goal of **releasing it within the next 4-6 months**."

他列出的当下在窗口期的品类：**friend-slop（合作欢乐游戏）、idle/incremental、恐怖各子类、模拟经营（商店模拟为主）、rage 游戏、autobattler、（可能）Vampire Survivors 二代**。
⚠️ **注意 —— 肉鸽本身不在这个列表里，因为 VS-like 已经饱和。**

**同篇里的两条机制描述（对你直接相关）** ✅ 同上：

> "If people don't think it is fun, ship it too and then MOVE ON, and develop another game. For these types of games, **you cannot 'polish' it to make it fun. You know it right away. It is either fun or not.** This (hopefully) prevents endless rework, scope creep, and long development times."

> "Genres that are so fun that players look past graphics and polish. They just want **tight, fun, deep gameplay**. The goal here is to make a game fast, throw it out there as a demo, or a playtest, and see if people think the game is fun. If it is, ship it."

**→ 对你的直接含义**：水墨修仙 Canvas 2D 的"粗糙边缘"不是风险，是**这个窗口期的通行证**。不要再往美术上投钱。把时间全砸进"砍杀局好不好玩"这一个判断上。

## F2. "Missing Middle"：中等规模游戏这个品类消失了

Zukowski 2023 年的文章 ✅ https://howtomarketagame.com/2023/09/28/the-missing-middle-in-game-development/ ：

- **id Software 在 1990 年代一年做 13 款游戏** —— 那时候没有 Unity/GameMaker/Godot/Unreal，没有数字发行
- 定义：**"middle game" = 比 game jam 大、但不是 30 小时三 A 大作，1–9 个月做完，预期收入 $10,000–$40,000**
- 后果：**Steam 上 75% 的工作室一辈子只发了 1 款游戏**
- 原因："Indies stopped developing 'middle' games because the industry stopped directly paying for them."

**Mumpitz Games 创始人 Laurin 的成本模型（对小团队最实用的一条）** ✅ https://howtomarketagame.com/2026/08/18/the-week-of-the-golden-age/：

> "With **$150K+ revenue** you can sustain a small team (1-3 persons) doing small to mid size games (< 1 year dev time), with $10K not so much. It's also a different mindset of doing games if you're aiming to do those low- to mid-tier games instead of hoping to have that million dollar hit and never have to work again."

**→ 翻译成你的决策**：一个 1–3 人团队要活下去，目标不是"百万级爆款"，是**让每个项目的营收稳定在 15 万美元以上、开发周期压在 1 年内**。这决定了你每个系统值多少钱。

## F3. 市场结构数据：2025 年肉鸽的确成了 Steam 最大的类型

| 指标 | 数值 | 核实 |
|---|---|---|
| Steam "Roguelike" 标签 2024 年新作 | 1,601 款 | ⚠️ Destructoid 引 SteamDB |
| 同标签 2025 年新作 | **1,562 款**（截至 11 月初），另有 52 款将在 11/11 前上线 → **2025 年将破纪录** | ⚠️ 同上 |
| 单月最高纪录 | **2025 年 10 月，191 款**（比 2024 年 11 月的 173 款多 18） | ⚠️ 同上 |
| 2025 年内**零评测**的肉鸽 | **108 款**（2024 年为 87 款） | ⚠️ 同上 |
| 24 小时内峰值 >1000 同时在线的肉鸽 | **50+ 款**（对比 Souls-like 标签的 33 款） | ⚠️ 同上 |

⚠️ 全部来自 https://www.destructoid.com/this-popular-genre-dominated-steam-in-2025-and-it-doesnt-look-like-were-escaping-the-loop-anytime-soon/（只拿到搜索摘要，SteamDB 原始数据未能直接核实）

**两条读法**：
1. **利好**：肉鸽仍是 Steam 上注意力最集中的类型，50+ 款破千同时在线，需求还在
2. **利空**：108 款零评测 = 你发布后大概率也是其中之一。**"进入这个品类"本身不构成任何优势。**

**独立开发者的观察（2025 年采访）** ⚠️：
> "The genre is bigger than ever, and is growing like crazy. That being said, the competition is much fiercer and seemingly every week there is a new flashy roguelike with a catchy hook... So developers can obviously find huge success in this genre, but **need something to differentiate them more than ever**."
> —— BenBonk（Slimekeep 开发者），https://www.superjumpmagazine.com/the-state-of-indie-games-in-2025-and-beyond-part-1/

**990,000 款 Steam 游戏的分析（2025）** ⚠️：最成功的独立品类是 **open world survival / crafting / simulation / management / horror**；最差的是 VR、解谜平台、3D 平台、竞技场射击。作者点名 Zukowski 把独立游戏分成三类：live service 多人（独立做不了）、手工单人叙事（独立做不了体量）、**crafty-buildy 系统/策略游戏（独立游戏的甜蜜点）**。
https://davidguardo.com/strategic-learning-hub/indie-developers-face-harsh-market-but-survival-simulation-and-horror-games-lead-the-way-on-steam/

⚠️ **重要警告：这些数字基本都出自同一份被反复转引的研究（Design Diary 2025-02），且该文自己声明方法论有偏（标签多维重叠导致重复计数）。当趋势看，不要当精确数据用。**

## F4. ★ 你的 12 条设计愿景 —— 逐项取舍裁决

按"1–3 人 / 零构建 / Canvas 2D / 纯前端 / 已有约 23,700 行代码在跑"这个具体约束来判。

### 裁决总表

| # | 系统 | 裁决 | 理由（短版） | 可落地的最小形态 |
|---|---|---|---|---|
| 1 | 真正的开放世界地图 | ✅ **做，但只做"节点图"** | Blue Prince / Loop Hero 证明节点图能撑起全部策略深度 | 5–6 个区域 × 每区 4–6 个节点，网格即地图 |
| 2 | 骑马与砍杀 | ⚠️ **只保留"赶路"，砍掉战斗编制** | 真实时间战斗是最高成本项，纯 2D Canvas 做不好 | 赶路消耗体力 + 触发遭遇文本/小怪 |
| 3 | 搜打撤沙盒 | ✅ **做，但用 Loop Hero 的分段返还** | 这是全清单里性价比最高的一条 | 撤退 30% / 中途归 60% / 满载归 100% |
| 4 | 砍杀局是日常历练 | ✅ **保留，这是核心** | 它就是你已有的割草玩法，零新增成本 | 砍杀局 = 你现在的战斗场景 |
| 5 | 主线在地图上（幻境/副本） | ✅ **做，但主线只用 1 个系统承载** | 见 F5 的"主线唯一论" | 地图上 3–4 个"幻境"节点 |
| 6 | 种田 / 灵田开垦 / 据点 / 篝火 | ⚠️ **砍掉开垦，保留篝火** | 开垦是内容量黑洞，篝火是零成本收益点 | 据点 = 篝火升级树，5–8 级 |
| 7 | 黑白夜循环 | ✅ **做，但当"节奏闸门"不当"光照系统"** | M&B 已经给出成熟做法 | 见 F6 |
| 8 | 伙伴/仆从/雇佣/结伴 | ⚠️ **砍掉"忠诚度系统"，保留"雇佣"** | 忠诚度 = 另一个数值层 + UI + 内容 | 招募 3 个固定伙伴，无忠诚度数值 |
| 9 | 商会 / 行会 | ❌ **砍掉** | 纯经济模拟，无玩法张力，纯数值劳动 | — |
| 10 | 奇遇 / 守卫 | ✅ **做，成本极低** | 事件文本是内容，不是系统 | 20–30 条事件文本 + 一个抽卡表 |
| 11 | 地图点 → 砍杀局 / 回合制副本 | ✅ **做，这是整个设计的枢纽** | 这是把 12 条愿景缝成一个循环的唯一方法 | 见 F5 |
| 12 | 保留肉鸽地图行走 | ✅ **保留，但它应该是"局内"的，不是"元"的** | 见 F5 的两层结构 | 见 F5 |

### 12 项里应该**立刻砍掉**的：#9 商会/行会

**理由**：商会/行会是一个**经济系统**，它的全部玩法价值来自"供需套利 + 声望刷取"，而这两件事在一个 5–10 分钟一局的单机网页游戏里没有节奏可言。玩家不会为了"本月商税交够了"再开一局。要做经济，至少得有"每天必须上线结算"的社交压力 —— 那是 F2P 手游的做法，和你的定位冲突。

### 12 项里最容易被误判为"很便宜"的：#6 种田 / #8 伙伴

- **种田的真实成本不在机制，在内容**：作物种类 × 季节 × 品质 × 肥料 × 加工链。§E3.2 显示 Stardew 一款游戏就有 30+ 种作物、4 级品质、3 种肥料、巨型作物合成、每日金币公式、攀爬架作物…… 而 §D1 显示 **Another Farm Roguelike: Rebirth（72.2%，本表最低好评）** 的失败原因就是"去掉了一切过程只留下点击"。而且它和"砍杀局"的乐趣**没有任何耦合** —— 种田玩家和砍杀玩家是两类人。
- **伙伴的真实成本不在数值，在内容量**：每个伙伴需要独立的战斗逻辑（或至少 3 选 1 的差异化）、好感事件文本、专属剧情。做 3 个 = 3 倍的文本量和平衡工作量。而"忠诚度"这个数值本身几乎没有玩法价值 —— 它只会变成一个你需要维护的滑条。

### 12 项里**最容易白做**的：#2 骑马与砍杀

M&B 的魅力 80% 来自**真实 3D 大规模战场**（几百单位、旗帜、阵型、攻城器械）。§B1.3 显示其兵种克制是"地形成 + 阵型"的**空间规则**（高地弓手、盾墙挡骑、阵型收紧消缝隙）—— 这些在节点地图上完全退化。**砍掉实时战斗，只保留"赶路 → 遭遇"这一个抽象层，是把 M&B 降维成它真正可移植的那部分。**

可移植的部分恰好很值钱：
- **士气系统**（单值 + 二值崩溃事件，20 行代码，§B1.1）
- **行军速度惩罚**（昼夜、队伍规模、俘虏数、载重、天气 —— 这就是 §F6 的现成答案）
- **遭遇的三个杠杆**（遭遇率、遭遇的强度梯度、遭遇时机）

## F5. ★ 建议的核心循环（把 12 条缝成一个东西）

**关键判断：12 条愿景不是 12 个系统，是 1 个循环的 4 个位置。**

```
        ┌──────────────────────────────────────────────┐
        │                                              │
   [篝火/据点]  ──准备──>  [大地图：赶路]  ──进入──>  [砍杀局]  ──活着出来──┐
        ↑                  │  ↑                      │                │
        │                  │  └──遭遇（奇遇/守卫/事件）│                │
        │              昼夜循环开关                      │           物资/战利品
        │                  │                           │                │
        │                  └─────── 幻境（主线回合制）<─┘                │
        │                                                            │
        └──────────  重建篝火 / 升级伙伴 / 解锁区域  <────────────────┘
                                  │
                     失败 = 丢物资，保留成长
```

### 依据 1 —— Loop Hero 证明了"撤退"本身就是玩法，而不是结算

它把死亡/撤退的收益做成三档：**死亡保留 30% 资源，中途撤退保留 60%，回到营地保留 100%**。这条设计让"何时收手"成为整局唯一的核心决策，把一个"打怪捡东西"的循环变成了一个"德州扑克 all-in"的循环 ⚠️（多个独立二手来源一致：metro.co.uk Switch 评测、中文拆解；未能打开官方 wiki 核实数字）。

**Loop Hero 数据**：
- ✅ Steam API 实测 2026-10-10：appid 1282730，**36,599 条评测 / 92.7% 好评 / Very Positive**
- ⚠️ 上线首周 50 万份（nichegamer / arcader 报道）
- ⚠️ steamrev.com 估算 120 万份 / $18.4M 毛收入；开发 3 人（Four Quarters），2019–2021，Unity

### 依据 2 —— Blue Prince 证明了"节点布局本身就是关卡设计"

Solo dev **Tonda Ros（Dogubomb）**，2025 年 4 月 10 日上线。核心机制：每开一扇门，从**三个随机房间蓝图里选一个**放到网格上。地图是 **5 列 × 9 行**，入口在最底、第 46 号房在最顶。玩家每天有 **50 步**，进一个房间消耗 1 步，步数耗尽则当天结束、房子清空、收集的一切全部丢失。只有"门厅"和"第 46 号房的前厅"跨局保留。
⚠️ https://www.eurogamer.net/blue-prince-is-a-looping-mystery-about-rearranging-the-layout-of-a-mansion-and-its-excitingly-good/ 、https://vo.rs/respawn/blue-prince-the-house-that-redraws-itself

它对"节点式地图"的启示是决定性的：
- **步数是唯一的资源，也是唯一的难度曲线**。没有血条，没有敌人，**唯一的敌人是"走路本身"**。
- **死亡惩罚不是掉装备，是丢掉本局所有收获** —— 这是最纯粹的"搜打撤"，且**完全不需要战斗系统**。
- **局外只保留"知识"和少量永久升级**。**进度货币是理解，不是数值。**
- ✅ Steam API 实测：appid 1569580，**20,348 条评测 / 86.3% 好评 / Very Positive** —— 注意这是本报告里好评率最低的一款，因为它是硬核解谜

### 依据 3 —— 你的 11 个节点不需要升级成"开放世界"，只需要升级成"有约束的节点图"

现在 3×4 网格、点节点 = 1 点体力，这是"无约束" —— 唯一的成本是体力，没有路线选择，没有冲突。

**最小改造（不超过 3 天工作量，三条）**：
1. **给每个节点加朝向**（进入/离开方向），让路线必须连成一条**回路或路径**而不是任意跳跃
2. **加区域**（比如 5 个区域，每区 3–4 个节点），区域之间用**关卡/体力门槛**隔开
3. **给节点加 1–2 个规则标签**（如"灵田：产出灵气，但不可在此战斗"、"妖巢：掉落材料，但每天只刷新 1 次"）

这三条加起来就是一个真正的"开放世界节点地图"，成本几乎为零 —— 而且它们直接对应 Blue Prince 的"房间规则"和 Loop Hero 的"地形卡邻接交互"。

**数据模型照抄 §C4.4**：节点用 `gx,gy` 网格坐标 + 稳定字符串 `id`（**绝不用数组下标**），`links[]` 显式声明连接（**用 links 表而不是隐式四邻接**，才能表达"山路/水路/捷径"），第一天就写 `version` 字段和迁移函数。

## F6. 昼夜循环：参考 M&B 的做法，不要做光照

**M&B 里昼夜循环的实际作用是"行军速度惩罚"** ⚠️ https://quartzmountain.org/article/does-the-area-you-travel-to-matter-mount-and-balde —— 夜里赶路队伍移动速度下降，而速度下降意味着同样的距离要走更久、遇到更多次遭遇判定。这把"要不要熬夜赶路"变成一个有代价的决策，而不是一个氛围开关。

**M&B 全部影响行军速度的因子**（同一来源，⚠️）：地形（丘陵/森林减速）、士气、骑乘 vs 步兵（**纯骑兵最快**）、库存里的马匹数量（**多了会拖慢**）、Pathfinding 技能、**昼夜循环**、天气、**俘虏数量**、库存物品总重量、队伍规模（越大越慢，因为步兵更多、战利品更重、俘虏更多、士气更低）。

**同理落到你的设计上，最省力的版本是**：
- **白天**：赶路消耗 1 点体力，走 1 格
- **夜晚**：赶路消耗 1 点体力，但**遭遇概率翻倍**；或"夜里不消耗体力但无法获得战利品"
- **篝火**：每个昼夜周期一次，消耗一个资源，换取"跳过夜晚"或"夜里不受遭遇"

这样黑白夜循环的**唯一功能是节奏闸门**：把"今天还想再走一格吗"变成"我要不要赌一次夜路"。

**不要做的**：昼夜光照 tint 全屏渲染、夜晚视野遮罩、怪物夜间刷新。这些是纯表现层，对一个网页小游戏来说是**带宽和 bug 的双重成本，零玩法收益**。

**可参考的额外做法**：§E1 的"篝火 = 国王的凝视"（The King is Watching 的机制）—— 把"篝火光照范围"同时当作"据点产出的作用域"，一个机制两个用途。

## F7. 搜打撤的最小实现：三个数 + 一张不可保清单就够了

不要碰 Tarkov 的保险/Secure Container/钥匙卡那一套 —— 那是为**多人 PvP + 几十小时在线时长**设计的，你在单机 5–10 分钟一局里做这套，只会得到"一堆 UI 没人看"。

**最小可行版本（Loop Hero 已验证过）**：

```
离开篝火 → 进入区域 → 砍杀局 N 波 → 随时可点"撤离"
  ├─ 战死        → 带回 30% 物资，成长不丢
  ├─ 中途撤离    → 带回 60%
  └─ 满进度撤离  → 带回 100% + 触发"奇遇判定"
```

再加两条：

**① 不可保清单**（设计上最关键）：指定 1–3 种物品（比如"本命法宝""宗门令牌"）**永远不会丢失，也不会被带回收益计算**。这就是 Tarkov 安全箱的最小版本，20 行代码，防止玩家因为一次翻车而永久卡关。

**② 一次性兜底补给包**（抄 EFT 的新手支援邮件的四要素）：**当玩家连续失败且资源低于阈值时，发放一个"刚好够打一局"的补给包，18 小时冷却，18 小时领取窗口。** 触发条件是"状态"不是"次数"，恢复的是"行动能力"不是"数值上限"。§A3.2 有完整拆解。

## F8. 具体的一份"砍掉清单"（可以直接贴在墙上）

按投入产出比排序：

| 必做（4 周） | 应该做（8 周） | 有余力再说 | **永远别做** |
|---|---|---|---|
| 节点图加**区域 / 朝向 / 规则标签** | **撤退 30/60/100 三档** | 昼夜作为速度/遭遇惩罚 | **商会行会经济** |
| 砍杀局接入地图节点 | 篝火升级树（5–8 级） | 3 个固定伙伴（无忠诚度数值） | **实时骑马战斗** |
| **撤退/损失机制** | 20–30 条奇遇文本 | 幻境（回合制主线）1 个 | **程序化地形生成** |
| **不可保清单** | 黑白夜作为节奏闸门 | 灵田（**只做产出，不做开垦**） | **装备打造/加工链** |
| **一次性兜底补给包** | 士气单值 + 二值崩溃 | | **联机 / 交易行 / 排行榜** |

**"永远别做"的推理**（不是取舍问题，是物理约束）：
你现在是 **GitHub Pages 静态部署 + localStorage 存档**（同项目审计实测：25 个 `xx_` 键、55–62 处调用、22–23 个模块持有）。**localStorage 存档意味着无法做跨设备同步，也无法做防作弊。** 任何需要服务器权威的玩法（联机、交易行、排行榜）在你当前的部署形态下**都不可能正确实现**。

**"永远别做"的第二条 —— 程序化地形生成**：
§C2.2 的整套噪声/POI 算法是为"每次生成全新世界"服务的。你的世界是**手排的、有限的、玩家会记住的**。Loop Hero 的 200 余种卡牌效果是**手工设计的邻接交互**，不是生成的；Blue Prince 的 45 个房间也是手写的。**在这个体量下，程序化生成是纯粹的负收益：它让每一局的地图都是陌生的，而"熟悉地图"恰恰是搜打撤张力的一部分来源**（你知道 A 点危险，所以敢多搜一个房间）。

## F9. 三个月路线图

| 阶段 | 做什么 | 验收标准（可量化） |
|---|---|---|
| **第 1–4 周** | 节点图三件套（区域/朝向/标签）+ 撤退三档 + 不可保清单 | 玩家能在 10 次赶路内做出至少 3 次"要不要再贪一格"的犹豫 |
| **第 5–8 周** | 砍杀局接入地图 + 篝火升级树 + 20 条奇遇文本 | 一个完整循环能跑通：篝火→赶路→砍杀→撤退→升级篝火 |
| **第 9–12 周** | 黑白夜闸门 + 兜底补给包 + 1 个幻境主线 | 首次游玩 20 分钟内能触到 3 次"差一点翻车" |
| **不做** | —— | —— |

**判断"这个循环好不好玩"的方法**（借 §F1）：**做完核心循环后立刻做成 demo 找人试玩，问一个问题 —— "你最后一次撤退是因为什么？"**
- 如果答案五花八门（"捡到东西了""血不够了""快到点了""想试试新路线"）→ 核心循环成立，继续做
- 如果答案收敛成一两种 → 决策空间太窄，回去加撤离点种类或遭遇类型
- 如果没人提到"撤退"这个词 → **他们根本没意识到这是一个决策**，说明 UI 没把三档返还显示出来，先改 UI，别改玩法

---

# G. 本报告的已知数据缺口（诚实清单）

以下内容**没有可靠来源，我没有编造**：

1. **Tarkov 保险费用的计算公式**（只有"忠诚度提供折扣"这一 ✅ 事实）
2. **Tarkov 当前各图 raid 时长 / hydration / energy 的具体数值**
3. **M&B 的伤兵系统、Warband 队伍规模上限、赎金公式、攻城战阶段数值**
4. **Dragon Age: Origins / Divinity OS2 / Kingdom Come 的好感与忠诚度阈值**
5. **Darkest Dungeon 的 stress 系统具体数值**
6. **Outer Wilds 的 22 分钟循环机制**
7. **TF2 PAYG 我已补齐**（§E2.1），但 **Fallout Shelter / Kingdoms and Castles** 的据点系统细节未取得
8. **Stardew 作物表已补齐**（§E3.2 规则层），但**每种作物的具体生长天数/售价/收获次数表未逐一抄录**
9. **r/roguelikes 与 r/roguelikedesign 的 2025–2026 原帖讨论**（Reddit 端点被挡；只有 Hiive Interpretation 这条提案）
10. **D3 的专项检索**（risk of reward / loss aversion / punishment design GDC）—— 未做，机制清单是从 D1/D2 反向提炼的
11. **"Ubisoft 开放世界世界生成 GDC talk"** —— 只有 Far Cry 5 一篇可查
12. **"Peglin 2" 独立游戏** —— 确认不存在（是 2.0 更新）
13. **零依赖零构建 Canvas 2D 游戏地图的成熟技术栈** —— ❌ 没找到（nobuild.net 是最接近的社区共识页）
14. **Candy Castle**（2D extraction shooter）—— Steam 搜索无结果，无法核实该游戏是否存在及其开发规模

**另需说明的一个方法学问题**：调研过程中我向三个子代理发送了 curl workaround 和一批"已核实"数据。其中一个子代理把这条消息判定为潜在的 prompt injection 并拒绝采信（**它的判断在程序上是对的** —— 一个 session 不该把另一个 session 的转述当作已核实事实）。它独立复核通过的数据与我一致，未采纳的只有 Megabonk / Nubby's Number Factory 两项 —— 这两项**我本人用 Steam API 直接核实过**（appid 3405340 = Megabonk 106,894 条评测；appid 3191030 = Nubby's Number Factory 19,718 条评测），所以它们在本报告中标 ✅。

---

## 一句话总结

**砍掉商会、实时骑马战斗、开垦/加工链三条线；把其余 9 条重组成"篝火 → 赶路 → 砍杀局 → 撤退三档 → 重建篝火"这一个循环；节点图加区域/朝向/规则标签三件套就是你想要的"开放世界"；昼夜当天数惩罚用，篝火当产出作用域用；用 Loop Hero 的 30/60/100 和 EFT 的"一次性兜底补给包"作为失败成本的全部答案。数据模型用 `gx,gy` 网格坐标 + 稳定字符串 id + 显式 links 表，`import x from './world.json' with {type:'json'}` 零构建直读。**