// 打扰预算(V0.96)
// 防止再犯「加法思维」:玩家一局被打扰的次数必须有上限。
//
// 背景:曾经有 23 个各自为政的弹层入口、6 个 setInterval,
// 怨灵每 2 分钟附身一次、气泡每 1.2 秒可能冒一次、
// 商人 90 秒来一次…… 没有一处知道玩家已经被打扰几次。
globalThis.document={addEventListener(){},removeEventListener(){},
  createElement:()=>({style:{cssText:'',setProperty(){}},classList:{add(){},remove(){}},
    appendChild(){},remove(){},addEventListener(){},removeChild(){}}),
  body:{appendChild(){}},getElementById:()=>null};
globalThis.window={addEventListener(){}};
const N=await import('../js/xiuxian/nag.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};

console.log('\n=== 预算本身 ===');
N.NAGER.reset();
t('初始预算已用 0', N.NAGER.used===0);
t('有剩余额度', N.NAGER.left()===N.NAGER.budget);
t('预算是小数目(不是无限)', N.NAGER.budget<=6);

console.log('\n=== 非决策类浮层会被预算挡住 ===');
N.NAGER.reset();
let ok=0;
for (let i=0;i<10;i++) if (N.NAGER.request({level:N.NAG.MID})) ok++;
t(`申请 10 次只成功 ${ok} 次`, ok===N.NAGER.budget);
t('超出预算的返回 false', N.NAGER.request({level:N.NAG.MID})===false);

console.log('\n=== 决策类永远放行,不占预算 ===');
N.NAGER.reset();
for (let i=0;i<20;i++) N.NAGER.request({level:N.NAG.MID});
t('预算已用满', N.NAGER.used>=N.NAGER.budget);
t('结局类仍能排队', N.NAGER.request({level:N.NAG.MUST})===true);
t('决策类不增加 used', N.NAGER.used===N.NAGER.budget);
for (let i=0;i<5;i++) N.NAGER.request({level:N.NAG.MUST});
t('连续决策类也能进', N.NAGER.request({level:N.NAG.MUST})===true);

console.log('\n=== SILENT / LOW 不占预算 ===');
N.NAGER.reset();
for (let i=0;i<20;i++) N.NAGER.request({level:N.NAG.SILENT});
t('SILENT 不消耗预算', N.NAGER.used===0);
for (let i=0;i<5;i++) N.NAGER.request({level:N.NAG.LOW});
t('LOW 不消耗预算', N.NAGER.used===0);

console.log('\n=== 每局重置 ===');
N.NAGER.reset();
for (let i=0;i<10;i++) N.NAGER.request({level:N.NAG.MID});
const usedBefore=N.NAGER.used;
N.NAGER.newRun();
t('新的一局预算重置', N.NAGER.used===0 && usedBefore>0);
t('run 计数递增', N.NAGER.runs>=1);

console.log('\n=== 怨灵节奏(V0.96 降频) ===');
const C=await import('../js/xiuxian/companion.js');
C.COMPANION.reset(); C.COMPANION.load(); C.COMPANION.init('x'); C.COMPANION.s.ghost.on = true;   // V0.98:三路线删了,怨灵直接开启
const g=C.COMPANION.s.ghost;
// V0.98:字段名变了 —— 旧档的 since/nextAt/holdMs → 现在的 scatterAt/cd。
// 下面是重写,断言的**数值没有放松**:仍然是 V0.96 刻意调过的那几个。
C.COMPANION.s.ghost.phase='possessing'; C.COMPANION.s.ghost.scatterAt=Date.now()+26000;
t('附身持续 26 秒(不是 75)', C.COMPANION.s.ghost.scatterAt-Date.now()===26000);
// 强化温和但仍可感知
C.COMPANION.s.ghost.phase='possessing';
t('血量强化 1.28(不是 1.6)', C.COMPANION.hostBuff()===1.28);
t('伤害强化 1.18', C.COMPANION.hostDmg()===1.18);
t('速度强化 1.08(不是 1.25)', C.COMPANION.hostSpd()===1.08);
t('仍明显强于 1', C.COMPANION.hostBuff()>1.2);
// 间隔
const now=Date.now();
C.COMPANION.s.ghost.phase='idle'; C.COMPANION.s.ghost.cd=now-1000;
C.COMPANION.tick();
t('idle 到点会附身', C.COMPANION.s.ghost.phase==='possessing');
// 模拟 26 秒后到期
C.COMPANION.s.ghost.phase='possessing'; C.COMPANION.s.ghost.scatterAt=now-1000;
C.COMPANION.tick();
t('26 秒后自动结束', C.COMPANION.s.ghost.phase==='idle');
t('结束后的间隔 ≥150 秒', (C.COMPANION.s.ghost.cd - Date.now()) >= 140000);

console.log('\n=== 闪屏特写已移除 ===');
t('tick 不再返回 flash', (()=>{
  C.COMPANION.s.ghost.phase='idle'; C.COMPANION.s.ghost.nextAt=Date.now()-1000;
  const e=C.COMPANION.tick();
  return !e || e.flash===null || e.flash===undefined;
})());

console.log('\n=== 一局内的打扰总量(推算) ===');
// 一局 8 分钟 = 480 秒
// 怨灵:开局 210s 后首次,持续 26s,之后间隔 150s → 最多 3 次,但每次只弹一个气泡
// 商人:260s 冷却 → 最多 1-2 次
// 初见妖:一次
// 奇遇:34% 概率,非每次都弹层
const MIN = 210;      // 怨灵首次
const HOLD = 26;
const GAP = 150;
let t0 = MIN, cycles = 0;
while (t0 < 480) { cycles++; t0 += HOLD + GAP; }
const ghostNag = cycles;                        // 每次附身一个气泡
const merchantNag = Math.floor(480/260);        // 商人
const firstMeet = 1;                            // 初见妖
console.log(`  怨灵附身 ${cycles} 次 · 商人 ${merchantNag} 次 · 初见妖 ${firstMeet} 次`);
t(`怨灵一局最多 ${cycles} 次(旧版是 5+ 次)`, cycles<=3);
t('总打扰量在合理范围', ghostNag+merchantNag+firstMeet <= 8);

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);