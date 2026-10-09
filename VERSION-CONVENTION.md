# 版本号协同约定（桌面侧 ↔ Z8）

> 建立：2026-10-10
> 起因：两边并行改同一个项目，**都提交了但都没升版本号**。
> 当时双方 HEAD 分别是 `8516dd5`(桌面) / `50d3c2e`(Z8)，`sw.js` 都还是 `xuanxuan-v099p`。
> —— 也就是说，**两个不同版本的代码对外声称是同一个 V0.99**。这必须治。

---

## 一、现状风险

| 问题 | 后果 |
|---|---|
| 两边都改，但都不升版本 | 用户拿到「V0.99」却不知道是哪个 V0.99；SW 缓存无法区分新旧 |
| `sw.js` 的 `const V` 改了但 `index.html` 没改 | `lint-version` 会红，但**合并后才红**，那时已经晚了 |
| 两边各自 `git push` | 后推的覆盖先推的（除非非快进），**可能静默丢提交** |

> ⚠️ 本项目已有 `tests/lint-version.mjs` 强制 `sw.js` / `index.html` / `manifest.webmanifest` / `version.json` 四处一致。
> 但它**只管一致，不管谁该升**。协同约定补的就是这个缺口。

---

## 二、硬规则

### 规则 1：版本号只有一个真源

**`sw.js` 第 6 行的 `const V`** 是唯一真源。

```js
const V = 'xuanxuan-v099p';   // ← 唯一需要手改的地方
```

其余三处（`index.html` / `manifest.webmanifest`）由 `lint-version` 校验一致性，
改完跑 `node tests/lint-version.mjs` 确认。

> ⚠️ **已知缺口**（实测）：`version.json`（4732 字节，含 112 个文件的 sha256）
> **没有任何 script 会重新生成它** —— `tests/make-manifest.mjs` 存在，但没挂进
> package.json 的 scripts，`lint-version` 也不检查它。
> 后果：改了代码不重新生成，`version.json` 里的探针指向一个**实际不存在的版本组合**。
> 手动跑：`node tests/make-manifest.mjs`。建议后续补进 scripts（见工单 XX-AUDIT-019）。

### 规则 2：改 `const V` 之前，必须先合并

**不要各自升版本号。** 流程固定：

```
1. 各自把自己的提交推上 GitHub
2. 合并（谁后合谁负责解决冲突）
3. 合并完成后，由**后合的一方**升版本号
4. 跑 npm run check:full，必须 0
5. 再推一次
```

理由：两人都升会撞成 `v099q`（两边都加 q），或一个升了另一个没升。

### 规则 3：patch 后缀表示「同版本内的修订」

```
xuanxuan-v099p → xuanxuan-v099q → xuanxuan-v099r
```

- `v099` → `v099p`：界面 `V0.99`
- `p/q/r`：同一界面版本下的 SW 修订（SW 缓存键必须变，否则用户拿不到新代码）
- 界面版本要动（`V0.99` → `V0.100`）时：`v100a`，**小版本开始重新计数**

> ⚠️ **只要改了任何会被浏览器缓存的文件的逻辑，就必须升 patch 后缀。**
> 否则老用户拿到的还是旧代码 —— 这就是 PWA 最常见的「我改了怎么没变」。

### 规则 4：合并后必须全绿才能推

```bash
npm run check:full      # 必须 0
bash tests/run-all.sh   # 必须 0
```

---

## 三、CHANGELOG 与提交的对应关系

| 改动类型 | 升版本号 | 写 CHANGELOG | commit message 前缀 |
|---|---|---|---|
| 修 bug（玩家可见） | ✅ patch | ✅ 加一条 | `fix(...)` |
| 修 bug（内部/不影响玩家） | ✅ patch | ❌ | `fix(...)` |
| 新玩法 / 新内容 | ✅ 小版本 | ✅ 大段 | `feat(...)` |
| 重构 / 收口（行为不变） | ✅ patch | ❌ | `refactor(...)` |
| 只改测试 | ❌ | ❌ | `test(...)` |
| 只改文档 | ❌ | ❌ | `docs(...)` |

> **重构也要升 patch。** 因为改了代码就是改了要缓存的东西。
> 行为不变 ≠ 用户拿到的代码没变。

### CHANGELOG 的写法

现有 CHANGELOG 是**面向玩家的叙事体**（讲「为什么改」而不是「改了哪个文件」）。保持这个风格：

```markdown
## V0.99q · <一句话主题>

**用户反馈:「……」/ 或 你自己发现的问题**

这一版 <做了什么>,并 <解决了什么>。

### 关键改动
- ...(面向玩家描述,不写文件名)
```

**反面例子**（不要这样写）：
```markdown
- 修复 js/xiuxian/profile.js 的 pxs_save 双写问题
```

---

## 四、当前的协调点

| 项 | 值 |
|---|---|
| 当前线上版本 | `xuanxuan-v099p` / 界面 `V0.99` |
| 桌面侧 HEAD | `8516dd5`（XX-AUDIT-018 双结局收口） |
| Z8 HEAD | `50d3c2e`（本轮发现回填 + 测试修正） |
| 状态 | **两边都未升版本号 —— 需合并后由后合方统一升到 `v099q`** |

**升到 `v099q` 的理由**：两边都有玩家可见改动
- 桌面侧：修「点了没反应」（bindTap 按钮互吞）、修结算软锁、修存档回滚
- Z8 侧：`19fc9f5` 修恒真断言与死常量、`48553dd` 修 `dayProgress` 重复计数

---

## 五、推送纪律

- **合并后一次性推**，不要各推各的（非快进推会被拒，强推会丢历史）
- GitHub 凭据：桌面侧已配好（`~/.git-credentials`，仅 github.com 生效）
- Z8 侧用 `gh`（已登录 `DaDaDelddd309`）

---

## 六、待办

- [ ] Z8 合并桌面侧提交 → 解决 `test-rng.mjs` 两边都有的冲突（**两边都留**）
- [ ] 合并后统一升版本号到 `xuanxuan-v099q`
- [ ] 更新 `index.html` / `manifest.webmanifest` 的 `V0.99q`（或按需升小版本）
- [ ] 手动跑 `node tests/make-manifest.mjs` 重新生成 `version.json`（**没有 npm script,得手动**）
- [ ] `npm run check:full` 必须 0
- [ ] CHANGELOG 补本轮条目
- [ ] 推送