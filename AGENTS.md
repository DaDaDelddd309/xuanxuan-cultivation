# 接手指南(给 AI Agent / 新开发者)

> 这份文档记录了**真实的坑**。大多是开发过程中实际踩到并修掉的。
> 动手前请完整读一遍,能省你几个小时。

---

## 零、先做这件事

```bash
bash tests/run-all.sh        # 逻辑测试 + 静态检查,~510 项,秒级
bash tests/run-browser.sh    # 浏览器全流程(Playwright),较慢
```

全绿是基线。**改任何东西之前先跑一次**,知道哪些是本来就红的。

`run-all.sh` 里除了 7 个 `.mjs` 逻辑测试(t80-t90),还跑 5 个静态检查:

| 检查 | 抓什么 |
|---|---|
| `lint-imports.mjs` | 重复 import 声明 —— **会让整个 ES module 加载失败,页面白屏且零报错** |
| `lint-precache.mjs` | sw.js 预缓存重复项 / 指向不存在的文件(会让 SW install 整体失败) |
| `lint-version.mjs` | 版本号在 index.html / manifest / sw.js 之间不一致 |
| `lint-methods.mjs` | 调用了 `this.xxx()` 但方法没定义(V0.89 实际踩过,点按钮毫无反应) |
| `lint-testversion.mjs` | 测试里写死版本号(升版后假失败,V0.86/87/88/89 各中一次) |

这五个 lint 不是可选项。V0.88/V0.89/V0.90 的严重 bug 全部是 `node --check` 查不出来的语义问题。

---

## 零点五、最近两个版本踩的坑(V0.88 / V0.89)

这批 bug 有共同点:**语法完全正确,`node --check` 全过,逻辑测试也全绿,只有真跑浏览器才炸。**

连同上面四个 lint 在内,`run-all.sh` 抓到的都是**语义**问题 —— 语法没问题,行为不对。

### 0. 存档:每个模块都得 `load()`,包括它自己

**V0.77 到 V0.90 的 P0 bug。** `Cult.init()` 以前只 load 了 nemesis/titles,
没 load 自己。结果每次刷新页面,修为/境界/丹药/神通全归零,还会把 0 写回存档。

```js
// ❌ 以为 init 会自动读存档
init() { this.nemesis.load(); this.titles.load(); }

// ✅ 每个模块启动都要读回自己的存档
init() { this.load(); this.nemesis.load(); this.titles.load(); }
```

**给带存档的模块写测试,必须有往返断言**:
```js
s.exp = 7777; commit(); load(); assert(s.exp === 7777);
```
否则逻辑测试从空档开始跑,永远测不到 —— 这个 bug 藏了 13 个版本。

### 1. 写了但没接上

```js
// ❌ 结局选择只发奖,从不调 finish()
// 后果:叙事线永远标记不了完成,结案后还在列表里 → 可无限刷奖励
const g = QUEST.grant(rw, path);        // 发了
// STORY.finish(k, path, grant)          // ← 这行漏了
```

**教训**:新增的函数如果没人调用,`node --check` 和单测都发现不了。
写完 grep 一下函数名,确认有调用点。

### 2. 缺 import 导致静默失败

```js
// ❌ quest.js 缺 import { BUILDINGS }
// 后果:Bag.add('bld_field') 返回 false,建筑类奖励发不出去,没有报错
// 道具发了,建筑没发,玩家只看到少了一样东西
```

**教训**:`Bag.add` 失败是**静默的**。新增物品类型后,验证 `Bag.add` 返回 true。

### 3. 导出名用错

```js
// ❌ STORY.ARCS —— ARCS 是独立导出,不在 STORY 上
// 后果:点击结案直接报错,弹窗不出现
import { STORY, ARCS } from './story.js';
```

### 4. 重构误伤(最隐蔽的一种)

