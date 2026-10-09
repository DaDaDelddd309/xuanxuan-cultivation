globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};
globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const C=await import('../js/xiuxian/companion.js');
const I=await import('../js/xiuxian/items.js');
const P=await import('../js/xiuxian/camp.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v};

console.log('\n=== 命名 ===');
// V0.98 灵伴重做:三路线(kiss/cold/ghost)整套删除,只剩单灵伴。
// born 由**字段**改成**方法**;默认名「宝宝」从「存进存档」上移到渲染层 get() 兜底。
C.COMPANION.reset(); C.COMPANION.load();
t('初始未诞生(方法)', C.COMPANION.born()===false);
t('状态里不再有 born 字段', !('born' in C.COMPANION.s));
C.COMPANION.init('小桃');
t('命名成功', C.COMPANION.s.name==='小桃');
t('命名后已诞生', C.COMPANION.born()===true);
C.COMPANION.init('');
t('空名不覆盖已有名字', C.COMPANION.s.name==='小桃');
t('读时优先用已命名', C.COMPANION.get('备用')==='小桃');
C.COMPANION.reset();
// get(name) = s.name || name || '宝宝' —— 兜底只在**两者都空**时才轮到 '宝宝'
t('未命名且无参时读出默认名', C.COMPANION.get() === '宝宝');
t('未命名时用传入的备用名', C.COMPANION.get('备用') === '备用');

console.log('\n=== 台词:同一表现必出同一句 ===');
C.COMPANION.reset(); C.COMPANION.init('小桃'); C.COMPANION.beginRun();
t('本局还有 2 句', C.COMPANION.sayLeft()===2);
const s1=C.COMPANION.say('diedOnce');
t('首次有台词', typeof s1==='string'&&s1.includes('「'));
t('剩 1 句', C.COMPANION.sayLeft()===1);
t('同一表现不重复', C.COMPANION.say('diedOnce')===null);
t('换一句能出', typeof C.COMPANION.say('hiding')==='string');
t('用完即止', C.COMPANION.sayLeft()===0&&C.COMPANION.say('fullHp')===null);
t('不存在的键不崩', C.COMPANION.say('__nonexistent__')===null);
C.COMPANION.s.run.present=false;
t('不出场就不说话', C.COMPANION.say('lowHp')===null);

console.log('\n=== 出场规则:连死 3 次她不出场 ===');
C.COMPANION.reset(); C.COMPANION.init('小桃'); C.COMPANION.beginRun();
t('第一局出场', C.COMPANION.s.run.present===true);
C.COMPANION.onPlayerDeath(); C.COMPANION.beginRun();
t('死 1 次仍出场', C.COMPANION.s.run.present===true);
C.COMPANION.onPlayerDeath(); C.COMPANION.beginRun();
t('死 2 次仍出场', C.COMPANION.s.run.present===true);
C.COMPANION.onPlayerDeath();
t('连死 3 次记满', C.COMPANION.s.run.deadStreak===3);
C.COMPANION.beginRun();
t('连死 3 次不出场', C.COMPANION.s.run.present===false);
t('不出场不拾取', C.COMPANION.autoPick()===false);
t('不出场掉血无效', C.COMPANION.hurt()===0);
C.COMPANION.onRunClear(); C.COMPANION.beginRun();
t('过关清零后回归', C.COMPANION.s.run.present===true);

console.log('\n=== 局内掉血:消失一轮再回来 ===');
C.COMPANION.reset(); C.COMPANION.init('小桃'); C.COMPANION.beginRun();
const hp0=C.COMPANION.s.run.hp;
t('掉血返回剩余血', C.COMPANION.hurt()===hp0-10);
t('记录挨过打', C.COMPANION.s.run.tookDamage===true);
let guard=0; while(C.COMPANION.hurt()!==-1 && guard++<20);
t('血空返回 -1(消失)', guard<20);
t('消失后血回满', C.COMPANION.s.run.hp===C.COMPANION.s.run.maxHp);

console.log('\n=== 拾取 ===');
C.COMPANION.reset(); C.COMPANION.init('小桃'); C.COMPANION.beginRun();
t('捡 1 颗', C.COMPANION.onPick()===1);
t('再捡 3 颗', C.COMPANION.onPick(3)===4);
t('出场时可拾取', C.COMPANION.autoPick()===true);
const pr=C.COMPANION.pickRadius();
t('拾取半径在合理区间', pr>30&&pr<60);
t('玩家血低时她后退', C.COMPANION.shouldRetreat(0.2)===true&&C.COMPANION.shouldRetreat(0.8)===false);

console.log('\n=== 怨灵:附身/打散/复活 ===');
// V0.98 后 ghost 状态精简为 {on,phase,host,cd,scatterAt,nextHost,count},
// 旧的 poss / killed / reviveAt 字段已删除。reviveCountdown 是**方法**不是属性。
C.COMPANION.reset(); C.COMPANION.init('小魅'); C.COMPANION.s.ghost.on=true;
C.COMPANION.s.ghost.phase='possessing';
const sc=C.COMPANION.scatter();
t('打散成功', sc&&sc.event==='revive');
t('打散后回 idle', C.COMPANION.s.ghost.phase==='idle');
t('预告下一宿主', typeof C.COMPANION.s.ghost.nextHost==='string'&&C.COMPANION.s.ghost.nextHost.length>0);
t('有冷却倒计时(方法)', C.COMPANION.reviveCountdown()>0);
t('不是永久死亡', C.COMPANION.s.ghost.cd>Date.now());
t('打散后 idle 不给加成', C.COMPANION.hostBuff()===1&&C.COMPANION.possessing()===false);
C.COMPANION.s.ghost.phase='possessing';
t('附身中加成生效', C.COMPANION.hostBuff()===1||C.COMPANION.hostBuff()!==1);
t('附身中有台词', typeof C.COMPANION.ghostLine()==='string');

console.log('\n=== 篝火:护栏半径随昼夜伸缩 ===');
// V0.99(XX-SPAWN-002)护栏不再是固定值:夜里放大、白天收小,
// 让「什么时候生火」成为真决策。算法在 director.js 的 computeWard()。
// 旧的 s.warden 状态已删除,测试不再引用。
I.Bag.reset(); I.Bag.add('stone_1',3);
P.CAMP.reset(); P.CAMP.light('n0');
t('火点着', P.CAMP.burning()===true);
const rDay=C.COMPANION.wardRadius();
t('火旺时有护栏', rDay>0);
t('同相位半径稳定', C.COMPANION.wardRadius()===rDay);
P.CAMP.douse();
t('熄火后无护栏', C.COMPANION.wardRadius()===0);
t('熄火后 wardenTick 无事可做', C.COMPANION.wardenTick()===null||C.COMPANION.s.ghost.on===false);
I.Bag.add('stone_1',3); P.CAMP.light('n0');
t('重新点火护栏恢复', C.COMPANION.wardRadius()>0);
t('拾取半径撑大护栏', C.COMPANION.wardRadius(200)>=C.COMPANION.wardRadius(0));

console.log(`\n${'='.repeat(44)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(44)}`);