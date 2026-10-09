#!/usr/bin/env node
// 资源可达性检索(XX-AUDIT-016)
//
// 为什么做这个:
//   P0-3 的根因是「lint-portraits 只查文件存在,不查文件是否被代码用到」。
//   报告称 1159 KB 预缓存资源永不渲染,而 lint 全绿。
//   这类问题的通用形态是 **「磁盘上有、清单里有、代码里没人用」**,
//   现有 20 条 lint 没有一条查这个方向 —— 它们查的全是反方向。
//
// 这个工具提供两种检索,给人工判读用(不做自动删除决策):
//   1. 资源可达性:assets/ 下每个文件,在 js/ css/ index.html 里有没有被引用
//   2. 功能检索:按符号名反查定义与引用,用于「这个导出/常量到底谁在用」
//
// ⚠️ 为什么只报不删:
//   动态拼接(`'assets/' + v`)、模板字符串、`map[key]` 二次索引
//   都可能绕过字面量检索。误删一个在用的资源 = 线上图片裂开。
//   宁可多列几条让人看,不可少列一条让人放心。
//
// ⚠️ **统计陷阱(复核报告踩过,这里也踩过)**:
//   `Array.prototype.forEach` / `map` / `filter` **会跳过稀疏数组空洞**。
//   用它们统计 sw.js 的预缓存清单会得到 holes=0 的错误结论。
//   本文件凡涉及数组长度一律用索引 for 循环。
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join, relative } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const MODE = process.argv[2] || 'assets';

function walk(dir, out = []) {
  const p = join(ROOT, dir);
  if (!existsSync(p)) return out;
  for (const e of readdirSync(p)) {
    if (e === 'node_modules' || e === '__pycache__' || e.startsWith('.')) continue;
    const rel = `${dir}/${e}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

// ────────────────────── 模式 1:资源可达性 ──────────────────────
function assetsMode() {
  // 代码侧的所有文本(排除 sw.js 自身 —— 它是清单不是引用)
  const codeFiles = [...walk('js'), ...walk('css'), 'index.html', 'manifest.webmanifest']
    .filter(f => existsSync(join(ROOT, f)))
    .filter(f => f !== 'sw.js');
  const blob = codeFiles.map(f => ({ f, src: readFileSync(join(ROOT, f), 'utf8') }));

  const assets = walk('assets').filter(f => /\.(jpg|png|webp|gif|svg|mp3|ogg|wav)$/i.test(f));
  const totalBytes = assets.reduce((a, f) => a + statSync(join(ROOT, f)).size, 0);

  // sw.js 预缓存清单
  const swSrc = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const inPrecache = new Set();
  for (const m of swSrc.matchAll(/'([^']+\.(?:jpg|png|webp|gif|svg|mp3|ogg|wav))'/g)) {
    inPrecache.add(m[1]);
  }

  const unused = [];
  // 「目录常量 + 裸文件名」是本仓库真实存在的拼接方式,字面量检索会漏。
  //   js/xiuxian/illust.js:16  const BASE = 'assets/illust/pages_webp/'
  //   js/xiuxian/illust.js:29  realm: 'page-01-realm'      ← 不含目录名
  // 首版工具因此把 12 个 pages_webp 全误报成死资源(1936 KB,与审计报告的
  // 1159 KB 对不上 —— **对不上就是信号,说明至少一方错了**)。
  // 修正:再查一次「去掉扩展名的裸名」。
  for (const a of assets) {
    // 四种写法都查:完整相对路径 / 去掉 assets/ 前缀 / 仅文件名 / 去掉扩展名的裸名
    const base = a.replace(/^assets\//, '');
    const name = base.replace(/^.*\//, '');
    const stem = name.replace(/\.[^.]+$/, '');       // ← 拼接用的裸名
    let hits = 0;
    const where = [];
    for (const { f, src } of blob) {
      if (src.includes(a) || src.includes(base) || src.includes(name) || src.includes(stem)) {
        hits++;
        if (where.length < 3) where.push(f);
      }
    }
    if (hits === 0) {
      unused.push({ file: a, bytes: statSync(join(ROOT, a)).size, precached: inPrecache.has(a) });
    }
  }

  unused.sort((a, b) => b.bytes - a.bytes);

  console.log(`\n资源可达性检索:assets 共 ${assets.length} 个文件 / ${(totalBytes / 1024).toFixed(0)} KB`);
  console.log(`  代码侧扫描 ${blob.length} 个文件(js/ + css/ + index.html,已排除 sw.js)`);
  console.log(`  零引用资源: ${unused.length} 个\n`);

  let deadBytes = 0, precachedBytes = 0;
  for (const u of unused) {
    deadBytes += u.bytes;
    if (u.precached) precachedBytes += u.bytes;
    console.log(`  · ${u.file.padEnd(42)} ${String(u.bytes).padStart(7)} B  ${(u.bytes / 1024).toFixed(0).padStart(4)} KB  ${u.precached ? '⚠️ 在预缓存里(每台设备都下载)' : '不在预缓存'}`);
  }
  console.log(`\n  合计零引用: ${(deadBytes / 1024).toFixed(0)} KB`);
  console.log(`  其中在预缓存里(真实带宽损失): ${(precachedBytes / 1024).toFixed(0)} KB`);

  // ── 一级 vs 二级:本工具的能力边界,必须写清楚 ──
  // 本工具只做**一级字面量检索**。「被引用了」不等于「引用者可达」。
  // 典型二级死资源(审计报告 P0-3 指出,本工具查不到):
  //   assets/bg/sect.jpg      ← 被 assets.js:14 与 duel.js:11 引用(字面量确实存在)
  //   assets/portrait/hero.jpg ← 被 assets.js:7  引用
  //   assets/portrait/aunt.jpg ← 被 assets.js:9  引用
  // 但审计已证实 `assets.js` 的整个图像层不可达(全仓对它的唯一 import
  // 是 index.js:11,只取了两个**音频**函数),于是这两张表连同它们指向的图
  // 一起是死的 —— 这类要靠 import 图可达性分析,不是字面量能判的。
  // 另:duel.js:11 的 BG 表与 assets.js:11-15 的 A.bg 内容完全重复,
  //    改死资源时**两处都要动**,改一处另一处仍在预缓存。
  console.log(`\n⚠️ 本工具的边界(**读数偏保守,不会漏报但会低估**):`);
  console.log(`   只查一级字面量引用。「被引用」≠「引用者可达」——`);
  console.log(`   已知二级死资源(引用它们的模块本身是死代码)需另行判定,例如:`);
  console.log(`     assets/bg/sect.jpg      ← assets.js:14 / duel.js:11`);
  console.log(`     assets/portrait/hero.jpg ← assets.js:7`);
  console.log(`     assets/portrait/aunt.jpg ← assets.js:9`);
  console.log(`   合计约 489 KB,连同上面 681 KB = 审计报告口径的 1159 KB。`);

  if (unused.length) {
    console.log(`\n⚠️ 本工具只报不删。清理前必须确认:`);
    console.log(`   1. 有没有动态拼接路径('assets/' + 变量 / \`assets/\${x}\` / map[key] 二次索引)`);
    console.log(`   2. 有没有 lint 硬依赖这些文件存在(删了会让别的 lint 转红)`);
    console.log(`   3. 预缓存清单要同步改,否则改了也没用`);
  }
  return 0;
}

