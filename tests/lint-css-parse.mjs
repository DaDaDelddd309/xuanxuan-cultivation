// CSS 可解析性 lint（工单 XX-FIX-007）
//
// 为什么需要这个:
//   V0.99 上线后全站灰底、无色、重影。我查了两轮:
//     · 第一轮查「变量有没有定义」→ 都在
//     · 第二轮查「有没有自我引用」→ 修了
//   **页面一点没变。** 真因是 `css/palette.css` 用 JS 风格的 `//` 当注释 ——
//   CSS 里 `//` 非法,第 1 行的 `#` 又让它变成 ID 选择器,
//   浏览器的错误恢复逻辑把后面的 `:root` 令牌块一起吃掉了。
//
//   也就是说:文件在、lint 过、变量"看起来"有定义 —— 但浏览器一行都没解析进去。
//
// 本文件的判据:**CSS 里不允许出现 `//` 注释**。
// 这是可以机械检查的,而且是这类问题的充分条件。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const CSS_FILES = ['css/palette.css', 'css/style.css', 'css/xiuxian.css', 'css/illust.css'];
let bad = 0;

console.log('\n[1] CSS 里不得出现 JS 风格注释 //');
{
  for (const f of CSS_FILES) {
    let src;
    try { src = readFileSync(ROOT + '/' + f, 'utf8'); }
    catch { console.log(`  ⚠️ 读不到 ${f},跳过`); continue; }
    const lines = src.split('\n');
    const hits = [];
    lines.forEach((L, i) => {
      // 行首 // 一定是 JS 注释残留
      if (/^\s*\/\//.test(L)) hits.push([i + 1, L.trim().slice(0, 50)]);
    });
    if (hits.length) {
      console.log(`  ❌ ${f}: ${hits.length} 行`);
      hits.slice(0, 3).forEach(([n, t]) => console.log(`     L${n}: ${t}`));
      bad++;
    } else console.log(`  ✅ ${f}`);
  }
}

console.log('\n[2] CSS 注释必须闭合 /* ... */');
{
  for (const f of CSS_FILES) {
    let src;
    try { src = readFileSync(ROOT + '/' + f, 'utf8'); } catch { continue; }
    // 去掉字符串再数,避免 /* 出现在内容里误判
    const open = (src.match(/\/\*/g) || []).length;
    const close = (src.match(/\*\//g) || []).length;
    if (open !== close) {
      console.log(`  ❌ ${f}: /* ${open} 个 vs */ ${close} 个 —— 注释没闭合,后面全被吃掉`);
      bad++;
    } else console.log(`  ✅ ${f} (${open} 组)`);
  }
}

console.log('\n[3] 首行必须是注释/@charset/@import,不能是裸 # 标题');
{
  // 「# ==== 标题 ====」是这次的真凶:CSS 里 # 是 ID 选择器,
  // 它不是注释,后面整段会被浏览器的错误恢复吃掉。
  // 合法首行:/* ... */、@charset、@import
  for (const f of CSS_FILES) {
    let src;
    try { src = readFileSync(ROOT + '/' + f, 'utf8'); } catch { continue; }
    const first = (src.split('\n').find(L => L.trim()) || '').trim();
    const okFirst = /^\/\*/.test(first) || /^@charset/.test(first) || /^@import/.test(first);
    if (!okFirst) {
      console.log(`  ❌ ${f}: 首行「${first.slice(0,44)}」不是注释/@charset/@import`);
      bad++;
    } else console.log(`  ✅ ${f}`);
  }
}

console.log('\n[4] var() 引用必须能在同文件或 palette.css 里找到定义');
{
  const defs = new Set();
  for (const f of ['css/palette.css', 'css/style.css', 'css/xiuxian.css']) {
    let s; try { s = readFileSync(ROOT + '/' + f, 'utf8'); } catch { continue; }
    for (const m of s.matchAll(/(--[\w-]+)\s*:/g)) defs.add(m[1]);
  }
  let miss = 0;
  for (const f of CSS_FILES) {
    let s; try { s = readFileSync(ROOT + '/' + f, 'utf8'); } catch { continue; }
    const used = new Set([...s.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
    const bad2 = [...used].filter(k => !defs.has(k));
    if (bad2.length) {
      console.log(`  ❌ ${f}: ${bad2.join(', ')}`);
      miss++; bad++;
    }
  }
  if (!miss) console.log('  ✅ 全部 var() 都能找到定义');
}

console.log('\n[5] 关键令牌有实值(不是自我引用/空值)');
{
  let s; try { s = readFileSync(ROOT + '/css/palette.css', 'utf8'); } catch { s = ''; }
  const root = s.slice(s.indexOf(':root'));
  const need = ['--xx-paper', '--xx-ink', '--xx-gold', '--xx-cinnabar', '--xx-jade', '--xx-bg-1'];
  for (const k of need) {
    const m = root.match(new RegExp(k.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+)'));
    if (!m) { console.log(`  ❌ ${k} 未定义`); bad++; continue; }
    const v = m[1].trim();
    const selfRef = v === `var(${k})`;
    const empty = !v;
    if (selfRef || empty) {
      console.log(`  ❌ ${k} = ${v} ${selfRef ? '(自我引用)' : '(空)'}`);
      bad++;
    } else console.log(`  ✅ ${k} = ${v}`);
  }
}

console.log(bad ? `\nCSS 可解析性问题: ${bad} 项` : '\n✅ CSS 可被浏览器正常解析');
process.exit(bad ? 1 : 0);