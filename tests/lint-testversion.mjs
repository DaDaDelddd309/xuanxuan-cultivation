// 测试里写死版本号 → 每次升版都要改测试,漏改就假失败(V0.86/87/88/89 各中一次)
import { readdirSync, readFileSync } from 'fs';
const D='/workspace/probe/rouge-offline/tests';
let bad=0;
for (const f of readdirSync(D).filter(x=>x.endsWith('.py')||x.endsWith('.mjs'))) {
  readFileSync(D+'/'+f,'utf8').split('\n').forEach((l,i)=>{
    // 只看真正的断言:含 ok(/assert(/test(/t( 的行
    if (!/\b(ok\(|assert|test\(|\bt\()/.test(l)) return;
    // 排除动态比对(m.match)与 lint 脚本自身
    if (/match\(/.test(l) || /_\w+/.test(l)) return;
    if (/V0\.\d\d/.test(l)) {
      console.log(`  ❌ ${f}:${i+1} 写死了版本号: ${l.trim().slice(0,70)}`);
      bad++;
    }
  });
}
console.log(bad?`\n写死版本号: ${bad} 处`:'✅ 测试没有写死版本号');
process.exit(bad?1:0);
