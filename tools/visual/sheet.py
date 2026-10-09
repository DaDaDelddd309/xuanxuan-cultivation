#!/usr/bin/env python3
"""
轩轩修仙传 —— 截图拼版 / 差异比对

两种用法:
  sheet.py sheet  <图目录> -o 拼版.png              把一堆截图拼成一张联系表,一眼扫完
  sheet.py diff   <基线目录> <当前目录> -o 差.png     逐张比,不同的用红框标出来

拼版是真解决问题的工具:18 张图逐个打开看,人会看漏;
一张联系表 + 标名字,漏的立刻跳出来。

用法:
  python3 tools/visual/sheet.py sheet tools/visual/shots -o /tmp/board.png
  python3 tools/visual/sheet.py diff  tools/visual/baseline tools/visual/shots -o /tmp/diff.png
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageChops

# 中文字体候选(装了 fonts-noto-cjk 就有)
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
]


def load_font(size: int):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                pass
    return ImageFont.load_default()


def shots_in(d: Path):
    return sorted([p for p in d.glob("*.png") if not p.name.startswith("_")])


def do_sheet(src: Path, out: Path, cols: int = 6, tw: int = 230, pad: int = 14,
             label_h: int = 26, title: str = ""):
    files = shots_in(src)
    if not files:
        raise SystemExit(f"[sheet] {src} 里没有 png")

    font = load_font(15)
    title_font = load_font(22)
    tmp_h = int(tw * 932 / 430)          # 保持手机屏比例
    head = 46 if title else 0

    rows = (len(files) + cols - 1) // cols
    W = cols * tw + (cols + 1) * pad
    H = head + rows * (tmp_h + label_h) + (rows + 1) * pad
    board = Image.new("RGB", (W, H), (24, 24, 27))
    d = ImageDraw.Draw(board)

    if title:
        d.text((pad, 12), title, font=title_font, fill=(235, 232, 224))

    for i, f in enumerate(files):
        r, c = divmod(i, cols)
        x = pad + c * (tw + pad)
        y = head + pad + r * (tmp_h + label_h + pad)
        try:
            im = Image.open(f).convert("RGB")
        except Exception:
            continue
        im.thumbnail((tw, tmp_h), Image.LANCZOS)
        ox = x + (tw - im.width) // 2
        board.paste(im, (ox, y))
        d.rectangle([x, y, x + tw, y + tmp_h], outline=(90, 90, 96), width=1)
        # 短名:去掉 10- / 20- 前缀,省地方
        name = f.stem
        for pre in ("00-", "10-", "20-", "30-", "31-"):
            if name.startswith(pre):
                name = name[len(pre):]
                break
        d.text((x + 2, y + tmp_h + 5), name, font=font, fill=(214, 210, 200))

    out.parent.mkdir(parents=True, exist_ok=True)
    board.save(out)
    print(f"[sheet] {len(files)} 张 -> {out}  ({W}x{H})")


def do_diff(base: Path, cur: Path, out: Path, cols: int = 6, tw: int = 230,
            pad: int = 14, label_h: int = 26, thresh: int = 12):
    bf, cf = shots_in(base), shots_in(cur)
    if not cf:
        raise SystemExit(f"[sheet] {cur} 里没有 png")

    font = load_font(15)
    title_font = load_font(22)
    bmap = {p.stem: p for p in bf}
    tmp_h = int(tw * 932 / 430)
    head = 46

    # 先算出哪些变了 —— 拼版只放有差异的,免得整版全红等于没报警
    changed, added, same = [], [], []
    for p in cf:
        b = bmap.get(p.stem)
        if b is None:
            added.append(p); continue
        try:
            A = Image.open(b).convert("RGB").resize((tw, tmp_h), Image.LANCZOS)
            B = Image.open(p).convert("RGB").resize((tw, tmp_h), Image.LANCZOS)
            bbox = ImageChops.difference(A, B).convert("L").point(
                lambda v: 255 if v > thresh else 0).getbbox()
            (changed if bbox else same).append((p, bbox))
        except Exception:
            added.append(p)

    items = [p for p, _ in changed] + added
    if not items:
        print(f"[sheet] {len(same)} 张全部一致 —— 无回归")
        return

    rows = (len(items) + cols - 1) // cols
    W = cols * tw + (cols + 1) * pad
    H = head + rows * (tmp_h + label_h) + (rows + 1) * pad
    board = Image.new("RGB", (W, H), (24, 24, 27))
    d = ImageDraw.Draw(board)
    d.text((pad, 12), f"视觉回归差异 · 改 {len(changed)} / 新增 {len(added)} / 未变 {len(same)}",
           font=title_font, fill=(235, 232, 224))

    for i, p in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * (tw + pad)
        y = head + pad + r * (tmp_h + label_h + pad)
        try:
            im = Image.open(p).convert("RGB")
        except Exception:
            continue
        im.thumbnail((tw, tmp_h), Image.LANCZOS)
        ox = x + (tw - im.width) // 2
        board.paste(im, (ox, y))
        d.rectangle([x, y, x + tw, y + tmp_h], outline=(220, 60, 50), width=3)
        name = p.stem
        for pre in ("00-", "10-", "20-", "30-", "31-"):
            if name.startswith(pre):
                name = name[len(pre):]; break
        tag = "新" if p in added else "改"
        d.text((x + 2, y + tmp_h + 5), f"[{tag}] {name}", font=font, fill=(235, 150, 140))

    out.parent.mkdir(parents=True, exist_ok=True)
    board.save(out)
    print(f"[sheet] 差异 {len(changed)} 新增 {len(added)} -> {out}")
    for p, _ in changed:
        print(f"  改  {p.stem}")
    for p in added:
        print(f"  新  {p.stem}")


def main():
    ap = argparse.ArgumentParser(description="截图拼版 / 差异比对")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("sheet"); a.add_argument("src"); a.add_argument("-o", "--out", required=True)
    a.add_argument("--cols", type=int, default=6); a.add_argument("--title", default="")
    b = sub.add_parser("diff")
    b.add_argument("base"); b.add_argument("cur"); b.add_argument("-o", "--out", required=True)
    b.add_argument("--cols", type=int, default=6); b.add_argument("--thresh", type=int, default=12)
    args = ap.parse_args()
    if args.cmd == "sheet":
        do_sheet(Path(args.src), Path(args.out), args.cols, title=args.title)
    else:
        do_diff(Path(args.base), Path(args.cur), Path(args.out), args.cols, thresh=args.thresh)


if __name__ == "__main__":
    main()