#!/usr/bin/env node
// 版本清单生成器（工单 XX-PROBE-001）
//
// 产物：version.json —— 版本 + 改了哪些文件 + 文件数 + 校验和
//
// 为什么需要它:
//   这轮「全站灰色」查了两轮才找到真因，其中一大半时间花在
//   「到底是缓存问题还是真 bug」上 —— 因为线上跑的是哪一版、
//   哪些文件是新的，**页面自己知道，但没人告诉它、也没人去看**。
//
//   把这些做成一个探针能读的文件，排查就从「猜」变成「查」。
//
// 用法：node tests/make-manifest.mjs            # 读 git 算出清单
//      node tests/make-manifest.mjs --write    # 写进 version.json
//      node tests/make-manifest.mjs --base <sha>  # 对比某个历史版本
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠️ `-c core.quotepath=false` **不能省**（XX-AUDIT-040 的 CI 实战教训）：
// git 默认 `core.quotepath=true`，会把非 ASCII 路径输出成带引号的八进制转义：
//   "docs/proposals/world-map-20261010/\345\244\247\344\275\225\345\234\260.md"
// 那串东西过不了下面的扩展名正则 → **被静默剔除**。
// 实测:quotepath=true 选中 176 条,false 选中 180 条,差的正是 4 个中文名文件。
//
// 而更糟的是**它会静默地全绿**:生成器和门禁在 quotepath=true 的机器上会一起少这 4 个,
// 逐条比对「一致」,没人看得见清单少了东西。
// 仓库里的 `core.quotepath` 是**每台机器各自的本地配置**,不是仓库的一部分 ——
// 所以它绝不能成为产物的一部分。
// 这也是本条工单同源的病:把「依赖运行环境」换成了「依赖 git 配置」,病没治好,只是挪了地方。
const git = (...a) => execSync(`git -c core.quotepath=false ${a.join(' ')}`, { cwd: ROOT, encoding: 'utf8' }).trim();

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;

// —— 版本 ——
const sw = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
const V = (sw.match(/const V\s*=\s*'([^']+)'/) || [])[1] || 'unknown';
const BUILD = (sw.match(/const BUILD\s*=\s*'([^']+)'/) || [])[1] || '';

