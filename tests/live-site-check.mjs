#!/usr/bin/env node
// 线上站点自检(XX-DEPLOY-002)—— 不需要浏览器,直接从**线上**把整棵模块图爬一遍
//
// 为什么要有这条:
//   `npm run check` 全绿只说明「仓库内容自洽」,说明不了「**线上**能加载」。
//   这两者之间有一整类分叉,DEPLOY.md 自己列过其中几个:
//     · 缓存(GitHub Pages 的 max-age=600)
//     · 大小写(Pages 区分,仓库名不区分)
//     · 漏提交 / 漏进预缓存清单
//   而它们的后果是**白屏** —— 正是 ci.yml 里 browser job 存在的理由。
//
//   browser job 要装 playwright + chromium,重、慢、且只在 CI 上有。
//   这条脚本零依赖、几分钟跑完,而且抓的是**同一类**问题:
//   import 链断没断、预缓存清单里有没有取不到的资源、清单与线上字节是否一致。
//   两者不互相替代(它测不出「点了没反应」「结局不结算」),
//   但它能在 browser job 之外多一道网,而且本地就能跑。
//
// ⚠️ 本文件第一版把 `URL.pathname` 剥掉前导斜杠后又拼回 BASE,
//    于是拼出 /xuanxuan-cultivation/xuanxuan-cultivation/... ——
//    **53 条「断链」全是这个 bug,没有一条是真的**。
//    教训:仓库路径本身是 URL 的一段,不能先剥再拼。现在全程走绝对 URL。
//
// 用法: node tests/live-site-check.mjs
//      LIVE_BASE=https://... node tests/live-site-check.mjs   # 指向别处
import { createHash } from 'node:crypto';

const BASE = (process.env.LIVE_BASE || 'https://dadadelddd309.github.io/xuanxuan-cultivation').replace(/\/+$/, '');
const bust = () => `?cb=${Date.now()}${Math.floor(Math.random() * 1e6)}`;

let pass = 0, fail = 0;
const failed = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; failed.push(n); console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); }
};

async function get(pathOrUrl, raw = false) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : new URL(pathOrUrl, BASE + '/').href;
  for (let attempt = 0; attempt < 3; attempt++) {
    // 503 是 Pages 的瞬时抖动(实测同一文件连打四次 200、中间冒出一次 503),
    // 直接判红会得到假红 —— 重试三次再下结论。
    const r = await fetch(url + (raw ? '' : bust()), { cache: 'no-store' });
    if (r.status !== 503) {
      return { status: r.status, body: raw ? Buffer.from(await r.arrayBuffer()) : await r.text() };
    }
    await new Promise(res => setTimeout(res, 1200));
  }
  return { status: 503, body: raw ? Buffer.alloc(0) : '' };
}

// ── 1. 线上 version.json 与线上文件逐条一致 ──
console.log(`\n[1] 线上清单与线上文件逐条校验(证明「线上跑的就是这次提交」)  BASE=${BASE}`);
const vjson = JSON.parse((await get('version.json')).body);
const entries = Object.entries(vjson.files);
// GitHub Pages **不发布点开头的文件**:tests/.hardcoded-baseline.json
// (lint-tokens 真正在用的 353 条基线)在线上取不到,这是预期行为,不是事故。
// 单列出来,不混进「不符」里 —— 混进去就会有人去"修"一个不存在的问题。
const isDot = p => p.split('/').pop().startsWith('.');
const dotfiles = entries.filter(([p]) => isDot(p));
let okN = 0; const mism = [];
for (const [p, h] of entries.filter(([p]) => !isDot(p))) {
  const { status, body } = await get(p, true);
  if (status !== 200) { mism.push(`${p} HTTP ${status}`); continue; }
  const b = createHash('sha256').update(body).digest('hex').slice(0, 12);
  if (b === h) okN++; else mism.push(`${p} ${h}≠${b}`);
}
ok(`线上 ${entries.length - dotfiles.length} 个非点开头文件全部可达且校验和一致`, mism.length === 0,
  mism.length ? `${mism.length} 处不符,前 3:${mism.slice(0, 3).join(' | ')}` : '');
if (dotfiles.length) console.log(`     另有 ${dotfiles.length} 个点开头文件(Pages 不发布,预期取不到): ${dotfiles.map(d => d[0]).join(', ')}`);
console.log(`     线上版本 ${vjson.version} · BUILD ${vjson.build} · ${vjson.count} 条`);

// ── 2. 模块图爬取:import 链断 = 白屏 ──
console.log('\n[2] 线上模块图完整性(import 链断 = 白屏)');
const seen = new Set(); const broken = []; const noExt = [];
const IMPORT_RE = /(?:^|[;\n])\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

