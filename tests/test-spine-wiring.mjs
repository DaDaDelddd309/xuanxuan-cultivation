// 主线骨架接线测试 —— 工单 XX-SPINE-003
// 运行: node tests/test-spine-wiring.mjs
//
// 为什么需要这个文件:
//   spine.js 的单测(test-spine.mjs)只证明**它自己**逻辑对,
//   不证明**它被接上了**。V0.98~V0.99 期间出现过两种"看着接了、其实没接":
//     1) spine.js 整个文件在仓库里,但没有任何模块 import 它 → 纯死代码
//     2) 支线同步写成 `Object.entries(QUEST.s?.quests || {})`,
//        而 QUEST.s 的真实形状是 { active:[], done:{} } —— `|| {}` 兜底成空循环,
//        不报错、不告警,永远同步 0 条
//   第 2 种是静默失效,最难查。这里把每一处接线的**结构前提**钉死。
//
// 诚实声明:本文件是**结构检查**(读源码断言接线形态),
// 不断言运行时行为。运行时那条要靠浏览器实测 —— 本机 playwright 不支持 Android。

import { readFileSync } from 'fs';
import { fileURLToPath as _fu } from 'url';
import { dirname as _dn, resolve as _rv } from 'path';
const ROOT = _rv(_dn(_fu(import.meta.url)), '..');
const read = f => readFileSync(ROOT + '/' + f, 'utf8');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

const ui = read('js/xiuxian/ui.js');
const main = read('js/main.js');
const css = read('css/xiuxian.css');
const sw = read('sw.js');
const quest = read('js/xiuxian/quest.js');

console.log('\n[1] spine.js 不再是死代码');
{
  const imported = /import\s*\{[^}]*\bSPINE\b[^}]*\}\s*from\s*'\.\/spine\.js'/.test(ui)
                || /import\s*\{[^}]*\binstallSpine\b[^}]*\}\s*from\s*'\.\/xiuxian\/spine\.js'/.test(main);
  ok('有人真的 import 了 spine.js', imported);
  ok('installSpine 在开局被调用', /installSpine\(Cult\.s,\s*CAMP\)/.test(main));
  // 挂载顺序:必须在 Cult.init/CAMP.load 之后,否则读到的是空状态
  const iLoad = main.indexOf('CAMP.load();');
  const iInst = main.indexOf('installSpine(Cult.s, CAMP);');
  ok('installSpine 在 CAMP.load() 之后调用', iLoad > 0 && iInst > iLoad, `load@${iLoad} install@${iInst}`);
}

console.log('\n[2] 初见妖 → 主线骨架(工单验收第 2 条)');
{
  ok('调了 SPINE.observeLegend', /SPINE\.observeLegend\(/.test(ui));
  ok('把因果句传给 showLegend', /showLegend\(l,\s*causal\)/.test(ui));
  ok('showLegend 接受 causal 参数', /showLegend\(l,\s*causal\)\s*\{/.test(ui));
  // 关键:causal 必须真的进了 DOM 模板,不能算完就丢
  ok('因果句写进了 banner 的 innerHTML',
    /xx-bn-c/.test(ui) && /causal\.map\(/.test(ui));
}

console.log('\n[3] 双结局因果链(工单验收第 1 条)');
{
  ok('causal 变量取自 observeLegend 的返回值',
    /causal\s*=\s*\(SPINE\.observeLegend\(l\.key\)\.lines\)\s*\|\|\s*\[\]/.test(ui));
  // 只提示一次的纪律不能被写坏
  ok('没有自己再造一个随机池(不应出现 Math.random 取台词)',
    !/causal\s*=\s*.*Math\.random/.test(ui));
}

console.log('\n[4] 支线 → 主线(工单验收第 3 条)');
{
  ok('调了 SPINE.observeQuest', /SPINE\.observeQuest\(/.test(ui));
  // 这条是本文件存在的核心理由:必须用 QUEST.s 的真实形状
  ok('读的是 QUEST.s.active(真实字段)', /QUEST\.s\.active/.test(ui));
  ok('读的是 QUEST.s.done(真实字段)', /QUEST\.s\.done/.test(ui));
  ok('没有用不存在的 QUEST.s.quests', !/QUEST\.s\??\.quests/.test(ui),
     ' QUEST.s.quests 不存在,会被 || {} 静默吞成空循环');
  // 顺序:autoTake 之后才同步,否则本轮新接的支线同步不到
  const vQ = ui.slice(ui.indexOf('  vQuest() {'), ui.indexOf('  vQuest() {') + 700);
  ok('autoTake 在同步之前', vQ.indexOf('QUEST.autoTake()') < vQ.indexOf('SPINE.observeQuest'));
}

console.log('\n[5] 仙人墓 → 主线(工单验收第 4 条)');
{
  ok('调了 SPINE.openTomb', /SPINE\.openTomb\(\)/.test(ui));
  // 不能放在渲染函数里 —— "打开了墓的页面"不等于"进了墓"
  const vTombBody = ui.slice(ui.indexOf('  vTomb() {'));
  ok('没有把 openTomb 塞进 vTomb() 渲染函数',
    !vTombBody.slice(0, 900).includes('SPINE.openTomb'));
  // 必须真的进墓成功之后才记
  const iEnter = ui.indexOf('const r = TOMB.enter();');
  const iOk = ui.indexOf('if (!r.ok)', iEnter);
  const iOpen = ui.indexOf('SPINE.openTomb()', iEnter);
  ok('在 TOMB.enter() 之后调用', iEnter > 0 && iOpen > iEnter);
  ok('在 enter 成功的守卫之后调用', iOk > 0 && iOpen > iOk);
}

console.log('\n[6] 因果句有样式(不然是一行没排版的字)');
{
  ok('CSS 定义了 .xx-bn-c', /\.xx-bn-c\s*\{/.test(css));
}

console.log('\n[7] 离线可用(spine.js 在预缓存里)');
{
  ok('sw.js 清单含 spine.js', /'js\/xiuxian\/spine\.js'/.test(sw));
  // 反向核对:磁盘上每个 js 都必须在清单里(这正是审计里那个 P0 的方向)
  ok('ui.js 在清单里', /'js\/xiuxian\/ui\.js'/.test(sw));
}

console.log(`\ntest-spine-wiring: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (failed.length) { console.log('失败项:'); failed.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);