V0.89 清理 `ui.js` 的 188 行重复代码时,把 `askStoryPath` / `showStoryDone` 一起删了 ——
它们 V0.88 才加,正好被包在重复块里。
点「了结」**毫无反应**,`this.askStoryPath is not a function` 只在浏览器控制台。

**教训**:清理重复代码前,先 `grep -c "方法名"` 确认真实定义数。
两份内容相同 ≠ 两份都是唯一的那份。

### 5. 重复定义(写重了)

V0.89 在 `ui.js` 里发现 7 个方法被定义两遍,整整 188 行。
JS 对象字面量里**后者静默覆盖前者**,功能"看起来完全正常"。

**教训**:改大文件后跑 `grep -oP "^  \K\w+(?=\()" js/xiuxian/ui.js | sort | uniq -d`,看有没有重名。

### 6. 重复 import(直接白屏)

```js
// ❌ ui.js 里 import { QUEST } 写了两遍
// 后果:SyntaxError → 整个修仙阁打不开,页面上没有任何提示
```

**教训**:已加 `tests/lint-imports.mjs` 长期防回归。`node --check` 抓不到这个。

---

## 一、致命坑(会让你整个游戏打不开)

### 1. Service Worker 会把你的新版本钉死

```js
// ❌ sw.js 曾经这么写(已修)
const cached = await caches.match(e.request);
if (cached) return cached;      // 命中就永远不更新!
```

缓存了 `index.html` 之后,用户永远看不到新版本。
**症状**:本地改了代码,刷新页面没反应;线上部署成功但用户看到的还是老样子。

**现在的策略**:
- 导航请求(navigate / text/html)→ **network-first**,离线才回缓存
- 静态资源 → **stale-while-revalidate**

**你必须做**:每次改动版本号就改 `sw.js` 里的 `const V = 'xuanxuan-v0XX'`。
不改的话用户拿不到新版本。

### 2. ES Module 导出是只读的

```js
import * as Enemies from './game/enemies.js';
Enemies.spawnEnemy = function(){...};   // ❌ TypeError
```

**症状**:`Cannot assign to property 'spawnEnemy' of [object Module]`
**后果**:整个 `main.js` 抛错,**游戏完全打不开**,而且浏览器只报一句不明显的错。

**正确做法**:改源文件加钩子。`js/game/enemies.js` 里有现成的 `setEnemyMod()`。

### 3. TDZ —— 变量用在了声明之前

```js
function bind() {
  Enemies.setEnemyMod(COMPANION.possessing() ? {...} : null);  // ← 用了 _ghostMod
  let _bondT = 0, _ghostMod = null;                              // ← 声明在这
}
```

**症状**:`Cannot access '_ghostMod' before initialization`,游戏打不开。

**规则**:`let` / `const` 全部声明提到函数**第一行**。

### 4. 导入了不存在的符号

```js
import { BUILD, TIERS } from './build.js';   // TIERS 其实在 bestiary.js
```

**症状**:模块加载失败 → 依赖它的 UI 全部空白,而且**报错信息指向别的模块**,很难查。

**每次改完 import 跑这个校验**:

```bash
python3 - <<'EOF'
import re,os
d='js/xiuxian'; mods={}
for f in os.listdir(d):
    if f.endswith('.js'):
        src=open(os.path.join(d,f),encoding='utf-8').read()
        ex=set(re.findall(r'export\s+(?:const|function|class|let|var)\s+(\w+)',src))
        mods[f[:-3]]=ex
bad=[]
for f in sorted(os.listdir(d)):
    if not f.endswith('.js'):continue
    src=open(os.path.join(d,f),encoding='utf-8').read()
    for m in re.finditer(r"import\s*\{([^}]+)\}\s*from\s*'\./(\w+)\.js'",src):
        for n in m.group(1).split(','):
            n=n.strip().split(' as ')[0].strip()
            if n and m.group(2) in mods and n not in mods[m.group(2)]:
                bad.append(f"{f} ← {n} (from {m.group(2)})")
print('\n'.join(bad) if bad else '  ✅ import 全部有效')
EOF
```

