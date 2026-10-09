// 称号条件闸门 —— 防「写着条件却永远达不到」
//
// 背景(XX-ARCH-006):8 个称号的授予机制本来是好的(check() → add()),
// 但其中 4 个的条件 flag 从来没人 track —— `streak` / `sword_kill_boss`
// / `nemesis_win` / `refuse_alliance`。页面上明明白白写着获取条件，
// 玩家照做一辈子也拿不到。这类 bug 断言抓不到、单测抓不到，
// 因为代码"看起来"是完整的 —— 只有把条件列出来跟 track 点对一遍才看得见。
//
// 本 lint：check() 里用到的每个 flag，项目里必须至少有一处 titles.track('flag')。
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let fail = 0;
const ok = (n, c, d = '') => {
  if (c) console.log(`  ✓ ${n}`);
  else { fail++; console.log(`  ❌ ${n} ${d}`); }
};

const rel = readFileSync(join(ROOT, 'js/xiuxian/relations.js'), 'utf8');

console.log('\n[1] 称号条件用到的 flag');
// test 数组形如 ['chizi', (f.challenge||0) >= 30 && ...]
const tests = [...rel.matchAll(/\['(\w+)',\s*([^\]]+)\]/g)];
const needed = new Set();
for (const [, id, expr] of tests) {
  for (const m of expr.matchAll(/f\.(\w+)/g)) needed.add(m[1]);
}
ok(`解析出 ${tests.length} 个称号、${needed.size} 个 flag`, tests.length > 0 && needed.size > 0);

// 全项目找 track 点
const allJs = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) allJs.push(p);
  }
})(join(ROOT, 'js'));
const all = allJs.map(f => readFileSync(f, 'utf8')).join('\n');
const tracked = new Set([...all.matchAll(/titles\.track\(\s*['"](\w+)['"]/g)].map(m => m[1]));

console.log('\n[2] 每个条件 flag 都必须有 track 点');
const missing = [];
for (const f of [...needed].sort()) {
  const has = tracked.has(f);
  if (!has) missing.push(f);
  ok(`f.${f} 有 track 点`, has);
}

// 反向：track 了但条件里没有的 flag 是死写入，提示一下
const orphanTrack = [...tracked].filter(t => !needed.has(t)).sort();
if (orphanTrack.length) {
  console.log(`  ℹ track 了但没有任何称号条件用它：${orphanTrack.join(', ')}（无害，但可能是笔误）`);
}

console.log(`\nlint-titles: ${fail ? 'FAIL' : 'PASS'} (${fail ? fail : 'ok'})`);
process.exit(fail ? 1 : 0);