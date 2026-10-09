#!/usr/bin/env python3
"""
轩轩修仙传 —— 自动视觉体检(像素级)

断言能证明"文件在、模块通、数字对",证明不了"owner 看到的是什么"。
这个脚本在真浏览器里把每个界面跑一遍,截图 + 判定:

  tofu      豆腐块 —— 字体缺字。只测真正的文本叶子,且校验 canvas 字体确实生效
  clip      文字被容器裁掉 (scrollWidth > clientWidth 且 overflow hidden)
  spill     元素跑出视口。横向滚动容器内的元素不算(滚走是设计,不是 bug)
  tiny      触控目标 < 44px
  contrast  对比度 —— 走真实截图像素统计,不靠解析式猜背景色
            (渐变/图片背景会让解析式算出 ratio=1 的假阳性)

v2 的教训:第一版报「灵」「篝」「火」是豆腐块 5501 个,全是假阳性。
根因是 canvas 的 ctx.font 赋值失败(字体名含未加引号的多词族名),
量出来的宽度全是垃圾。对比度第一版对渐变按钮算出 1.0 也是同类错误。
检测器自己有 bug 时,报出来的问题全是噪声 —— 先证明检测器对,再信它的结论。

用法:
  python3 tools/visual/audit.py
  python3 tools/visual/audit.py --json /tmp/audit.json --strict
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shoot import XX_TABS, VIEWPORT, ensure_server, click_safe, pass_onboarding  # noqa: E402

# ---------- 页内检测:只负责"哪些元素可疑 + 在哪",像素活交给 Python ----------

JS_AUDIT = r"""
() => {
  const out = {tofu: [], clip: [], spill: [], tiny: [], text: []};

  // 可见性必须穿透祖先。本项目的 .hidden 是 opacity/visibility,不是 display:none,
  // 只看元素自身会把"藏在修仙阁遮罩后面的主菜单"当成可见 —— 第二版就在这栽了:
  // 量出一屏 `砍杀 1.92` 的假低对比,截图里那按钮清楚得很。
  const vis = el => {
    if (el.checkVisibility) {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true,
                                 contentVisibilityAuto: true });
    }
    let n = el;
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' ||
          parseFloat(s.opacity) === 0) return false;
      n = n.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const sig = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string')
      s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };
  const txt = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  // 横向滚动容器内的元素滚出视口是设计,不是 bug
  const inScroller = el => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      n = n.parentElement;
    }
    return false;
  };

  // ---- 豆腐块 ----
  // 判据是【像素位图相同】,不是【宽度相同】。宽度相同只是碰巧 —— 第一版就是
  // 栽在这:字体没吃进去,所有字宽度一致,于是全站误报。
  // 先验字体真的生效:同字体下 '正' 和 '鑫' 必须画出不同位图,否则这套测法作废。
  const SZ = 24;
  const scratch = document.createElement('canvas');
  const sc = scratch.getContext('2d', { willReadFrequently: true });
  const bmpCache = new Map();
  const fontOK = new Map();

  function bitmap(fontStr, ch) {
    const key = fontStr + '\u0000' + ch;
    if (bmpCache.has(key)) return bmpCache.get(key);
    scratch.width = SZ; scratch.height = SZ;
    sc.clearRect(0, 0, SZ, SZ);
    sc.font = fontStr;
    sc.textBaseline = 'middle';
    sc.fillStyle = '#000';
    sc.fillText(ch, SZ / 2, SZ / 2);
    const d = sc.getImageData(0, 0, SZ, SZ).data;
    let h = 2166136261 >>> 0, ink = 0;
    for (let i = 3; i < d.length; i += 4) { h = (h ^ d[i]) >>> 0; h = Math.imul(h, 16777619) >>> 0; if (d[i] > 8) ink++; }
    const v = h + ':' + ink;          // 位图 + 墨量,避免空画布撞哈希
    bmpCache.set(key, v);
    return v;
  }
  const fontUsable = fontStr => {
    if (fontOK.has(fontStr)) return fontOK.get(fontStr);
    const ok = bitmap(fontStr, '正') !== bitmap(fontStr, '鑫');
    fontOK.set(fontStr, ok);
    return ok;
  };
  const tofuBit = {};                  // 每种字体各缓存一个"标准豆腐"位图

  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length !== 0) continue;      // 关键:必须是真文本叶子
    if (!vis(el)) continue;
    const t = (el.textContent || '').trim();
    if (!t) continue;
    const cs = getComputedStyle(el);
    const want = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (!fontUsable(want)) continue;             // 字体没生效 -> 这元素测不了,不瞎报
    const ref = tofuBit[want] || (tofuBit[want] = bitmap(want, '\uFFFF'));
    for (const ch of t) {
      const cp = ch.codePointAt(0);
      if (cp < 0x2E80) continue;                  // ASCII / 标点 跳过
      if (cp >= 0x1F000 && cp <= 0x1FAFF) continue;   // emoji 交给 emoji 字体
      if (bitmap(want, ch) === ref && !seen.has(ch)) {
        seen.add(ch);
        out.tofu.push({el: sig(el), ch, code: 'U+' + cp.toString(16).toUpperCase(), text: txt(el)});
      }
    }
  }

  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const st = txt(el);

    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 &&
        (cs.overflow === 'hidden' || cs.overflowX === 'hidden')) {
      out.clip.push({el: sig(el), need: el.scrollWidth, have: el.clientWidth, text: st});
    }
    if (!inScroller(el) && (r.right > window.innerWidth + 1 || r.left < -1)) {
      out.spill.push({el: sig(el), left: Math.round(r.left), right: Math.round(r.right),
                      vw: window.innerWidth, text: st});
    }
    if ((el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') &&
        r.width > 0 && (r.width < 44 || r.height < 44)) {
      out.tiny.push({el: sig(el), w: Math.round(r.width), h: Math.round(r.height), text: st});
    }
    // 待做像素比对的文本元素。textRect 用 Range 量【文字本身】的包围盒,
    // 不是元素盒子 —— 元素盒子含边框和内边距,那些像素会把统计带偏。
    if (el.children.length === 0 && st && r.width >= 6 && r.height >= 6 &&
        r.width < window.innerWidth * 0.98) {
      // 遮挡检测:修仙阁盖在主菜单上时,菜单里的按钮"可见但被盖住"。
      // checkVisibility 对这种无效 —— 元素确实没被 display:none。
      let occluded = false;
      try {
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        if (top && top !== el && !top.contains(el) && !el.contains(top)) occluded = true;
      } catch (e) { /* 检不了就当没遮住 */ }
      if (occluded) continue;

      const fs = parseFloat(cs.fontSize);
      let tr = {left: r.left, top: r.top, width: r.width, height: r.height};
      try {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        const q = rg.getBoundingClientRect();
        if (q.width >= 4 && q.height >= 4) tr = {left: q.left, top: q.top, width: q.width, height: q.height};
      } catch (e) { /* 回落到元素盒子 */ }
      out.text.push({
        el: sig(el), text: st,
        x: tr.left, y: tr.top, w: tr.width, h: tr.height,
        size: fs, weight: parseInt(cs.fontWeight) || 400,
      });
    }
  }
  out.text = out.text.slice(0, 400);
  return out;
}
"""

# ---------- 像素级对比度 ----------

def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _relL(rgb):
    r, g, b = rgb
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def _otsu(hist, total):
    """Otsu 最大类间方差阈值。把像素分成前景/背景两类,
    不预设谁亮谁暗 —— 这是前两版失败的地方(分位数法把背景当成了前景)。"""
    best, bt = -1.0, 127
    sum_all = sum(i * hist[i] for i in range(256))
    wB = 0; sumB = 0
    for t in range(256):
        wB += hist[t]
        if wB == 0:
            continue
        wF = total - wB
        if wF == 0:
            break
        sumB += t * hist[t]
        mB = sumB / wB
        mF = (sum_all - sumB) / wF
        v = wB * wF * (mB - mF) ** 2
        if v > best:
            best, bt = v, t
    return bt


def pixel_contrast(img: Image.Image, box, dpr: float):
    """对比度:取【文字周围一圈】当背景,只把明显偏离这个背景的像素当文字。

    为什么不用全局阈值 / Otsu:
      全局分位数 —— 细黑字占不到 2% 像素,取回抗锯齿灰(正常黑字白底算成 2.96)
      Otsu      —— 对渐变按钮分出来的是渐变深浅两端,不是文字与背景
    环形采样 + 偏离阈值两个一起避开:背景取文字外一圈的局部值(渐变只造成缓慢变化,
    文字是突然跳变),前景取偏离该局部背景 60 级以上的像素(墨色对比度至少约 7:1,
    渐变一整块也跳不到 60 级)。

    返回 (ratio, kind)
    """
    x, y, w, h = [int(round(v * dpr)) for v in box]
    x, y = max(0, x), max(0, y)
    w, h = min(w, img.width - x), min(h, img.height - y)
    if w < 4 or h < 4:
        return None, "tiny-box"

    core = img.crop((x, y, x + w, y + h)).convert("L")
    cp = list(core.getdata())
    if len(cp) < 16:
        return None, "tiny-box"

    # --- 背景:文字盒子向外扩一圈,取这一圈的中位数 ---
    m = max(3, int(min(w, h) * 0.35))
    ax, ay = max(0, x - m), max(0, y - m)
    bx, by = min(img.width, x + w + m), min(img.height, y + h + m)
    ring = []
    if bx - ax >= w + 2 and by - ay >= h + 2:
        outer = img.crop((ax, ay, bx, by)).convert("L")
        ox0, oy0 = x - ax, y - ay
        for j in range(outer.height):
            for i in range(outer.width):
                if (ox0 <= i < ox0 + w) and (oy0 <= j < oy0 + h):
                    continue
                ring.append(outer.getpixel((i, j)))
    if len(ring) < 12:
        return None, "no-ring"
    ring.sort()
    bg = ring[len(ring) // 2]

    # --- 前景:核心区里偏离背景 60 级以上的像素 ---
    ink = [v for v in cp if abs(v - bg) >= 60]
    if len(ink) < max(8, len(cp) * 0.005):
        # 没有可辨认的墨色。两种情况要分开,否则要么漏报"文字糊成一片",
        # 要么把"这里压根没文字"也报成对比度问题:
        #   核心区几乎均匀 -> 裁到空白,跳过
        #   有起伏但跳不到 60 级 -> 文字在,但和背景糊在一起,这正是要报的
        # 没有达到 60 级的墨色。区分"压根没文字"和"文字糊在背景里":
        #   最大偏离 < 2 级  -> 裁到空白,跳过
        #   有任何可辨起伏   -> 文字在,只是对比度太低,这正是要报的
        # (不能用 stddev 判:低对比字的起伏可能只有几级,均值方差趋近 0)
        dev = [abs(v - bg) for v in cp]
        if max(dev) < 2:
            return None, "uniform"
        ink.sort()
        ordered = sorted(cp, key=lambda v: abs(v - bg))
        half = ordered[len(ordered) // 2:]
        fg = half[len(half) // 2]
        a_, b_ = _relL((fg,) * 3), _relL((bg,) * 3)
        return (max(a_, b_) + 0.05) / (min(a_, b_) + 0.05), "ring"
    ink.sort()
    # 取墨色像素的中位数,抗两端离群值
    fg = ink[len(ink) // 2]
    if abs(fg - bg) < 60:
        return None, "flat"

    a_, b_ = _relL((fg,) * 3), _relL((bg,) * 3)
    ratio = (max(a_, b_) + 0.05) / (min(a_, b_) + 0.05)
    return ratio, "ring"


# ---------- 主流程 ----------

def audit_page(page, name, dsf=2):
    d = page.evaluate(JS_AUDIT)
    shot = page.screenshot()
    import io
    img = Image.open(io.BytesIO(shot)).convert("RGB")
    lows = []
    for t in d["text"]:
        fs = t["size"]
        need = 3.0 if (fs >= 24 or (fs >= 18.66 and t["weight"] >= 700)) else 4.5
        ratio, kind = pixel_contrast(img, (t["x"], t["y"], t["w"], t["h"]), dsf)
        if kind != "ring" or ratio is None:
            continue
        if ratio < need:
            lows.append({"el": t["el"], "text": t["text"], "ratio": round(ratio, 2),
                         "need": need, "size": fs})
    d["contrast"] = lows
    d["screen"] = name
    return d


def report(rows, out_json, strict):
    keys = ["tofu", "clip", "spill", "tiny", "contrast"]
    total = {k: 0 for k in keys}
    print("\n" + "=" * 70)
    print("自动视觉体检(像素级)")
    print("=" * 70)
    for d in rows:
        n = {k: len(d.get(k, [])) for k in keys}
        for k in keys:
            total[k] += n[k]
        flag = sum(n.values())
        print(f"{'OK ' if flag == 0 else '!! '}{d['screen']:<16} "
              + "  ".join(f"{k}={n[k]}" for k in keys))
        for t in d.get("tofu", [])[:5]:
            print(f"      豆腐    '{t['ch']}' {t['code']} @{t['el']} 「{t['text']}」")
        for c in d.get("clip", [])[:5]:
            print(f"      裁切    {c['need']}>{c['have']} @{c['el']} 「{c['text']}」")
        for s in d.get("spill", [])[:5]:
            print(f"      溢出    {s['left']}..{s['right']} (vw={s['vw']}) @{s['el']}")
        for t in d.get("tiny", [])[:5]:
            print(f"      触控小  {t['w']}x{t['h']} @{t['el']} 「{t['text']}」")
        for c in d.get("contrast", [])[:5]:
            print(f"      对比度  {c['ratio']}<{c['need']} @{c['el']} 「{c['text']}」")
    print("-" * 70)
    print("合计  " + "  ".join(f"{k}={v}" for k, v in total.items()))
    clean = all(v == 0 for v in total.values())
    print("全部通过。" if clean else "有问题,见上。")
    if out_json:
        out_json.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"明细 -> {out_json}")
    return 0 if clean else (1 if strict else 0)


def main():
    ap = argparse.ArgumentParser(description="自动视觉体检(像素级)")
    ap.add_argument("--base", default=None)
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--json", default=None)
    ap.add_argument("--strict", action="store_true")
    a = ap.parse_args()
    base = ensure_server(a.port, a.base)
    rows = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage",
                                    "--force-color-profile=srgb", "--hide-scrollbars"])
        ctx = b.new_context(viewport=VIEWPORT, device_scale_factor=2, is_mobile=True,
                            has_touch=True, locale="zh-CN")
        page = ctx.new_page()
        page.goto(f"{base}/index.html", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1200)
        pass_onboarding(page)
        page.wait_for_timeout(800)
        rows.append(audit_page(page, "主菜单"))
        for key, enter, leave in [("组合图鉴", "#btn-codex", "#btn-codex-back"),
                                  ("怪物图鉴", "#btn-bestiary", "#btn-bestiary-back"),
                                  ("选择角色", "#btn-play", "#btn-select-back")]:
            if click_safe(page, enter):
                page.wait_for_timeout(900)
                rows.append(audit_page(page, key))
                click_safe(page, leave); page.wait_for_timeout(500)
        if click_safe(page, "#btn-cult", timeout=6000):
            page.wait_for_timeout(1100)
            for k, label in XX_TABS:
                if click_safe(page, f'.xx-tab[data-tab="{k}"]'):
                    rows.append(audit_page(page, f"修仙阁·{label}"))
        b.close()
    sys.exit(report(rows, Path(a.json) if a.json else None, a.strict))


if __name__ == "__main__":
    main()