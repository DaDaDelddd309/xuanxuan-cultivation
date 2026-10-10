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

// —— 合法色板 ————————————————————————————
//
// 【2026-10-10 改动】原来是**手工维护的 17 支清单**,和 palette.css 里的令牌
// 各写各的 —— 实测 19 个色值令牌里只有 15 个登记在册,4 个漏了。
// 手工清单必然漂移:加了令牌忘了同步,这里就会误报。
// 现在改成**从 css/palette.css 的 :root 直接推导**,令牌加了自动跟着走。
//
// 另外两类不属于「令牌」但正当:
//   · 语义例外色 —— 朱砂/青玉/警示等,有意偏离主干
//   · 纯黑纯白   —— 画布清屏等少数正当用途
const SEMANTIC = new Set([
  '#7a2b24', '#3d6b7a', '#4a7a4e', '#a03a2e',
  '#000000', '#ffffff',
]);

const TOKEN_COLORS = new Set();
try {
  const css = readFileSync(resolve(__ROOT__, 'css/palette.css'), 'utf8');
  for (const m of css.matchAll(/--xx-[a-z0-9-]+\s*:\s*(#[0-9a-fA-F]{6})/g)) {
    TOKEN_COLORS.add(m[1].toLowerCase());
  }
} catch { /* palette.css 缺失时退化为主干清单 */ }

const ALLOWED = new Set([
  // 墨阶
  '#080706', '#131110', '#1c1917', '#2a2522',
  // 纸阶
  '#ece5d3', '#c9c0ab', '#8a8378',
  // 金
  '#c9a227', '#8a6f1c',
  // 朱砂 / 青玉
  '#8c3a2e', '#5a7a6a',
  // 语义例外 + 正当用途
  ...SEMANTIC,
  // 从 :root 推导出来的全部色值令牌
  ...TOKEN_COLORS,
]);

// —— 已知长尾豁免：一次性插画色，暂不改但记录在案 ——
const EXEMPT = new Set([
  // 这些来自 js/pix/*.js 的像素画与 sprite，逐个改代价大收益低
]);

// —— 按「文件角色」豁免 ————————————————
//
// 为什么需要这一层（2026-10-10 补）：
//   改用 --strict 时会报 135 支色板外色值,其中 64 支来自下面这几个文件 ——
//   而它们**报出来本身就是错的**,属于分类错误:拿尺子量尺子。
//
//   `lint-palette` 的命题是「UI 层的色值应收敛到 CSS 令牌」。
//   但有两个文件的**内容本身**就是色值:
//     · js/pix/palette.js  —— 像素画色板 `PAL` 的定义。全站 12 个 pix 模块都从它取色,
//                             其余 12 个文件硬编码色值数均为 0,说明它们走的是 `PAL.x`。
//                             把定义本身判成违规,等于要求色板不许存在。
//     · css/palette.css    —— CSS 令牌(`:root` 里的 `--xx-*`)的定义,
//                             所有 var(--xx-*) 的来源就是它。
//
//   另有一个开发工具:
//     · probe.html         —— 版本/色板探针页,自包含样式,不出货。
//                             它的**职责就是**写出未登记的色来暴露问题。
//
// 这里按「文件 + 理由」登记,不是按色值开白名单 ——
// 按色值开白名单等于让任何文件都能给自己发通行证,这个 lint 立刻失去意义。
const ROLE_EXEMPT = new Map([
  ['js/pix/palette.js', '像素画色板 PAL 的定义(12 个 pix 模块均从它取色)'],
  ['css/palette.css',   'CSS 令牌 :root 的定义,所有 var(--xx-*) 的来源'],
  ['probe.html',        '版本/色板探针页,自包含样式,不出货;职责就是暴露未登记色'],
]);
// 注意:这里只豁免 palette.js 这**一个**文件。
// 同目录其余 12 个 pix 模块硬编码色值数实测均为 0(全部走 PAL.x),
// 给整个目录开豁免等于用一张没必要的通行证把真违规也放过去 —— 不做。
const ROLE_EXEMPT_DIR = new Map();

// 该文件是否按「角色」豁免；返回豁免理由,不豁免返回 null
function roleExempt(rel) {
  if (ROLE_EXEMPT.has(rel)) return ROLE_EXEMPT.get(rel);
  for (const [dir, why] of ROLE_EXEMPT_DIR) {
    if (rel.startsWith(dir) || rel.includes('/' + dir)) return `${why}(${rel})`;
  }
  return null;
}

// —— 色值「数据字段」豁免 ————————————————————
//
// 比「整文件放行」精确得多:只放过**明确承载色值的字段**,
// 同一个文件里其它位置的硬编码色(比如某个渐变色标)照样会被抓到。
//
// 为什么需要:`arts.js` 的 `tint`(每个器灵自己的身份色)、`items.js` 的 `col`
// (每个品阶自己的颜色)、`realms.js` 的 `color`(每个境界)、`ambience.js` 的昼夜
// `tint` —— 这些**本身就是数据**。收敛它们等于抹掉实体的区分度。
// 「器灵引魂灯是青色」这件事,必须由这个字段独立于 UI 皮肤存在。
const DATA_FIELD = /(?:^|[\s,{])col(?:or)?\s*:\s*['"]?#|tint\s*:\s*['"]?#/;

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
let roleSkipped = [];     // 按角色豁免掉的文件(留个可见度,免得以为没扫)

for (const f of files) {
  const rel = relative(__ROOT__, f);
  const why = roleExempt(rel);
  if (why) { roleSkipped.push(`${rel}(${why})`); continue; }
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  src.split('\n').forEach((line, i) => {
    // 去掉注释里的颜色（注释里提到色值是文档，不是用法）
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    // 承载色值的数据字段:色值本身就是数据,不是 UI 用色
    const isData = DATA_FIELD.test(code);
    const re = /#([0-9a-fA-F]{6})\b/g;
    let m;
    while ((m = re.exec(code))) {
      const c = '#' + m[1].toLowerCase();
      if (!hits.has(c)) hits.set(c, []);
      hits.get(c).push({ file: rel, line: i + 1, isData });
    }
  });
}

const bad = [];
let dataFieldHits = 0;   // 色值数据字段里的出现次数(已豁免,但要报出来让人看见)
for (const [c, locs] of hits) {
  if (ALLOWED.has(c) || EXEMPT.has(c)) continue;
  const uiLocs = locs.filter(l => !l.isData);
  dataFieldHits += locs.length - uiLocs.length;
  if (!uiLocs.length) continue;                 // 全部出现在数据字段里 → 不算违规
  bad.push({ c, n: uiLocs.length, where: uiLocs.slice(0, 3) });
}
bad.sort((a, b) => b.n - a.n);

console.log(`\n扫描 ${files.length} 个文件，找到 ${hits.size} 支色`);
console.log(`合法色板: ${ALLOWED.size} 支（主干 17 + 语义 6 + :root 推导 ${TOKEN_COLORS.size}）`);

// —— 近似色检查：这才是「页面拼不到一起」的真正病根 ————————
//
// 单纯统计「有多少色不在令牌里」会得出一个错误的结论:
//   多段渐变的每个色标都是**只出现一次**的。把它们各自做成令牌,
//   等于造出一堆只用一次的令牌 —— 令牌数没减少,可维护性反而更差。
//
// 真正让页面「拼不到一起」的是**近似色**:两个肉眼几乎分不出、
// 但 hex 不同、也都没进令牌的色。它们才是色板漂移的证据。
// 例如 xiuxian.css 里同时存在 #e8a0a0 / #e8b0a8 / #f0b8b0 三个警示文字色,
// 语义完全相同 —— 这才是该收敛成一个令牌的地方。
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function dist(h1, h2) {
  const a = hex2rgb(h1), b = hex2rgb(h2);
  // 粗略的加权欧氏距离,对亮度差更敏感（人眼对明度更敏感）
  return Math.sqrt(2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2) / 3;
}
const NEAR = 12;   // 阈值:小于它视为肉眼难分辨的近似色
const nearPairs = [];
const badColors = bad.map(b => b.c);
for (let i = 0; i < badColors.length; i++) {
  for (let j = i + 1; j < badColors.length; j++) {
    const d = dist(badColors[i], badColors[j]);
    if (d < NEAR) nearPairs.push({ a: badColors[i], b: badColors[j], d });
  }
}
nearPairs.sort((x, y) => x.d - y.d);

if (roleSkipped.length) {
  console.log(`按角色豁免 ${roleSkipped.length} 个文件（内容本身即色值定义）:`);
  roleSkipped.forEach(r => console.log(`  · ${r}`));
}
if (dataFieldHits) {
  console.log(`色值数据字段 ${dataFieldHits} 处（col/color/tint —— 实体自身的身份色，不算 UI 违规）`);
}
if (nearPairs.length) {
  console.log(`\n⚠️  近似色 ${nearPairs.length} 对（距离 < ${NEAR}，肉眼几乎分不出 —— 这才是色板漂移的证据）:`);
  for (const p of nearPairs) {
    const na = bad.find(b => b.c === p.a), nb = bad.find(b => b.c === p.b);
    console.log(`  ${p.a} ≈ ${p.b}  (距离 ${p.d.toFixed(1)})`);
    console.log(`      ${p.a}: ${na.where[0].file}:${na.where[0].line}   ×${na.n}`);
    console.log(`      ${p.b}: ${nb.where[0].file}:${nb.where[0].line}   ×${nb.n}`);
  }
}

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