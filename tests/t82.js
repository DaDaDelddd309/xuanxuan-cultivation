globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const P='../js/xiuxian/';
const F=await import(P+'family.js'), CH=await import(P+'chronicle.js'), PR=await import(P+'profile.js');
const I=await import(P+'items.js'), C=await import(P+'camp.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};

console.log('\n=== 家族:立族 ===');
F.FAMILY.reset();F.FAMILY.load();
t('未立族',F.FAMILY.s.founded===false);
t('不能直接繁衍',F.FAMILY.canBirth()===false);
const fr=F.FAMILY.found('云氏');
t('立族成功',fr.ok&&F.FAMILY.s.name==='云氏');
t('送么么茶+长老',F.FAMILY.s.members.length===2&&F.FAMILY.s.members.some(m=>m.npc==='momocha')&&F.FAMILY.s.members.some(m=>m.role==='elder'));
t('重复立族失败',F.FAMILY.found('x').ok===false);

console.log('\n=== 家族:繁衍 ===');
F.FAMILY.s.wealth=1000;
F.FAMILY.addMember('warrior');F.FAMILY.addMember('scholar');
t('有两对未婚',F.FAMILY.s.members.filter(m=>!m.partner).length>=2);
t('可繁衍',F.FAMILY.canBirth()===true);
const b=F.FAMILY.birth();
t('繁衍成功',b.ok===true);
t('生了一个孩子',F.FAMILY.s.members.length===5);
t('孩子代数+1',F.FAMILY.s.members.find(m=>m.uid===b.baby.uid).gen>1);
t('父母配对',F.FAMILY.member(F.FAMILY.s.members[1].uid).partner!==null);
t('扣了200资产',F.FAMILY.s.wealth===800);
t('可再次繁衍(人口足够)',F.FAMILY.birth().ok===true);
t('再繁衍扣200',F.FAMILY.s.wealth===600);

console.log('\n=== 家族:关系培养 ===');
const m0=F.FAMILY.s.members.filter(x=>x.npc!=='momocha')[2]||F.FAMILY.s.members[2];
const a0=m0.aff,l0=m0.lv;
const r1=F.FAMILY.interact(m0.uid,'talk');
t('叙话涨忠诚',r1.ok&&F.FAMILY.member(m0.uid).aff>a0);
t('叙话扣资产(20)',F.FAMILY.s.wealth===580);
const r2=F.FAMILY.interact(m0.uid,'train');
t('督修涨层数',F.FAMILY.member(m0.uid).lv>l0);
const b0=I.Bag.count('stone_1');
F.FAMILY.interact(m0.uid,'gift');
t('赠源石给族人',I.Bag.count('stone_1')>=b0);

console.log('\n=== 家族:族产 ===');
F.FAMILY.s.members=F.FAMILY.s.members.filter(m=>m.npc==='momocha');
F.FAMILY.addMember('miner');F.FAMILY.addMember('alchemist');
F.FAMILY.addMember('scholar');F.FAMILY.addMember('warrior');
const y=F.FAMILY.yieldDay();
t('矿师产源石',y.stone>0);
t('丹师产丹',y.pill>0);
t('修士产修为',y.exp>0);
t('战修产道行',y.dao>0);

console.log('\n=== 家族:领地/围攻/求援 ===');
F.FAMILY.s.wealth=1000;
F.FAMILY.claim('n0');F.FAMILY.claim('n1');
t('领地2处',F.FAMILY.s.land.length===2);
t('重复占领失败',F.FAMILY.claim('n0').ok===false);
t('有被围攻可能',F.FAMILY.attackChance()>=0);
F.FAMILY.s.wealth=1000;
const h=F.FAMILY.callHelp();
t('求援扣100',h.ok&&F.FAMILY.s.wealth===900);
t('求援有战力',h.power>0);
const at=F.FAMILY.resolveAttack();
t('围攻结算',typeof at.ok==='boolean');
t('围攻次数+1',F.FAMILY.s.attacks>=1);

console.log('\n=== 万年历 ===');
CH.CHRONICLE.reset();CH.CHRONICLE.load();
// V0.99(XX-FIX-003)起 CHRONICLE 不再自己数日子,day() 内部只调 CLOCK.action(),
// 而 CLOCK 的 1 游戏日 = 12 行动。所以「1 年」不再是 12 次 day(),
// 而是 12(日) × 12(行动/日) = 144 次。旧的 12 次写法已失效。
// 注意:day() 这个名字现在是历史遗留 —— 它实际推进的是「一次行动」,不是「一天」。
const PER_YEAR=144;
t('初始第1年',CH.CHRONICLE.s.year===1);
for(let i=0;i<PER_YEAR;i++)CH.CHRONICLE.action();
t('144次推进=1年',CH.CHRONICLE.s.year===2);
t('第2年有事件',CH.CHRONICLE.s.log.length===1);
t('怪物变强',CH.CHRONICLE.mobMul()>1);
for(let i=0;i<PER_YEAR*3;i++)CH.CHRONICLE.action();   // 累计 576 次 → 第 5 年
t('第5年源石涨价',CH.CHRONICLE.stoneMul()>1);
t('第5年Boss变强',CH.CHRONICLE.bossMul()>1);
t('有时间戳',CH.CHRONICLE.stamp().includes('年'));

console.log('\n=== 统一存档 + 种子 ===');
PR.Seed.set('青石村');
t('种子可设',PR.Seed.get()==='青石村');
const seq1=[PR.Seed.next(),PR.Seed.next(),PR.Seed.next()];
PR.Seed.set('青石村');
const seq2=[PR.Seed.next(),PR.Seed.next(),PR.Seed.next()];
t('同种子=同序列',JSON.stringify(seq1)===JSON.stringify(seq2));
PR.Seed.set('黑风岭');
const seq3=[PR.Seed.next(),PR.Seed.next(),PR.Seed.next()];
t('异种子=异序列',JSON.stringify(seq1)!==JSON.stringify(seq3));
t('随机在0-1',seq1.every(x=>x>=0&&x<1));
PR.Seed.set('青石村');
t('int范围正确',(()=>{for(let i=0;i<100;i++){const v=PR.Seed.int(5,10);if(v<5||v>10)return false}return true})());
t('weighted会返回元素',['a','b','c'].includes(PR.Seed.weighted(['a','b','c'],()=>1)));
// 导出导入
PR.Profile.data={...PR.Profile.data,seed:'测试种子',cult:{realm:'qi',layer:5,dao:1234}};
const code=PR.Profile.export();
t('导出有内容',code.length>50);
t('导入成功',PR.Profile.import(code).ok===true);
t('导入还原道行',PR.Profile.data.cult.dao===1234);
t('导入坏码不崩',PR.Profile.import('乱码!!!').ok===false);

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);