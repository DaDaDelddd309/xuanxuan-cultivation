// tests/lint-testwiring.mjs —— 门禁写了却没接线 = 门禁是死的
// 运行: node tests/lint-testwiring.mjs
//
// 为什么要有这道门禁(2026-10-10 实测):
//   一次 `npm run check` 全绿,我据此对外宣布「合并后绿」。结果一查接线,
//   **七个门禁文件根本不在任何脚本里**,一次都没跑过:
//     lint-deadexport / lint-deadwire / test-mine / test-runcfg /
//     test-seed / test-world-compat / test-worldgen
//   合计 117 条断言 + 2 道 report-only lint,全是死的。
//
//   这跟本轮清掉的「导出了但生产引用为 0 的代码 = 没写」是同一个病:
//   **存在 ≠ 生效**。模块身份分裂那次也是 —— COLLATZ 31 项门禁全绿,
//   但真游戏里 `ui.js` 和 `main.js` 加载的是**两份 spawner 模块**,
//   曲线恒等于 1。两边的单测都绿,因为绿的是**两份实例**,不是玩家跑的那份。
//
//   绿色的 check 最危险的地方在于它**主动提供保证**。一个没接线的门禁
//   不产生红条、不产生警告,check 照样 EXIT=0 —— 它不是漏报,是根本没被问。
//
// 判据:tests/ 下每个 .mjs 都必须出现在 package.json 的某个 script 里,
// 反过来 script 里引用的文件也必须真的存在。两个方向都要查:
//   正向漏(死门禁)—— 这道门禁存在的理由
//   反向漏(悬空引用)—— 那会让 `node tests/x.mjs` 直接 module not found,
//                  整条 && 链在中途断掉,**后面的门禁一个都跑不到**
//                  —— 那是一种更隐蔽的"全绿":链断了,前面几关是绿的。
//
// ⚠️ 公共库不要列进来:它们是被别的门禁 import 的,不自己跑。
//   这里显式列出而不是按 `lib-` 前缀猜 —— 新增公共库时应当有人 consciously
//   判断一次,而不是被命名约定自动放行。自动放行 = 写错名字就悄悄溜过去。

import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

/** 不是门禁的公共库(被别的文件 import,不自己跑)。新增请写清理由。 */
const NOT_A_GATE = new Set([
  'tests/harness.mjs',     // DOM/引擎测试台,被 test-*.mjs import
  'tests/lib-swlist.mjs',  // 剥注释工具,给 lint-precache 用
  'tests/lib-uimod.mjs',   // 剥注释 + 模块加载工具,给多个门禁用
]);

const pkg = JSON.parse(readFileSync(ROOT + '/package.json', 'utf8'));
const scripts = pkg.scripts || {};

// 只认 scripts 字段 —— 别的字段里出现 tests/ 路径不算接线
const referenced = new Set();
for (const cmd of Object.values(scripts)) {
  for (const m of String(cmd).matchAll(/tests\/[A-Za-z0-9._-]+\.mjs/g)) referenced.add(m[0]);
}

let bad = 0;

// 1) 正向:磁盘上有、任何脚本都没引用 —— 写了但永远不会跑
const onDisk = readdirSync(ROOT + '/tests').filter((f) => f.endsWith('.mjs')).sort();
let wired = 0;
for (const f of onDisk) {
  const rel = 'tests/' + f;
  if (NOT_A_GATE.has(rel)) continue;
  if (!referenced.has(rel)) {
    console.log(`  ❌ 门禁没接线(文件在,但没有任何脚本跑它): ${rel}`);
    bad++;
  } else wired++;
}

// 2) 反向:脚本引用了、磁盘上没有 —— && 链会在这里断,后面全跑不到
for (const rel of [...referenced].sort()) {
  if (!existsSync(ROOT + '/' + rel)) {
    console.log(`  ❌ 脚本引用了不存在的文件(整条 && 链会断在这里): ${rel}`);
    bad++;
  }
}

// 3) 本门禁自己也得被接上 —— 否则它就是第 N+1 个死门禁,
//    而这正是它本该防的那件事。
if (!referenced.has('tests/lint-testwiring.mjs')) {
  console.log('  ❌ 本门禁自己没接线 —— 那它就是下一个死门禁');
  bad++;
}

// 4) 反向自查:NOT_A_GATE 里的文件必须真的存在,否则这份清单自己在腐烂
for (const rel of [...NOT_A_GATE].sort()) {
  if (!existsSync(ROOT + '/' + rel)) {
    console.log(`  ⚠️  NOT_A_GATE 列了不存在的文件(清单该清理了): ${rel}`);
  }
}

if (bad) {
  console.log(`\n门禁接线: ${bad} 处问题 —— 这些检查一次都没跑过`);
  process.exit(1);
}
console.log(`  ✅ ${wired} 个门禁全部接线(${NOT_A_GATE.size} 个公共库按约定排除)`);
