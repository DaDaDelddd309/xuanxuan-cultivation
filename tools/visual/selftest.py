#!/usr/bin/env python3
"""
检测器自检 —— 往页面里注入"已知缺陷",看体检器抓不抓得到。

为什么要这个:第一版体检器报「灵」「篝」「火」是豆腐块 5501 个,全是假阳性。
如果没有自检,我就会拿着一个坏尺子去量游戏,然后去"修"根本没问题的地方。
尺子本身要先验。

用法: python3 tools/visual/selftest.py
退出码 0 = 全部抓到;1 = 有漏报(尺子坏了)
"""
import sys
import io
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit import JS_AUDIT, pixel_contrast  # noqa: E402

# 注入的缺陷页。每项都必须是"确实存在的毛病",不许放正常的当基准。
HTML = """<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><style>
body{background:#fff;font-family:'Noto Sans CJK SC',sans-serif;font-size:16px}
.box{border:1px solid #999;margin:8px;padding:4px}
#clipped{width:90px;height:22px;overflow:hidden;white-space:nowrap}
#lowcontrast{color:#e8e8e0;background:#efeee6}
#tinybtn{display:inline-block;width:30px;height:30px;background:#333;color:#fff;border:0}
#tofu{font-family:'Noto Sans CJK SC',sans-serif;font-size:40px}
#oktext{color:#222;background:#fff}
</style></head><body>
<div class="box" id="clipped">这是一段很长很长很长很长很长很长很长很长很长很长很长的文字会被裁掉</div>
<div class="box" id="lowcontrast">低对比度文字低对比度文字</div>
<button id="tinybtn">x</button>
<div class="box" id="tofu">\U00020000\U00020001</div>
<div class="box" id="oktext">正常对比度文字</div>
<div class="box" id="okclip" style="width:400px">这段不该被裁</div>
<button id="okbtn" style="width:80px;height:50px;background:#c00;color:#fff;border:0">正常按钮</button>
</body></html>"""

EXPECT = {
    "tofu": ("U+20000", "U+20001"),
    "clip": ["clipped"],
    "tiny": ["tinybtn"],
    "spill": [],
}


def main():
    p = Path(__file__).resolve().parent / "_selftest.html"
    p.write_text(HTML, encoding="utf-8")
    ok = True
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = b.new_context(viewport={"width": 430, "height": 932},
                             device_scale_factor=2).new_page()
        page.goto(p.as_uri())
        page.wait_for_timeout(300)
        d = page.evaluate(JS_AUDIT)
        img = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
        b.close()

    print("=" * 66)
    print("检测器自检")
    print("=" * 66)

    # 1) 豆腐块:注入的两个生僻字必须被抓到
    got = [t["code"] for t in d["tofu"]]
    for code in EXPECT["tofu"]:
        hit = any(code in g for g in got)
        print(f"  {'✓' if hit else '✗'} 豆腐块 {code} {'抓到' if hit else '漏报 —— ' + str(got[:8])}")
        ok &= hit
    # 正常文字不该被误报
    bad_fp = [t for t in d["tofu"] if t["el"].startswith("div#ok")]
    print(f"  {'✓' if not bad_fp else '✗'} 正常文字无误报 {bad_fp[:3]}")
    ok &= not bad_fp

    # 2) 裁切
    clips = [c["el"] for c in d["clip"]]
    hit = any("clipped" in c for c in clips)
    print(f"  {'✓' if hit else '✗'} 裁切 #clipped {'抓到' if hit else '漏报 ' + str(clips)}")
    ok &= hit
    fp = [c for c in clips if "okclip" in c]
    print(f"  {'✓' if not fp else '✗'} 未裁切元素无误报 {fp}")
    ok &= not fp

    # 3) 触控过小
    tinys = [t["el"] for t in d["tiny"]]
    hit = any("tinybtn" in t for t in tinys)
    print(f"  {'✓' if hit else '✗'} 触控过小 #tinybtn {'抓到' if hit else '漏报 ' + str(tinys)}")
    ok &= hit
    fp = [t for t in tinys if "okbtn" in t]
    print(f"  {'✓' if not fp else '✗'} 正常按钮无误报 {fp}")
    ok &= not fp

    # 4) 像素对比度:低对比那格必须低于阈值,正常那格必须高于
    for t in d["text"]:
        if "lowcontrast" in t["el"] or "oktext" in t["el"]:
            fs = t["size"]
            need = 3.0 if (fs >= 24 or (fs >= 18.66 and t["weight"] >= 700)) else 4.5
            r, kind = pixel_contrast(img, (t["x"], t["y"], t["w"], t["h"]), 2)
            label = t["el"]
            if "lowcontrast" in label:
                good = r is not None and r < need
                print(f"  {'✓' if good else '✗'} 低对比 {label} ratio={r} need={need}")
                ok &= good
            else:
                good = r is not None and r >= need
                print(f"  {'✓' if good else '✗'} 正常对比 {label} ratio={r} need={need}")
                ok &= good

    print("-" * 66)
    print("尺子合格。" if ok else "尺子坏了 —— 结论不可信,先修尺子。")
    try:
        p.unlink()
    except OSError:
        pass
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())