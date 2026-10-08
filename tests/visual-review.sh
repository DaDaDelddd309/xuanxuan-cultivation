#!/usr/bin/env bash
# 美术视觉验收(工单 XX-VIS-001)
#
# 为什么要有这个:
#   V0.99 之前,美术产出只验「文件存在 + 尺寸对」就报完成。
#   于是:立绘在 58×78 的卡片尺寸下是一团黑糊、么么茶是中年妇女而文案写的是
#   「少年」、游侠明显女性化 —— 三处都是我肉眼看不见、断言也看不见的。
#   代价是用户成了唯一的测试员。
#
# 它做什么:
#   1. 按**实际显示尺寸**合成对照图(立绘 58×78、插画铺满)
#   2. 并排新旧版本,便于比对
#   3. 输出到 /tmp,由**人/视觉模型**看 —— 这一步自动化不了,
#      脚本只负责"把要看的摆出来",判断必须真的看
#
# 用法: bash tests/visual-review.sh [输出目录]
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/tmp/visual-review}"
mkdir -p "$OUT"

PY="$(command -v python3 || echo python3)"
"$PY" - "$ROOT" "$OUT" <<'PYEOF'
import sys, os
from PIL import Image
ROOT, OUT = sys.argv[1], sys.argv[2]
P = os.path.join(ROOT, 'assets/portrait')
I = os.path.join(ROOT, 'assets/illust/pages_webp')

def sheet(files, cw, ch, gap, out, bg=(20,18,16), scale=1):
    if not files: return None
    w = cw*len(files) + gap*(len(files)+1)
    im = Image.new('RGB', (w, ch+gap*2), bg)
    x = gap
    for f in files:
        try: s = Image.open(f).convert('RGB')
        except Exception as e: print('跳过', f, e); continue
        s = s.resize((cw, ch), Image.LANCZOS)
        im.paste(s, (x, gap)); x += cw + gap
    im = im.resize((im.width*scale, im.height*scale), Image.LANCZOS) if scale>1 else im
    im.save(out, 'JPEG', quality=90)
    print('→', out, im.size)
    return out

# 1. 立绘:按卡片真实尺寸 58×78(这就是玩家看到的)
order = ['knight','mage','ranger','white','companion','momocha','merchant']
files = [os.path.join(P, f'{n}.jpg') for n in order]
sheet(files, 58*4, 78*4, 5, os.path.join(OUT,'portrait-cardsize.jpg'))
sheet(files, 200, 268, 8, os.path.join(OUT,'portrait-full.jpg'))

# 2. 插画:12 张 3×4
if os.path.isdir(I):
    names = sorted(os.listdir(I))
    tw, th, g = 340, 192, 6
    rows = (len(names)+2)//3
    sh = Image.new('RGB', (tw*3+g*4, th*rows+g*(rows+1)), (20,18,16))
    for i, n in enumerate(names):
        try: im = Image.open(os.path.join(I,n)).convert('RGB')
        except Exception: continue
        im.thumbnail((tw,th), Image.LANCZOS)
        sh.paste(im, (g+(i%3)*(tw+g), g+(i//3)*(th+g)))
    sh.save(os.path.join(OUT,'illus-grid.jpg'),'JPEG',quality=85)
    print('→', os.path.join(OUT,'illus-grid.jpg'), sh.size, f'({len(names)} 张)')

print()
print('═'*60)
print('这些图必须**真的被看**。脚本只负责摆出来,判断不能自动化。')
print('看的时候问:')
print('  · 缩到实际显示尺寸还认得出来吗?')
print('  · 图和文案/设定矛盾吗?')
print('  · 和同批其他图是同一套吗?')
print('═'*60)
PYEOF

echo
echo "对照图已生成于: $OUT"
echo "历史版本(改之前)可用:  cp <old>.jpg <new>.jpg  再跑一次即可比对"
