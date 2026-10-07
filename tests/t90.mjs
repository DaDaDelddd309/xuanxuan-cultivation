// 存档持久化 —— 锁住 V0.77 起的 P0 bug。
// Cult.init() 以前没调自己的 load(),刷新页面后修为/境界/丹药/神通全归零,
// 而且把 0 写回存档,玩家的进度直接被抹掉。
globalThis.document={addEventListener(){},removeEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const I=await import('/workspace/probe/rouge-offline/js/xiuxian/index.js');
const {Cult}=I;
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};

console.log('\n=== init 必须读回存档 ===');
// 先模拟一次"上次玩过"的状态
store['xx_cultivation_v077']=JSON.stringify({
  realm:'zhuji', layer:3, exp:4321, dao:8888, totalKills:77,
  pills:{pill_zhuji:5}, arts:{jianqi:4}, visited:{n0:true,n5:true},
});
t('存档里确实有进度', JSON.parse(store['xx_cultivation_v077']).exp===4321);

Cult.init();
t('init 后 exp 读回来了', Cult.get().exp===4321);
t('init 后境界读回来了', Cult.get().realm==='zhuji' && Cult.get().layer===3);
t('init 后道行读回来了', Cult.get().dao===8888);
t('init 后丹药读回来了', Cult.get().pills.pill_zhuji===5);
t('init 后神通读回来了', Cult.get().arts.jianqi===4);
t('init 后地图读回来了', Cult.get().visited.n5===true);

console.log('\n=== 空档时走默认值,不炸 ===');
for(const k of Object.keys(store)) delete store[k];
Cult.load();
t('空档时 exp=0', Cult.get().exp===0);
t('空档时有默认境界', !!Cult.get().realm);
t('空档时不抛异常', true);

console.log('\n=== 坏档不炸 ===');
store['xx_cultivation_v077']='{坏数据';
Cult.load();
t('坏档回落默认值', Cult.get().exp===0 && !!Cult.get().realm);
store['xx_cultivation_v077']='null';
Cult.load();
t('null 档不炸', !!Cult.get());
store['xx_cultivation_v077']='{"exp":999}';
Cult.load();
t('半截档能补全默认值', Cult.get().exp===999 && !!Cult.get().realm);

console.log('\n=== 写入后能读回(往返一致) ===');
for(const k of Object.keys(store)) delete store[k];
Cult.load();
Cult.get().exp=7777; Cult.get().dao=666; Cult.get().realm='jindan'; Cult.get().layer=5;
Cult.commit();
// 模拟刷新:重新 load
Cult.load();
t('exp 往返一致', Cult.get().exp===7777);
t('dao 往返一致', Cult.get().dao===666);
t('境界往返一致', Cult.get().realm==='jindan' && Cult.get().layer===5);
t('存档里写的是 7777 不是 0', JSON.parse(store['xx_cultivation_v077']).exp===7777);

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
