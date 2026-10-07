// 预缓存清单重复 → 每次 addAll 白下载一遍
// 清单里有文件不存在 → 整个 install 失败,SW 不注册
import { readFileSync, existsSync } from 'fs';
const ROOT='/workspace/probe/rouge-offline';
const s=readFileSync(ROOT+'/sw.js','utf8');
const blocks=[...s.matchAll(/const\s+\w+\s*=\s*\[([\s\S]*?)\]/g)].map(m=>m[1]);
const per=blocks.map(b=>[...b.matchAll(/'([^']+)'/g)].map(m=>m[1].replace(/^\.\//,'')));
let bad=0;
// 1) 块内重复
per.forEach((items,i)=>{
  const d=[...new Set(items.filter(x=>items.filter(y=>y===x).length>1))];
  if(d.length){console.log(`  ❌ 第 ${i+1} 个清单块内重复: ${d.join(', ')}`);bad++;}
});
// 2) 跨块重复(可接受,但报出来)
const seen=new Set();
per.forEach(items=>items.forEach(x=>{
  if(seen.has(x)&&x!=='index.html')console.log(`  ⚠️  跨块重复: ${x}`);
  seen.add(x);
}));
// 3) 文件不存在
per.forEach(items=>items.forEach(x=>{
  if(x&&!x.startsWith('http')&&!existsSync(ROOT+'/'+x)){console.log(`  ❌ 清单里没有这个文件: ${x}`);bad++;}
}));
console.log(bad?`\n预缓存问题: ${bad} 项`:'✅ 预缓存清单干净');
process.exit(bad?1:0);
