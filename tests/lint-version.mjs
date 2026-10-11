import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 版本号散在 4 处:index.html / manifest.webmanifest / sw.js / version.json
// 漏改一处线上就新旧混搭(工单 XX-QUAL-003 / TECHDEBT P0-1)
//
// 【V0.99 加固】原来这里只查前三处,而且正则只捕获数字段:
//   · version.json 完全没查 —— 它是 make-manifest.mjs 从 sw.js 生成的探针产物,
//     两者一旦漂移,探针就会指向一个实际不存在的版本,排查时反而误导人。
//   · /xuanxuan-v(\d+)/ 对 "xuanxuan-v099p" 只取到 "099",字母后缀 p 完全不可见 ——
//     把 v099 改成 v099p 或反过来,这个 lint 都不会红。
// 现在后缀可见,且 version.json 与 sw.js 强制一致。
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
const R=__ROOT__+'';
const read=f=>readFileSync(R+'/'+f,'utf8');
const html=read('index.html'), mf=read('manifest.webmanifest'), sw=read('sw.js');
const hasVjson=existsSync(R+'/version.json');
const vjson=hasVjson?read('version.json'):'';
let bad=0;
const uniq=a=>[...new Set(a)];
// 界面记法:V0.99 / V0.99p —— 连后缀一起抓
const V=s=>[...s.matchAll(/V(\d+\.\d+[a-z]*)/g)].map(m=>m[1]);
// SW 记法:xuanxuan-v099p —— 后缀必须抓,否则 v099 / v099p 会被当成同一个
const SWV=s=>[...s.matchAll(/xuanxuan-v(\d+[a-z]*)/g)].map(m=>m[1]);
const DEC=s=>[...s.matchAll(/(?:^|[^\w-])v(\d+[a-z]*)/g)].map(m=>m[1]);

const hV=uniq(V(html)), mV=uniq(V(mf));
if(hV.length>1){console.log(`  ❌ index.html 版本号不一致: ${hV.join(', ')}`);bad++;}
if(mV.length>1){console.log(`  ❌ manifest 版本号不一致: ${mV.join(', ')}`);bad++;}
const main=hV[0];
if(main && mV[0]!==main){console.log(`  ❌ manifest(${mV[0]}) ≠ index.html(${main})`);bad++;}

// —— sw.js 自身的两处:const V 与 xuanxuan-vNNNp 必须一致 ——
const swConst=(sw.match(/const V\s*=\s*'xuanxuan-v(\d+[a-z]*)'/)||[])[1];
const swCacheV=uniq(SWV(sw));
if(swCacheV.length>1){console.log(`  ❌ sw.js 出现多个缓存版本: ${swCacheV.join(', ')}`);bad++;}
if(swConst && swCacheV[0] && swConst!==swCacheV[0]){
  console.log(`  ❌ sw.js 内部不一致: const V=${swConst} 但缓存名是 xuanxuan-v${swCacheV[0]}`);bad++;}
// 缓存版本必须带主版本号(界面 V0.99 → 缓存 v099…)
if(swCacheV[0] && main && swCacheV[0].replace(/[a-z]+$/,'')!==main.replace('.','')){
  console.log(`  ❌ sw.js 缓存版本 v${swCacheV[0]} 与主版本 ${main} 不符`);bad++;}

// —— version.json 必须等于 sw.js 的 V(它是探针,指向错版本比没有更糟)——
if(hasVjson){
  let jv='';
  try{ jv=(JSON.parse(vjson).version)||''; }catch(e){ console.log(`  ❌ version.json 解析失败: ${e.message}`); bad++; }
  const jNum=(jv.match(/v?(\d+[a-z]*)/)||[])[1];
  if(jv && swConst && jNum!==swConst){
    console.log(`  ❌ version.json(${jv}) ≠ sw.js(${swConst}) —— 探针指向的版本不存在,重新生成: node tests/make-manifest.mjs --write`);
    bad++;}
}

