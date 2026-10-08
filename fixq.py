import io, re, os
# 1) 'PAL.xxx' → PAL.xxx （全部）
n = 0
for root, dirs, files in os.walk('js'):
    if 'node_modules' in root: continue
    for f in files:
        if not f.endswith('.js'): continue
        p = os.path.join(root, f)
        if p.endswith('core/palette.js'): continue
        s = io.open(p, encoding='utf-8').read()
        if "'PAL." not in s: continue
        s2 = re.sub(r"'PAL\.(\w+)'", r'PAL.\1', s)
        io.open(p, 'w', encoding='utf-8').write(s2)
        n += s.count("'PAL.")
print(f'去引号: {n} 处')

# 2) world.js: 本地 V0.96 里没有 worldgen,NODE_TYPES 里的 PAL 引用是新的,
#    但它 import 的是 '../core/palette.js' 且本地另有一处 PAL 声明 → 查冲突
p = 'js/xiuxian/world.js'
if os.path.exists(p):
    s = io.open(p, encoding='utf-8').read()
    cnt = len(re.findall(r'\bPAL\b', s))
    decls = re.findall(r'(?:const|let|var)\s+PAL\b', s)
    print(f'world.js: PAL 出现 {cnt} 次, 声明 {len(decls)} 次')
    if len(decls) > 1:
        print('  → 有重复声明')
