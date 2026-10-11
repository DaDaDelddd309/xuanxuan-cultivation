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
const git = (...a) => execSync(`git ${a.join(' ')}`, { cwd: ROOT, encoding: 'utf8' }).trim();

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
