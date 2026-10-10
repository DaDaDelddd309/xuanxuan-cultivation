// 灵伴 · 怨灵系统 + 篝火护栏(工单 XX-COMP-003 / XX-FIX-003 / XX-SPAWN-002)
//
// 运行: node tests/t81.js
//
// 【为什么这个文件被重写过】
// 原 t81 测的是 V0.98 之前的灵伴:三选一路线(kiss/cold/ghost)、亲密度、
// 贴边弹窗、送礼、亲密度分级。V0.98 那次「灵伴重做」把这些**整体删掉了**
// ——不是坏了,是设计上决定不要了(理由见 js/xiuxian/companion.js 顶部注释):
// 割草游戏的情感语言是动作,不是菜单;菜单层的点击农场是假情感。
// 但测试没跟着重写,于是从 7856c5e(V0.99)起这个文件就一直在报 TypeError,
// 而且是**红色的状态被提交进了仓库**。
//
// 【分工,别重复造轮子】
// 灵伴的生命周期本身(取名/开局/生死/台词/年表/存档往返)在
//   tests/test-companion.mjs   —— 已完整覆盖 XX-COMP-001~006,别往这边再抄一遍
// 本文件只负责 test-companion.mjs 没覆盖的两块:
//   ① 怨灵系统的完整状态机(它被明确保留为「玩法机制」)
//   ② 篝火护栏 wardRadius / wardenTick(与篝火、昼夜、拾取范围的耦合)
globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};
globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const C=await import('../js/xiuxian/companion.js');
const I=await import('../js/xiuxian/items.js');
const P=await import('../js/xiuxian/camp.js');
let pass=0,fail=0;const t=(n,c,d='')=>{c?pass++:(fail++,console.log('  ❌',n,d?(':: '+d):''))};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>{delete store[k]}};
const co=C.COMPANION;

// ============================================================
console.log('\n=== 诞生与取名 ===');
co.reset();
t('初始未诞生', co.born()===false);
co.init('小满');
t('取名后已诞生', co.born()===true);
t('名字生效', co.s.name==='小满');
t('已存的名字优先于传入名', co.get('备用')==='小满' && co.get()==='小满');
co.s.name='';
t('无名字时用传入名', co.get('备用')==='备用');
t('无名字也无参数时回落宝宝', co.get()==='宝宝');
co.init('');
t('空名不覆盖已有默认', co.born()===false);

// 旧 API 不得复活:重做是有意为之,不是意外删错
console.log('\n=== 旧路线系统已移除(防回潮) ===');
for(const m of ['choose','hug','hugChoose','tryGift','canHug','stage','cold'])
  t(`${m} 已不存在`, typeof co[m]!=='function');
t('无 s.route', !('route' in co.s));
t('无 s.pick',  !('pick'  in co.s));
t('无 s.aff',   !('aff'   in co.s));

// ============================================================
console.log('\n=== 怨灵:默认关闭 ===');
co.reset();
t('默认不启用', co.s.ghost.on===false);
t('未启用时 tick 无事发生', co.tick()===null);
t('未启用时无台词', co.ghostLine()===null);
t('未启用时无加成', co.hostBuff()===1 && co.hostDmg()===1 && co.hostSpd()===1);
t('未启用时不算附身', co.possessing()===false);

// ============================================================
console.log('\n=== 怨灵:附身循环 ===');
co.s.ghost.on=true; co.s.ghost.cd=0;
const ev=co.tick();
t('到点触发附身', ev&&ev.event==='possess', `实际 ${JSON.stringify(ev)}`);
t('进了附身态', co.s.ghost.phase==='possessing');
t('附身有宿主', typeof ev.host==='string'&&ev.host.length>0);
t('次数累加', co.s.ghost.count===1);
t('附身中有一句台词', co.ghostLine()==='「借你的剑用一用。」');
t('附身给宿主加成', co.hostBuff()===1.28 && co.hostDmg()===1.18 && co.hostSpd()===1.08);
t('possessing() 为真', co.possessing()===true);
t('附身中倒计时为 0', co.reviveCountdown()===0);
t('未到期不再触发', co.tick()===null);

// ============================================================
console.log('\n=== 怨灵:打散与冷却 ===');
const sc=co.scatter();
t('打散成功', !!sc);
t('回到 idle', co.s.ghost.phase==='idle');
t('预告下一宿主', typeof sc.msg==='string'&&sc.msg.includes('宿主'));
const cd=co.reviveCountdown();
t('冷却约 210 秒', cd>200&&cd<=210, `实际 ${cd}`);
t('冷却中不再附身', co.tick()===null);
t('散了就无加成', co.hostBuff()===1 && co.possessing()===false);
t('散了就没台词', co.ghostLine()===null);

// 到点自动再附身
co.s.ghost.cd=Date.now()-1;
const ev2=co.tick();
t('冷却结束自动再附身', ev2&&ev2.event==='possess');
t('次数累加到 2', co.s.ghost.count===2);

// ============================================================
console.log('\n=== 篝火护栏 ===');
P.CAMP.reset(); I.Bag.reset();
t('无火时护栏为 0', co.wardRadius()===0);
I.Bag.add('stone_1',3);
const lit=P.CAMP.light('n0');
t('火点着', lit.ok===true && P.CAMP.burning()===true);
const w1=co.wardRadius(20);
t('有火时护栏>0', w1>0, `实际 ${w1}`);
t('护栏不低于硬下限', co.wardRadius(9999)>=48);
P.CAMP.s.totalSec=99999; P.CAMP.save();
const w5=co.wardRadius(20);
t('篝火升阶护栏更大', w5>w1, `lv1=${w1} lv5=${w5}`);
t('升阶后仍>0', w5>0);

// ============================================================
console.log('\n=== 怨灵被篝火驱散 ===');
co.s.ghost.on=true; co.s.ghost.cd=0; co.tick();
t('附身中', co.s.ghost.phase==='possessing');
t('火旺时 wardenTick 返回怨灵状态', co.wardenTick()!==null);
P.CAMP.douse();
t('熄火后护栏归零', co.wardRadius()===0);
t('熄火后 wardenTick 不再干预', co.wardenTick()===null);
t('熄火不影响怨灵本体', co.s.ghost.phase==='possessing'&&co.hostBuff()===1.28);

console.log(`\n${'='.repeat(44)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(44)}`);
if(fail) process.exit(1);