globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const Q=await import('/workspace/probe/rouge-offline/js/xiuxian/quest.js');
const S=await import('/workspace/probe/rouge-offline/js/xiuxian/story.js');
const L=await import('/workspace/probe/rouge-offline/js/xiuxian/legend.js');
const I=await import('/workspace/probe/rouge-offline/js/xiuxian/items.js');
const {Cult}=await import('/workspace/probe/rouge-offline/js/xiuxian/index.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const W=()=>{for(const k of Object.keys(store))delete store[k];
  Q.QUEST.s={active:[],done:{},choices:{}}; S.STORY.reset();
  I.Bag.s={items:{},demon:0,charter:false}; Cult.load(); Cult.get().visited={n0:true};};

console.log('\n=== 每只妖都有可接支线 ===');
t('8只传说妖', L.LEGEND_LIST.length===8);
t('每只有quest', L.LEGEND_LIST.every(x=>x.quest&&x.quest.title&&x.quest.desc&&x.quest.reward));
t('每只有完成条件', Object.keys(Q.QUEST_COND).length===8);
t('条件指向真妖', Object.keys(Q.QUEST_COND).every(k=>L.LEGEND[k]));
t('条件节点合法', Object.values(Q.QUEST_COND).every(c=>
  !c.where || c.where.every(w=>/^n\d+$/.test(w))));

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
Cult.get().visited.n10=true; Cult.get().visited.n1=true; Cult.commit();
t('到齐目标节点', Q.QUEST.progress('hongyi')===1);
t('ready', Q.QUEST.ready('hongyi')===true);

console.log('\n=== 多点条件(姥姥要2处) ===');
W();
S.STORY.see('laolao'); Q.QUEST.autoTake();
t('初始0', Q.QUEST.progress('laolao')===0);
Cult.get().visited.n5=true; Cult.commit();
t('去1处=50%', Math.abs(Q.QUEST.progress('laolao')-0.5)<0.01);
Cult.get().visited.n7=true; Cult.commit();
t('2处=完成', Q.QUEST.progress('laolao')===1);

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
Cult.get().visited.n10=true; Cult.get().visited.n3=true; Cult.commit();
t('灯尸可结', Q.QUEST.ready('dengshi')===true);
const e1=Q.QUEST.finish('dengshi',1);
t('结局1', e1.ok && Q.QUEST.s.done.dengshi.path===1);
W();
S.STORY.see('dengshi'); Q.QUEST.autoTake();
Cult.get().visited.n10=true; Cult.get().visited.n3=true; Cult.commit();
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