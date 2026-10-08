import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 重复 import 声明会让整个 ES module 加载失败,修仙阁直接白屏。
// 静态语法检查抓不到,单独盯。
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
// 同 lint-syntax:扫全仓而不是只扫 js/xiuxian/。
// 重复 import 在 js/game/、js/ui/ 同样会让模块加载失败(V0.98 就有一例在 game/ 里)。
let bad=0, checked=0;
const files=[];
(function walk(d){for(const e of readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;
  if(e.isDirectory())walk(p);else if(e.name.endsWith('.js'))files.push(p);}})(__ROOT__+'/js');
for (const f of files.sort()) {
  const src=readFileSync(f,'utf8');
  const names=[];
  for (const m of src.matchAll(/^import\s+\{([^}]+)\}/gm)) {
    for (let n of m[1].split(',')) {
      n=n.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.push(n);
    }
  }
  checked++;
  const dup=[...new Set(names.filter(n=>names.filter(x=>x===n).length>1))];
  if (dup.length) { console.log(`  ❌ ${f.replace(__ROOT__+'/','')}: 重复声明 ${dup.join(', ')}`); bad++; }
}
console.log(bad? `\n重复 import: ${bad} 个文件` : `✅ 无重复 import(检查 ${checked} 个模块)`);
process.exit(bad?1:0);
