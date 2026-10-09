# 待推送清单（2026-10-08 10:20 · 手机无 WiFi 期间产出）

> 网络恢复后按此顺序执行。全部文件已备好在 Z8 可达的传输通道。

## 状态：网络中断点

Z8（192.168.1.133）在局域网内，手机 WiFi 掉线（`wlan0` 消失，仅剩 4G `ccmni0`），
暂时够不着。**已 commit 的 9 个提交安全保存在 Z8 分支上**，不受影响。

## 产出物位置

| 文件 | 本地路径 | 用途 |
|---|---|---|
| 主线骨架 | `backbone/js/xiuxian/spine.js` | 新增模块 |
| 主线测试 | `backbone/tests/test-spine.mjs` | 26/26 已本地验证 |
| 主线接线脚本 | `backbone/wire_spine.py` | 改 ui.js 的 5 处 |
| 灵伴方案文档 | `COMPANION-PLAN.md` | 入 docs/ |
| 灵伴新实现 | `companion.js` | 已传 Z8，未 commit |
| 灵伴局内实体 | `companion-actor.js` | 已写，待接 main.js |

---

## 恢复后执行步骤

### 步骤 1：验证灵伴改动（未 commit，优先）
```bash
cd /tmp/v96.L8dr/xxdeploy
# 1a. 符号残留检查
grep -rn 'HUG_CHOICES\|HUG_LINES\|addAff\|tryGift\|hugChoose\|COMPANION\.s\.route' js/ --include=*.js
# 预期：只有注释里有 showHug/hugChoose 说明文字

# 1b. lint 全绿
for f in tests/lint-*.mjs; do node $f; done

# 1c. 单测回归
for t in test-rng test-seed test-worldgen test-world-compat test-mine test-runcfg; do node tests/$t.mjs; done
```
**全部通过才 commit 灵伴。**

### 步骤 2：推送主线骨架
```bash
# spine.js
scp backbone/js/xiuxian/spine.js        → Z8:js/xiuxian/spine.js
scp backbone/tests/test-spine.mjs       → Z8:tests/test-spine.mjs
scp backbone/wire_spine.py              → Z8:/tmp/
scp COMPANION-PLAN.md                   → Z8:docs/
scp companion-actor.js                  → Z8:js/xiuxian/
```

### 步骤 3：接线 + 验证
```bash
cd <repo> && python3 /tmp/wire_spine.py
node tests/lint-syntax.mjs          # ui.js 改过，必须验
node tests/lint-methods.mjs
node tests/test-spine.mjs
```

### 步骤 4：浏览器实测（不可省）
```bash
node -m http.server 8930 &
node <e2e脚本>
```
验两件事：
1. 见到传说妖时**因果句真的出现**（不是只有 lore）
2. 灵伴在场上**真的动了、捡了东西**

**教训**：本轮我三次"只查一半就下结论"（矿脉、模块实例、传说妖 lore），
任何"坏了/没做"的判断必须先跑浏览器实测再下。

### 步骤 5：提交
灵伴与主线分成两个 commit，便于单独回滚。

---

## 未完成的（排队中）

见 `TICKETS.md`，优先级：
1. HINT 门禁提示（低成本高收益）
2. PAL 色板收敛
3. ART 立绘重出
4. DAY 昼夜怪物种类