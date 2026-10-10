import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 预缓存清单重复 → 每次 addAll 白下载一遍
// 清单里有文件不存在 → 整个 install 失败,SW 不注册
import { readFileSync, existsSync, readdirSync } from 'fs';
import path, { normalize } from 'path';
import { stripComments } from './lib-swlist.mjs';
const ROOT=__ROOT__+'';
const s=readFileSync(ROOT+'/sw.js','utf8');
// 去注释后再取条目 —— 见 lib-swlist.mjs 顶部的说明:
// 直接扫全文会把**注释里提到的路径**当成清单项,报出假红。
// 逐块解析(而不是整文件取并集),因为下面要分别检查「块内重复」与「跨块重复」。
const per=[...s.matchAll(/const\s+\w+\s*=\s*\[([\s\S]*?)\]/g)]
  .map(m=>[...stripComments(m[1]).matchAll(/'([^']+)'/g)].map(x=>x[1].replace(/^\.\//,'')));
let bad=0;
// 1) 块内重复
per.forEach((items,i)=>{
  const d=[...new Set(items.filter(x=>items.filter(y=>y===x).length>1))];
  if(d.length){console.log(`  ❌ 第 ${i+1} 个清单块内重复: ${d.join(', ')}`);bad++;}
});
// 2) 跨块重复(可接受,但报出来)
const seen=new Set();
per.forEach(items=>items.forEach(x=>{
  if(seen.has(x)&&x!=='index.html')console.log(`  ⚠️  跨块重复: ${x}`);
  seen.add(x);
}));
// 3) 文件不存在
per.forEach(items=>items.forEach(x=>{
  if(x&&!x.startsWith('http')&&!existsSync(ROOT+'/'+x)){console.log(`  ❌ 清单里没有这个文件: ${x}`);bad++;}
}));
// 4) 反向:磁盘上有、清单里没有 —— **这条才是 P0,原来一直没有**
//    V0.98 查出:V0.86~V0.90 重写清单时漏掉 7 个模块,而它们全在
//    main.js/ui.js 的**静态 import 图**上。原生 ES Module 静态 import 是全有或全无,
//    离线状态下拉不到任意一个就是**整页白屏**;在线因为 SW 的 stale-while-revalidate
//    走网络能补上,玩家无感 —— 所以它能一路带着"预缓存清单干净"发布出去。
//    旧版只查"清单里有、磁盘没有"(第 3 条),方向是反的,永远看不见这一类。
{
  const listed=new Set();
  per.forEach(items=>items.forEach(x=>listed.add(x)));
  // 注意:跳过规则必须作用在**相对路径**上。
  // 踩过一次:当时写成 `/(^|\/)\./.test(绝对路径)`,而仓库位于 /root/.tmp/… 下,
  // 于是每一项都被当成"点目录"跳过,反向检查实际上一件文件都没扫,
  // 还会照样打印 ✅ —— 一个比没有检查更坏的假通过。
  const skipRel=(rel)=>/(^|\/)\.[^/]/.test(rel) || rel.split('/').includes('node_modules');
  const walk=(d,out=[])=>{
    for(const e of readdirSync(d,{withFileTypes:true})){
      const rel=d.slice(ROOT.length+1)+'/'+e.name;
      if(skipRel(rel))continue;
      if(e.isDirectory())walk(d+'/'+e.name,out);
      else if(/\.(js|css)$/.test(e.name))out.push(rel);
    }
    return out;
  };
  const all=walk(ROOT+'/js').concat(walk(ROOT+'/css'));

  // 【阶段化未接线文件】—— 2026-10-10 工单 XX-WORLD-001
  //
  // 「磁盘有、清单没有」有两种完全不同的成因:
  //   ① 真事故:文件已经在 main.js 的 import 图上,但漏登记进 sw.js。
  //      离线/PWA 下白屏 —— 审计批 2 就是这么丢的(.github/workflows/ci.yml)。
  //   ② 按计划未接线:工单明确要求「纯数据落地、world.js 一行不改」,
  //      于是文件此刻**根本不在 import 图上**,不进预缓存是**正确**的。
  //
  // 本 lint 第一版只判存在性,不判因果,所以 ② 也被报红 —— 报的还是
  // 「离线会白屏」这种极重的措辞,而实际上离线根本不会加载它。
  //
  // 判据:**只有确实无人 import 的文件才豁免**。一旦它被接线了,
  // 本条立刻恢复报错 —— 豁免跟着因果走,不是跟着文件名走。
  const sources = walk(ROOT+'/js');
  const imported = new Set();
  const IMPORT_RE = /(?:^|[;\n])\s*import\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g;
  for (const f of sources) {
    let src; try { src = readFileSync(ROOT+'/'+f,'utf8'); } catch { continue; }
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1].split('?')[0];
      if (!spec.startsWith('.')) continue;
      imported.add(normalize(path.resolve(path.dirname(ROOT+'/'+f), spec)));
    }
  }
  const isWired = rel => imported.has(path.resolve(ROOT+'/'+rel));

  const missAll = all.filter(f=>!listed.has(f));
  const missUnwired = missAll.filter(f=>!isWired(f));      // 按计划未接线 → 豁免
  const miss = missAll.filter(f=>isWired(f));              // 接了线却没登记 → 真事故

  if(missUnwired.length){
    console.log(`  ⏳ ${missUnwired.length} 个文件按工单计划尚未接线,暂不进预缓存:`);
    missUnwired.forEach(m=>console.log(`     ${m}`));
  }
  if(miss.length){
    console.log(`  ❌ 磁盘有、预缓存清单没有 ${miss.length} 个(离线会白屏):`);
    miss.forEach(m=>console.log(`     ${m}`));
    bad++;
  } else {
    console.log('✅ 磁盘上的 js/css 全部在预缓存清单里(反向也查了)');
  }
}
console.log(bad?`\n预缓存问题: ${bad} 项`:'✅ 预缓存清单干净');
process.exit(bad?1:0);
