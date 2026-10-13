import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 预缓存清单重复 → 每次 addAll 白下载一遍
// 清单里有文件不存在 → 整个 install 失败,SW 不注册
import { readFileSync, existsSync, readdirSync } from 'fs';
import path, { normalize } from 'path';
import { stripComments, precacheEntries } from './lib-swlist.mjs';
const ROOT=__ROOT__+'';
const s=readFileSync(ROOT+'/sw.js','utf8');
// 去注释后再取条目 —— 见 lib-swlist.mjs 顶部的说明:
// 直接扫全文会把**注释里提到的路径**当成清单项,报出假红。
// 逐块解析(而不是整文件取并集),因为下面要分别检查「块内重复」与「跨块重复」。
const per=[...s.matchAll(/const\s+\w+\s*=\s*\[([\s\S]*?)\]/g)]
  .map(m=>[...stripComments(m[1]).matchAll(/'([^']+)'/g)].map(x=>x[1].replace(/^\.\//,'')));
let bad=0;
// 0) **结构完整性**(2026-10-12 新增,修一个实测坐实的假通过)
//    下面第 1~3 条全部用 `/'([^']+)'/g` 抽条目,于是:
//      · 数组稀疏空洞 `['a', , 'b']`  —— 没有引号,解析阶段就被丢掉
//      · 空字符串条目 `''`            —— 正则要 1+ 字符,同样被丢掉
//    这两类条目在运行时是 `undefined` / `''`,`cache.addAll` 会去请求
//    `<scope>/undefined`,每次 install 白白几次 404。
//    阴性对照实测(注入 `'js/main.js', , 'js/sprites.js',`):
//        修之前 EXIT=0 报绿;修之后 EXIT=1。
//    ⚠️ 这个坑本仓栽过两次(V0.98「检查方向搞反」、这次「解析不完整」),
//       两次都是同一类:lint 报绿但实际有问题。
//    解析器在 lib-swlist.mjs 的 precacheEntries() —— 刻意不用 eval,
//    对仓库内容求值等于给自己开一个执行口子。
{
  const ents = precacheEntries(s);
  const holes = ents.filter(e=>e.kind==='hole');
  const empty = ents.filter(e=>e.kind==='empty');
  const undef = ents.filter(e=>e.kind==='undef');
  const notStr = ents.filter(e=>e.kind==='notstring');
  if(holes.length){
    console.log(`  ❌ 预缓存清单有 ${holes.length} 个稀疏空洞(运行时是 undefined,每次 install 白白 404):`);
    for(const h of holes) console.log(`     第 ${h.blockIndex} 个清单块`);
    bad++;
  }
  if(empty.length){
    console.log(`  ❌ 预缓存清单有 ${empty.length} 个空字符串条目:`);
    for(const e of empty) console.log(`     第 ${e.blockIndex} 个清单块`);
    bad++;
  }
  if(undef.length){
    console.log(`  ❌ 预缓存清单有 ${undef.length} 个 undefined/null 条目(等价于空洞):`);
    for(const e of undef) console.log(`     第 ${e.blockIndex} 个清单块: ${e.raw.trim()}`);
    bad++;
  }
  // ⚠️ 非字符串条目**只提示不判红** —— 第一版把它判红,当场误伤第 4 个清单块里
  //   合法的 `...CORE` / `...XX` / `...ART` 展开。展开/字符串拼接都能求值出字符串,
  //   静态查不了「它展开后存不存在」,所以只能提示,判红就是造假红。
  if(notStr.length){
    console.log(`  ℹ️  预缓存清单有 ${notStr.length} 个非字面量条目(展开/拼接,本 lint 校验不了它们):`);
    for(const e of notStr) console.log(`     第 ${e.blockIndex} 个清单块: ${e.raw.trim().slice(0,60)}`);
  }
}
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
// ── install / activate 的失败处理(XX-PWA-001)──
//
// 原来的 install 是:
//     await Promise.allSettled(ASSETS.map(...));
//     self.skipWaiting();
// 两个问题,都是**静默**的:
//   ① rejection 被原样丢掉 —— 漏存多少项、控制台一个字都没有,没人知道漏了什么。
//   ② activate 照常执行 `caches.delete(k !== V)` —— 新缓存不完整 + 旧缓存已删,
//      移动端安装时网络抖动(极常见)就会得到这个组合,一断网即白屏。
//
// 为什么**不**要求「失败就 throw 让 install 失败」:
//   一个永久失效的资源(比如将来某张图下线)会让 install 永久失败,
//   用户从此再也收不到任何更新 —— 比漏存几项更糟。
//   所以钉的是「留痕 + 按完整性决定清不清旧缓存」,不是「必须 throw」。
{
  const sw = readFileSync(ROOT+'/sw.js','utf8');
  const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"));

  console.log('\n=== install/activate 不得静默丢预缓存失败 ===');
  const chk=(name,cond,detail)=>{
    if(cond) console.log(`  ✅ ${name}`);
    else { console.log(`  ❌ ${name}${detail?' — '+detail:''}`); bad++; }
  };
  chk('install 不得裸调 allSettled 就 skipWaiting',
      !/await\s+Promise\.allSettled\([^;]*\)\s*;?\s*\n\s*self\.skipWaiting/.test(install),
      '失败被吞 + 照样激活 = 漏存项无人知晓');
  chk('install 必须算出失败清单(failed)',
      /const\s+failed\s*=/.test(install), '没提取 failed 就等于没打算用它');
  chk('install 必须把失败项打出来(console.warn)',
      /failed\.length[\s\S]{0,240}console\.warn/.test(install),
      '有 failed 却不输出 = 仍然不可观测');
  chk('activate 必须先判断预缓存完整性',
      /const\s+complete\s*=/.test(activate), 'activate 不判断完整性就会照删旧缓存');
  chk('删旧缓存必须受完整性门控',
      /if\s*\(\s*complete\s*\)[\s\S]{0,160}caches\.delete/.test(activate),
      'precache 不完整时删旧缓存 = 断网即白屏');
  chk('完整性标记只在 install 全成功时写入',
      /put\(\s*STAMP/.test(install) && /else\s*\{\s*[\s\S]{0,80}put\(\s*STAMP/.test(install),
      '无条件写标记 = 完整性判断恒为 true,等于没门');
}

console.log(bad?`\n预缓存问题: ${bad} 项`:'✅ 预缓存清单干净');
process.exit(bad?1:0);