// —— version.json 的**清单内容**必须等于生成器的输出 ——
//
// ⚠️ 工单 XX-AUDIT-040:上面那段只比 `version` 字段,`count` 和 `files` 一个都不看。
// 于是文档里那条纪律 ——「`version.json` 是生成物,按文件内容算 sha256,
// 改任何 `.md` 都会让它失效,**必须跑 `make-manifest.mjs --write`**」——
// **至今没有任何会红的检查在管**。清单可以长期过期而 `npm run lint` 全绿。
// 实测(2026-10-11):Z8 提交的 version.json 有 183 条,仓库实际 179 条,
// 全绿放行了,是**人工比对**才发现的。
//
// 实现约束(这一条比门禁本身更重要):
//   **门禁必须调真正的生成器,不能在 lint 里重写一遍算法。**
//   门禁自带一份算法 = 多了一个会漂移的副本 —— 那就是把同一个病复制一遍,
//   只是搬进了门禁里。将来改了算法而忘了改门禁,门禁就会拿着旧算法
//   对着新产物说「一致」。
if (hasVjson) {
  const gen = spawnSync(process.execPath, [R + '/tests/make-manifest.mjs'],
                        { encoding: 'utf8', cwd: R });
  if (gen.status !== 0) {
    // 生成器自己跑不起来时**不能放行**:那等于「没检查」伪装成「检查通过」。
    console.log(`  ❌ 清单生成器跑不起来(rc=${gen.status}):${(gen.stderr||'').trim().split('\n')[0]||'无 stderr'}`);
    bad++;
  } else {
    let g = null;
    try { g = JSON.parse(gen.stdout); } catch (e) {
      console.log(`  ❌ 清单生成器输出不是合法 JSON: ${e.message}`);
      bad++;
    }
    if (g) {
      const cur = (() => { try { return JSON.parse(vjson).files || {}; } catch { return {}; } })();
      const gen_ = g.files || {};
      const added   = Object.keys(gen_).filter(f => !(f in cur));   // 该有却没有
      const removed = Object.keys(cur).filter(f => !(f in gen_));   // 不该有却还在
      const changed = Object.keys(gen_).filter(f => f in cur && cur[f] !== gen_[f]);
      if (added.length || removed.length || changed.length) {
        const n = added.length + removed.length + changed.length;
        console.log(`  ❌ version.json 清单已过期(${n} 项与生成器不符)—— 重新生成: npm run manifest:write`);
        if (changed.length) console.log(`     内容变了 ${changed.length} 个(前 5):` +
          changed.slice(0, 5).map(f => `\n       ${f}  清单记 ${cur[f]} → 应为 ${gen_[f]}`).join(''));
        if (added.length)   console.log(`     清单缺了 ${added.length} 个(前 5): ${added.slice(0, 5).join(', ')}`);
        if (removed.length) console.log(`     清单多出 ${removed.length} 个(前 5): ${removed.slice(0, 5).join(', ')}`);
        console.log(`     条目数 清单=${Object.keys(cur).length} / 生成器=${g.count}`);
        bad++;
      } else {
        console.log(`  ℹ️  清单已核对:${g.count} 个文件,校验和逐条一致`);
      }
    }
  }
}

if(main) console.log(`  ℹ️  当前版本 ${main} · SW 缓存 xuanxuan-v${swCacheV[0]||'?'}${hasVjson?' · 探针已核对':''}`);

// —— package.json 的 version ——
// 它是第五处版本号(前三处 index/manifest/sw,第四处 version.json 探针)。
// 之前没人查它,所以它一路漂到了 0.99.4 —— 与 sw 的 xuanxuan-v099p 不是一个记法体系。
// 包版本号和页面版本号本来就允许不同记法(0.99.4 vs v099p 不冲突),
// 但**它必须存在且非空**,否则 npm 自己都报不出来。
if(existsSync(R+'/package.json')){
  let pv='';
  try{ pv=(JSON.parse(read('package.json')).version)||''; }catch(e){ console.log(`  ❌ package.json 解析失败: ${e.message}`); bad++; }
  if(pv && !/^\d+\.\d+\.\d+/.test(pv)){
    console.log(`  ❌ package.json version 不是合法 semver: "${pv}"`);
    bad++;
  } else if(pv){
    console.log(`  ℹ️  package.json version: ${pv}(npm 用,与页面版本号两套记法,允许不同)`);
  } else {
    console.log(`  ❌ package.json 缺 version 字段`);
    bad++;
  }
}

console.log(bad?`\n版本号问题: ${bad} 项`:'✅ 版本号一致');
process.exit(bad?1:0);