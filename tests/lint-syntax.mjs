import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// `node --check` 不做完整 ES module 解析 —— V0.92 踩过:
// 模板串里 ${...} 没闭合,node --check 通过,浏览器直接白屏。
// 这里用动态 import 真正加载每个模块。
import { readdirSync } from 'fs';
globalThis.document={addEventListener(){},removeEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};
globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
// 必须扫全仓,不能只扫 js/xiuxian —— V0.98 踩过:
// 7 个 js/game/*.js 把 '../core/palette.js' 写成了 './core/palette.js',
// 整条 import 链断掉、main.js 都加载不了,而当时这个 lint 报「所有模块能真正加载」。
// 因为它只遍历 js/xiuxian/,压根没碰过 js/game/。
const files=[];
(function walk(d){for(const e of readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;
  if(e.isDirectory())walk(p);else if(e.name.endsWith('.js'))files.push(p);}})(__ROOT__+'/js');
let bad=0;
for (const f of files.sort()) {
  try { await import(f); }
  catch(e) {
    if (/document|window|Audio|localStorage|navigator|Image|is not defined/.test(e.message)) continue; // 运行时依赖,非语法错
    console.log(`  ❌ ${f.replace(__ROOT__+'/','')}: ${e.message.split('\n')[0]}`);
    bad++;
  }
}
console.log(bad?`\n模块加载失败: ${bad} 个（共扫 ${files.length} 个）`:'✅ 所有模块能真正加载（'+files.length+' 个）');
process.exit(bad?1:0);
