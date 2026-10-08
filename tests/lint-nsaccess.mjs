import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 深层访问错误: LORE.CHARACTERS.moying —— LORE 其实是 WORLD 的别名,没有 CHARACTERS
// 后果:运行时 TypeError,只在玩家走到那条路线时才炸(测试碰不到就漏了)
import { readFileSync, readdirSync } from 'fs';
const D=__ROOT__+'/js/xiuxian';
const exports={};
for (const f of readdirSync(D).filter(x=>x.endsWith('.js'))) {
  const src=readFileSync(D+'/'+f,'utf8');
  exports[f]={};
  for (const m of src.matchAll(/export\s+(?:const|function|class|let)\s+(\w+)/g))
    exports[f][m[1]]=true;
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g))
    m[1].split(',').forEach(n=>{const p=n.trim().split(/\s+as\s+/);exports[f][p[1]||p[0]]=true;});
}
let bad=0;
for (const f of readdirSync(D).filter(x=>x.endsWith('.js'))) {
  const src=readFileSync(D+'/'+f,'utf8');
  const alias={};
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/(\w+)\.js'/g)) {
    for (let n of m[1].split(',')) {
      const p=n.trim().split(/\s+as\s+/).map(x=>x.trim());
      if(p[0]) alias[p[1]||p[0]]=p[0];
    }
  }
  for (const m of src.matchAll(/\b([A-Z][A-Z_0-9]*)\.([a-z_]\w*)\.([a-z_]\w*)/g)) {
    const [,, ns,mid] = m;
    const mod=alias[ns];
    if(!mod) continue;
    const target=readdirSync(D).find(x=>x===mod+'.js');
    if(!target) continue;
    const e=exports[target];
    if(e && !e[mid]) { console.log(`  ❌ ${f}: ${ns}(=${mod}).${mid} 不存在 → ${m[0]}`); bad++; }
  }
}
console.log(bad?`\n命名空间访问错误: ${bad} 处`:'✅ 无命名空间深层访问错误');
process.exit(bad?1:0);