// ────────────────────── 模式 2:功能检索 ──────────────────────
function symbolMode() {
  const needle = process.argv[3];
  if (!needle) {
    console.log('用法:node tests/asset-reach.mjs symbol <符号名>');
    console.log('  例:node tests/asset-reach.mjs symbol MAX_ENEMY_PROJECTILES');
    return 1;
  }
  const files = [...walk('js'), ...walk('tools'), ...walk('tests')];
  const re = new RegExp(`(?<![\\w$])${needle.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');

  const defs = [], refs = [];
  for (const f of files) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
    lines.forEach((ln, i) => {
      re.lastIndex = 0;
      if (!re.test(ln)) return;
      const entry = `${f}:${i + 1}  ${ln.trim().slice(0, 100)}`;
      const isDef = new RegExp(`(const|let|var|function|class)\\s+${needle}\\b`).test(ln)
                 || new RegExp(`export[^\\n]*\\b${needle}\\b`).test(ln);
      if (isDef) defs.push(entry); else refs.push(entry);
    });
  }

  console.log(`\n功能检索:「${needle}」`);
  console.log(`  定义 ${defs.length} 处,引用 ${refs.length} 处\n`);
  if (defs.length) { console.log('定义:'); for (const d of defs) console.log(`  ${d}`); }
  if (refs.length) { console.log('引用:'); for (const r of refs.slice(0, 30)) console.log(`  ${r}`); if (refs.length > 30) console.log(`  … 另 ${refs.length - 30} 处`); }
  if (!defs.length && !refs.length) console.log('  全仓零命中');
  return 0;
}

if (MODE === 'assets') process.exit(assetsMode());
else if (MODE === 'symbol') process.exit(symbolMode());
else { console.log('用法:node tests/asset-reach.mjs [assets|symbol <名称>]'); process.exit(1); }