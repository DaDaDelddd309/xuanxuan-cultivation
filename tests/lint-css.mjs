import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// CSS 同属性重复定义 → 后者静默覆盖前者,改的人看不到自己改的被吃掉。
// V0.93 踩过:.xx-sc-x 有两份,新样式写了不生效。
//
// 注意:同名选择器出现多次本身是正常的(CSS 渐进增强),
// 只有「同一属性被定义两次」才是问题。组合选择器(.a .xx-sk)不参与判定,
// 因为它们作用范围不同,不算冲突。
import { readFileSync, readdirSync } from 'fs';
const R=__ROOT__+'/css';
let bad=0;
// 0) 注释必须闭合 —— V0.95 踩过:插入时漏了 */,后面 3000 多字符
//    (含 .xx-skills.on)全被当成注释,回合制技能栏点不到,
//    而 node --check 和所有语法检查都通过。
for (const f of readdirSync(R).filter(x=>x.endsWith('.css'))) {
  const src=readFileSync(R+'/'+f,'utf8');
  let inC=false;
  for (let i=0;i<src.length-1;i++) {
    if (!inC && src[i]==='/' && src[i+1]==='*') { inC=true; i++; continue; }
    if (inC && src[i]==='*' && src[i+1]==='/') { inC=false; i++; continue; }
  }
  if (inC) {
    const at=src.lastIndexOf('/*');
    console.log(`  ❌ ${f}: 有 /* 没有配对的 */(从第 ${src.slice(0,at).split('\\n').length} 行开始)`);
    console.log(`     ${src.slice(at,at+60).replace(/\\n/g,' ')}`);
    bad++;
  }
}
for (const f of readdirSync(R).filter(x=>x.endsWith('.css'))) {
  const src=readFileSync(R+'/'+f,'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  // 只取顶层规则(跳过 @media / @keyframes 内部)
  const top=src.replace(/@(media|keyframes|supports)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,'');
  const defs={};   // 类名 → 属性名 → 次数
  const re=/(^|\})\s*([^{}@]+?)\s*\{([^}]*)\}/g;
  let m;
  while ((m=re.exec(top))) {
    const sel=m[2].trim();
    // 只看单一类选择器,组合选择器不算
    if (!/^\.[a-zA-Z0-9_-]+$/.test(sel)) continue;
    const cls=sel.slice(1);
    defs[cls]=defs[cls]||{};
    for (const d of m[3].split(';')) {
      const p=d.split(':')[0]?.trim();
      if (!p || p.startsWith('--')) continue;      // CSS 变量重复是允许的
      defs[cls][p]=(defs[cls][p]||0)+1;
    }
  }
  for (const [cls,props] of Object.entries(defs)) {
    const dup=Object.entries(props).filter(([,n])=>n>1).map(([p,n])=>`${p}×${n}`);
    if (dup.length) {
      console.log(`  ❌ ${f}: .${cls} 的属性重复定义 → ${dup.join(', ')}`);
      bad++;
    }
  }
  // 同一段里同名选择器定义多次(哪怕属性不同)也报 —— 分散在文件头尾最容易看漏
  const blocks={};
  // 只看「纯类选择器」(.xx-sk)。带后代/修饰的(.xx-sk sup、.xx-sk span)不算重复定义。
  const re2=/(^|\})\s*\.([a-zA-Z0-9_-]+)\s*\{/g;
  let mm;
  while ((mm=re2.exec(top))) blocks[mm[2]]=(blocks[mm[2]]||0)+1;
  for (const [cls,n] of Object.entries(blocks)) {
    if (n>1) { console.log(`  ❌ ${f}: .${cls} 出现 ${n} 次(定义分散,容易看漏)`); bad++; }
  }
}
console.log(bad?`\nCSS 同属性重复: ${bad} 处`:'✅ 无 CSS 同属性重复定义');
process.exit(bad?1:0);
