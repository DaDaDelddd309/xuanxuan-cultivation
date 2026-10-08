// ===== 色板卡口 lint-palette.mjs =====
// V0.99 · 工单 XX-PAL-004
//
// 为什么要有这个:
//   历史上出现过 157 支色、98 支只出现一次。根因不是没规范，
//   是**没有强制**。这次收敛完如果不卡住，三个月后又会长回去。
//
// 判定规则:
//   1. 扫描所有 .css / .js / .html
//   2. 提取 #rrggbb（排除 3/6/8 位标准写法之外的畸形）
//   3. 命中白名单（令牌定义、语义色、合法插画色）→ 放行
//   4. 新色不在白名单 → 报告
//
// 模式:
//   默认 warn  —— 只报告，退出码 0（防止误伤阻断发布）
//   --strict  —— 报错，退出码 1（CI 用）
//
// 用法:
//   node tests/lint-palette.mjs            # warn 模式
//   node tests/lint-palette.mjs --strict   # 阻断模式

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __ROOT__ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

// —— 合法色板：令牌里定义的全部值 + 语义例外 ——
const ALLOWED = new Set([
  // 墨阶
  '#080706', '#131110', '#1c1917', '#2a2522',
  // 纸阶
  '#ece5d3', '#c9c0ab', '#8a8378',
  // 金
  '#c9a227', '#8a6f1c',
  // 朱砂 / 青玉
  '#8c3a2e', '#5a7a6a',
  // 语义例外
  '#7a2b24', '#3d6b7a', '#4a7a4e', '#a03a2e',
  // 纯黑纯白（画布/清屏等少数正当用途）
  '#000000', '#ffffff',
]);

// —— 已知长尾豁免：一次性插画色，暂不改但记录在案 ——
const EXEMPT = new Set([
  // 这些来自 js/pix/*.js 的像素画与 sprite，逐个改代价大收益低
]);

function* walk(dir, depth = 0) {
  if (depth > 4) return;
  let items;
  try { items = readdirSync(dir); } catch { return; }
  for (const it of items) {
    if (it === 'node_modules' || it === '.git' || it === 'assets') continue;
    const p = resolve(dir, it);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p, depth + 1);
    else if (/\.(css|js|html|mjs)$/.test(it)) yield p;
  }
}

const files = [...walk(__ROOT__)].filter(f => !f.includes('/tests/lint-palette'));
const hits = new Map();   // color -> [{file, line}]

for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  src.split('\n').forEach((line, i) => {
    // 去掉注释里的颜色（注释里提到色值是文档，不是用法）
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    const re = /#([0-9a-fA-F]{6})\b/g;
    let m;
    while ((m = re.exec(code))) {
      const c = '#' + m[1].toLowerCase();
      if (!hits.has(c)) hits.set(c, []);
      hits.get(c).push({ file: relative(__ROOT__, f), line: i + 1 });
    }
  });
}

const bad = [];
for (const [c, locs] of hits) {
  if (ALLOWED.has(c) || EXEMPT.has(c)) continue;
  bad.push({ c, n: locs.length, where: locs.slice(0, 3) });
}
bad.sort((a, b) => b.n - a.n);

console.log(`\n扫描 ${files.length} 个文件，找到 ${hits.size} 支色`);
console.log(`合法色板: ${ALLOWED.size} 支（17 主干 + 2 正当用途）`);

if (!bad.length) {
  console.log('✅ 全部色值都在色板内');
  process.exit(0);
}

console.log(`\n⚠️  色板外色值 ${bad.length} 支，共 ${bad.reduce((s, b) => s + b.n, 0)} 处:`);
for (const b of bad) {
  console.log(`  ${b.c}  ×${b.n}`);
  b.where.forEach(w => console.log(`      ${w.file}:${w.line}`));
}
console.log(`\n  处置:加进 css/palette.css 的 :root，或若为一次性插画色加进 EXEMPT`);
console.log(`  替换对照表见 palette.css 的 [data-palette-map]`);

if (STRICT) {
  console.log(`\n❌ strict 模式: ${bad.length} 支色板外色值`);
  process.exit(1);
} else {
  console.log(`\n(warn 模式,退出码 0。CI 用 --strict)`);
  process.exit(0);
}