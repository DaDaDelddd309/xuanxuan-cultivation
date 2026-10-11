// XX-QA-065 · 浏览器测试里内联 JS 的「Python 注释漏进 JS」检查
//
// 为什么有这个东西(2026-10-11 实踩):
//   tests/t88.py 的 `pg.evaluate("""async()=>{ ... }""")` 里,我把一行注释写成了
//   Python 的 `#   凑不够 2 个 field 就永远结不了案。` ——
//   而那段是**包在 Python 三引号字符串里的 JS**,`#` 在 JS 里是非法 token。
//
// 为什么没被任何既有门禁抓到:
//   · `python3 -m py_compile` 只查 Python,三引号里的东西对它是字符串,永远合法
//   · lint-syntax.mjs 只查 .js/.mjs,不看 .py
//   · 浏览器套件在 CI 上跑,但它报的是 `SyntaxError: Invalid or unexpected token`,
//     **不带文件名行号**,第一眼看着像产品代码炸了
//
// 所以这条规则只卡一件极窄的事:三引号 evaluate 块里,行首(可含缩进)的 `#`。
// 不做完整的 JS 解析 —— 试过,正则字面量会被误判(见文件末尾的自述),
// 判据必须窄到不会假阳性,否则又是一条自己出错的度量工具。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../tests/', import.meta.url).pathname;
const files = readdirSync(DIR).filter(f => f.endsWith('.py'));

let fails = 0;
let blocks = 0;
const hits = [];

/** 抓 `pg.evaluate("""...""")`（也覆盖 page.evaluate / pg2.evaluate 等） */
const BLOCK = /\.evaluate\(\s*"""([\s\S]*?)"""/g;
/** 行首可含空白，然后是 # —— 也就是 Python 注释漏进了 JS */
const PY_COMMENT = /^[ \t]*#[^\n]*$/m;

for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8');
  let m;
  BLOCK.lastIndex = 0;
  while ((m = BLOCK.exec(src))) {
    blocks++;
    const body = m[1];
    const c = PY_COMMENT.exec(body);
    if (!c) continue;
    const line = src.slice(0, m.index).split('\n').length
      + body.slice(0, c.index).split('\n').length;
    hits.push(`${f}:${line}  ${c[0].trim().slice(0, 60)}`);
  }
}

console.log('【内联 JS 里的 Python 注释】');
console.log(`  扫了 ${files.length} 个 .py,${blocks} 段 pg.evaluate("""...""") 内联 JS`);
if (hits.length === 0) {
  console.log('  ✅ 没有 `#` 开头的 Python 注释漏进 JS');
} else {
  fails += hits.length;
  for (const h of hits) console.log(`  ❌ ${h}`);
  console.log('  ↑ 这些在 JS 里是 SyntaxError,但 python3 -m py_compile 查不出来。');
}

// 自述:为什么不做完整 JS 解析。
// 试过用 new Function 反解每段内联 JS,结果 tests/t87.py:47 报假阳性 ——
// 那段里有正则字面量 /\\['([^']+)'/,而这里读的是**文件原文**,
// 没有做 Python 三引号字符串的反转义,`\\[` 被当成正则转义坏了。
// 而 t87 在 CI 上是绿的。判据太宽就会自己出错,所以这里只卡上面那一条窄规则。
console.log('\n  ℹ️ 本 lint 刻意不做完整 JS 解析(正则字面量会假阳性,见上),只卡这一条窄规则。');

console.log(`\n失败 ${fails} 项` + (fails ? '' : ' · 全部通过'));
process.exit(fails ? 1 : 0);
