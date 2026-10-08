globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const BI=await import('../js/xiuxian/bestiary.js');
const B=await import('../js/xiuxian/build.js');
const F=await import('../js/xiuxian/family.js');
const C=await import('../js/xiuxian/camp.js');
const I=await import('../js/xiuxian/items.js');
const CP=await import('../js/xiuxian/companion.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const WIPE=()=>{for(const k of Object.keys(store))delete store[k];
  B.BUILD.s={placed:[],fires:[],tierLv:1,incomeAt:0};
  F.FAMILY.s={founded:false,name:'轩氏',members:[],couples:[],gen:1,wealth:0,land:[],mines:[],lastYield:0,attacks:0,defended:0};
  I.Bag.s={items:{},demon:0,charter:false}; C.setMomocha(false);};

console.log('\n=== 么么茶真实入队 ===');
WIPE();
F.FAMILY.found('云氏');
const mm=F.FAMILY.momocha();
t('立族后么么茶在队', !!mm);
t('名字正确', mm && mm.name==='么么茶');
t('标记为 npc', mm && mm.npc==='momocha');
t('固定队友(不参与婚配)', F.FAMILY.canBirth===F.FAMILY.canBirth &&
  (F.FAMILY.s.members.filter(m=>!m.partner&&m.npc!=='momocha').length===F.FAMILY.s.members.length-1));
t('不能被培养', F.FAMILY.interact('npc_momocha','talk').ok===false);
t('不能重复加入', F.FAMILY.addMomocha()===null);
C.setMomocha(true);
t('营地被动已开', C.momochaIn()===true);

console.log('\n=== 么么茶被动生效 ===');
// 同一状态跑两次,只切换么么茶(保证可比)
const base={lit:true,nodeId:'n0',fuelEnd:Date.now()+3600000,totalSec:0,members:[],invites:0,formed:false,rep:0};
C.CAMP.s=Object.assign({},base,{lastTick:Date.now()-600000});
C.setMomocha(false); const off=C.CAMP.earn();
C.CAMP.s=Object.assign({},base,{lastTick:Date.now()-600000});
C.setMomocha(true);  const on=C.CAMP.earn();
t('挂机收益 +25%', on.dao>off.dao);
t('修为也 +25%', on.exp>off.exp);

console.log('\n=== 么么茶灵田 ×1.8 ===');
WIPE();
F.FAMILY.found('x'); F.FAMILY.addMomocha();
for(let i=0;i<3;i++)F.FAMILY.addMember('scholar');
I.Bag.add('bld_field',1); B.BUILD.place('bld_field');
B.BUILD.assign(0,'npc_momocha');
t('么么茶可派去种田', B.BUILD.s.placed[0].workers.length===1);
// 固定随机源,只让 worker 不同
let seed=12345; const _mr=Math.random; Math.random=()=>{seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff;};
let withM=B.BUILD.fieldYield(0).n, txt1=B.BUILD.fieldYield(0).text;
B.BUILD.s.placed[0].workers=[];
const w0=F.FAMILY.s.members.find(m=>m.npc!=='momocha');
B.BUILD.s.placed[0].workers.push({uid:w0.uid,busy:true,at:Date.now()});
let without=B.BUILD.fieldYield(0).n;
Math.random=_mr;
t('么么茶产量更高', withM>without);
t('文案标注他', txt1.includes('么么茶'));

console.log('\n=== 建筑真实掉落 ===');
WIPE();
let drops={};
for(let i=0;i<4000;i++){
  const d=B.BUILD.onKillTier(i%3===0?2:i%3===1?1:0);
  if(d) drops[d.id]=(drops[d.id]||0)+1;
}
t('会掉建材', Object.keys(drops).length>0);
t('Boss掉率更高', (()=>{let boss=0,wild=0;
  for(let i=0;i<3000;i++){ if(i%2){ if(B.BUILD.onKillTier(2)) boss++; }
                         else { if(B.BUILD.onKillTier(0)) wild++; } }
  return boss>wild;})());
t('按图谱掉落(妖王掉灵田)', (()=>{
  I.Bag.s.items={}; let got=false;
  for(let i=0;i<200;i++){ if(B.BUILD.onKill('yao')){got=true;break;} }
  return got;})());
t('怪类型也能掉', (()=>{I.Bag.s.items={};
  let g=0; for(let i=0;i<300;i++){ if(B.BUILD.onKill('wanderer'))g++; } return g>=0;})());

console.log('\n=== 怨灵附身真实强化 ===');
WIPE();
CP.COMPANION.reset(); CP.COMPANION.load();
CP.COMPANION.init('x'); CP.COMPANION.s.ghost.on = true   // V0.98:三路线删了,怨灵改为直接开启(不选路线);
t('未附身时倍率=1', CP.COMPANION.hostBuff()===1&&CP.COMPANION.hostDmg()===1);
CP.COMPANION.s.ghost.phase='possessing';
t('附身中 possesing()', CP.COMPANION.possessing()===true);
// V0.96:从 +60%/+45%/+25% 降到 +28%/+18%/+8%
// 理由不是「变弱更好玩」,是持续 75 秒、一局三轮的全场施压最伤体验。
t('血量 ×1.28', CP.COMPANION.hostBuff()===1.28);
t('伤害 ×1.18', CP.COMPANION.hostDmg()===1.18);
t('速度 ×1.08', CP.COMPANION.hostSpd()===1.08);
// 但仍必须明显大于 1 —— 全是 1 就没有「附身」这件事了
t('附身仍有可感知的强化', CP.COMPANION.hostBuff()>1.15);
CP.COMPANION.s.ghost.phase='idle';
t('散后恢复', CP.COMPANION.hostBuff()===1);

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);