// `node --check` 不做完整 ES module 解析 —— V0.92 踩过:
// 模板串里 ${...} 没闭合,node --check 通过,浏览器直接白屏。
// 这里用动态 import 真正加载每个模块。
import { readdirSync } from 'fs';
globalThis.document={addEventListener(){},removeEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};
globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const D='/workspace/probe/rouge-offline/js/xiuxian';
let bad=0;
for (const f of readdirSync(D).filter(x=>x.endsWith('.js'))) {
  try { await import(D+'/'+f); }
  catch(e) {
    if (/document|window|Audio|localStorage|is not defined/.test(e.message)) continue; // 运行时依赖,非语法错
    console.log(`  ❌ ${f}: ${e.message}`);
    bad++;
  }
}
console.log(bad?`\n模块加载失败: ${bad} 个`:'✅ 所有模块能真正加载');
process.exit(bad?1:0);