### 5. 同一符号被导入两次

```js
import { CHARACTERS, TITLES, WORLD } from './lore.js';
import { ENCOUNTERS, CHARACTERS } from './lore.js';   // ❌ 重复
```

**症状**:`Identifier 'CHARACTERS' has already been declared`,模块加载失败。

### 6. 往 Bag 里加新物品类型

`Bag.add()` 有白名单:
```js
const isItem = id => !!(STONES[id] || SCROLLS[id] || GOODS[id]
                       || REGISTRY.buildings[id] || REGISTRY.extras[id]);
```

**新物品类型必须在对应模块注册**:
- 建筑 → `registerBuildings()`(`bestiary.js` 顶部已自动注册全部 `BUILDINGS`)
- 其他(如灵米)→ `registerExtras()`

**症状**:`Bag.add()` 静默返回 `false`,东西凭空消失,不报错。

---

## 二、设计坑(逻辑对但体验坏)

### 7. 晋升死锁

曾经配了:
```
LV1 槽位 2 格,LV2 晋升条件「需要 3 个建筑」
```
**永远升不了**。

**规则**:`TIERS[i].need.builds` 必须 ≤ `TIERS[i-1].slots`。
已加保护 `BUILD._needOf()` 会 clamp,但**数据本身也改了**,别改回去。

### 8. 建筑必须有 `eff`,否则是纯摆设

曾经灵井/哨塔/议事堂只有名字和图标,功能全是假的。

**规则**:`BUILDINGS` 里每一条都必须有 `eff: { ... }`,
并且效果要真的在 `BUILD.effects()` / `BUILD.popCap()` / `BUILD.ward()` 里被消费。

**自检**:每个建筑的效果,玩家在界面上**看得到数字变化**吗?

### 9. 产出必须有出口

灵田曾经收了灵米直接丢弃,玩家完全看不到价值。

**规则**:任何 `tickAll()` / `yieldDay()` 产出的东西,
必须在 UI 上有「吃 / 卖 / 送 / 用」中至少一种出口。

### 10. 地图标记不能要求相邻可达

矿脉标记曾经要求「与当前位置相邻才显示」,
结果秘境/妖巢都不相邻 → **玩家永远看不到矿脉标记**。

**规则**:地图上的**信息性标记**(矿脉/异兽/叙事)用全局条件判断,
只有**移动**才受相邻限制。

### 11. 不要在仪式/弹层上留死锁

曾经开局仪式没有超时兜底,玩家什么都不点就一直被挡。

**规则**:任何全屏遮罩(`.xx-ritual` `.xx-off` `.xx-defeat`)必须有
至少两条关闭路径 + 超时自动关闭。

---

## 三、代码风格约定

### 12. CSS 用 `.xx-` 前缀

修仙层的类名一律 `.xx-*`。不加前缀会污染原版样式。

### 13. 不要用 `Math.random()`,要用 `Seed.next()`

```js
import { Seed } from './profile.js';
Seed.next();          // 确定性
Seed.int(3, 8);
Seed.pick(arr);
Seed.weighted(arr, x => x.weight);
Seed.chance(0.3);
```

用 `Math.random()` 会让「同种子 = 同世界」失效,存档码也无法复现进度。

**已知例外**(暂未迁移,后续应改):
- `ambience.js` 的白噪声生成(纯装饰性)
- `build.js` 的产量浮动
- `profile.js` 自身的 PRNG

### 14. Python 改文件必须加 assert

开发中多次 `str.replace()` 因为字符串不匹配而**静默失败**,
我以为写进去了,实际没写,浪费很多时间。

```python
old = "...."
assert old in u, "未匹配!"      # ← 必须有
u = u.replace(old, new)
```

写完还要 `grep` 确认符号真的进去了:
```bash
grep -c "xx-node-mine" js/xiuxian/ui.js    # 期望 ≥1
```

