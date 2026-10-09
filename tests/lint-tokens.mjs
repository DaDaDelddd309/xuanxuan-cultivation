import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 样式令牌(V0.95)—— 别再随手写数字。
// 之前全站有 11 种不同的边框写法、同样的底色散落各处,
// 页面之间拼不到一起。现在统一走 var(--xx-*)。
import { readFileSync, readdirSync, existsSync as require$fs_exists } from 'fs';
const require$fs={existsSync:require$fs_exists};
const R=__ROOT__+'/css';
// 允许的例外(确实需要独立表达的)
const ALLOW = [
  'border:0', 'border:none', 'border:0 solid', 'border:7px solid transparent',
  /var\(--xx-/,
];
const TOKENS = ['--xx-line-1','--xx-line-2','--xx-line-gold','--xx-bg-1','--xx-bg-2','--xx-bg-3','--xx-bg-4','--xx-r'];
let bad=0;
for (const f of readdirSync(R).filter(x=>x.endsWith('.css'))) {
  const src=readFileSync(R+'/'+f,'utf8');
  for (const m of src.matchAll(/border(-left|-right|-top|-bottom)?:\s*([^;]+);/g)) {
    const decl=m[0].trim();
    const flat = decl.replace(/\s+/g,' ').replace(/;$/,'');
    if (ALLOW.some(a=>typeof a==='string'?a===flat:a.test(flat))) continue;
    // 非 1px 的描边(进度条填充、占位块)以及特殊形态(虚线)各有用途,放行
    if (/solid rgba\(232,220,196,(0?\.\d+)\)/.test(flat) && !/^border[^:]*:1px/.test(flat)) continue;
    if (/dashed|none|transparent/.test(flat)) continue;
    // 只查最常见的两种:默认线 + 金线。其余留给人工判断。
    if (!/^1px solid rgba\((232,220,196|201,162,39),/.test(flat)) continue;
    console.log(`  ❌ ${f}: ${decl.slice(0,60)} → 应改用 var(--xx-*)`);
    bad++;
  }
}
// 令牌本身必须都在
const css=readFileSync(R+'/xiuxian.css','utf8');
for (const t of TOKENS) {
  if (!css.includes(`${t}:`)) { console.log(`  ❌ 缺少令牌定义: ${t}`); bad++; }
}
console.log(bad?`\n未使用令牌的硬编码: ${bad} 处`:'✅ 边框/底色统一走令牌');

// ===== XX-AUDIT-008 硬编码颜色基线差分 =====
//
// 为什么不是「禁止一切硬编码」:实测 css/*.css 里**已有 355 处**(纯黑遮罩另计)。
// V0.95 那个「50 处收敛到 :root 令牌」只覆盖了边框/底色那几类规则,
// 没覆盖 CSS 文件本体 —— 全禁会一次性炸出 355 条,不可用。
//
// 所以用基线差分:现状存进 tests/.hardcoded-baseline.json,
// 之后只拦**新增**。既有的一条不动,让这个 lint 从第一天就有用。
//
// 排除项:
//   · :root{} 里的令牌定义(那就是定义本身)
//   · 纯黑遮罩 rgba(0,0,0,…) —— V0.94 起是刻意的浮层遮罩
const BASELINE_PATH=__ROOT__+'/tests/.hardcoded-baseline.json';
if (require$fs.existsSync(BASELINE_PATH)) {
  const raw=JSON.parse(readFileSync(BASELINE_PATH,'utf8'));
  // 基线条目形如 `文件:行号:颜色`。
  // ⚠️ **行号不能参与匹配**(XX-AUDIT-008 修订):
  //   原实现把行号写进 key,导致在 CSS 中间插入任何内容都会让后续行号整体位移,
  //   于是几百条既有颜色全被误报成「新增」。
  //   实测踩坑:给 .rt-mouth 加一句 transition,CSS 插入 12 行,
  //   run-all 立刻冒出 150 条红 —— 而实际只新增了 0 个颜色。
  //   行号只是给人看的定位信息,判定「是否新增」应看**这个文件里这个颜色出现过没有**。
  const base=new Set();
  const baseFull=new Set(raw);
  for (const k of raw) {
    // ⚠️ 不能用 lastIndexOf(':'):颜色本身含冒号,
    //   如 `xiuxian.css:103:rgba(232,220,196,.5)` —— 最后那个冒号在 rgba 里面。
    // 正确切法:从左数第二个冒号,前面是 `文件:行号`。
    const first=k.indexOf(':');
    const second=first<0?-1:k.indexOf(':',first+1);
    if (second>0) base.add(k.slice(0,first)+':'+k.slice(second+1));   // `文件:颜色`
  }
  let added=0;
  const seen=new Set();
  for (const f of readdirSync(R).filter(x=>x.endsWith('.css'))) {
    const src=readFileSync(R+'/'+f,'utf8').replace(/:root\s*\{[^}]*\}/gs,'');
    const lines=src.split('\n');
    lines.forEach((ln,i)=>{
      for (const m of ln.matchAll(/(?<![\w-])(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
        const v=m[0];
        if (/^rgba?\(0,\s*0,\s*0/.test(v)) continue;           // 纯黑遮罩
        // 同文件同颜色只判一次,避免重复刷屏
        if (seen.has(f+':'+v)) continue;
        const key=`${f}:${v}`;
        if (!base.has(key)) {
          // 行号仅用于提示定位,不参与判定
          seen.add(f+':'+v);
          console.log(`  ❌ 新增硬编码颜色 ${f}:${i+1}: ${v} → 应走 var(--xx-*)`);
          added++;
        }
      }
    });
  }
  console.log(added?`\n新增硬编码颜色: ${added} 处`:'✅ 无新增硬编码颜色(基线内既有不动)');
  if (added) process.exit(1);
}
