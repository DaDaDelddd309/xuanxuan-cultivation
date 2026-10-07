# NOTES — 给后续开发 agent 的接手文档

> 这是给「接手这个项目的人 / agent」的备忘。  
> README 写给「人」,NOTES 写给「干活的人」—— 包括人以后怎么开发,以及本项目独有的坑。

---

## 1. 这是什么

- **项目**:`轩轩修仙传`(原版 `QinYin31/rouge` 的水墨武侠幸存者肉鸽 PWA 改版)
- **形态**:纯静态前端,**零依赖、零构建、零后端** —— 直接静态托管即可
- **技术栈**:原生 JS(35 个 module)+ Service Worker + Web App Manifest
- **仓库**:https://github.com/DaDaDelddd309/xuanxuan-cultivation(public)
- **原作者**:https://github.com/QinYin31/rouge(部署时务必保留出处)

---

## 2. 部署地址(实时,deploy 后必查)

```
主:  https://dadadelddd309.github.io/xuanxuan-cultivation/
备1: https://cdn.jsdelivr.net/gh/DaDaDelddd309/xuanxuan-cultivation@main/index.html
备2: https://gcore.jsdelivr.net/gh/DaDaDelddd309/xuanxuan-cultivation@main/index.html
备3: https://raw.githubusercontent.com/DaDaDelddd309/xuanxuan-cultivation/main/index.html
```

确认命令:

```bash
curl -sI https://dadadelddd309.github.io/xuanxuan-cultivation/ | head -1
# 期望:HTTP/2 200

curl -s https://dadadelddd309.github.io/xuanxuan-cultivation/sw.js | grep -o "xuanxuan-v[0-9]*"
# 期望:xuanxuan-v0XX(版本号必须 >= 你刚提交的 sw.js 里的常量)

gh api /repos/DaDaDelddd309/xuanxuan-cultivation/pages/builds/latest \
  --jq '{status, duration, error: .error.message}'
# 期望:status="built" error=null
```

---

## 3. 文件结构(改之前先看)

```
rouge-offline/
├── index.html              # 入口(顶部 BOM 别删)
├── sw.js                   # Service Worker — ⚠️ 缓存版本号在这里改
├── manifest.webmanifest    # PWA 元数据
├── .nojekyll               # 必须存在(否则 GitHub Pages 会过 Jekyll 吞掉下划线开头的文件)
├── css/style.css
├── js/
│   ├── main.js              # 应用入口
│   ├── sprites.js
│   ├── core/               # engine / camera / input / save / audio
│   ├── game/               # player / map / particles / enemies / weapons / spawner / boss / upgrades / pickups
│   ├── pix/                # 像素绘画(hero / boss / fx / items / projectiles)
│   ├── ui/                 # hud / codex / bestiary / screens / joystick
│   └── xiuxian/            # V0.80+ 新增的修仙体系(境界 / 神通 / 营地 / 商人 / 回合 / 大世界)
├── icons/                  # 180 / 192 / 512 / maskable-512
└── assets/                 # V0.80+ 新增(bg 背景 / bgm 音乐 / mob 怪物 / portrait 角色立绘)
```

---

## 4. 改动 → 部署 → 让老用户看到

PWA 改了 push 之后,**老用户浏览器可能还在用旧 Service Worker 缓存**,看不到新代码。必须按下面两步:

### 4.1 改 `sw.js` 第 2 行:递增缓存版本号

```js
const V = 'xuanxuan-v084';   // ← 改成 v085 / v086 / ...
```

> **铁律**:每次 `sw.js` 文件本身改了、或 `index.html` 改了、或新增了任何预缓存文件 → **必须升版本号**,否则老用户的浏览器只看到旧缓存。

### 4.2 推上去后等 Pages 重新 build

```bash
git add -A
git commit -m "v0.85 描述改了啥"
git push origin main

# 等 30 秒左右,GitHub Pages 自动 rebuild
gh api /repos/DaDaDelddd309/xuanxuan-cultivation/pages/builds/latest \
  --jq '{status, duration_ms: .duration}'
# 期望:status=built
```

### 4.3 用户侧第一次访问新 SW

- 浏览器自动检测 `sw.js` 内容变化 → install 新 SW → activate 删除旧缓存
- 一般 1~2 次访问后生效
- 想立刻生效:DevTools → Application → Service Workers → Update / Unregister

---

## 5. 本地测试(无构建,直接静态服务器)

任何能起静态文件 server 的都行:

```bash
cd rouge-offline
python3 -m http.server 8080
# 或:npx http-server -p 8080
# 打开 http://localhost:8080/
```

> Service Worker 在 `file://` 协议下不工作,必须走 http(s)。这是浏览器规范。

---

## 6. 已知坑

| 现象 | 原因 | 解法 |
|---|---|---|
| 改完代码 push 了,但用户访问还是旧版 | SW 缓存没刷 | 升 `sw.js` 第 2 行的 `V` 常量再走一次 |
| 用户在自己电脑 404,但 github.io / jsdelivr 都 200 | 客户端 DNS / 运营商缓存 | 试 jsdelivr 镜像;或换 DNS(1.1.1.1 / 223.5.5.5) |
| push 后 Pages build 失败 | 极少数情况 Jekyll 误处理 | 确认 `.nojekyll` 在仓库根(0 字节) |
| Service Worker 在本地 `file://` 不工作 | 浏览器规范 | 本地必须 http(s) |

---

## 7. 仓库 / GitHub 操作

```bash
# 查 Pages
gh api /repos/DaDaDelddd309/xuanxuan-cultivation/pages

# 查最新 build
gh api /repos/DaDaDelddd309/xuanxuan-cultivation/pages/builds/latest

# 触发 Pages 重新 build(通常 push 自动触发,这条作异常恢复用)
gh api -X POST /repos/DaDaDelddd309/xuanxuan-cultivation/pages/builds

# 列最近 commits
gh api /repos/DaDaDelddd309/xuanxuan-cultivation/commits --jq \
  '.[] | "\(.sha[0:7]) \(.commit.author.date) \(.commit.message)"' | head -10
```

> **API 坑记录**:首次启用 Pages 必须用 `POST /pages`,`PUT /pages` 在新仓库会返回 404。这是 GitHub API 的 quirk。

---

## 8. 不要做的事

- ❌ 不要加构建工具(webpack / vite / esbuild)—— 当前架构零构建是优势
- ❌ 不要把 `.nojekyll` 删掉
- ❌ 不要把 `index.html` 顶部的 BOM(`\ufeff`)去掉(Windows 工具常丢)
- ❌ 不要在 `sw.js` 里写死缓存版本号后又忘记升
- ❌ 不要把 `index.html` / 资源改成绝对路径(`/js/main.js`)—— 当前都是相对路径,部署到子目录才不出问题
- ❌ 不要提交任何 token / 私钥 / `.env` 进仓库

---

## 9. 兜底方案:Netlify Drop(30 秒,任何时候都能用)

如果 GitHub Pages 出问题、或需要给中国独立用户一个镜像:

1. 打开 https://app.netlify.com/drop
2. 把整个 `rouge-offline/` 文件夹拖进去(不是 zip)
3. 10 秒后拿到 `https://xxx-yyy-123.netlify.app` 形如的地址
4. 完事

无需账号、无需 git、不受 github.io DNS 影响。