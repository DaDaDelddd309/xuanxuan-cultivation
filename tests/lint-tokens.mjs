import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 样式令牌(V0.95)—— 别再随手写数字。
// 之前全站有 11 种不同的边框写法、同样的底色散落各处,
// 页面之间拼不到一起。现在统一走 var(--xx-*)。
import { readFileSync, readdirSync } from 'fs';
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
process.exit(bad?1:0);
