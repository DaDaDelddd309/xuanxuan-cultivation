import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// V0.89 事故:清理重复代码时误删了 askStoryPath/showStoryDone,
// 调用点还在 → 点了没反应,且只在浏览器里炸。
// 检查:this.xxx( 调用到的,必须在本文件的 UI 对象里定义过。
import { readFileSync, readdirSync } from 'fs';
const D=__ROOT__+'/js/xiuxian';
let bad=0;
for (const f of readdirSync(D).filter(x=>x.endsWith('.js'))) {
  const src=readFileSync(D+'/'+f,'utf8');
  // 只关心有 UI 对象大写开头的模块
  const defined=new Set([...src.matchAll(/^  (\w+)\s*\(/gm)].map(m=>m[1]));
  // 运行时赋值也算定义:this.foo = ... / this.foo = () =>
  for (const m of src.matchAll(/this\.(\w+)\s*=/g)) defined.add(m[1]);
  // 对象属性形式:{ foo(...) {} } / foo: function
  for (const m of src.matchAll(/^\s*(\w+)\s*[:(]/gm)) defined.add(m[1]);
  const called=new Set([...src.matchAll(/this\.(\w+)\s*\(/g)].map(m=>m[1]));
  for (const c of called) {
    if (!defined.has(c)) { console.log(`  ❌ ${f}: 调用了 this.${c}() 但没定义`); bad++; }
  }
}
console.log(bad?`\n未定义方法调用: ${bad} 处`:'✅ 所有 this.xxx() 调用都有定义');
process.exit(bad?1:0);
