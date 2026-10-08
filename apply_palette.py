"""批量替换色板外色值。

关键区分(V0.99 · 曾踩坑):
  CSS 里的色值 → 换成 var(--xx-xxx)          ✅ 生效
  JS  里的色值 → 换成 PAL.xxx 常量引用        ✅ 生效
  直接把 JS 里的 '#xxx' 换成 'var(--xx)'      ❌ canvas fillStyle 读不了 CSS 变量

所以两类要分别处理。
用法: python3 apply_palette.py [--write]
"""
import io, os, re, sys, glob

ROOT = os.getcwd().rstrip('/') + '/'
WRITE = '--write' in sys.argv

# 色值 → (CSS 令牌, JS 常量名)
MAP = {
    # 红 → 朱砂 / 暴击
    '#b03a2e': ('--xx-cinnabar', 'cinnabar'), '#8c2f27': ('--xx-cinnabar', 'cinnabar'),
    '#b5342a': ('--xx-cinnabar', 'cinnabar'), '#7a2018': ('--xx-cinnabar', 'cinnabar'),
    '#5c1a14': ('--xx-cinnabar', 'cinnabar'), '#a53529': ('--xx-cinnabar', 'cinnabar'),
    '#c85545': ('--xx-cinnabar', 'cinnabar'), '#d9662e': ('--xx-cinnabar', 'cinnabar'),
    '#e43b44': ('--xx-crit', 'crit'),         '#a8514a': ('--xx-crit', 'crit'),
    '#b55088': ('--xx-crit', 'crit'),         '#68386c': ('--xx-cinnabar', 'cinnabar'),
    '#b072d8': ('--xx-crit', 'crit'),         '#8a3ac8': ('--xx-crit', 'crit'),
    # 青绿 → 青玉 / 灵力 / 经验
    '#5fb8c4': ('--xx-jade', 'jade'),   '#4da7b4': ('--xx-jade', 'jade'),
    '#7fd4de': ('--xx-jade', 'jade'),   '#7ec8b0': ('--xx-jade', 'jade'),
    '#3d6b57': ('--xx-jade', 'jade'),   '#5a7a6a': ('--xx-jade', 'jade'),
    '#4a9de0': ('--xx-qi', 'qi'),       '#6aa8e0': ('--xx-qi', 'qi'),
    '#41899b': ('--xx-qi', 'qi'),
    '#63c74d': ('--xx-xp', 'xp'),       '#4f9673': ('--xx-xp', 'xp'),
    # 黄 → 金
    '#c9a227': ('--xx-gold', 'gold'),   '#c9972f': ('--xx-gold', 'gold'),
    '#fee761': ('--xx-gold', 'gold'),   '#ffd319': ('--xx-gold', 'gold'),
    '#feae34': ('--xx-gold', 'gold'),   '#e0a83c': ('--xx-gold-dim', 'goldDim'),
    '#e2b94e': ('--xx-gold-dim', 'goldDim'), '#e0904a': ('--xx-gold-dim', 'goldDim'),
    '#c96a3c': ('--xx-gold-dim', 'goldDim'),
    # 纸白 → 纸阶
    '#ffffff': ('--xx-paper', 'paper'), '#f2ecdd': ('--xx-paper', 'paper'),
    '#e8dcc4': ('--xx-paper', 'paper'), '#e8fbff': ('--xx-paper', 'paper'),
    '#f2e2c0': ('--xx-paper', 'paper'), '#fff6e8': ('--xx-paper', 'paper'),
    '#ece5d3': ('--xx-paper', 'paper'), '#e2dabf': ('--xx-paper', 'paper'),
    '#d3c7a6': ('--xx-paper-dim', 'paperDim'), '#d8c8a8': ('--xx-paper-dim', 'paperDim'),
    '#c8b494': ('--xx-paper-dim', 'paperDim'), '#e0d0b4': ('--xx-paper-dim', 'paperDim'),
    '#d8cfb4': ('--xx-paper-dim', 'paperDim'), '#f2ecdd2': ('--xx-paper', 'paper'),
    '#c0cbdc': ('--xx-paper-faint', 'paperFaint'),
    '#8a8a7a': ('--xx-paper-faint', 'paperFaint'), '#6b6b5d': ('--xx-paper-faint', 'paperFaint'),
    '#9aa08a': ('--xx-paper-faint', 'paperFaint'), '#8a9a5a': ('--xx-paper-faint', 'paperFaint'),
    '#8a8a8a': ('--xx-paper-faint', 'paperFaint'), '#7f8a70': ('--xx-paper-faint', 'paperFaint'),
    # 墨黑 → 墨阶
    '#2b2b2b': ('--xx-ink-2', 'ink2'), '#3a3a3a': ('--xx-ink-3', 'ink3'),
    '#3f4140': ('--xx-ink-3', 'ink3'), '#181818': ('--xx-ink', 'ink'),
    '#4a4a4a': ('--xx-ink-3', 'ink3'), '#6f6252': ('--xx-ink-4', 'ink4'),
}

