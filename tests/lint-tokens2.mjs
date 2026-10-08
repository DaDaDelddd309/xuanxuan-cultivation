// CSS 令牌完整性 lint(工单 XX-TEST-003)
//
// 查三件会让整站"掉回浏览器默认色"的事:
//   1. 自我引用:--xx-paper: var(--xx-paper)。浏览器直接判为无效,变量消失。
//      V0.99 上线后主菜单是灰底黑字,就是三处自引用 + 加载顺序错造成的。
//   2. 加载顺序:定义令牌的表必须排在引用它的表**之前**。
//   3. 引用了但没定义:var(--xx-xxx) 找不到 xxx。
//
// 表现都是"页面没颜色",但逻辑全对、模块全通 —— 又一次只有肉眼能发现。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, dirname } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const read = f => readFileSync(ROOT + '/' + f, 'utf8');
let bad = 0;

console.log('\n[1] 无自我引用的 CSS 变量');
{
  const files = ['css/palette.css', 'css/style.css', 'css/xiuxian.css', 'css/illust.css'];
  let n = 0;
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/(--[\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*\)/g)) {
      if (m[1] === m[2]) { console.log(`  ❌ ${f}: ${m[1]}: var(${m[2]})`); n++; bad++; }
    }
  }
  if (!n) console.log('  ✅ 4 个样式表均无自我引用');
}

console.log('\n[2] 令牌表必须排在引用它的表之前');
{
  const html = read('index.html');
  const order = [...html.matchAll(/<link[^>]+href="css\/([\w.-]+)"/g)].map(m => m[1]);
  // 哪个文件定义了 --xx-* 令牌
  let definer = null;
  for (const f of ['palette.css', 'style.css', 'xiuxian.css', 'illust.css']) {
    if (/--xx-[\w-]+\s*:/.test(read('css/' + f))) { definer = f; break; }
  }
  const iDef = order.indexOf(definer);
  const users = order.filter(f => f !== definer && /var\(\s*--xx-/.test(read('css/' + f)));
  if (iDef < 0) { console.log(`  ❌ 令牌表 ${definer} 没被引入`); bad++; }
  else {
    const late = users.filter(f => order.indexOf(f) < iDef);
    if (late.length) {
      console.log(`  ❌ 这些表排在令牌表(${definer})之前,它们的 var(--xx-*) 会失效:`);
      late.forEach(f => console.log(`     ${f}`));
      bad++;
    } else console.log(`  ✅ ${definer} 排在所有引用者之前 (${order.join(' → ')})`);
  }
}

console.log('\n[3] 引用的令牌都有定义');
{
  const defined = new Set();
  for (const f of ['palette.css', 'style.css', 'xiuxian.css']) {
    for (const m of read('css/' + f).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  }
  const used = new Map();
  for (const f of ['palette.css', 'style.css', 'xiuxian.css', 'illust.css']) {
    for (const m of read('css/' + f).matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(f);
    }
  }
  const missing = [...used.keys()].filter(k => !defined.has(k));
  if (missing.length) {
    console.log('  ❌ 用了但没定义:'); missing.forEach(k => console.log(`     ${k}  (${[...used.get(k)].join(', ')})`));
    bad++;
  } else console.log(`  ✅ ${used.size} 个令牌全部有定义`);
}

console.log('\n[4] 内联 style 不得写死颜色(应走令牌)');
{
  // 内联 style 写 rgba/# 会在深浅两套主题下都对不上;允许少数例外(透明/纯黑遮罩)
  const html = read('index.html');
  const hard = [...html.matchAll(/style="[^"]*?(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))[^"]*"/g)];
  const allow = /rgba\(0,\s*0,\s*0/;   // 纯黑遮罩是刻意的
  const badOnes = hard.filter(m => !allow.test(m[0]));
  if (badOnes.length) {
    console.log(`  ⚠️ index.html 有 ${badOnes.length} 处内联硬编码颜色(不阻断,建议迁到令牌):`);
    badOnes.slice(0, 3).forEach(m => console.log(`     ${m[0].slice(0, 60)}`));
  } else console.log('  ✅ 无内联硬编码颜色');
}

console.log(bad ? `\nCSS 令牌问题: ${bad} 项` : '\n✅ CSS 令牌完整');
process.exit(bad ? 1 : 0);