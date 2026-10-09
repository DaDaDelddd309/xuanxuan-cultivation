import io
p = 'tools/ui/split.mjs'
s = io.open(p, encoding='utf-8').read()
o = s

old = """const block = src.slice(i, j);
const found = (block.match(/^  (\\w+)\\(/gm) || []).map(x => x.trim().slice(0, -1));
const want = cfg.methods.filter(m => m !== 'vTomb');   // 已拆过的壳不在这段里
const missing = want.filter(m => !found.includes(m));
// 区间里可能夹着**已经拆走的壳**(`  vArts(s) { return vArtsImpl(this, s); }`),
// 它们同样匹配 `^  (\\w+)\\(` —— 不认的话每拆一刀,后面几刀的区间检查就全误报。
// 判据是这一行**是不是转发壳**,不是"名字在不在配置里"。
// 逐行匹配而不是整段 + /^/:没有 m 标志时 ^ 只锚在整段文本开头,
// 后面那些壳一个都认不出来,自检 2 会把整排壳报成"区间里多了方法"。拆第一页就撞上了。
const isShell = (m) => block.split('\\n').some(l =>
  l.startsWith('  ' + m + '(') && /\\{\\s*return\\s+\\w+Impl\\(this/.test(l));
const extra = found.filter(m => !want.includes(m) && !cfg.methods.includes(m) && !isShell(m));
if (missing.length) throw new Error(`区间里少了方法:${missing.join(',')}`);
if (extra.length) throw new Error(`区间里多了方法:${extra.join(',')} —— 配置该更新,或代码变了`);"""

new = """const block = src.slice(i, j);

// —— 自检 2:区间里**只应有本页的实现**,不能有别的页已经拆走的壳 ——
// ⚠️ 这里翻过车,而且翻得很隐蔽:先是把壳当成"区间里多了方法"直接报错,
// 于是我加了容错(isShell 跳过它们)。结果更糟 —— 壳被当成实现又搬了一遍:
// fam 的区间跨过了 story 那 9 个壳 → fam.js 里出现 9 个假的
// `export function showStoryBeat(hall,b) { return showStoryBeatImpl(this,b); }`,
// 同时 ui.js 里那 9 个真壳**被删掉了**(因为脚本用变换后的内容替换区间)。
// 当时脚本还打印了 ✅。
//
// 正确做法不是"容错",是**剔除**:壳属于别的页,不该出现在本页的实现里。
// 剔除之后再断言剩下的方法集合 == 配置,多一个少一个都停。
const isShellLine = (l) => /^  \\w+\\([^)]*\\) \\{ return \\w+Impl\\(this/.test(l);
const implBlock = block.split('\\n').filter(l => !isShellLine(l)).join('\\n');
const shellsInRange = block.split('\\n').filter(isShellLine);

const found = (implBlock.match(/^  (\\w+)\\(/gm) || []).map(x => x.trim().slice(0, -1));
const want = cfg.methods.filter(m => m !== 'vTomb');   // 已拆过的壳不在这段里
const missing = want.filter(m => !found.includes(m));
const extra = found.filter(m => !want.includes(m));
if (missing.length) throw new Error(`区间里少了方法:${missing.join(',')}`);
if (extra.length) throw new Error(`区间里多了方法:${extra.join(',')} —— 配置该更新,或代码变了`);
if (shellsInRange.length)
  console.log(`  (注:区间里有 ${shellsInRange.length} 行别的页的转发壳,已剔除不动它们)`);"""

assert old in s, 'self-check 2 block not found'
s = s.replace(old, new)

# 变换要用 implBlock,不是 block
old2 = """let body = block
  .replace(/^  (\\w+)\\(([^)]*)\\) \\{/gm,"""
new2 = """let body = implBlock
  .replace(/^  (\\w+)\\(([^)]*)\\) \\{/gm,"""
assert old2 in s, 'transform not found'
s = s.replace(old2, new2)

assert s != o
io.open(p, 'w', encoding='utf-8').write(s)
print('脚本已改:区间内的别页转发壳改为剔除,并对剔除后的集合断言')