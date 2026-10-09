#!/usr/bin/env node
// 体验提示门禁(XX-AUDIT-021)
//
// 为什么要有这个:
//   `apply_hints.py` 依据 REACH-AUDIT.md 的分析修了三处体验缺陷 ——
//   门禁条件(财力 500 / 道行 800)**对玩家不可见**,玩家点了才知道差多少。
//   补丁已落地(跑该脚本 5/5 显示「已存在」),但:
//
//   1. **21 条 lint 里没有一条检查这些提示**。任何人重构 ui.js 时删掉它们,
//      没有一条 lint 会红 —— 已知缺陷静默回归。
//   2. **该脚本本身不幂等**:s4() 缺 `if ... return '已存在'` 判断(其它四步都有),
//      重跑会重复插入同一段 HTML。2026-10-10 实测复现:
//      ui.js:1561 被插入第二份「还需 N 道行」提示。
//
//   这就是「修完就裸奔」的典型形态 —— 修复没留下可执行的验证。
//
// 本 lint 把那 5 处断言变成**会红的门禁**,让修复不再裸奔。
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv, join } from 'path';

const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

let fail = 0;
const t = (n, c, d = '') => { if (!c) { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };

const family = read('js/xiuxian/family.js');
const build = read('js/xiuxian/build.js');
const ui = read('js/xiuxian/ui.js');
const css = existsSync(join(ROOT, 'css/xiuxian.css')) ? read('css/xiuxian.css') : '';

console.log('\n[1] 缺口查询函数存在(REACH-AUDIT 的修复本体)');
t('family.js 导出 raiseGap()', /raiseGap\s*\(/.test(family));
t('build.js 导出 pactGap()', /pactGap\s*\(/.test(build));

console.log('=== [2] 招族人缺口提示 ===');
{
  t('ui.js 调用 BUILD 的缺口查询', /raiseGap\s*\(/.test(ui) || /FAMILY[^\n]*raiseGap/.test(ui),
    '招人按钮旁应有「还差多少财力」');
  t('ui.js 有「还差/还需」类可见文本', /还[需差]|不足/.test(ui));
}

console.log('=== [3] 缔同盟缺口提示 ===');
{
  t('ui.js 调用 BUILD.pactGap()', /pactGap\s*\(/.test(ui));
  t('提示含「道行」字样', /道行/.test(ui));
}

console.log('=== [4] 幂等:同盟提示不得出现两份 ===');
{
  // 历史上 s4() 无幂等判断,重跑会重复插入(实测 ui.js:1561 被插了第二份)
  const pactHints = (ui.match(/BUILD\.pactGap\(\)/g) || []).length;
  t('pactGap 提示只出现一次', pactHints === 1, `实测 ${pactHints} 次,>1 说明 apply_hints.py 被重复跑过`);
}

console.log('=== [5] 提示样式已定义 ===');
{
  t('CSS 有 xx-hint 类', /\.xx-hint\b/.test(css));
  t('CSS 有 xx-hintok 类(条件满足时的正反馈)', /\.xx-hintok\b/.test(css));
}

console.log('=== [6] apply_hints.py 不得留在仓库根 ===');
{
  const inRoot = existsSync(join(ROOT, 'apply_hints.py'));
  t('apply_hints.py 已移走或删除', !inRoot,
    '它是**一次性**修补脚本,补丁已由本 lint 接管;留在根目录随时可能被误跑(repeat 插入)');
}

if (fail === 0) {
  console.log('\n✅ 体验提示门禁通过:缺口数值对玩家可见,且无重复插入');
} else {
  console.log(`\n❌ ${fail} 项不达标 —— 体验修复已裸奔,玩家又要面对「点了才知道差多少」`);
  console.log('   依据:REACH-AUDIT.md(财力 500 靠守家攒 / 道行 800 约 1300 杀)');
  console.log('   ⚠️ 不要直接重跑 apply_hints.py —— 它的 s4() 不幂等,会重复插入。');
}
process.exit(fail ? 1 : 0);