# 视觉检查工具集

一套在**真浏览器**里把游戏每个界面渲染一遍、并用计算方式判定"owner 看到的是什么"的工具。

> 为什么需要它:harness（`tests/*.mjs` 的 631 条断言）只能证明
> **文件在、模块通、数字对**，证明不了**画面长什么样**。
> 全站变灰那类事故（XX-FIX-007）里，断言全绿，页面是废的。

---

## 四个文件

| 文件 | 干什么 | 什么时候用 |
|---|---|---|
| `shoot.py` | 无头渲染，18 个界面各截一张，顺带抓 console 报错和 404 | 改完 UI，出一轮图 |
| `sheet.py` | 把一堆截图拼成联系表 / 与基线比差异并红框标出 | 一眼扫完；或版本回归 |
| `audit.py` | 自动判定：豆腐块、文字裁切、溢出视口、触控过小、对比度 | 接 CI，当门禁 |
| `selftest.py` | 给**检测器本身**做体检：注入已知缺陷，看抓不抓得到 | **改完 audit.py 必须跑** |

## 环境

- Chromium: `/root/.cache/ms-playwright/chromium_headless_shell-1243/`（Chrome for Testing 153）
- 系统库：`apt-get install libnss3 libatk1.0-0t64 …`（本机是 Ubuntu 24.04，直接装即可）
- 字体：`fonts-noto-cjk` + `fonts-noto-color-emoji`

> ⚠️ **字体必须和真机一致**。少装 emoji 字体时，🪙 会渲染成豆腐块，
> 检测器会把它报成缺陷——那是测试环境的锅，不是游戏的锅。
> 别照着假阳性去改游戏。

## 用法

```bash
# 一轮全量：截图 + 体检
python3 tools/visual/shoot.py --out tools/visual/shots
python3 tools/visual/sheet.py sheet tools/visual/shots -o /tmp/board.png

# 只截某几屏
python3 tools/visual/shoot.py --only menu,xx-realm,xx-bag

# 进一局截 HUD / 暂停
python3 tools/visual/shoot.py --play

# 视觉回归：跟基线比，只把变了的拼出来
python3 tools/visual/sheet.py diff tools/visual/baseline tools/visual/shots -o /tmp/diff.png

# 体检（--strict 有问题就 exit 1，可接 CI）
python3 tools/visual/audit.py --json /tmp/audit.json
python3 tools/visual/audit.py --strict

# 检测器自检 —— 改过 audit.py 就必须先过这个
python3 tools/visual/selftest.py
```

## 覆盖的界面

- 开屏取名仪式
- 局外 4 屏：主菜单 / 组合图鉴 / 怪物图鉴 / 选择角色
- 修仙阁 13 页签：境界·大地图·营地·神通·行囊·集市·人物·称号·家族·领地·图鉴·支线·存档
- 局内（`--play`）：HUD / 暂停

## 检测器踩过的坑（都写进 selftest 了）

这个工具的第一版**大面积误报**，如果不修就去改游戏，等于修不存在的问题。四轮迭代：

| 版本 | 症状 | 根因 | 修法 |
|---|---|---|---|
| v1 | 「灵」「篝」「火」是豆腐块 5501 个 | canvas `ctx.font` 赋值实际失败，所有字宽度一致；且把 `#app` 这种容器也当文本叶子量了 | 改**像素位图比对**（画出来和 `\uFFFF` 比），且先验字体真的生效（同字体下 `正`/`鑫` 必须画出不同位图） |
| v1 | 渐变按钮对比度算出 1.0 | `backgroundColor` 对渐变返回透明，背景往上找错了 | 改**像素级**采样 |
| v2 | 正常黑字白底算成 2.96 | 取 2% 分位当前景色，细黑字占不到 2% 像素，取回抗锯齿灰 | 换成 Otsu 双峰分割 |
| v3 | 渐变按钮对比度算出 4.35 | Otsu 分出来的是渐变深浅两端，不是文字与背景 | 换成**环形采样**：背景取文字外一圈的中位数，前景取偏离该背景 60 级以上的像素 |
| v3 | 修仙阁页报出主菜单的按钮 | 菜单被遮罩**盖住**了，但没被 `display:none`，可见性判断抓不到遮挡 | 加 `elementFromPoint` 遮挡检测 |

**结论**：检测器自己有 bug 时，它报的问题全是噪声。
**尺子不过 `selftest.py`，结论一律不算数。**