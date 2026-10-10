# 部署指南

## 目标

- 仓库:`DaDaDelddd309/xuanxuan-cultivation`(public)
- 地址:<https://dadadelddd309.github.io/xuanxuan-cultivation/>

## 方式 A:GitHub REST API(本项目用的方式)

沙箱环境里 `git` 直连 GitHub 会报 SSL 证书错误
(`server certificate verification failed`),所以走 REST API。

需要 Personal Access Token,权限 **只勾 `public_repo`** 就够。

### 脚本要点

```
1. POST /git/blobs       每个文件一个 blob
2. POST /git/trees       base_tree=main,一次提交全部
3. GET  /git/ref/heads/main   拿当前 commit sha
4. POST /git/commits     tree + parents
5. PATCH /git/refs/heads/main  更新分支指针
```

**注意**:token 绝对不要写进代码文件,只走环境变量。

### 部署后

GitHub Pages 需要重新构建,**等 30-60 秒**再去验证,
否则会看到旧版本误判失败。

```bash
# 验证标题
curl -s https://dadadelddd309.github.io/xuanxuan-cultivation/ | grep -o "<title>.*</title>"
# 验证 SW 版本
curl -s https://dadadelddd309.github.io/xuanxuan-cultivation/sw.js | grep -o "xuanxuan-v[0-9]*"
# 验证关键文件
curl -s -o /dev/null -w "%{http_code}" https://dadadelddd309.github.io/xuanxuan-cultivation/js/xiuxian/index.js
```

---

## 方式 B:本地 git(用户本地)

```bash
git clone https://github.com/DaDaDelddd309/xuanxuan-cultivation.git
cd xuanxuan-cultivation
# 把 rouge-offline/ 的内容覆盖到根目录
rsync -av --delete /path/to/rouge-offline/ ./
git add -A
git commit -m "V0.87 · <变更摘要>"
git push
```

---

## 每次发版必做

### 第 0 步：先跑测试（**不要跳过**）

```bash
bash tests/run-all.sh        # 逻辑测试 + lint，退出码非 0 就停
bash tests/run-browser.sh    # 浏览器测试，退出码非 0 就停
```

**必须两套都跑。** 原因是它们抓的 bug 类别不重叠：

| 套件 | 抓什么 | 抓不到什么 |
|---|---|---|
| `run-all.sh` | 逻辑错、数据错、导入/版本/CSS 不一致 | 「代码没错但没接上」「重复定义互相覆盖」 |
| `run-browser.sh` | 白屏、点了没反应、结局不结算、UI 不一致 | —— |

历史上「结局无限刷奖励」「修仙阁白屏」「去重误删方法导致点了毫无反应」
这几类事故，`run-all.sh` **全是绿的**。只跑逻辑测试就发版，等于没跑。

> **⚠️ 浏览器测试只能在带桌面环境的机器上跑。**
> Termux/Android 上装不了：无 chromium 二进制、Termux 仓库无 chromium 包、
> pip 也拿不到适配 Python 3.14 的 playwright 轮子。
> 所以发版前的浏览器测试**必须在本地桌面机执行**，手机上跑不了。
> `run-browser.sh` 已在缺 playwright 时直接退出 1 并打印安装命令，
> 不会假装跑过了。

### 第 1~3 步：改版本号

1. **`index.html` 改版本号**
   `<title>轩轩修仙传 V0.XX</title>` 和菜单副标题
2. **`manifest.webmanifest` 改 name / description**
3. **`sw.js` 改缓存版本** `const V = 'xuanxuan-v0XX'`

**第 3 步绝对不能忘。** 不改的话用户的 Service Worker 继续用旧缓存,
推送了也看不到。详见 `AGENTS.md` 第一条坑。

改完跑 `node tests/lint-version.mjs` 确认四处一致（含 `version.json` 探针），
再跑 `node tests/make-manifest.mjs --write` 重新生成版本清单。

---

## 版本号对应

| 版本 | 缓存标识 |
|---|---|
| V0.86 | `xuanxuan-v086` |
| V0.85 | `xuanxuan-v085` |
| V0.84 | `xuanxuan-v084` |
| V0.83 | `xuanxuan-v083` |
| V0.82 | `xuanxuan-v082` |
