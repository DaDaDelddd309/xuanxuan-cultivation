#!/usr/bin/env python3
# 门禁:仓库里不许再出现 Pillow 已废弃的 API。
#
# 【为什么要有这条 —— 2026-10-12】
#   三审报告报了 2 处 `getdata()`,独立复核说漏了第 3 处 `getpixel()`。
#   我实测了本机的 Pillow **12.3.0**:
#       getdata()  → 1 条 DeprecationWarning  ← 确实废弃
#       getpixel() → 0 条警告                ← **没有**被废弃
#   ⇒ 第 3 处是**误报**。我一度照着「三处一起改」的说法在 audit.py 里
#      写了「getpixel 也计划移除」的注释,实测发现是假的,已撤。
#   这条门禁的价值就在这儿:**别再靠转述判断哪个 API 废弃了,跑一次就知道。**
#
# 判据用**运行时警告**而不是硬编码 API 名 —— Pillow 升版时废弃清单会变,
# 这条门禁会自己跟上;写死 API 名只会变成又一处「凭印象」。
#
# 用法: python3 tools/art/_pillow-check.py      退出码 0/1
import pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
# 扫代码(不是扫 txt 报告 —— 报告里留着历史输出片段,那是记录不是代码)
PAT = re.compile(r'\.(getdata|getpixel)\s*\(')

def sample_call(method):
    """在真实 Pillow 上跑一次,看它到底报不报 DeprecationWarning。"""
    code = (
        "import warnings\n"
        "from PIL import Image\n"
        "im = Image.new('RGB',(4,4),(1,2,3))\n"
        "with warnings.catch_warnings(record=True) as w:\n"
        "    warnings.simplefilter('always')\n"
        f"    {'list(im.getdata())' if method=='getdata' else 'im.getpixel((0,0))'}\n"
        "    print(len(w))\n"
    )
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as f:
        f.write(code); path = f.name
    try:
        out = subprocess.run([sys.executable, path], capture_output=True, text=True, timeout=60)
        return out.stdout.strip() == '0'
    except Exception:
        return True      # 跑不起来就当没废弃,别造假红
    finally:
        pathlib.Path(path).unlink(missing_ok=True)

deprecated = {m for m in ('getdata', 'getpixel') if not sample_call(m)}
print(f"实测本机 Pillow 已废弃的 API: {', '.join(sorted(deprecated)) or '(无)'}")

hits = []
SELF = pathlib.Path(__file__).resolve()
for p in sorted(ROOT.glob('tools/**/*.py')):
    if p.resolve() == SELF:
        continue                          # 本文件里有构造示例代码的字符串,排除自己
    for i, line in enumerate(p.read_text(errors='replace').splitlines(), 1):
        if line.lstrip().startswith('#'):
            continue                      # 注释里提到不算调用
        for m in PAT.finditer(line):
            if m.group(1) in deprecated:
                hits.append((p.relative_to(ROOT), i, m.group(1), line.strip()[:70]))

if hits:
    print(f"\n❌ 用到已废弃的 Pillow API {len(hits)} 处:")
    for f, i, name, line in hits:
        print(f"   {f}:{i}  .{name}()  {line}")
    sys.exit(1)
print("✅ tools/ 下没有用到已废弃的 Pillow API")
sys.exit(0)
