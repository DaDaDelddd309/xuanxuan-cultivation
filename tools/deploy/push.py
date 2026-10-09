#!/usr/bin/env python3
"""
按文件树差异推送 —— 因为这台机器 git 协议被墙。

`git push` / `git ls-remote` 都会超时(exit 124),github.com 的 git 协议无响应。
但 `api.github.com` 通,所以走 Git Data API:

  1. GET 远端 main 的 SHA
  2. GET 它的文件树(recursive)
  3. 和本地 `git ls-tree -r HEAD` 逐个比对 blob SHA
  4. 只给**有差异**的文件建 blob
  5. 以远端树为 base 建新树 → 新 commit → PATCH refs/heads/main

关键性质:
  · **按文件树差异,不按历史**。本地历史可能和远端完全分叉,那也不影响。
  · 新树以远端树为 base,**远端有、本地没有的文件不会被删**
    (没列出的路径自动继承)。
  · 调用次数 = 差异文件数 + 3。注意 GitHub 配额是 60/小时(按 IP)。

用法:
  python3 tools/deploy/push.py --dry-run     # 只看差异,不推
  python3 tools/deploy/push.py -m "提交说明"
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

TOKEN = open(os.path.expanduser("~/.gt") if os.path.exists(os.path.expanduser("~/.gt")) else "/tmp/.gt").read().strip()
API = "https://api.github.com/repos/{repo}"
REPO = "DaDaDelddd309/xuanxuan-cultivation"


def api(path, data=None, method=None, repo=REPO):
    req = urllib.request.Request(API.format(repo=repo) + path,
                                 method=method or ("POST" if data else "GET"))
    req.add_header("Authorization", "token " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "push-script")
    req.add_header("Content-Type", "application/json")
    if data is not None:
        req.data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:400])
        raise


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--message", default=None)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    ref = api("/git/ref/heads/main")
    parent = ref["object"]["sha"]
    tree = api(f"/git/commits/{parent}")["tree"]["sha"]
    rmap = {t["path"]: t["sha"] for t in api(f"/git/trees/{tree}?recursive=1")["tree"]
            if t["type"] == "blob"}

    lmap = {}
    for line in sh("git", "ls-tree", "-r", "HEAD").splitlines():
        meta, path = line.split("\t", 1)
        lmap[path] = meta.split()[2]

    added = sorted(set(lmap) - set(rmap))
    removed = sorted(set(rmap) - set(lmap))
    changed = sorted(p for p in set(lmap) & set(rmap) if lmap[p] != rmap[p])

    print(f"远端 main {parent[:8]} · 远端 {len(rmap)} 文件 / 本地 {len(lmap)} 文件")
    print(f"  新增 {len(added)}  改 {len(changed)}  远端有本地无 {len(removed)}"
          + ("(会保留,不删)" if removed else ""))
    for p in removed[:8]:
        print("   -", p)
    for p in added[:12]:
        print("   +", p)
    for p in changed[:12]:
        print("   ~", p)

    todo = added + changed
    need = len(todo) + 3
    left = api("/rate_limit") if False else None
    print(f"\n要建 {len(todo)} 个 blob,预计消耗 {need} 次 API 调用(配额 60/小时)")
    if a.dry_run:
        print("[dry-run] 未推送")
        return 0
    if not todo:
        print("无差异,跳过")
        return 0

    blobs = {}
    for i, p in enumerate(todo, 1):
        raw = open(p, "rb").read()
        try:
            payload, enc = raw.decode("utf-8"), "utf-8"
        except UnicodeDecodeError:
            payload, enc = base64.b64encode(raw).decode(), "base64"
        blobs[p] = api("/git/blobs", {"content": payload, "encoding": enc})["sha"]
        print(f"  {i:>2}/{len(todo)} {p}")

    newtree = api("/git/trees", {"base_tree": tree, "tree": [
        {"path": p, "mode": "100644", "type": "blob", "sha": s} for p, s in blobs.items()]})["sha"]
    msg = a.message or (sh("git", "log", "-1", "--pretty=%B", "HEAD").strip()
                        + "\n\n(经 Git Data API 按文件树差异推送:本机 git 协议被墙,"
                          "故为压平后的单提交,不保留中间历史)")
    c = api("/git/commits", {"message": msg, "tree": newtree, "parents": [parent]})["sha"]
    api("/git/refs/heads/main", {"sha": c, "force": False}, method="PATCH")
    print(f"\n✓ 已推送 {parent[:8]} → {c}")
    print("  提醒:Pages 重建不是即时的,约 1~2 分钟后再验线上。")
    return 0


if __name__ == "__main__":
    sys.exit(main())