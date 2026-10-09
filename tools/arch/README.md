# 架构接线普查

回答一个问题：**这个游戏是真的整合为一体，还是一堆各写各的？**

## 工具（装在 node_modules，只在开发时用，不进 PWA）

| 工具 | 查什么 | 仓库 |
|---|---|---|
| **knip** | 导出/文件/dep 从未被使用 —— 专治「只有概念没有配套」 | webpro-nl/knip ★12421 ISC |
| **madge** | 循环依赖 + 孤儿模块 —— 专治「独立开发分散」 | pahen/madge ★10168 MIT |

## 用法

```bash
npx knip --no-progress          # 死导出、死文件、没用的依赖
npx madge --circular js/main.js # 循环依赖
npx madge --orphans js/         # 没人 import 的模块
```

## 为什么不用 grep 自己写

本次我用 grep 下了两次错误结论：
1. 「称号零授予点」—— `check()` 内部调 `this.add(id)`，grep `titles.add` 搜不到
2. 「`travel` 没接线」—— 实际走 `ui.js` 的 `data-act="travel"`，不是 `WORLD.travel`

静态分析器解析**代码结构**，grep 匹配**字符串**。判断「接没接上」，grep 不够格。

## 当前结论（2026-10-09，v099h）

- **循环依赖 0** —— 结构本身干净
- **死导出 50 个** —— 详见工单 XX-ARCH-001
- 主链路是真的通的：BUILD/FAMILY/QUEST/CAMP/COMPANION/STORY 各有 10~40 处调用
- 断的是**中间层**：有一批子系统只做了数据层 + UI 层，产出/触发那层没接上
