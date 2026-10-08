import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 版本号散在 index.html / manifest / sw.js 四处,漏改一处线上就新旧混搭
import { readFileSync } from 'fs';
const R=__ROOT__+'';
const read=f=>readFileSync(R+'/'+f,'utf8');
const html=read('index.html'), mf=read('manifest.webmanifest'), sw=read('sw.js');
let bad=0;
const uniq=a=>[...new Set(a)];
const V=s=>[...s.matchAll(/V(\d+)\.(\d+)/g)].map(m=>`${m[1]}.${m[2]}`);

const hV=uniq(V(html)), mV=uniq(V(mf)), sV=uniq(V(sw));
if(hV.length>1){console.log(`  ❌ index.html 版本号不一致: ${hV.join(', ')}`);bad++;}
if(mV.length>1){console.log(`  ❌ manifest 版本号不一致: ${mV.join(', ')}`);bad++;}
const main=hV[0];
if(main && mV[0]!==main){console.log(`  ❌ manifest(${mV[0]}) ≠ index.html(${main})`);bad++;}
// sw 的缓存版本必须带主版本
const swCache=(sw.match(/xuanxuan-v(\d+)/)||[])[1];
if(swCache && main && swCache!==main.replace('.','')){console.log(`  ❌ sw.js 缓存版本 v${swCache} 与主版本 ${main} 不符`);bad++;}
if(main) console.log(`  ℹ️  当前版本 ${main} · SW 缓存 xuanxuan-v${swCache||'?'}`);
console.log(bad?`\n版本号问题: ${bad} 项`:'✅ 版本号一致');
process.exit(bad?1:0);
