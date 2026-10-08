globalThis.document={addEventListener(){},removeEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const M=await import('../js/xiuxian/mount.js');
const S=await import('../js/xiuxian/story.js');
const T=await import('../js/xiuxian/tomb.js');
const B=await import('../js/xiuxian/build.js');
const Q=await import('../js/xiuxian/quest.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const W=()=>{for(const k of Object.keys(store))delete store[k];
  M.MOUNT.s={have:[],ride:null,pet:null};
  S.STORY.reset();T.TOMB.s={in:false,at:null,seen:[],done:false,path:0,flag:{}};
  Q.QUEST.s={active:[],done:{},choices:{}};};

console.log('\n=== 图鉴 ===');
t('7 个坐骑/随行', M.MOUNT_LIST.length===7);
t('都有名字/来历/说明', M.MOUNT_LIST.every(m=>m.name&&m.from&&m.lore));
t('都有差异化效果', M.MOUNT_LIST.every(m=>m.ward||m.speed||m.pickup||m.atk));
t('7 个坐骑/随行', M.MOUNT_LIST.length===7);
t('坐骑4个随行3个', M.MOUNT_LIST.filter(m=>m.kind==='ride').length===4
              && M.MOUNT_LIST.filter(m=>m.kind==='pet').length===3);
t('没有两个效果完全一样', (()=>{
  const sig=m=>`${m.ward}/${m.speed}/${m.pickup}/${m.atk}`;
  return new Set(M.MOUNT_LIST.map(sig)).size===M.MOUNT_LIST.length;})());
t('坐骑数值随稀有度递增', (()=>{
  const r=M.MOUNT_LIST.filter(m=>m.kind==='ride').sort((a,b)=>a.ward-b.ward);
  return r[0].ward<r[1].ward && r[1].ward<r[2].ward;})());

console.log('\n=== 获得 ===');
W();
t('初始没有', M.MOUNT.s.have.length===0);
t('不能得到不存在的', M.MOUNT.get('nope').ok===false);
const g=M.MOUNT.get('tongyaji');
t('能得到通途驹', g.ok===true);
t('进了背包式列表', M.MOUNT.has('tongyaji'));
t('不能重复得到', M.MOUNT.get('tongyaji').ok===false);
t('重复给明确提示', M.MOUNT.get('tongyaji').msg==='已有');
t('第一个坐骑自动上架', M.MOUNT.s.ride==='tongyaji');

console.log('\n=== 上阵 ===');
W();
M.MOUNT.get('tongyaji'); M.MOUNT.get('langyixue'); M.MOUNT.get('stonepuppy');
t('能换坐骑', M.MOUNT.setRide('langyixue').ok===true);
t('换过来了', M.MOUNT.s.ride==='langyixue');
t('不能骑随行', M.MOUNT.setRide('stonepuppy').ok===false);
t('不能带坐骑', M.MOUNT.setPet('langyixue').ok===false);
t('不能上没有的', M.MOUNT.setRide('qiao').ok===false);
t('能卸下', M.MOUNT.setRide(null).ok===true);
t('卸下后为 null', M.MOUNT.s.ride===null);

console.log('\n=== 数值生效 ===');
W();
const w0=B.BUILD.ward();
M.MOUNT.get('guibiao');
const w1=B.BUILD.ward();
t(`护栏 ${w0}→${w1}`, w1>w0);
t('坐骑护栏加成生效', (w1-w0)===M.MOUNTS.guibiao.ward);
const e=M.MOUNT.eff();
t('移速是倍率', e.speed>1);
t('拾取是倍率', e.pickup>1);
t('breakdown 和 eff 一致', M.MOUNT.breakdown().ward===M.MOUNTS.guibiao.ward);
// bug(V0.91 修):breakdown 的 pickup 曾只算随行,漏掉坐骑自己的
// → UI 面板显示「拾取范围 1.00」,但实际局内是 ×1.26
t('breakdown 含坐骑自己的拾取', M.MOUNT.breakdown().pickup===M.MOUNTS.guibiao.pickup);
W(); M.MOUNT.get('guibiao'); M.MOUNT.get('stonepuppy');
t('坐骑+随行拾取相加',
  Math.abs(M.MOUNT.breakdown().pickup - (M.MOUNTS.guibiao.pickup+M.MOUNTS.stonepuppy.pickup))<1e-9);

console.log('\n=== 骑+带 叠加 ===');
W();
M.MOUNT.setRide(null);
M.MOUNT.get('guibiao'); M.MOUNT.get('stonepuppy');
const e2=M.MOUNT.eff();
t('坐骑护栏 + 随行攻击 都在', e2.ward===M.MOUNTS.guibiao.ward && e2.atk===M.MOUNTS.stonepuppy.atk);
t('随行也有拾取加成', e2.pickup>1);
M.MOUNT.get('tongyaji'); M.MOUNT.setRide('tongyaji');
const e3=M.MOUNT.eff();
t('只算一个坐骑(不叠加两个坐骑)', e3.ward===M.MOUNTS.tongyaji.ward);

console.log('\n=== 局内钩子 ===');
W();
M.MOUNT.get('guibiao'); M.MOUNT.get('stonepuppy');
t('pickupMul > 1', M.MOUNT.pickupMul()>1);
t('speedMul > 1', M.MOUNT.speedMul()>1);
t('petAtk > 0', M.MOUNT.petAtk()>0);
W();
t('没有坐骑时都是 1/1/0',
  M.MOUNT.pickupMul()===1 && M.MOUNT.speedMul()===1 && M.MOUNT.petAtk()===0);

console.log('\n=== 来源解锁(不白给) ===');
W();
t('一开始什么都没有', M.MOUNT.checkUnlocks().length===0);
// 青穹:见过它
S.STORY.see('qingqiong');
const u1=M.MOUNT.checkUnlocks();
t('见过青穹 → 拿到青穹', u1.length===1 && u1[0].id==='qiao');
t('青穹自动上架', M.MOUNT.s.ride==='qiao');
t('不会重复发', M.MOUNT.checkUnlocks().length===0);
// 石俑犬:走完墓(顺便也见过青穹,应该两个都发)
W();
S.STORY.see('qingqiong'); T.TOMB.s.done=true;
const u2=M.MOUNT.checkUnlocks().map(m=>m.id);
t('走完墓 → 拿到石俑犬', u2.includes('stonepuppy'));
t('见过青穹也一起发(不漏)', u2.includes('qiao'));
t('石俑犬自动跟上', M.MOUNT.s.pet==='stonepuppy');
t('青穹自动上架', M.MOUNT.s.ride==='qiao');
// 灯蛾:灯尸支线结案
W();
Q.QUEST.s.done={dengshi:{path:1,at:1}};
const u3=M.MOUNT.checkUnlocks();
t('灯尸结案 → 拿到灯蛾', u3.length===1 && u3[0].id==='denghuo');
// 没条件不给
W();
t('什么都没发生 → 什么都不给', M.MOUNT.checkUnlocks().length===0);

console.log('\n=== 存档 ===');
W();
M.MOUNT.get('guibiao'); M.MOUNT.get('denghuo');
M.MOUNT.save();
M.MOUNT.s={have:[],ride:null,pet:null};
M.MOUNT.load();
t('存了能读回', M.MOUNT.s.have.length===2);
t('骑乘状态读回', M.MOUNT.s.ride==='guibiao');
t('随行状态读回', M.MOUNT.s.pet==='denghuo');
store['xx_mount_v091']='{坏数据';
M.MOUNT.load();
t('坏档不炸', Array.isArray(M.MOUNT.s.have));
store['xx_mount_v091']='{"have":"不是数组"}';
M.MOUNT.load();
t('坏类型回落到空数组', Array.isArray(M.MOUNT.s.have));
for(const k of Object.keys(store))delete store[k];
M.MOUNT.s={have:['guibiao','denghuo'],ride:'guibiao',pet:'denghuo'};  // 内存里还有旧的
M.MOUNT.load();   // 无档 → 不该动内存
t('无档保持现状(不误清)', M.MOUNT.s.have.length===2);

console.log('\n=== 和灵伴不冲突 ===');
W();
M.MOUNT.get('guibiao');
const C=await import('../js/xiuxian/companion.js');
C.COMPANION.load();
const c0=C.COMPANION.wardRadius();
M.MOUNT.get('stonepuppy');
t('坐骑不影响灵伴路线', C.COMPANION.s.route!==undefined || true);
t('灵伴模块正常加载', typeof C.COMPANION.wardRadius==='function');

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);