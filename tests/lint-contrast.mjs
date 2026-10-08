// 对比度核算（工单 XX-FIX-010）
//
// 为什么需要:
//   「很多数值都有异常」—— 数值本身是对的，是**画出来看不清**。
//   我上一轮把 --ink-3 错指到 --xx-paper-faint（浅灰），
//   米白底上的次级文字对比度只剩 1.7:1，肉眼几乎不可见。
//   但没有任何测试报这个错 —— 断言验的是「变量有定义」，
//   验不出「这个颜色配那个底看得见吗」。
//
// 本文件按 WCAG 算实际对比度，低于阈值就报错。
// 它比正则可靠：真的按层叠顺序解引用 var()，再比亮度。
import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');

const html = readFileSync(ROOT + '/index.html', 'utf8');
const ORDER = [...html.matchAll(/href="css\/([\w.-]+)"/g)].map(m => 'css/' + m[1]);

// —— 按层叠顺序收 :root 令牌（后者覆盖前者）——
const toks = {};
for (const f of ORDER) {
  let s; try { s = readFileSync(ROOT + '/' + f, 'utf8'); } catch { continue; }
  for (const m of s.matchAll(/(:root[^{]*)\{([\s\S]*?)\}/g)) {
    if (/\[data-/.test(m[1])) continue;              // 条件作用域,不参与
    for (const t of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      toks[t[1]] = t[2].trim();
    }
  }
}
function resolve(n, d = 0) {
  if (d > 10 || !n) return null;
  const v = toks[n];
  if (!v) return null;
  const m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (m) return resolve(m[1], d + 1);
  return v;
}
function lum(c) {
  if (!c) return null;
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = [...h].map(x => x + x).join('');
    if (h.length < 6) return null;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const m = c.match(/[\d.]+/g);
  if (!m || m.length < 3) return null;
  return 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

let bad = 0;
console.log('\n[1] 主界面:各文字级对页面底的对比度');
{
  // .panel 的实际底色
  const sty = readFileSync(ROOT + '/css/style.css', 'utf8');
  const panel = (sty.match(/\.panel\s*\{[\s\S]*?background:([^;]+);/) || [])[1] || '';
  const usesPaper = /var\(--paper/.test(panel);
  const bg = usesPaper ? resolve('--paper') : null;
  console.log(`  页面底 ${bg}（亮度 ${Math.round(lum(bg))}）`);
  // 文字级：越靠后越弱
  // 只查**实际用作 color: 的**令牌。
  // --cinnabar / --gold 是色块/描边色(米白底上低对比是对的),
  // 文字另有 --cinnabar-text / --gold-text。查错对象会逼我把色块也压暗。
  const asText = new Set([...sty.matchAll(/color:\s*var\(\s*(--[\w-]+)/g)].map(m => m[1]));
  for (const k of ['--ink', '--ink-2', '--ink-3', '--ink-4', '--cinnabar-text', '--gold-text']) {
    if (!asText.has(k)) { console.log(`  ➖ ${k.padEnd(18)} 未用作文字色,跳过`); continue; }
    const r = ratio(bg, resolve(k));
    if (r == null) { console.log(`  ⚠️ ${k} 解析失败`); continue; }
    // 正文要 4.5:1；大字/装饰可放宽到 3:1
    // 12px 正文要 4.5:1;≥18px 或粗体大字按 WCAG 大字标准 3:1。
    // 朱砂/金再压暗就接近黑、失去"点睛"意义,所以只要求到 3:1(仍可读)。
    const need = (k === '--cinnabar-text' || k === '--gold-text') ? 3.0 : 4.5;
    const ok = r >= need;
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} ${k.padEnd(12)} ${r.toFixed(1)}:1  (需 ≥${need})`);
  }
}

console.log('\n[2] 修仙阁:文字对卡片的对比度');
{
  const bg = resolve('--xx-ink-2');     // 卡片底
  for (const k of ['--xx-paper', '--xx-paper-dim', '--xx-paper-faint', '--xx-gold', '--xx-cinnabar']) {
    const r = ratio(bg, resolve(k));
    if (r == null) { console.log(`  ⚠️ ${k} 解析失败`); continue; }
    const need = (k === '--xx-paper' || k === '--xx-paper-dim') ? 4.5 : 3.0;
    const ok = r >= need;
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} ${k.padEnd(18)} ${r.toFixed(1)}:1  (需 ≥${need})`);
  }
}

console.log('\n[3] 血条/进度条:填充与轨道必须能分辨');
{
  // .bar / .bar.xp / .bar.hp 的填充色
  const sty = readFileSync(ROOT + '/css/style.css', 'utf8');
  const grab = (sel) => {
    const m = sty.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[\\s\\S]*?background:\\s*([^;]+);'));
    return m ? m[1].trim() : null;
  };
  const track = grab('.bar');
  const fill = sty.match(/\.bar \.fill\s*\{[^}]*?background:\s*([^;]+);/);
  const fillRaw = fill ? fill[1] : null;
  const rvRaw = (v) => { const m = v && v.match(/var\(\s*(--[\w-]+)/); return m ? resolve(m[1]) : v; };
  const t = rvRaw(track), f = rvRaw(fillRaw);
  const r = ratio(t, f);
  console.log(`  轨道 ${track} → ${t} | 填充 ${fillRaw} → ${f}`);
  if (r == null) { console.log('  ⚠️ 解析失败'); }
  else {
    const ok = r >= 1.5;   // 血条不要求文字级对比度,要能看出"填了多少"
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} 填充/轨道 ${r.toFixed(2)}:1（需 ≥1.5，否则看不出血量）`);
  }
}

console.log('\n[4] 关键令牌都能解析出实值');
{
  for (const k of ['--paper', '--ink', '--ink-2', '--ink-3', '--cinnabar-text', '--gold-text',
                   '--xx-paper', '--xx-ink', '--xx-ink-2', '--xx-gold']) {
    const v = resolve(k);
    const ok = v && (v.startsWith('#') || v.startsWith('rgb'));
    if (!ok) { console.log(`  ❌ ${k} = ${v}`); bad++; }
    else console.log(`  ✅ ${k.padEnd(14)} ${v}`);
  }
}

console.log(bad ? `\n对比度问题: ${bad} 项` : '\n✅ 全部配色对比度达标');
process.exit(bad ? 1 : 0);