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
---

## ⚠️ 一次「同内容、不同 SHA」的双头状态（2026-10-11 · 需在网络恢复后收敛）

**事实**：同一条改动在两边各有一个提交，**内容完全相同**（逐文件 blob SHA 已核对相等），
但 SHA 不同，因此不是快进关系，直接 `git push` 会被拒。

| 位置 | SHA | 说明 |
|---|---|---|
| 本地 `merge/p1-elite` | `1fe610b` | 正常 `git commit` 产生 |
| 远端 `main` | `862f732` | 经 **api.github.com** 的 Git Data API 直传 |

**为什么分叉**：2026-10-11 晚，`git push` 到 `github.com:443` 持续
`Failed to connect`（该主机解析到 `20.205.243.166`，路由不通；同刻
`api.github.com`（`20.205.243.168`）0.2 秒可达）。只有 API 链路是通的，
于是用 `git/trees → git/commits → git/refs` 三步造了**单个**提交直传
（刻意不用 contents PUT，那会拆成两个提交）。

**已经做过的安全检查**（都通过）：
- 覆盖前核对远端 blob SHA == 本地 `HEAD~1` 的 blob SHA → 确认期间无人并发改动
- 推进 ref 前二次读 `git/ref/heads/main` 做 compare-and-swap → 不覆盖别人的新提交
- 推送后逐文件比对远端 blob SHA 与本地 `HEAD` → 全部相等

**网络恢复后怎么收敛**（二选一，不要两个都做）：
```sh
# A. 让本地跟远端对齐（丢弃本地那条重复提交；内容一字不差，安全）
git fetch origin main
git merge -s ours origin/main -m "chore: 与远端 862f732 对齐（同内容不同 SHA）"

# B. 保留本地那条，把远端那条并进来（会产生一个 merge 提交）
git fetch origin main
git merge origin/main
```
选 A 更好：内容已经验证一致，没必要在历史里留一个空合并。

⚠️ `git push` 的重试循环**不要**写成 `if git push … | tail -2; then echo OK` ——
管道的退出码取自最后一条命令（`tail`，恒为 0），推送失败也会打印成功。
2026-10-11 就因此误报过一次「已推送」。正确写法见 `tests/` 与 `tools/` 里的惯例：
```sh
git push … > /tmp/p.log 2>&1; rc=$?; [ $rc -eq 0 ] || { cat /tmp/p.log; retry; }
```
