import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// V0.89 事故:清理重复代码时误删了 askStoryPath/showStoryDone,
// 调用点还在 → 点了没反应,且只在浏览器里炸。
// 检查:this.xxx( 调用到的,必须在本文件的 UI 对象里定义过。
import { readFileSync, readdirSync } from 'fs';
const D=__ROOT__+'/js/xiuxian';

// —— 收集源文件(递归) ——
// ⚠️ 踩过:原来只有 `readdirSync(D)` 一层。XX-AUDIT-005 把 ui.js 拆成
// js/xiuxian/ui/*.js 之后,那些文件**一个都没进检查范围** ——
// 报出来还是「✅ 所有 this.xxx() 调用都有定义」,但覆盖已经悄悄缩水了。
// 一个不检查的检查比没有检查更坏,因为它给的是安心。
// 反过来,JS 里 `indexOf`/`.filter` 这类调用满地都是,跨文件混进来会淹没信号;
// vendor/ 是第三方轮子,方法都是本地作用域的,也不该进。
const SKIP_DIR=(name)=>name==='vendor'||name==='node_modules';
const files=[];
(function walk(d){
  for(const e of readdirSync(d,{withFileTypes:true})){
    if(e.isDirectory()){ if(!SKIP_DIR(e.name)) walk(d+'/'+e.name); }
    else if(e.name.endsWith('.js')) files.push(d+'/'+e.name);
  }
})(D);
files.sort();

const rel=f=>f.slice(D.length+1);

// —— 第一遍:全量收集「定义过」的方法名 ——
// 为什么改成跨文件汇总:ui.js 拆分后用 Object.assign 把各视图模块合并回同一个
// Hall 对象(Hall 本身不能被视图模块 import,那是循环依赖)。
// 既然运行时它们**确实是同一个对象上的方法**,那么「在 A 文件调用、在 B 文件定义」
// 是合法的,不是问题。按文件隔离反而会在拆分当天报一片假红,把正确的拆分堵死。
const defined=new Set();
const definedIn=new Map();
const addDef=(name,f)=>{
  defined.add(name);
  if(!definedIn.has(name)) definedIn.set(name,[]);
  definedIn.get(name).push(rel(f));
};
for (const f of files) {
  const src=readFileSync(f,'utf8');
  // 只关心有 UI 对象大写开头的模块
  for (const m of src.matchAll(/^  (\w+)\s*\(/gm)) addDef(m[1],f);
  // 运行时赋值也算定义:this.foo = ... / this.foo = () =>
  for (const m of src.matchAll(/this\.(\w+)\s*=/g)) addDef(m[1],f);
  // 对象属性形式:{ foo(...) {} } / foo: function
  for (const m of src.matchAll(/^\s*(\w+)\s*[:(]/gm)) addDef(m[1],f);
}

// —— 第二遍:查调用 ——
// ⚠️ 踩过:这里原来只有 `this.` 一种形态。拆分后的视图模块拿到的是
// `hall` 参数(工单 XX-AUDIT-005 定的拆法是 `vRealm(s){ return vRealm(this,s) }`,
// 也就是实现侧签名是 `vRealm(hall, s)`),里面全是 `hall.xxx()` —— 一处都扫不到。
// 于是拆分完成后这个 lint 对**整个新架构**完全失明,还照常打印 ✅。
// 探针实测过:`hall.thisDoesNotExistAnywhere()` 放在 ui/ 下不报红。
//
// 范围要收紧:只认 `js/xiuxian/ui/` 下**导出**函数的首形参。
// 试过放宽成"所有文件所有函数的首形参",结果 d.foo()/e.foo()/src.foo()
// 全被当成方法调用,假阳性淹没信号 —— 那种 lint 等于没有 lint。
const SELF = new Set(['this']);
{
  const UISUB=D+'/ui/';
  // ⚠️ 踩过:原先用一条 `export\s+(?:function\s+(\w+)|const\s+\w+\s*=...)\(([^)]*)`。
  // `[^)]*` 连开头的 `(` 一起吃掉了(它只排除 `)`),首参抓成 `(hall`,
  // 于是 SELF 集合里根本没有 hall —— 拆分后这个 lint 全程失明还照样绿。
  // 拆成两条独立正则,各自紧跟一个显式的 `\(`。
  const P1=/export\s+function\s+\w+\s*\(([^)]*)/g;
  const P2=/export\s+const\s+\w+\s*=\s*(?:async\s*)?\(([^)]*)/g;
  for (const f of files) {
    if (!f.startsWith(UISUB)) continue;
    const src=readFileSync(f,'utf8');
    for (const re of [P1, P2]) {
      for (const m of src.matchAll(re)) {
        const first=(m[1]||'').split(',')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(first)) SELF.add(first);
      }
    }
  }
}
const selfAlt=[...SELF].map(x=>x.replace(/\$/g,'\\$')).join('|');
const CALL_RE=new RegExp('(?<![.\\w$])(' + selfAlt + ')\\.(\\w+)\\s*\\(','g');

let bad=0, checked=0;
for (const f of files) {
  const src=readFileSync(f,'utf8');
  const called=new Set([...src.matchAll(CALL_RE)].map(m=>m[2]));
  for (const c of called) {
    checked++;
    if (!defined.has(c)) {
      console.log(`  ❌ ${rel(f)}: 调用了 this.${c}() 但没定义`);
      bad++;
    }
  }
}
console.log(`  (扫了 ${files.length} 个文件 / ${defined.size} 个方法名 / ${checked} 处调用)`);
console.log(bad?`\n未定义方法调用: ${bad} 处`:'✅ 所有 this.xxx() 调用都有定义');
process.exit(bad?1:0);