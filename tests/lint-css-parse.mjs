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

// ⚠️ 2026-10-11:加 css/gear.css / css/wash.css。
//   原来这里是硬编码名单,V0.99「全站灰底」事故的根因正是
//   palette.css 用了 JS 风格 `//` 注释而本门禁没扫到它。
//   **新增样式表不写进这个名单 = 它可以用 `//` 而所有门禁全绿** ——
//   浏览器会把 `//` 之后的整块当注释吃掉,表现是样式整体失效。
//   判据:加样式表必须同时加这里,别只写进 index.html。
const CSS_FILES = ['css/palette.css', 'css/style.css', 'css/xiuxian.css', 'css/illust.css',
                   'css/gear.css', 'css/wash.css'];
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
  // ⚠️ 2026-10-11 修两处**门禁自身**的缺陷(不是 gear.css 的问题):
  //
  //   ① 扫 var() 引用前没剥 /* */ 注释。
  //      gear.css:19 的文件头注释里写着「颜色一律 var(--xx-*),来源只有 palette.css」,
  //      正则把 `--xx-*` 里的 `--xx-` 读成一个令牌名 → 报「未定义」假红。
  //   ② 定义表只扫 palette/style/xiuxian 三份,**不扫 CSS_FILES 自身**。
  //      于是 gear.css 里自定义一个 --xx-xxx 令牌并自己用,同样会假红。
  //
  //  判据:度量工具自己出错比没有度量更危险 —— 它会让人去改**正确的产品代码**
  //  去迎合一个错的门禁,而那正是本项目最恨的「改断言凑绿」的镜像版本。
  const stripCssComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

  const defs = new Set();
  for (const f of new Set([...CSS_FILES, 'css/palette.css', 'css/style.css', 'css/xiuxian.css'])) {
    let s; try { s = stripCssComments(readFileSync(ROOT + '/' + f, 'utf8')); } catch { continue; }
    for (const m of s.matchAll(/(--[\w-]+)\s*:/g)) defs.add(m[1]);
  }
  if (!defs.size) {
    console.log('  ❌ 一个令牌定义都没解析到 —— 门禁自身失效,别信结论');
    process.exit(2);
  }
  let miss = 0;
  for (const f of CSS_FILES) {
    let s; try { s = stripCssComments(readFileSync(ROOT + '/' + f, 'utf8')); } catch { continue; }
    const used = new Set([...s.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
    const bad2 = [...used].filter(k => !defs.has(k));
    if (bad2.length) {
      console.log(`  ❌ ${f}: ${bad2.join(', ')}`);
      miss++; bad++;
    }
  }
  if (!miss) console.log(`  ✅ 全部 var() 都能找到定义(定义表 ${defs.size} 个令牌)`);
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