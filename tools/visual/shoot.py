#!/usr/bin/env python3
"""
轩轩修仙传 —— 无头渲染截图器

用途:把每个界面用真浏览器渲染一遍并出图。断言只能证明"文件在、模块通、数字对",
证明不了"owner 看到的是什么"。这个脚本管后者。

它能顺便抓住 (断言抓不到的部分):
  - 浏览器 console 的报错 / 未捕获异常 → 白屏的真正病因
  - 请求 404 的资源 → 图裂、样式表没加载
  - 每个页面的真实像素 → 空页、纯色页、布局塌了

用法:
  python3 tools/visual/shoot.py --out tools/visual/shots
  python3 tools/visual/shoot.py --out /tmp/s1 --label v099e
  python3 tools/visual/shoot.py --only menu,xx-realm   # 只截指定页
  python3 tools/visual/shoot.py --play                  # 先进一局再截(截 HUD/暂停/升级)

不写任何游戏文件,只读 + 截图。
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
DEFAULT_PORT = 8899

# 修仙阁 13 页签 —— 与 js/xiuxian/ui.js:46 的 TABS 一一对应
XX_TABS = [
    ("realm", "境界"), ("map", "大地图"), ("camp", "营地"), ("arts", "神通"),
    ("bag", "行囊"), ("market", "集市"), ("people", "人物"), ("title", "称号"),
    ("fam", "家族"), ("build", "领地"), ("dex", "图鉴"), ("quest", "支线"),
    ("sys", "存档"),
]

# 局外各屏 —— (截图名, 入口按钮, 返回按钮)
# 顺序有依赖:每个屏截完必须点"返回"才能进下一个。少了这一步,
# 后面所有屏都会被上一个盖住 —— 第一版就是这么只截出 3 张图的。
OUTER_FLOW = [
    ("menu", None, None),                                  # 开屏仪式结束后已在主菜单
    ("codex", "#btn-codex", "#btn-codex-back"),
    ("bestiary", "#btn-bestiary", "#btn-bestiary-back"),
    ("select", "#btn-play", "#btn-select-back"),
]

VIEWPORT = {"width": 430, "height": 932}   # 主流手机逻辑分辨率


# ---------- 本地服务 ----------

def ensure_server(port: int, base: str | None):
    """返回 base url。没起服务就现起一个。"""
    if base:
        return base.rstrip("/")
    import urllib.request
    url = f"http://127.0.0.1:{port}/index.html"
    try:
        urllib.request.urlopen(url, timeout=2)
        print(f"[shoot] 复用已有服务 {base or url}")
        return f"http://127.0.0.1:{port}"
    except Exception:
        print(f"[shoot] 起本地服务 :{port} (cwd={REPO})")
        subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
            cwd=str(REPO), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(40):
            time.sleep(0.25)
            try:
                urllib.request.urlopen(url, timeout=2)
                return f"http://127.0.0.1:{port}"
            except Exception:
                continue
        raise SystemExit("[shoot] 本地服务起不来")


# ---------- 页面操作 ----------

def pass_onboarding(page, name: str = "小轩"):
    """走完取名仪式。返回是否真的走了流程。"""
    try:
        inp = page.wait_for_selector("#rt-name", timeout=8000)
        inp.fill(name)
        page.click("#rt-go")
        page.wait_for_timeout(400)
        page.click("#rt-ok")
        page.wait_for_timeout(700)
        return True
    except Exception:
        return False   # 已经起过名/或没有仪式层,不算失败


def shot(page, outdir: Path, name: str, manifest: dict, settle: int = 320):
    """截一张图并登记。同时记下当时的可见文本长度,便于判断空页。"""
    page.wait_for_timeout(settle)
    path = outdir / f"{name}.png"
    page.screenshot(path=str(path))
    try:
        txt = page.evaluate("() => document.body.innerText.trim().length")
    except Exception:
        txt = -1
    manifest["shots"].append({"name": name, "file": path.name, "textLen": txt})
    print(f"  ✓ {name:<22} text={txt}")
    return path


def click_safe(page, selector: str, timeout: int = 4000) -> bool:
    """点一个选择器,点不到返回 False 而不是抛异常炸掉整轮。"""
    try:
        page.wait_for_selector(selector, timeout=timeout, state="visible")
        page.click(selector)
        page.wait_for_timeout(260)
        return True
    except Exception:
        return False


def run(base: str, outdir: Path, only: list[str] | None, do_play: bool,
        label: str) -> int:
    outdir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "label": label, "base": base, "viewport": VIEWPORT,
        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "shots": [], "console": [], "pageerrors": [], "failedReq": [],
    }
    want = set(only) if only else None

    def need(n: str) -> bool:
        return want is None or n in want

    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage",
                  "--force-color-profile=srgb", "--hide-scrollbars"])
        ctx = browser.new_context(
            viewport=VIEWPORT, device_scale_factor=2, is_mobile=True,
            has_touch=True, locale="zh-CN", timezone_id="Asia/Shanghai")
        page = ctx.new_page()

        page.on("console", lambda m: manifest["console"].append(
            {"type": m.type, "text": m.text[:400]}) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: manifest["pageerrors"].append(str(e)[:400]))
        page.on("requestfailed", lambda r: manifest["failedReq"].append(
            {"url": r.url.split("/")[-1], "why": (r.failure or "")[:120]}))
        page.on("response", lambda r: manifest["failedReq"].append(
            {"url": r.url.split("/")[-1], "why": f"HTTP {r.status}"}) if r.status >= 400 else None)

        print(f"[shoot] {base}/index.html  ->  {outdir}")
        page.goto(f"{base}/index.html", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1200)

        # 取名仪式 (顺带留一张,这是新玩家第一眼)
        if need("onboarding"):
            if page.query_selector("#rt-name"):
                shot(page, outdir, "00-onboarding", manifest)
                pass_onboarding(page)
            else:
                pass_onboarding(page)

        page.wait_for_timeout(900)

        # ---- 局外各屏 (逐屏进出) ----
        for key, enter, leave in OUTER_FLOW:
            if not need(key):
                continue
            if enter and not click_safe(page, enter):
                print(f"  ✗ {key:<22} 入口 {enter} 点不到,跳过")
                continue
            shot(page, outdir, f"10-{key}", manifest, settle=900)
            if leave:
                if not click_safe(page, leave):
                    print(f"  ! {key:<22} 返回键 {leave} 失效,强制回主菜单")
                    page.evaluate("""() => {
                        document.querySelectorAll('.screen').forEach(e => e.classList.add('hidden'));
                        const m = document.getElementById('screen-menu');
                        if (m) m.classList.remove('hidden');
                    }""")
                page.wait_for_timeout(500)

        # ---- 修仙阁 13 页签 ----
        if any(need(f"xx-{k}") for k, _ in XX_TABS) or want is None:
            if click_safe(page, "#btn-cult", timeout=6000):
                page.wait_for_timeout(1100)   # 等插画预取
                for k, label_ in XX_TABS:
                    if not need(f"xx-{k}"):
                        continue
                    ok = click_safe(page, f'.xx-tab[data-tab="{k}"]')
                    if not ok:
                        print(f"  ✗ xx-{k:<16} 页签点不到")
                        continue
                    shot(page, outdir, f"20-xx-{k}", manifest, settle=560)
                # 关掉修仙阁
                page.evaluate("""() => {
                    const b = document.querySelector('.xx-screen:not(.hidden) [data-act="back"]');
                    if (b) b.click();
                }""")
                page.wait_for_timeout(500)

        # ---- 局内 ----
        if do_play:
            print("[shoot] 进一局,截 HUD")
            page.evaluate("""() => {
                document.querySelectorAll('.xx-screen,.rt-screen').forEach(e => e.classList.add('hidden'));
            }""")
            page.wait_for_timeout(300)
            if click_safe(page, "#btn-play", timeout=5000):
                page.wait_for_timeout(1200)
                click_safe(page, "#char-list .card, #char-list button, #char-list > *", 3000)
                page.wait_for_timeout(3500)
                shot(page, outdir, "30-ingame", manifest, settle=1200)
                if click_safe(page, "#btn-pause", 3000):
                    shot(page, outdir, "31-pause", manifest, settle=700)

        browser.close()

    # ---- 汇总 ----
    manifest["summary"] = {
        "shots": len(manifest["shots"]),
        "emptyShots": [s["name"] for s in manifest["shots"] if 0 <= s["textLen"] < 5],
        "pageerrors": len(manifest["pageerrors"]),
        "consoleErrors": len([c for c in manifest["console"] if c["type"] == "error"]),
        "failedReq": len(manifest["failedReq"]),
    }
    (outdir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    s = manifest["summary"]
    print(f"\n[shoot] {s['shots']} 张图")
    print(f"  页面异常 {s['pageerrors']} / console error {s['consoleErrors']} / 失败请求 {s['failedReq']}")
    if s["emptyShots"]:
        print(f"  ⚠ 近乎空白页: {', '.join(s['emptyShots'])}")
    for e in manifest["pageerrors"][:10]:
        print(f"  ✗ {e}")
    for f in manifest["failedReq"][:10]:
        print(f"  ✗ {f['url']} {f['why']}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="轩轩修仙传 无头截图器")
    ap.add_argument("--out", default="tools/visual/shots")
    ap.add_argument("--base", default=None, help="已有服务地址,不给就自己起")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--label", default="local")
    ap.add_argument("--only", default=None, help="逗号分隔:menu,xx-realm,xx-bag ...")
    ap.add_argument("--play", action="store_true", help="进一局截 HUD/暂停")
    a = ap.parse_args()
    only = [x.strip() for x in a.only.split(",")] if a.only else None
    base = ensure_server(a.port, a.base)
    outdir = Path(a.out)
    if not outdir.is_absolute():
        outdir = REPO / outdir
    sys.exit(run(base, outdir, only, a.play, a.label))


if __name__ == "__main__":
    main()