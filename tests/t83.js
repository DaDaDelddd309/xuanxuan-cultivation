globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const P='../js/xiuxian/';
const BI=await import(P+'bestiary.js');   // 先导入,触发建筑注册
const B=await import(P+'build.js');
const I=await import(P+'items.js'), F=await import(P+'family.js'), C=await import(P+'camp.js');
const FRESH={
  build:()=>{B.BUILD.s={placed:[],fires:[],tierLv:1,incomeAt:0};},
  family:()=>{F.FAMILY.s={founded:false,name:'轩氏',members:[],couples:[],gen:1,
    wealth:0,land:[],mines:[],lastYield:0,attacks:0,defended:0};},
  bag:()=>{I.Bag.s={items:{},demon:0,charter:false};},
};
const WIPE=()=>{
  for(const k of Object.keys(store))delete store[k];
  FRESH.build(); FRESH.family(); FRESH.bag();
};
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};

console.log('\n=== 怪物图谱 ===');
t('8种怪物', Object.keys(BI.BESTIARY).length===8);
t('都有立绘', Object.values(BI.BESTIARY).every(m=>m.img&&m.img.includes('assets/mob/')));
t('都有简介+背景', Object.values(BI.BESTIARY).every(m=>m.desc&&m.lore));
t('都有掉落', Object.values(BI.BESTIARY).every(m=>Array.isArray(m.drops)&&m.drops.length));
t('境界递增', (()=>{const o=['炼气','炼气','筑基','筑基','金丹','金丹','元婴','化神'];
  const v=Object.values(BI.BESTIARY); let ok=true; for(let i=1;i<v.length;i++) if(o.indexOf(v[i].realm)<o.indexOf(v[i-1].realm))ok=false; return ok})());

console.log('\n=== 建筑 ===');
t('7种建筑', Object.keys(BI.BUILDINGS).length===7);
t('都有名字图标', Object.values(BI.BUILDINGS).every(b=>b.name&&b.icon));
t('灵田有产出', !!BI.BUILDINGS.bld_field.out);
t('丹炉有产出', !!BI.BUILDINGS.bld_furnace.out);

console.log('\n=== 领地阶位 ===');
t('5阶(篝火→宗门)', BI.TIERS.length===5);
t('阶位递增', BI.TIERS.every((x,i)=>i===0||x.lv>BI.TIERS[i-1].lv));
t('槽位递增至6', BI.TIERS[4].slots===6);
t('晋升需多篝火', BI.TIERS[4].need.fires===3);
t('宗门需16人3篝火', BI.TIERS[4].need.pop===16&&BI.TIERS[4].need.fires===3);
t('无死锁(需求≤上阶槽位)', BI.TIERS.every((x,i)=> i===0 || x.need.builds<=BI.TIERS[i-1].slots));

console.log('\n=== 放置 ===');
WIPE();
WIPE();
t('无建材不能放', B.BUILD.place('bld_furnace').ok===false);
I.Bag.add('bld_furnace',2); I.Bag.add('bld_field',1);
const p1=B.BUILD.place('bld_furnace');
t('放置成功', p1.ok===true);
t('消耗1个', I.Bag.count('bld_furnace')===1);
t('占1格', B.BUILD.s.placed.length===1);
t('2格上限只能放2个', (B.BUILD.place('bld_furnace').ok===true) && B.BUILD.s.placed.length===2);
t('第3个失败(超槽位)', B.BUILD.place('bld_field').ok===false);
// 初始 2 个丹炉,放1用1,放1用1 → 剩 0,拆1 → 1
t('拆除全额返还', (B.BUILD.remove(0).ok===true) && I.Bag.count('bld_furnace')===1);

console.log('\n=== 晋升 ===');
WIPE();
WIPE();
t('LV1 是篝火', B.BUILD.tier().name==='篝 火');
t('条件不足不能晋', B.BUILD.canPromote().ok===false);
t('提示缺什么', B.BUILD.canPromote().msg.includes('建筑'));
I.Bag.add('bld_furnace',3);
B.BUILD.place('bld_furnace');B.BUILD.place('bld_furnace');
F.FAMILY.found('测试');
for(let i=0;i<2;i++)F.FAMILY.addMember('scholar');
t('建筑齐了(2/2)', B.BUILD.s.placed.length===2);
t('人口当前4(么么茶+3)', F.FAMILY.s.members.length===4);
const pk=B.BUILD.canPromote();
t('人口已够,可晋升', pk.ok===true);
t('人口已够可晋升', B.BUILD.canPromote().ok===true);
const pr=B.BUILD.promote();
t('晋升成功', pr.ok===true);
t('LV2=村落', B.BUILD.tier().name==='村 落');
t('槽位变3', B.BUILD.slots()===3);