async function walk(absUrl, fromLabel) {
  if (seen.has(absUrl)) return;
  seen.add(absUrl);
  const rel = new URL(absUrl).pathname.replace(/^\//, '');
  const { status, body } = await get(absUrl);
  if (status !== 200) { broken.push(`${rel}  (被 ${fromLabel} 引用) HTTP ${status}`); return; }
  if (!/\.(js|mjs)$/.test(absUrl)) return;
  for (const m of body.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (!spec || !spec.startsWith('.')) continue;
    const clean = spec.split('?')[0];
    if (!/\.(js|mjs)$/.test(clean)) { noExt.push(`${rel} → ${spec}`); continue; }
    await walk(new URL(clean, absUrl).href, rel);
  }
}
const idx = await get('index.html');
const entry = [...idx.body.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m => m[1]);
ok('index.html 有 script 入口', entry.length > 0, `找到 ${entry.length} 个`);
for (const e of entry) await walk(new URL(e.split('?')[0], BASE + '/').href, 'index.html');
for (const m of idx.body.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/g)) {
  await walk(new URL(m[1].split('?')[0], BASE + '/').href, 'index.html');
}
ok(`模块图 ${seen.size} 个文件全部 200`, broken.length === 0,
  broken.length ? `断链 ${broken.length} 条,前 3:${broken.slice(0, 3).join(' | ')}` : '');
ok('所有相对 import 都带扩展名', noExt.length === 0, noExt.slice(0, 3).join(' | '));

// ── 3. sw.js 预缓存清单 ──
console.log('\n[3] sw.js 预缓存清单(离线白屏的来源)');
const sw = (await get('sw.js')).body;
const assets = [];
for (const blk of sw.match(/const (?:CORE|XX|ART)\s*=\s*\[([\s\S]*?)\]/g) || []) {
  for (const m of blk.matchAll(/'([^']+)'/g)) assets.push(m[1]);
}
for (const a of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png']) assets.push(a);
const uniqA = [...new Set(assets)].map(a => a.replace(/^\.\//, ''));
const badAsset = [];
for (const a of uniqA) {
  const r = await fetch(new URL(a, BASE + '/').href + bust(), { method: 'HEAD', cache: 'no-store' });
  if (!r.ok) badAsset.push(`${a} HTTP ${r.status}`);
}
ok(`预缓存 ${uniqA.length} 项全部可取`, badAsset.length === 0,
  badAsset.length ? `${badAsset.length} 项失效,前 5:${badAsset.slice(0, 5).join(', ')}` : '');

// ── 4. 关键修复在线上字节里确实在 ──
console.log('\n[4] 本轮修复在线上字节里的落实');
{
  const m = sw.match(/const V = '([^']+)'/);
  ok(`sw.js 版本与 version.json 一致(${m?.[1]})`, m?.[1] === vjson.version);
  ok('install 有失败清单(不再静默吞)', /const failed = results/.test(sw));
  ok('activate 按完整性决定是否删旧缓存', /const complete =/.test(sw) && /if \(complete\)/.test(sw));
  ok('?v= 的模块身份职责有注释在位(防后人误删戳)', /ESM 模块身份/.test(sw));
  const ajs = (await get('js/xiuxian/assets.js')).body;
  ok('mp3 BGM 听「音乐」开关', /export function setEnabled/.test(ajs));
  ok('音乐关闭时 mp3 不播', /enabled === false\) \{ stop\(\); return; \}/.test(ajs));
  ok('关开关时清 cur(否则重开后声音回不来)', /curPrio = -1; cur = null; return;/.test(ajs));
  ok('死导出 setVolume 已移除', !/export function setVolume/.test(ajs));
  const mjs = (await get('js/main.js')).body;
  ok('设置面板广播 music-setting', /Bus\.emit\(\s*'music-setting'/.test(mjs));
}

// ── 5. ?v= 戳的线上实际形态 ──
console.log('\n[5] ?v= 戳:线上实际形态');
{
  const stamps = new Map();
  for (const f of [...seen].filter(x => x.endsWith('.js'))) {
    const b = (await get(f)).body;
    for (const m of b.matchAll(/from\s*['"]([^'"]+\?v=[0-9]+)['"]/g)) {
      const clean = m[1].split('?')[0].split('/').pop();
      if (!stamps.has(clean)) stamps.set(clean, new Set());
      stamps.get(clean).add(m[1].split('?v=')[1]);
    }
  }
  const mixed = [...stamps].filter(([, s]) => s.size > 1);
  ok(`每个模块的戳唯一(线上 ${stamps.size} 个被戳模块)`, mixed.length === 0,
    mixed.length ? `混用戳:${mixed.map(([k, v]) => `${k}=${[...v]}`).join(', ')}` : '');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 线上自检:${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);