### 15. 改完必须 `node --check`

```bash
for f in js/xiuxian/*.js js/main.js; do node --check $f || echo "❌ $f"; done
```

---

## 四、状态对象的 load 陷阱

```js
// ❌ 旧档缺字段会导致 undefined
if (r) this.s = { ...this.s, ...JSON.parse(r) };
```

**症状**:某字段显示 `undefined`,或 `.includes()` 崩。

**正确写法**(family/camp/companion 都是这个模式):
```js
load() {
  try {
    const r = localStorage.getItem(K);
    if (r) {
      const d = JSON.parse(r) || {};
      const def = { founded:false, members:[], /* 全部默认值 */ };
      this.s = { ...def, ...d };
      for (const k in def) if (this.s[k] === undefined) this.s[k] = def[k];
      if (!Array.isArray(this.s.members)) this.s.members = [];
    }
  } catch {}
  return this.s;
}
```

---

## 五、命名约定

| 概念 | 命名 |
|---|---|
| 修仙层 CSS 类 | `.xx-*` |
| 修仙层 localStorage 键 | `xx_<名字>_v0XX` |
| 修仙层新模块 | `js/xiuxian/<名>.js` |
| BGM 轨道常量 | `relations.js` 的 `BGM.TRACKS` |
| 测试脚本 | `scripts/t<版本>.mjs`(逻辑) / `t<版本>.py`(浏览器) |

---

## 六、绝对不要做的

1. **不要引入框架/构建工具** —— 会破坏 Canvas 渲染层
2. **不要把修仙 UI 画进 canvas** —— 和原版渲染循环打架
3. **不要修改 `js/game/` 的游戏逻辑** —— 只允许加钩子(`ENEMY_MOD` 这种)
4. **不要打包外部音频/图片素材** —— 音频用 WebAudio 合成,图片用 AI 生成
5. **不要在 `main.js` 里塞业务逻辑** —— 它只做装配和钩子
6. **不要声称「已完成」而没实际验证** —— 每个数字都要有对应测试断言

---

## 七、当前版本状态

**V0.90 · 存档修复**

- 逻辑测试 **510 项**全绿(t80-t90)+ 5 个静态检查
- 浏览器测试 **5 套**全流程通过,0 JS 错误
- 线上:`https://dadadelddd309.github.io/xuanxuan-cultivation/`

**已完成**:
- ✅ 存档持久化修复(V0.77 起的老 bug,V0.90 修)
- ✅ 支线任务系统(8 条传说妖支线,追踪/双结局/发奖)
- ✅ 叙事线与支线打通(共用结局,发奖只发一次)
- ✅ 仙人墓地下层(5 房间,墓主身份揭晓,结局刻碑文)

**未完成**(详见 [`ROADMAP.md`](ROADMAP.md)):
- 坐骑 / 宠物
- 昼夜生态表(现在只改倍率,不改种类)
- 化神之上(渡劫 / 仙人)
- 更多传说妖与叙事线
- 结局的长期影响(碑文是第一步,还没影响 NPC 对话)

**技术债**:见 [`TECHDEBT.md`](TECHDEBT.md)。
其中 `ui.js` 1394 行待拆、存档键分散在 5 个模块、部分 `Math.random()` 未迁移到种子。

---

## 八、部署

见 [`DEPLOY.md`](DEPLOY.md)。要点:
- 仓库 `DaDaDelddd309/xuanxuan-cultivation`
- **部署前必跑** `bash tests/run-browser.sh`(只跑逻辑测试不够,见第零点五节)
- 升版本号要改 4 处:`index.html` ×2、`manifest.webmanifest`、`sw.js`
  (`lint-version.mjs` 会验,漏改直接红)
- 部署完要**等 GitHub Pages 构建完再验证**,通常 30-60 秒
- commit message 现在会自动读 `index.html` 里的版本号