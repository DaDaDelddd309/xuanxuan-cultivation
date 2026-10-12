// CSS 渐进增强门禁:用了 aspect-ratio 的选择器必须有 height 兜底
// 运行: node tests/lint-aspect-ratio-fallback.mjs
//
// 由来(对端实测,已复核属实):
//   「模拟 Safari 不支持 aspect-ratio:容器高度 274px → 24px,15 个节点全部不可见」
//
// 为什么值得单独一道门禁:aspect-ratio 是**渐进增强**里典型的"用了就完全替代
// height"的属性 —— 它不支持时不是"效果差一点",而是**高度直接归零**。
// 仓库里凡是靠百分比绝对定位的容器(地图),一塌就整页不可用。
// 而这类问题在本机**测不出来**:Node 没有布局引擎,headless 浏览器装不上。
// 只能靠静态检查把"新加一处 aspect-ratio 忘了兜底"挡在门外。
//
// 判据:css/ 下每个含 aspect-ratio 的规则,其选择器必须在同文件里存在
//      `@supports not (aspect-ratio...)` 的兜底声明。
import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const cssDir = ROOT + '/css';
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = d + '/' + f;
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.css')) files.push(p);
  }
})(cssDir);

let checked = 0, bad = 0;
const report = [];

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  // 去掉注释,免得注释里的 aspect-ratio 被当成真代码(本仓库踩过同样的坑)
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const rel = f.slice(ROOT.length + 1);

  // 收集 @supports not (aspect-ratio...) 块里出现过的选择器
  const guards = new Set();
  const guardRe = /@supports\s+not\s*\(\s*aspect-ratio[^)]*\)\s*\{([\s\S]*?)\n\}/g;
  let gm;
  while ((gm = guardRe.exec(css))) {
    const body = gm[1];
    const selRe = /(^|[},])\s*([^{}@]+?)\s*\{/g;
    let sm;
    while ((sm = selRe.exec(body))) {
      for (const s of sm[2].split(',')) {
        const t = s.trim();
        if (t) guards.add(t);
      }
    }
  }

  // 收集所有用 aspect-ratio 的选择器
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rm;
  while ((rm = ruleRe.exec(css))) {
    const body = rm[2];
    if (!/aspect-ratio\s*:/.test(body)) continue;
    const sels = rm[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const sel of sels) {
      if (sel.startsWith('@')) continue;
      checked++;
      if (guards.has(sel)) continue;
      bad++;
      report.push(`  ❌ ${rel} 的 ${sel} 用了 aspect-ratio 却没有 height 兜底`);
    }
  }
}

if (checked === 0) {
  console.log('  ❌ 一处 aspect-ratio 都没扫到 —— 判据可能失效了(仓库里明明有)');
  process.exit(2);   // 门禁自身失效,按章程 exit 2,不装作通过
}

console.log(`检查 ${checked} 处 aspect-ratio 用例,${bad} 处缺兜底`);
for (const r of report) console.log(r);
if (bad === 0) {
  console.log('✅ aspect-ratio 全部有 height 兜底');
  process.exit(0);
}
console.log('\n修法:在同一文件加');
console.log('  @supports not (aspect-ratio: 1/1) { <选择器> { height: … } }');
process.exit(1);
