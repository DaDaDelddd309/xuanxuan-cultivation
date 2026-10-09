#!/usr/bin/env node
// package.json scripts 自洽性检查(XX-AUDIT-010)
//
// 为什么要做这个:
//   `npm run test:rng` 引用了 6 个**从未在 git 历史中存在过**的测试文件
//   (test-rng / test-seed / test-worldgen / test-world-compat / test-mine / test-runcfg)。
//   实跑得到 MODULE_NOT_FOUND,`npm run check:full` 因此永远红。
//
//   根因不是「文件丢了」,而是**没有任何检查校验 package.json 里的
//   script 指向的文件到底存不存在**。于是:
//     · 本地跑 check:full 立刻炸 → 大家就不跑它了
//     · 跑 lint 全绿 → 误以为「测试都通过」
//   这跟历史上 lint-precache「方向搞反」是同一类问题:
//   **门禁声称覆盖的东西,实际没覆盖。**
//
// 检查两件事:
//   1. script 里 `node <file>` 引用的文件必须存在
//   2. 反向:tests/ 下每个 .mjs 都应该被某个 script 引用到(孤儿检测)
//      —— 否则新写的测试不会被跑,等于白写
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join, basename } from 'path';
import { readdirSync } from 'fs';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

let bad = 0;

// ---------- 1. script 引用的文件必须存在 ----------
const referenced = new Set();
console.log('\npackage.json scripts 文件引用检查:');

for (const [name, cmd] of Object.entries(scripts)) {
  if (!cmd || typeof cmd !== 'string') continue;
  // 抓 node <path> 形式(允许 node --flag <path>)
  for (const m of cmd.matchAll(/\bnode\s+(?:-{1,2}[\w-]+\s+)*([\w./-]+\.(?:mjs|js|cjs|py|sh))\b/g)) {
    const rel = m[1];
    referenced.add(rel);
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      console.log(`  ❌ scripts.${name} → ${rel} 不存在`);
      bad++;
    }
  }
  // 抓 bash/sh <path> 形式
  for (const m of cmd.matchAll(/\b(?:bash|sh)\s+([\w./-]+\.(?:sh|py))\b/g)) {
    const rel = m[1];
    referenced.add(rel);
    if (!existsSync(join(ROOT, rel))) {
      console.log(`  ❌ scripts.${name} → ${rel} 不存在`);
      bad++;
    }
  }
  // 抓 python3 <path> 形式
  for (const m of cmd.matchAll(/\bpython3?\s+([\w./-]+\.py)\b/g)) {
    const rel = m[1];
    referenced.add(rel);
    if (!existsSync(join(ROOT, rel))) {
      console.log(`  ❌ scripts.${name} → ${rel} 不存在`);
      bad++;
    }
  }
}

// ---------- 2. 孤儿检测:tests/ 下没被任何 script 引用的测试 ----------
const testDir = join(ROOT, 'tests');
const orphans = [];
if (existsSync(testDir)) {
  for (const f of readdirSync(testDir)) {
    if (!/\.(mjs|js|py|sh)$/.test(f)) continue;
    const rel = `tests/${f}`;
    // lint-* 由 npm run lint 里的裸 `node tests/lint-x.mjs` 引用,已在 referenced 里
    if (!referenced.has(rel)) orphans.push(rel);
  }
}

console.log(`  scripts 引用文件: ${referenced.size} 个,缺失 ${bad} 个`);
if (orphans.length) {
  console.log(`  ℹ️  未被任何 script 直接引用的测试文件 ${orphans.length} 个:`);
  for (const o of orphans) console.log(`     ${o}`);
  console.log('     (若它们由 run-all.sh 或其他脚本间接调用,属正常)');
}

if (bad === 0) {
  console.log('\n✅ package.json scripts 引用的文件全部存在');
} else {
  console.log(`\n❌ package.json scripts 引用了 ${bad} 个不存在的文件`);
  console.log('   修法二选一:① 补写这些测试 ② 改 package.json 让它只引用真实存在的文件');
  console.log('   ⚠️ 别只是把 check:full 从文档里删掉 —— 那样承诺就真的没了。');
}
process.exit(bad === 0 ? 0 : 1);