# 跳过：像素画是"画出来的内容"，不是 UI 色
SKIP = ['js/pix/', 'js/sprites.js']

targets = []
for pat in ['css/*.css', 'js/**/*.js', 'js/*.js', '*.html']:
    targets += glob.glob(ROOT + pat, recursive=True)
targets = [t for t in targets if 'node_modules' not in t and '.git' not in t]

css_changed, js_changed = [], []
js_need_import = []

for f in sorted(set(targets)):
    rel = os.path.relpath(f, ROOT)
    if any(s in rel for s in SKIP):
        continue
    try:
        src = io.open(f, encoding='utf-8').read()
    except Exception:
        continue
    orig = src
    is_css = rel.endswith('.css')
    n = 0
    for hexv, (tok, jsname) in MAP.items():
        pat_r = re.compile(re.escape(hexv) + r'(?![0-9a-fA-F])')
        if is_css:
            src, k = pat_r.subn(f'var({tok})', src)
        else:
            # JS: 替换成字符串占位,后面统一改成 PAL.xxx
            src, k = pat_r.subn(f'@@{jsname}@@', src)
        n += k
    if src == orig:
        continue

    if is_css:
        css_changed.append((rel, n))
    else:
        # JS 里 @@xxx@@ 只在引号内的字符串才有效;这里统一转成 PAL.xxx
        used = sorted(set(re.findall(r'@@(\w+)@@', src)))
        src = re.sub(r"(['\"])@@(\w+)@@\1", r"\1PAL.\2\1", src)   # 'xxx' → 'PAL.xxx'
        src = re.sub(r"@@(\w+)@@", r"'PAL.\1'", src)              # 裸色值位置
        # 补 import
        if used and 'palette-js.js' not in src:
            imp = "import { PAL } from '../core/palette.js';\n" if rel.startswith('js/ui/') \
                  else "import { PAL } from './core/palette.js';\n" if rel.startswith('js/') \
                  else "import { PAL } from './js/core/palette.js';\n"
            # 插到第一个 import 之后
            m = re.search(r"^import .*?;\s*$", src, re.M)
            if m:
                src = src[:m.end()] + '\n' + imp.strip() + src[m.end():]
            else:
                src = imp + src
        js_changed.append((rel, n, used))

    if WRITE:
        io.open(f, 'w', encoding='utf-8').write(src)

print(f'{"已写入" if WRITE else "dry-run"}')
print(f'  CSS: {len(css_changed)} 文件 {sum(x[1] for x in css_changed)} 处')
print(f'  JS : {len(js_changed)} 文件 {sum(x[1] for x in js_changed)} 处')
if css_changed:
    print('\n  CSS 变更:')
    for rel, n in sorted(css_changed, key=lambda x: -x[1]):
        print(f'    {rel:40s} {n:4d}')
if js_changed:
    print('\n  JS 变更(前 12):')
    for rel, n, used in sorted(js_changed, key=lambda x: -x[1])[:12]:
        print(f'    {rel:40s} {n:4d}  用到: {",".join(used[:5])}')
if not WRITE:
    print('\n(加 --write 落盘)')