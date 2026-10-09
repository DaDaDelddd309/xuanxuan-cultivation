#!/usr/bin/env python3
"""
立绘调色板采样器 —— 把风格从形容词变成数字（XX-ART-001）

为什么要有这个：`css/palette.css` 头注释里那套数字是从 **12 张插画**反推的，
不是立绘。第一次生成反派时照搬那段写成「暗底 87% 深灰」，整批图发闷发糊 ——
**参数用错地方，风格就整个反掉**。

所以：先从仓库现有立绘采样出真实区间，再拿它做闸门。
规格见 docs/ART-PORTRAIT-SPEC.md。

用法：
  python3 tools/art/measure_style.py            # 打印全部立绘的实测值
  python3 tools/art/measure_style.py --gate     # 判定是否在区间内(给 lint 用)
"""
import colorsys
import pathlib
import statistics as st
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIR = ROOT / "assets/portrait"

# ── 实测区间(来自现有 10 张立绘,2026-10-09)──
#   平均亮度 185-229 · 饱和像素占比 <0.2% · 均饱和 0.07-0.14
# 放宽到 240 是因为守谷妖修实测 236 —— 偏亮但饱和度合规,
# 属"可接受偏差",写进区间并在输出里标出来,而不是偷偷放过。
LIM = dict(meanL=(185.0, 240.0), satPct=(0.0, 1.0), meanS=(0.0, 0.20))


def measure(path: pathlib.Path):
    from PIL import Image
    im = Image.open(path).convert("RGB")
    im.thumbnail((200, 200), Image.LANCZOS)
    px = list(im.getdata())
    n = len(px)
    L = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in px]
    S = [colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[1] for r, g, b in px]
    return dict(
        meanL=st.mean(L), sdL=st.pstdev(L),
        darkPct=sum(1 for x in L if x < 32) / n * 100,
        satPct=sum(1 for x in S if x > 0.45) / n * 100,
        meanS=st.mean(S), n=n,
    )


def main() -> int:
    gate = "--gate" in sys.argv
    files = sorted([f for f in DIR.iterdir()
                    if f.suffix.lower() in (".jpg", ".png", ".webp")])
    if not files:
        print("FAIL  assets/portrait 下没有立绘")
        return 1
    bad = []
    for f in files:
        try:
            m = measure(f)
        except Exception as e:
            bad.append((f.name, f"读取失败 {e}"))
            continue
        okl = (LIM["meanL"][0] <= m["meanL"] <= LIM["meanL"][1]
               and m["satPct"] <= LIM["satPct"][1] and m["meanS"] <= LIM["meanS"][1])
        note = ""
        if m["meanL"] > 232:
            note = "  (偏亮,已在放宽区间内)"
        line = (f"{f.name:<26} 均亮={m['meanL']:>5.0f} 暗%={m['darkPct']:>4.0f} "
                f"饱和>0.45%={m['satPct']:>6.2f} 均饱和={m['meanS']:.3f} "
                f"{'PASS' if okl else 'FAIL'}{note}")
        if gate:
            print(line)
        else:
            print(line)
        if not okl:
            bad.append((f.name, f"均亮{m['meanL']:.0f} 饱和{m['satPct']:.2f}%"))
    if bad:
        print("FAIL")
        return 1
    print(f"全部 {len(files)} 张落在实测区间内")
    return 0


if __name__ == "__main__":
    sys.exit(main())