// —— 文件清单 + 校验和（sha256 前 12 位，够用且短）——
//
// ⚠️ 工单 XX-AUDIT-039:原来这里用 walk('.') 遍历**工作目录**。
// 后果是**同一份代码在两台机器上会生成出两个不同的清单** ——
// 谁的工作区里有未跟踪文件,谁的清单就多几行。
// 实测(2026-10-11 合并 Z8 装备页时撞上):Z8 那份 183 条,我这份 179 条,
// 分歧的 4 个全是「Z8 本地有、git 里从来没有」的文件:
//
//   DEPLOY-REQUEST.md / DEV-SYNC.md / MERGE-GUIDE.md   ← 未跟踪
//   assets/portrait/req-momocha.json                   ← fef5b95 已删,本地残留
//
// **清单存在的全部意义就是「线上跑的是哪一版」**,所以它必须能从仓库内容
// **唯一确定**。一份取决于运行环境的清单,在排查时会把人带偏 ——
// 而它恰恰是用来排查的。
//
// 判据:**同一 commit,在任何机器上生成的清单必须逐字节相同。**
//
// 所以改成 `git ls-files --cached`(= 跟踪 + 已暂存):
//   · 跟踪 → 玩家/CI 拿到的是仓库里的东西,未跟踪文件不在其中
//   · 已暂存 → 合并中途生成清单时新文件已 `git add` 但还没 commit,
//     此时按 HEAD 取会漏掉它们(本次合并就是这个场景)
//
// 顺带修正:旧的 walk 会跳过「点开头」的文件,于是 `tests/.hardcoded-baseline.json`
// (lint-tokens.mjs 真正在用的 353 条基线,已跟踪)从来没进过清单。
// 跟踪的点开头文件是内容,应当计入。
const files = git('ls-files', '--cached')
  .split('\n').filter(Boolean)
  .filter(f => !f.split('/').includes('node_modules'))
  .filter(f => /\.(js|css|html|json|webmanifest|md)$/.test(f) || /^icons\//.test(f))
  .filter(f => f !== 'version.json')
  .sort();

const manifest = {};
const missing = [];
for (const f of files) {
  try {
    manifest[f] = createHash('sha256').update(readFileSync(resolve(ROOT, f))).digest('hex').slice(0, 12);
  } catch (e) {
    // ⚠️ 不再**静默**跳过:被 git 跟踪却在工作区读不到的文件,
    // 说明工作区和索引已经不一致,清单会悄悄变短 —— 比报错更坏。
    // 收集起来在下面一次性报出来,但不改变退出语义(不打断在途工作)。
    missing.push(f);
  }
}
if (missing.length) {
  console.error(`  ⚠️ 有 ${missing.length} 个文件被 git 跟踪但工作区读不到,已从清单剔除:`);
  for (const f of missing.slice(0, 10)) console.error(`     ${f}`);
  if (missing.length > 10) console.error(`     …还有 ${missing.length - 10} 个`);
}

const out = {
  version: V,
  build: BUILD,
  count: Object.keys(manifest).length,
  // 关键：探针只比对 files 就能知道「我是不是旧的」
  files: manifest,
  ...(BASE ? { base: BASE, changed: changedSince(BASE) } : {}),
};

function changedSince(base) {
  try {
    const raw = git('diff', '--name-only', `${base}`, 'HEAD');
    return raw ? raw.split('\n').filter(Boolean) : [];
  } catch { return []; }
}

const json = JSON.stringify(out, null, 2);
if (WRITE) {
  writeFileSync(resolve(ROOT, 'version.json'), json);
  console.log(`✅ version.json 已写：${out.version} · ${out.count} 个文件`);
} else {
  console.log(json);
}

// ⚠️ 未跟踪文件陷阱(2026-10-13 实踩,CI 亲自抓出来的)
//
// 上面的 `git ls-files --cached` 只看**跟踪 + 已暂存**。于是这个顺序会静默出事:
//
//     ① 写好新文件(此时是 `??` 未跟踪)
//     ② npm run manifest:write      ← 新文件不在清单里,而且**一声不吭**
//     ③ git add + commit             ← 现在它们被跟踪了
//     ④ 推到 CI → lint-version 红:「清单缺了 3 个」,清单=184 / 生成器=187
//
// 本轮就是这样丢的:docs/AUDIT-R3-VERIFY.md、tests/dead-member-baseline.json、
// tests/dead-member-triage.md 三个文件在②里还没被跟踪。
//
// 「同一 commit 在任何机器上生成同一份清单」这个判据本身是对的(见上面 XX-AUDIT-039),
// 错的不是枚举方式,是**没告诉人正确的调用顺序**。所以在写完清单之后提醒一次:
// 把「会被收进本次提交、却因为还没 git add 而漏掉」的文件点名报出来。
//
// 这不改退出码 —— 拦住的是「以为写好了」,不是「写坏了」。
if (WRITE) {
  const INCLUDE = /\.(js|css|html|json|webmanifest|md)$/;
  let untracked = [];
  try {
    untracked = git('ls-files', '--others', '--exclude-standard')
      .split('\n').filter(Boolean)
      .filter(f => !f.split('/').includes('node_modules'))
      .filter(f => f !== 'version.json')
      .filter(f => INCLUDE.test(f) || /^icons\//.test(f));
  } catch { /* 不是 git 仓库 / 老版本 git:跳过提醒,不影响主流程 */ }
  if (untracked.length) {
    console.log('');
    console.log(`  ⚠️ 有 ${untracked.length} 个符合清单口径的文件**还没被 git 跟踪**,这次没进 version.json:`);
    for (const f of untracked.slice(0, 10)) console.log(`     ${f}`);
    if (untracked.length > 10) console.log(`     …还有 ${untracked.length - 10} 个`);
    console.log('     它们一旦被提交,CI 的 lint-version 就会判「清单已过期」。');
    console.log('     正确顺序:git add → 再跑一次 npm run manifest:write → commit。');
  }
}
