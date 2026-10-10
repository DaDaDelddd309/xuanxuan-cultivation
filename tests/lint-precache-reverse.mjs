import {fileURLToPath as _fu} from 'url';import {dirname as _dn,resolve as _rv} from 'path';
const __ROOT__=_rv(_dn(_fu(import.meta.url)),'..');
// 预缓存**反向**核对:磁盘上有、sw.js 清单里没有 → 离线取不到 → 白屏
//
// 【为什么要有这条】(工单 XX-AUDIT-014 · 2026-10-11 桌面侧)
//
//   `lint-precache.mjs` 只查**一个方向**:清单里有、磁盘上没有。
//   另一个方向(磁盘有、清单没有)原先**只存在于 `.github/workflows/ci.yml` 的
//   一段内联 node -e 里**,于是:
//     · 本地 `npm run check` 永远看不到它 —— 明明有 bug 也是全绿;
//     · 它在 CI 上已经连续红了三个提交(6b89551 / 0475e80 / 4dad804),
//       红的原因是 `js/xiuxian/world/{network,types}.js` 漏进清单,
//       而没有任何人在本地被告知过。
//
//   「检查存在,但只存在于一个大多数人跑不到的地方」——
//   这正是 XX-AUDIT-014 原话「浏览器测试不在任何自动执行路径上」的同一个病,
//   只不过这次是反过来的:检查在 CI 上,但不在本地路径上。
//
//   所以这条搬进 `npm run lint`,并让 ci.yml 调同一个文件,消除重复实现。
//
// 【为什么要双向都查】
//   清单里有、磁盘没有 → `addAll` 整个失败 → SW 不注册(旧条目的那份也会受影响)
//   磁盘有、清单没有 → 该模块离线时 fetch 失败 → import 链断 → 白屏
//   两条都是 P0,方向不同,都要查。
//
// 【判据的一处宽严说明】
//   本条按「`js/` 下所有 .js 都要在清单里」一刀切,比"实际会被 fetch"更严。
//   阶段 0 落地但尚未接线的模块(运行时消费者为 0)也会被要求进清单 ——
//   这是**故意**的:XX-WORLD-005 一接线它们立刻变成会被 fetch,
//   到那时再补就晚了,而漏补的后果是离线白屏。
import { readFileSync, readdirSync } from 'fs';
import { stripComments } from './lib-swlist.mjs';

const ROOT = __ROOT__ + '';
const swRaw = readFileSync(ROOT + '/sw.js', 'utf8');

// 从「去注释后的块」里取条目 —— 理由见 lib-swlist.mjs 顶部:
// 直接扫全文会把注释里提到的路径当成清单项,报出假红。
const listed = new Set(
  [...swRaw.matchAll(/const\s+\w+\s*=\s*\[([\s\S]*?)\]/g)]
    .flatMap(m => [...stripComments(m[1]).matchAll(/'([^']+)'/g)].map(x => x[1].replace(/^\.\//, '')))
);

const files = [];
(function walk(d) {
  for (const e of readdirSync(ROOT + '/' + d, { withFileTypes: true })) {
    const p = d + '/' + e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})('js');

const missing = files.filter(f => !listed.has(f) && !listed.has(f.replace(/^\//, '')));

if (missing.length === 0) {
  console.log(`  ✅ 预缓存反向核对通过:${files.length} 个 js/ 模块全在 sw.js 清单里`);
} else {
  console.log(`  ❌ 磁盘有、预缓存清单没有(离线会白屏):${missing.length} 个`);
  missing.forEach(f => console.log(`     ${f}`));
  process.exit(1);
}
