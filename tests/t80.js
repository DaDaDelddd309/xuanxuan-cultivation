const R=await import('../js/xiuxian/items.js');
const C=await import('../js/xiuxian/camp.js');
const {CLOCK}=await import('../js/xiuxian/clock.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v};

console.log('\n=== 源石分级 ===');
t('6 品源石', R.STONE_LIST.length===6);
t('品阶递增', R.STONE_LIST.every((s,i)=>i===0||s.tier>R.STONE_LIST[i-1].tier));
t('时长递增', R.STONE_LIST.every((s,i)=>i===0||s.dur>R.STONE_LIST[i-1].dur));
t('最短=15分(用户要求)', R.STONE_LIST[0].dur===15);
t('每品有来源', R.STONE_LIST.every(s=>s.src&&s.d));

console.log('\n=== 掉落表(只有Boss掉高阶) ===');
R.Bag.reset();
const boss={}; for(let i=0;i<4000;i++){const r=R.Bag.rollStone(3); if(r) boss[r.id]=(boss[r.id]||0)+1;}
const bS3=(boss.stone_3||0), bS4=(boss.stone_4||0), bS5=(boss.stone_5||0), bS6=(boss.stone_6||0);
let wildS1=0, wildHi=0;
for(let i=0;i<3000;i++){const r=R.Bag.rollStone(0); if(r){ if(r.id==='stone_1') wildS1++; else wildHi++; }}
t('Boss 必出源石(100%)', bS3+bS4+bS5+bS6>3990);
t('Boss 出高阶(4阶+)>25%', bS4+bS5+bS6>1000);
t('Boss 极少出仙品(<5%)', bS6<200);
t('Boss 不掉最低阶', !boss.stone_1);
t('荒野只掉碎灵石', wildHi===0);
t('荒野出率低', wildS1<3000*0.4);

console.log('\n=== 篝火:投石与燃料 ===');
R.Bag.reset(); C.CAMP.reset();
t('无石生火失败', C.CAMP.light('n0').ok===false);
R.Bag.add('stone_1',2);
const lit=C.CAMP.light('n0');
t('有石生火成功', lit.ok===true);
console.log('   燃料分钟 =', C.CAMP.fuelMin(), '| 源石袋 =', JSON.stringify(R.Bag.s.items));
t('燃料>0', C.CAMP.fuelMin()>0);
t('燃烧中', C.CAMP.burning()===true);

console.log('\n=== 数量增减快操 ===');
C.CAMP.s.fuelEnd=Date.now()+60000; C.CAMP.save();
R.Bag.add('stone_2',5);
t('投1颗灵晶=45分', C.CAMP.feed('stone_2',1).added===45);
t('再投2颗=90分', C.CAMP.feed('stone_2',2).added===90);
const over=C.CAMP.feed('stone_2',99);
t('投超量被夹住(不超扣)', over.added<=45*3);

console.log('\n=== 营地升级 / 立宗 ===');
t('5 个阶位', C.CAMP_TIERS.length===5);
t('初阶=篝火', C.CAMP.tier().name==='篝火');
C.CAMP.s.totalSec=1500; C.CAMP.save();
t('累计时长升阶(LV3)', C.CAMP.tier().lv===3);
t('LV3 尚不能传送', C.CAMP.canTeleport()===false);
C.CAMP.s.totalSec=2400; C.CAMP.save();
t('Lv4+ 可传送', C.CAMP.canTeleport()===true);
C.CAMP.s.totalSec=99999; C.CAMP.save();
t('顶级=山门', C.CAMP.tier().name==='山门');
t('无家族令不能立宗', C.CAMP.foundSect().ok===false);
R.Bag.s.charter=true;
t('持令可立宗', C.CAMP.foundSect().ok===true);
t('不能重复立宗', C.CAMP.foundSect().ok===false);

console.log('\n=== 族人 / 传承 ===');
C.CAMP.s.members=[]; C.CAMP.save();
const v=C.CAMP.spawnVisitor();
t('会有人来投宿', !!v);
t('有名字和身份', !!(v&&v.name&&v.title));
R.Bag.add('scroll_1',1);
const before=C.CAMP.s.members[0].lv;
const teach=C.CAMP.teach(C.CAMP.s.members[0].uid,'scroll_1');
t('授传承提升族人', teach.ok===true && C.CAMP.s.members[0].lv>before);
t('传承书被消耗', R.Bag.count('scroll_1')===0);

console.log('\n=== 经验溢出转传承书 ===');
t('转化率 40%', R.OVERFLOW_RATE===0.4);
t('大溢出→高阶书', R.scrollForExp(40000).id!=='scroll_1');
t('小溢出→低阶书', R.scrollForExp(300).id==='scroll_1');

console.log('\n=== 昼夜 ===');
t('12 行动/日', R.DAY.ACTIONS_PER_DAY===12);
// V0.99(XX-FIX-003):phase()/isNight()/bonus() 全部委托 CLOCK,
// DAY.s.actions 已降级为只读镜像,写它不再影响相位 —— 原来这三行写的是失效字段,
// 于是「夜里」成了假通过(CLOCK 一直停在 hour=0,注入的 10 从未生效)。
// 现在直接写 CLOCK.s.actions。
// ⚠️ 不能用 DAY.tick() 代替:tick 会同时推进 ms,tick×3 实测 hour=12→'day',不等于 dawn。
R.DAY.reset(); CLOCK.s.actions=3;
t('3行动=清晨(非夜)', R.DAY.phase().key==='dawn'&&!R.DAY.isNight());
CLOCK.s.actions=6;
t('正午=昼', R.DAY.phase().key==='day'&&!R.DAY.isNight());
CLOCK.s.actions=10;
t('夜里', R.DAY.isNight());
t('夜间收益更高', R.DAY.bonus()>1);

console.log(`\n${'='.repeat(42)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(42)}`);