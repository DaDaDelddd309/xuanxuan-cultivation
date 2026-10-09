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