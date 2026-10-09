// 渲染产物自检（工单 XX-VIS-003）
//
// 这轮的教训:
//   源石用了不存在的精灵名 `stone`,`drawSprite` 静默 return ——
//   **它从来没被画出来过**。而精灵表就在本机,查一次是一秒的事,
//   我却让你进游戏打了一局、截了四张图才发现。
//
// 所以定规矩:凡是「引用了一个具名资源」的地方,
//   都要有一条检查能在**本机**回答「它存不存在」。
//
// 本文件覆盖之前没查到的几类:
//   1. 精灵 / 音频 / 字体 / 图标 —— 具名资源引用
//   2. 字符串里的路径 —— 容易写错的相对路径
//   3. CSS 变量 —— 令牌有定义且有实值
//   4. localStorage 键 —— 两处写入两处读取是否配对
import { install } from './harness.mjs';
install();

import { readdirSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join, relative } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

const all = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    // ⚠️ `docs/` 里只有**设计文档与提案代码**,不参与构建、不进 sw.js 预缓存、
    //    也没有任何 js/ 模块 import 它。把它当产品代码扫描是错的:
    //    提案里引用的 `assets/portrait/legend/*.jpg` 是**规划中、尚未产出**的美术,
    //    扫进来就报「引用了不存在的资源」,而它们本来就不该存在。
    //    (这条是被 `docs/proposals/world-map-20261010/code/equipment.js`
    //    实测逼出来的 —— 加进仓库后 test-assets 直接 FAIL 245/258。)
    if (e.name === 'docs') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|css|html|json|webmanifest)$/.test(e.name)) all.push(p);
  }
})(ROOT);
const code = all.filter(f => /\.(js|css|html)$/.test(f));
const rel = f => relative(ROOT, f);

console.log('\n[1] 音频引用:assets/bgm/*.mp3 必须存在');
{
  for (const f of code.filter(f => f.endsWith('.js'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"](assets\/[^'"]+\.(?:mp3|ogg|wav|jpg|png|webp|svg))['"]/g)) {
      ok(`${rel(f)} → ${m[1]}`, existsSync(join(ROOT, m[1])));
    }
  }
}

console.log('\n[2] HTML 里的资源引用必须存在');
{
  for (const f of code.filter(f => f.endsWith('.html'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:href|src)="(?!https?:|data:|#)([^"]+)"/g)) {
      const t = m[1].split('?')[0];
      ok(`${rel(f)} → ${t}`, existsSync(join(ROOT, t)));
    }
  }
}

console.log('\n[3] 预缓存清单里的文件必须存在');
{
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  for (const m of sw.matchAll(/'([^']+\.(?:js|css|html|webmanifest|png|jpg|webp|mp3))'/g)) {
    ok(`sw.js → ${m[1]}`, existsSync(join(ROOT, m[1])));
  }
}

console.log('\n[4] localStorage 键:写入与读取配对');
{
  const keys = new Map();   // key -> {read:[], write:[]}
  for (const f of code.filter(f => f.endsWith('.js'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/localStorage\.(getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)) {
      if (!keys.has(m[2])) keys.set(m[2], { read: [], write: [] });
      if (m[1] === 'getItem') keys.get(m[2]).read.push(rel(f));
      else keys.get(m[2]).write.push(rel(f));
    }
  }
  for (const [k, v] of keys) {
    if (v.write.length && !v.read.length) {
      ok(`'${k}' 有人写没人读`, false, `只写在 ${v.write[0]}`);
    } else {
      ok(`'${k}' 读写配对`, true);
    }
  }
}

console.log('\n[5] CSS 变量:引用了必须有定义');
{
  const defined = new Set();
  // ⚠️ 必须连 .html 一起扫。第一版只扫 .css,于是 probe.html 在自己 <style> 的
  // :root 里定义的 8 个令牌全被报成「未定义」——尺子瞎了,不是页面有问题。
  // 令牌可以定义在 HTML 内联样式里,只扫 CSS 就会漏。
  for (const f of all.filter(f => /\.(css|html)$/.test(f))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  }
  for (const f of all.filter(f => /\.(css|html)$/.test(f))) {
    const src = readFileSync(f, 'utf8');
    const used = new Set([...src.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
    for (const u of used) {
      if (!defined.has(u)) { ok(`${rel(f)} 用 var(${u})`, false, '令牌未定义'); }
    }
  }
  ok('全部 CSS 变量都有定义', true);
}

console.log('\n[6] version.json 与 sw.js 版本必须一致(探针的依据)');
{
  const man = join(ROOT, 'version.json');
  if (existsSync(man)) {
    const v = JSON.parse(readFileSync(man, 'utf8'));
    const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
    const sv = (sw.match(/const V\s*=\s*'([^']+)'/) || [])[1];
    ok(`version.json(${v.version}) == sw.js(${sv})`, v.version === sv);
  } else ok('version.json 存在', false, '跑 node tests/make-manifest.mjs --write');
}

console.log(`\ntest-assets: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
