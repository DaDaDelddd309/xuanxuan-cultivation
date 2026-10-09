// 局内广播条回归测试(XX-COMPANION-003)
//
// 玩家反馈:灵伴说话用**弹窗**,在砍杀中途「突兀、妨碍视野」——
//          正盯着弹幕呢,视野被挡一下。
// owner 要求:改成顶部滚动字幕,**透明底不挡视野**;
//          刚出场那句有渐变,说完淡化停留,保留 2 行,名字带颜色。
//
// 本测试锁住这些要求,防止改回去。
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const JS = readFileSync(join(ROOT, 'js/xiuxian/companion-broadcast.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'css/style.css'), 'utf8');
// 令牌定义在 palette.css —— 第一版只读了 style.css,导致 4 项误报。
const PAL = readFileSync(join(ROOT, 'css/palette.css'), 'utf8');
const BOND = readFileSync(join(ROOT, 'js/xiuxian/bond.js'), 'utf8');

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };

console.log('\n=== [1] 不挡视野:透明底 ===');
{
  const blk = CSS.slice(CSS.indexOf('XX-COMPANION-003'));
  t('pointer-events:none(绝不挡操作)', /\.cc-bc\s*\{[^}]*pointer-events:\s*none/.test(blk));
  // 注意:正则里的 '.' 必须转义,否则会匹配任意字符 —— 第一版写成
  // /rgba\(18,14,11,0\)/ 时 '0' 前的点成了通配,匹配行为不可控。
  t('有完全透明的墨色令牌', /--cc-ink:\s*rgba\(18,\s*14,\s*11,\s*0\)/.test(PAL));
  t('墨晕很淡(≤0.3)',
    (() => { const m = PAL.match(/--cc-veil:\s*rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
             return m ? parseFloat(m[1]) <= 0.3 : false; })(),
    '上一版给了 .72 的实底,弹幕密集时糊掉一片 —— 那等于又回到老问题');
  t('右侧完全化开(渐变到透明)', /--cc-veil-edge:\s*rgba\(18,\s*14,\s*11,\s*0\)/.test(PAL));
  t('靠 text-shadow 压背景而非实底', /text-shadow:[^;]*rgba\(0,0,0/.test(blk));
}

console.log('=== [2] 刚出场有渐变,说完淡化停留 ===');
{
  t('入场淡入上浮(cc-bc-in)', /\.cc-bc-in\s*\{[^}]*opacity:\s*1/.test(CSS));
  t('入场有过渡(渐变而非瞬现)', /\.cc-bc-line\s*\{[^}]*transition:[^}]*opacity/.test(CSS));
  t('说完降级为 prev(不消失)', /\.cc-bc-line-prev/.test(CSS));
  t('prev 淡化(.46 左右)', /\.cc-bc-line-prev\s*\{[^}]*opacity:\s*\.4/.test(CSS));
  t('有停留时长 DWELL_MS', /DWELL_MS\s*=\s*\d{3,}/.test(JS));
  t('停留不是立刻清空(clearTimeout 而非 remove)', /clearTimeout\(timer\)/.test(JS) && !/removeChild\(line\)/.test(JS));
}

console.log('=== [3] 永远保留 2 行 ===');
{
  t('MAX_LINES = 2', /MAX_LINES\s*=\s*2/.test(JS));
  t('超出即移除最旧一行', /while\s*\(el\.children\.length\s*>\s*MAX_LINES\)/.test(JS));
  t('移除的是 firstChild(最上面那行)', /el\.removeChild\(el\.firstChild\)/.test(JS));
  t('上一条降级而不是消失', /classList\.add\(\s*['"]cc-bc-line-prev/.test(JS));
}

console.log('=== [4] 名字带颜色 + 字体分层 ===');
{
  t('名字用 <b class="cc-bc-name">', /class="cc-bc-name"/.test(JS));
  t('名字有独立颜色令牌', /--cc-name:\s*#c9a227/.test(PAL));   // '#' 在正则里无特殊含义
  t('名字加粗 + 字距', /\.cc-bc-name\s*\{[^}]*font-weight:\s*700/.test(CSS));
  t('动作词独立类且样式不同', /\.cc-bc-verb\s*\{/.test(CSS) && /class="cc-bc-verb"/.test(JS));
  t('正文与名字视觉可区分', /\.cc-bc-name[^}]*font-weight/.test(CSS) && /\.cc-bc-text/.test(CSS));
  t('传入了灵伴名(不是空)', /COMPANION\.s && COMPANION\.s\.name/.test(BOND) || /COMPANION\.s\.name/.test(JS));
}

console.log('=== [5] 不能破坏既有约束 ===');
{
  t('原 bubble() 预算仍在(每局 6 条)', /_bubBudget\s*=\s*6/.test(BOND));
  t('预算没被广播条另开一份(不叠加)', !/Broadcast.*_bubBudget/.test(BOND));
  t('原气泡仍保留(不是替换,是并存)', /bd-bub/.test(BOND));
  t('调用链没断:runEventLines → bubble', /bubble\(text, kind\)/.test(BOND));
}

console.log('=== [6] 资源与安全 ===');
{
  t('已登记 sw.js 预缓存', existsSync(join(ROOT, 'sw.js')) &&
    /companion-broadcast\.js/.test(readFileSync(join(ROOT, 'sw.js'), 'utf8')));
  t('内容经 esc 转义(防注入)', /const esc = s =>/.test(JS) && /esc\(who\)/.test(JS) && /esc\(text\)/.test(JS));
  t('支持 prefers-reduced-motion', /prefers-reduced-motion/.test(CSS));
  t('aria-live(读屏可播报)', /aria-live/.test(JS));
}

if (fail === 0) {
  console.log('\n✅ 广播条符合要求:透明底不挡视野 / 渐入后淡化停留 / 恒 2 行 / 名字带色');
} else {
  console.log(`\n❌ ${fail} 项不达标`);
}
process.exit(fail ? 1 : 0);
