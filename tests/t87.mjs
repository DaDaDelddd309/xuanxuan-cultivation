globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const Q=await import('../js/xiuxian/quest.js');
const S=await import('../js/xiuxian/story.js');
const L=await import('../js/xiuxian/legend.js');
const I=await import('../js/xiuxian/items.js');
const {Cult}=await import('../js/xiuxian/index.js');
const {WORLD}=await import('../js/xiuxian/world.js');
// 【XX-PLAY-011】支线锚点改成按**类型**,测试也必须按类型取真实节点 ——
//   原来这里写的是 visited.n5 / visited.n7,而 id 逐种子重发,写了等于没测。
const idsOfType=ty=>WORLD.nodes.filter(n=>n.type===ty).map(n=>n.id);
const visitAll=ty=>{for(const id of idsOfType(ty))Cult.get().visited[id]=true;Cult.commit();};
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const W=()=>{for(const k of Object.keys(store))delete store[k];
  Q.QUEST.s={active:[],done:{},choices:{}}; S.STORY.reset();
  I.Bag.s={items:{},demon:0,charter:false}; Cult.load(); Cult.get().visited={n0:true};};

console.log('\n=== 每只妖都有可接支线 ===');
t('8只传说妖', L.LEGEND_LIST.length===8);
t('每只有quest', L.LEGEND_LIST.every(x=>x.quest&&x.quest.title&&x.quest.desc&&x.quest.reward));
t('每只有完成条件', Object.keys(Q.QUEST_COND).length===8);
t('条件指向真妖', Object.keys(Q.QUEST_COND).every(k=>L.LEGEND[k]));
t('条件类型合法', Object.values(Q.QUEST_COND).every(c=>
  !c.types || (c.types.every(ty=>/^(village|field|secret|elite|boss|rift|mine|outpost|wonder|gate)$/.test(ty))
               && c.need >= 1)));
// 【XX-PLAY-011】补一条反向断言:条件里**不许再出现节点 id**。
// 原来那条断言是 `c.where.every(w=>/^n\d+$/.test(w))` —— 它反过来在**要求**
// 必须写 id。而 id 逐种子重发,写了就错。这条断言现在钉住的是「不许写 id」。
t('条件里没有残留的节点 id(锚点必须用类型,不是 id)',
  Object.values(Q.QUEST_COND).every(c=>!c.where));
t('任务描述里不出现原始 id(玩家不该看到 n8 这种东西)',
  Object.values(Q.QUEST_COND).every(c=>!(c.tip||'').match(/\bn\d+\b/)));

console.log('\n=== 接取:必须先见过妖 ===');
W();
t('没见过不能接', Q.QUEST.canTake('hongyi').ok===false);
t('提示文案', Q.QUEST.canTake('hongyi').msg.includes('没见过'));
S.STORY.see('hongyi');
t('见过后可接', Q.QUEST.canTake('hongyi').ok===true);
const tk=Q.QUEST.take('hongyi');
t('接取成功', tk.ok && Q.QUEST.s.active.includes('hongyi'));
t('不能重复接', Q.QUEST.take('hongyi').ok===false);

console.log('\n=== autoTake 自动接 ===');
W();
S.STORY.see('hongyi'); S.STORY.see('dengshi');
const n=Q.QUEST.autoTake();
t('自动接了2条', n===2);
t('都在 active 里', Q.QUEST.s.active.length===2);
t('没见过的不会接', !Q.QUEST.s.active.includes('baize'));

console.log('\n=== 进度推进 ===');
W();
S.STORY.see('hongyi'); Q.QUEST.autoTake();
t('初始进度0', Q.QUEST.progress('hongyi')===0);
t('未达成不可结', Q.QUEST.finish('hongyi',1).ok===false);
visitAll('field');
t('到齐目标节点', Q.QUEST.progress('hongyi')===1);
t('ready', Q.QUEST.ready('hongyi')===true);

console.log('\n=== 多点条件(姥姥要2处) ===');
W();
S.STORY.see('laolao'); Q.QUEST.autoTake();
t('初始0', Q.QUEST.progress('laolao')===0);
// 【反向断言,本节最要紧的一条】去**错类型**的地方不许推进。
// 原来查 visited['n5'],而 n5 的类型逐种子漂 —— 逛到一片编号 n5 的野地
// 就能把「姥姥」这条线推满,玩家什么都没做对。
const wrongType=idsOfType('field');
t('去错类型的地方不推进(野地对姥姥线无效)', wrongType.length>0 && (()=>{
  for(const id of wrongType) Cult.get().visited[id]=true; Cult.commit();
  return Q.QUEST.progress('laolao')===0; })());
