// 重复 import 声明会让整个 ES module 加载失败,修仙阁直接白屏。
// 静态语法检查抓不到,单独盯。
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
const DIR='/workspace/probe/rouge-offline/js/xiuxian';
let bad=0, checked=0;
for (const f of readdirSync(DIR).filter(x=>x.endsWith('.js'))) {
  const src=readFileSync(join(DIR,f),'utf8');
  const names=[];
  for (const m of src.matchAll(/^import\s+\{([^}]+)\}/gm)) {
    for (let n of m[1].split(',')) {
      n=n.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.push(n);
    }
  }
  checked++;
  const dup=[...new Set(names.filter(n=>names.filter(x=>x===n).length>1))];
  if (dup.length) { console.log(`  ❌ ${f}: 重复声明 ${dup.join(', ')}`); bad++; }
}
console.log(bad? `\n重复 import: ${bad} 个文件` : `✅ 无重复 import(检查 ${checked} 个模块)`);
process.exit(bad?1:0);