console.log('\n=== 值守效率 ===');
WIPE();
WIPE();
F.FAMILY.found('x');
for(let i=0;i<4;i++)F.FAMILY.addMember('scholar');
I.Bag.add('bld_field',1);
B.BUILD.place('bld_field');
t('1人×1.0', B.BUILD.efficiency(1)===1.0);
t('2人×1.6', B.BUILD.efficiency(2)===1.6);
t('3人×2.1', B.BUILD.efficiency(3)===2.1);
t('0人无产出', B.BUILD.efficiency(0)===0);
t('灵田可派3人', B.BUILD.canAssign(0).maxW===3);
const f0=F.FAMILY.s.members[0].uid;
B.BUILD.assign(0,f0);t('派人成功', B.BUILD.s.placed[0].workers.length===1);
B.BUILD.assign(0,F.FAMILY.s.members[1].uid);
B.BUILD.assign(0,F.FAMILY.s.members[2].uid);
t('派满3人', B.BUILD.s.placed[0].workers.length===3);
t('第4人被拒', B.BUILD.canAssign(0).ok===false);
t('一键满编无闲人', B.BUILD.autoFill().n===0);

WIPE();
F.FAMILY.found('x');F.FAMILY.addMember('scholar');F.FAMILY.addMember('scholar');F.FAMILY.addMember('scholar');
I.Bag.add('bld_field',1);
const pp=B.BUILD.place('bld_field');
console.log('   放置灵田:',pp.ok,pp.msg||'');
console.log('\n=== 灵田 10 分钟 ===');
WIPE();
F.FAMILY.found('x');F.FAMILY.addMember('scholar');F.FAMILY.addMember('scholar');F.FAMILY.addMember('scholar');
I.Bag.add('bld_field',1);B.BUILD.place('bld_field');
B.BUILD.assign(0,F.FAMILY.s.members[0].uid);
t('周期=10分钟', B.FIELD_PERIOD===600000);
const r0=B.BUILD.tickField(0);
t('首次下种', !!(r0&&r0.msg&&r0.msg.includes('10 分钟')));
const rr=B.BUILD.tickField(0);
t('未成熟显示剩余分钟', !!(rr&&rr.left>0&&rr.left<=10));
B.BUILD.s.placed[0].plantAt=Date.now()-1;
const rd=B.BUILD.tickField(0);
t('成熟可收', !!(rd&&rd.ready&&rd.n>0));
t('产量受属性影响', (()=>{let mn=99,mx=0;
  for(let i=0;i<80;i++){const y=B.BUILD.fieldYield(0); if(y.n<mn)mn=y.n; if(y.n>mx)mx=y.n;}
  return mx>mn})());
t('区域密度加成', B.BUILD.fieldBonus('n8')>B.BUILD.fieldBonus('n0'));
t('妖巢附近产量更高', B.BUILD.fieldBonus('n8')>B.BUILD.fieldBonus('n9'));

console.log('\n=== 多篝火 ===');
WIPE();
B.BUILD.reset();B.BUILD.load(); I.Bag.reset();
t('默认1处(火旺时)', B.BUILD.fireCount()>=1);
t('可新增', B.BUILD.addFire('n5').ok===true);
t('同处不能重复', B.BUILD.addFire('n5').ok===false);
B.BUILD.addFire('n8');          // 第2处
B.BUILD.addFire('n2');          // 第3处
const r4=B.BUILD.addFire('n3');  // 第4处 → 应被拒
t('第4处被拒(最多3)', r4.ok===false && /最多 3/.test(r4.msg||''));
t('篝火上限为3', B.BUILD.s.fires.length===3);
t('篝火计入晋升条件', B.BUILD.fireCount()===3);

console.log('\n=== 固定NPC图鉴 ===');
// V0.99(7856c5e「燎原」)把灵伴三形(宝宝/鬼火/怨灵)判为无意义
// ——它们本就是同一个人的三种说法 —— 合并为 1 个 NPC,并删掉 route 字段。
// 原断言数的是 6 个,现为 4 个;ghostfire/revenant 已不存在,引用即崩。
const N=Object.keys(BI.NPCS);
t('4个NPC', N.length===4);
t('名单与预期一致', ['baby','merchant','momocha','moying'].every(k=>N.includes(k)));
t('已删的三形不再出现', !('ghostfire' in BI.NPCS) && !('revenant' in BI.NPCS));
t('宝宝=灵伴', BI.NPCS.baby.form==='灵 伴');
t('宝宝无威胁(不打扰)', BI.NPCS.baby.threat.includes('不会主动打扰'));
t('商人标注不打断', BI.NPCS.merchant.ability.includes('不打断'));
t('么么茶是固定NPC', BI.NPCS.momocha.recruit.includes('无需招募'));
t('墨影=宿敌', BI.NPCS.moying.form==='宿 敌');
t('墨影威胁极高', BI.NPCS.moying.threat==='极高');
t('都有人物背景', Object.values(BI.NPCS).every(n=>n.bio&&n.bio.length>20));
t('都有能力说明', Object.values(BI.NPCS).every(n=>n.ability));
t('都有立绘', Object.values(BI.NPCS).every(n=>n.img&&n.img.startsWith('assets/portrait/')));

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);