// 正向:去够该类型的点就必须能推满。
// 注意**不写死百分比**:险地每图 1~3 个,need 会被 min(need,实际数量) 封顶,
// 所以「恰好 50%」那种断言在只出 1 个险地的图里必然失败。种子无关的不变量才是要测的。
const elites=idsOfType('elite');
t('该图确实有险地', elites.length>0, `elite=${elites.length}`);
visitAll('elite');
t('去齐该类型的点=完成', Q.QUEST.progress('laolao')===1);

console.log('\n=== 结案发奖 ===');
W();
S.STORY.see('hongyi'); Q.QUEST.autoTake();
Cult.get().visited.n10=true; Cult.get().visited.n1=true; Cult.commit();
const d0=Cult.get().dao, i0=I.Bag.count('scroll_2');
const r=Q.QUEST.finish('hongyi',1);
t('结案成功', r.ok===true);
t('发了道行', Cult.get().dao===d0+r.reward.dao);
t('发了传承书', I.Bag.count('scroll_2')===i0+1);
t('从 active 移除', !Q.QUEST.s.active.includes('hongyi'));
t('记入 done', !!Q.QUEST.s.done.hongyi);
t('完成后不能重接', Q.QUEST.canTake('hongyi').ok===false);
t('奖励有文字说明', r.reward.text.length>0);

console.log('\n=== 双结局 ===');
W();
S.STORY.see('dengshi'); Q.QUEST.autoTake();
visitAll('field');
t('灯尸可结', Q.QUEST.ready('dengshi')===true);
const e1=Q.QUEST.finish('dengshi',1);
t('结局1', e1.ok && Q.QUEST.s.done.dengshi.path===1);
W();
S.STORY.see('dengshi'); Q.QUEST.autoTake();
visitAll('field');
const e2=Q.QUEST.finish('dengshi',2);
t('结局2', e2.ok && Q.QUEST.s.done.dengshi.path===2);
t('两结局都记录', e1.ok && e2.ok);

console.log('\n=== 特殊交互(白泽/剑骨等) ===');
t('白泽有特殊提示', (Q.QUEST.specialPrompt('baize')||{}).special!==undefined || !!Q.QUEST.specialPrompt('baize'));
const sps=['baize','dangkang','qingqiong','jiangu','shijiang'];
t('5只有特殊交互', sps.every(k=>!!Q.QUEST.specialPrompt(k)));
t('特殊提示有正反两个选项', sps.every(k=>{
  const s=Q.QUEST.specialPrompt(k); return s && s.a1 && s.a2 && s.r1 && s.r2;}));
t('特殊结局2额外+300道行', (()=>{
  W(); S.STORY.see('baize'); Q.QUEST.autoTake();
  Cult.get().visited.n4=true; Cult.commit();
  const d0=Cult.get().dao;
  const r=Q.QUEST.finish('baize',2);
  return r.ok && Cult.get().dao===d0+300 && /道行 \+300/.test(r.reward.text.join());})());
t('特殊结局1不加道行', (()=>{
  W(); S.STORY.see('baize'); Q.QUEST.autoTake();
  Cult.get().visited.n4=true; Cult.commit();
  const r=Q.QUEST.finish('baize',1);
  return r.ok && r.reward.dao===0 && !/道行/.test(r.reward.text.join());})());

console.log('\n=== 列表 ===');
W();
S.STORY.see('hongyi'); S.STORY.see('dengshi'); Q.QUEST.autoTake();
t('activeList 有2条', Q.QUEST.activeList().length===2);
t('每条有标题/描述/进度', Q.QUEST.activeList().every(q=>q.title&&q.desc&&typeof q.p==='number'));
t('有可接列表', (()=>{S.STORY.see('laolao'); return Q.QUEST.availableList().length>0})());
Cult.get().visited.n10=true; Cult.get().visited.n1=true; Q.QUEST.finish('hongyi',1);
t('doneList 有1条', Q.QUEST.doneList().length===1);
t('doneList 带结局', Q.QUEST.doneList()[0].path===1);

console.log('\n=== 存档 ===');
Q.QUEST.take('laolao');
Q.QUEST.save();
Q.QUEST.s={active:[],done:{},choices:{}};
Q.QUEST.load();
t('存档能读回', Q.QUEST.s.active.includes('laolao'));

console.log(`\n${'='.repeat(50)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(50)}`);