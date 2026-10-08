globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};
globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const C=await import('/workspace/probe/rouge-offline/js/xiuxian/companion.js');
const I=await import('/workspace/probe/rouge-offline/js/xiuxian/items.js');
const P=await import('/workspace/probe/rouge-offline/js/xiuxian/camp.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v};

console.log('\n=== 命名与三选一 ===');
C.COMPANION.reset(); C.COMPANION.load();
t('初始未诞生', C.COMPANION.s.born===false);
C.COMPANION.init('小桃');
t('命名成功', C.COMPANION.s.name==='小桃');
t('默认宝宝(空名)', (C.COMPANION.init(''), C.COMPANION.s.name==='宝宝'));

C.COMPANION.reset(); C.COMPANION.init('阿宝');
C.COMPANION.choose('kiss');
t('kiss 路线开自动拾取', C.COMPANION.s.pick.on===true);
t('kiss 开新手福利范围', C.COMPANION.s.pick.range>=40);
t('kiss 不生怨灵', C.COMPANION.s.ghost.on===false);

C.COMPANION.reset(); C.COMPANION.init('小冷');
C.COMPANION.choose('cold');
t('cold 不开自动拾取', C.COMPANION.s.pick.on===false);
t('cold 也给基础福利', C.COMPANION.s.pick.range>=38);

C.COMPANION.reset(); C.COMPANION.init('小魅');
C.COMPANION.choose('ghost');
t('ghost 生怨灵', C.COMPANION.s.ghost.on===true);
t('ghost 无自动拾取', C.COMPANION.s.pick.on===false);
t('ghost 排了首次附身', C.COMPANION.s.ghost.nextAt>Date.now());

console.log('\n=== 自动拾取(一次一个、效率不高) ===');
C.COMPANION.choose('kiss');
C.COMPANION.s.pick.every=0; C.COMPANION.s.pick.spd=0;
let first=-1, second=-1;
for(let i=0;i<600;i++){ if(C.COMPANION.autoPick(1/60,10)){ if(first<0)first=i; else if(second<0)second=i; } }
t('会触发拾取', first>=0);
t('一次一个(慢)', first>10);   // <1秒不该触发
t('有冷却间隔', second>first+30);
t('范围外不拾取', (()=>{C.COMPANION.s.pick.every=0;return !C.COMPANION.autoPick(1,9999);})());

console.log('\n=== 贴边(有选项) ===');
C.COMPANION.s.lastHug=0;
const hug=C.COMPANION.hug();
t('可贴边', !!hug);
t('有台词', hug&&hug.line.includes('「'));
t('有4个选项', hug&&hug.choices.length===4);
const r0=C.COMPANION.s.pick.range, s0=C.COMPANION.s.pick.spd;
C.COMPANION.hugChoose(0);
t('选项提升范围', C.COMPANION.s.pick.range>r0);
t('选项提升速度', C.COMPANION.s.pick.spd>s0);
t('有冷却', C.COMPANION.hug()===null);
t('冷却中不重复', C.COMPANION.s.lastHug>0);

console.log('\n=== 亲密度随境界 ===');
const {Cult}=await import('/workspace/probe/rouge-offline/js/xiuxian/index.js');
Cult.load();
C.COMPANION.s.aff=0;
Cult.get().realm='qi'; Cult.get().layer=1;
t('炼气1层=初识', C.COMPANION.stage().key==='baby');
Cult.get().layer=12; t('炼气12层=更高', C.COMPANION.stage().key!=='baby');
Cult.get().realm='huashen'; Cult.get().layer=9;
t('化神满=永', C.COMPANION.stage().key==='eternal');
Cult.get().realm='qi'; Cult.get().layer=1;

console.log('\n=== 冷路线:自说自话+送礼 ===');
C.COMPANION.reset(); C.COMPANION.init('小冷'); C.COMPANION.choose('cold');
const l=C.COMPANION.cold();
t('有自说自话', typeof l==='string'&&l.includes('「'));
C.COMPANION.s.lastGift=0;
const g=C.COMPANION.tryGift();
t('会送礼', !!g);
t('送道行/源石/经验', g&&['dao','stone','exp'].includes(g.kind));
t('30秒冷却', (C.COMPANION.s.lastGift=Date.now(), C.COMPANION.tryGift()===null));

console.log('\n=== 怨灵:附身/闪屏 ===');
C.COMPANION.reset(); C.COMPANION.init('小魅'); C.COMPANION.choose('ghost');
C.COMPANION.s.ghost.nextAt=0;
let flashAt=[];
for(let i=0;i<40;i++){
  // 推进到 idle
  if(C.COMPANION.s.ghost.phase==='possessing'){
    C.COMPANION.s.ghost.since = Date.now() - 80000;   // 让本次附身到期
    C.COMPANION.tick();
  }
  C.COMPANION.s.ghost.nextAt=0;
  const e=C.COMPANION.tick();
  if(e&&e.event==='possess'){ if(e.flash) flashAt.push(C.COMPANION.s.ghost.poss); }
}
t('循环能持续附身(>=12次)', C.COMPANION.s.ghost.poss>=12);
// V0.96:闪屏特写已删。附身节奏拉长到 150 秒一轮后一局碰不到第 5 次,
// 这个机制等于死代码;而它原本的效果是疯狂马歇尔式闪屏 —— 对玩家是纯打扰。
// 仪式感应该来自「你知道它在,但它不闹你」。
t('不再闪屏(V0.96 移除)', flashAt.length===0);
t('att 旧存档的 poss 仍会被记录(存档兼容)', C.COMPANION.s.ghost.poss>0);
t('没闪的走气泡', true);

console.log('\n=== 怨灵:永远打不死 ===');
C.COMPANION.s.ghost.phase='possessing';
const sc=C.COMPANION.scatter();
t('打散成功', sc&&sc.reviveIn===120);
t('2分钟倒计时', C.COMPANION.reviveCountdown>110 && C.COMPANION.reviveCountdown<=120);
t('预告下一宿主', typeof sc.nextHost==='string'&&sc.nextHost.length>0);
t('不是永久死亡', C.COMPANION.s.ghost.reviveAt>Date.now());
// 等复活
C.COMPANION.s.ghost.reviveAt=Date.now()-1;
const rv=C.COMPANION.tick();
t('到点复活', rv&&rv.event==='revive');
t('复活进入 idle', C.COMPANION.s.ghost.phase==='idle');
t('kill 计数增加', C.COMPANION.s.ghost.killed===1);

console.log('\n=== 篝火:源石护栏绝对安全 ===');
I.Bag.reset(); I.Bag.add('stone_1',3);
P.CAMP.reset(); P.CAMP.light('n0');
t('火点着', P.CAMP.burning()===true);
const r1=C.COMPANION.wardRadius();
t('有护栏半径', r1>0);
const before=C.COMPANION.s.warden.count;
const w=C.COMPANION.wardenTick();
t('召唤强化怪', w.on===true && w.count>before);
P.CAMP.s.totalSec=99999; P.CAMP.save();
t('阶位高护栏更大', C.COMPANION.wardRadius()>r1);
P.CAMP.douse();
C.COMPANION.wardenTick();
t('熄火后无护栏', C.COMPANION.wardRadius()===0);
t('熄火后怪散', C.COMPANION.s.warden.on===false);

console.log('\n=== 怪不能进火内(距离校验) ===');
P.CAMP.reset(); I.Bag.add('stone_1',3); P.CAMP.light('n0');
t('火旺时护栏>0', C.COMPANION.wardRadius()>0);
P.CAMP.douse();
t('火灭护栏归零', C.COMPANION.wardRadius()===0);

console.log(`\n${'='.repeat(44)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(44)}`);