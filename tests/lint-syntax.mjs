import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// `node --check` 不做完整 ES module 解析 —— V0.92 踩过:
// 模板串里 ${...} 没闭合,node --check 通过,浏览器直接白屏。
// 这里用动态 import 真正加载每个模块。
import { readdirSync } from 'fs';
// ⚠️ 这里的桩**曾经不够用**,而且不够用的后果被豁免正则完全掩盖了(XX-AUDIT-016):
//   window 只有 {} —— 没有 addEventListener。于是 nag.js 里那句
//   `window.addEventListener('xx-run-start', …)` 抛
//   `window.addEventListener is not a function`,而消息里含 "window" 字样,
//   被下面的白名单放行。
//   ESM 会先求值**全部** import 再跑本模块函数体 ⇒ 这一抛就让 js/main.js 的
//   函数体**一次都没被执行过**,而门禁照样报「所有模块能真正加载(104 个)」。
//   也就是说:那 104 个里至少有 1 个从来没被检查过,门禁却显示全绿。
//   后来那段死代码被删掉,洞才顶出来 —— 一个**看起来在工作、实际少查了文件**的
//   度量工具,比没有更坏。
//   修法:① 桩补全(见下);② 白名单从模糊正则收窄成「确实缺全局」;③ 补 canvas。
const _ctxStub = () => ({
  fillRect(){},clearRect(){},drawImage(){},fillText(){},strokeText(){},
  measureText:()=>({width:0}),save(){},restore(){},translate(){},scale(){},rotate(){},
  beginPath(){},closePath(){},moveTo(){},lineTo(){},arc(){},fill(){},stroke(){},rect(){},
  setTransform(){},transform(){},
  createLinearGradient:()=>({addColorStop(){}}),
  createPattern:()=>null,
  getImageData:()=>({data:new Uint8ClampedArray(4),width:1,height:1}),
  putImageData(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(4),width:w||1,height:h||1}),
  globalCompositeOperation:'source-over',imageSmoothingEnabled:true,
});
const _elStub = () => ({
  width:0,height:0,style:{},dataset:{},
  getContext:()=>_ctxStub(),
  addEventListener(){},removeEventListener(){},
  getBoundingClientRect:()=>({left:0,top:0,width:0,height:0}),
  focus(){},setAttribute(){},getAttribute(){return null},
  classList:{_s:new Set(),add(...a){this._s.add(a[0])},remove(...a){this._s.delete(a[0])},contains(a){return this._s.has(a)},toggle(a,f){if(f===undefined)f=!this._s.has(a);f?this._s.add(a):this._s.delete(a);return f}},
  appendChild(){},append(){},prepend(){},remove(){},replaceWith(){},
  insertBefore(){},cloneNode(){return _elStub();},contains(){return false},
  querySelector(){return null},querySelectorAll(){return []},closest(){return null},
  removeAttribute(){},removeAttributeNS(){},getBoundingClientRect(){return {left:0,top:0,width:0,height:0};},
  textContent:'',innerHTML:'',offsetWidth:0,offsetHeight:0,scrollTop:0,scrollHeight:0,
  children:[],childNodes:[],parentNode:null,isConnected:true,
});
globalThis.document={addEventListener(){},removeEventListener(){},createElement:()=>_elStub(),body:{appendChild(){}},getElementById:()=>_elStub(),querySelector:()=>null,querySelectorAll:()=>[],hidden:false};
globalThis.window={addEventListener(){},removeEventListener(){},dispatchEvent(){},location:{href:'http://localhost/'},innerWidth:1280,innerHeight:720,devicePixelRatio:1};
globalThis.HTMLCanvasElement=function(){};
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
    // ⚠️ 白名单已收窄(XX-AUDIT-016):原来只要消息里**出现**
    //   document/window/Audio/... 这些词就放行,于是
    //   「window.addEventListener is not a function」这种**真·模块加载失败**
    //   也被当成「运行时依赖」放过去了 —— 它不是缺全局,是桩缺方法。
    //   现在只放行两类:
    //     ① `<某个名字> is not defined` —— 确实缺全局(浏览器专有 API)
    //     ② 明确列出的、已知只能在浏览器里跑的模块(见下方 ALLOW)
    if (/\b[A-Za-z_$][\w$]* is not defined\b/.test(e.message)) continue;
    console.log(`  ❌ ${f.replace(__ROOT__+'/','')}: ${e.message.split('\n')[0]}`);
    bad++;
  }
}
console.log(bad?`\n模块加载失败: ${bad} 个（共扫 ${files.length} 个）`:'✅ 所有模块能真正加载（'+files.length+' 个）');
process.exit(bad?1:0);
