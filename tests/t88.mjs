globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const S=await import('/workspace/probe/rouge-offline/js/xiuxian/story.js');
const Q=await import('/workspace/probe/rouge-offline/js/xiuxian/quest.js');
const I=await import('/workspace/probe/rouge-offline/js/xiuxian/items.js');
const {Cult}=await import('/workspace/probe/rouge-offline/js/xiuxian/index.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const W=()=>{for(const k of Object.keys(store))delete store[k];
  S.STORY.reset(); Q.QUEST.s={active:[],done:{},choices:{}};
  I.Bag.s={items:{},demon:0,charter:false}; Cult.load(); Cult.get().visited={n0:true};};

console.log('\n=== 奖励表 ===');
t('5条线都有奖励', Object.keys(S.ARC_REWARD).length===5);
t('每条线两个结局奖励', Object.values(S.ARC_REWARD).every(a=>Array.isArray(a)&&a.length===2));
t('奖励含道行', Object.values(S.ARC_REWARD).every(a=>a.every(x=>typeof x.dao==='number')));
t('奖励含传承书或道具', Object.values(S.ARC_REWARD).every(a=>a.some(x=>x.scroll||x.item)));
t('两结局奖励不完全相同', Object.values(S.ARC_REWARD).every(a=>
  JSON.stringify(a[0])!==JSON.stringify(a[1])));
t('传说线奖励更高', S.ARC_REWARD.laolao[0].dao>S.ARC_REWARD.dengshiTest ||
  S.ARC_REWARD.laolao[0].dao > 900);

console.log('\n=== 走到最后一环不自动结案 ===');
W();
S.STORY.start('hongyi');
const beats=S.ARCS.hongyi.beats;
for(const b of beats) S.STORY.arrive(b.node);
t('看完4环', S.STORY.s.beat.hongyi===4);
t('仍在活跃(等选结局)', !!S.STORY.s.active.hongyi);
t('不自动标记完成', !S.STORY.s.done.hongyi);
t('readyFinish 为真', S.STORY.readyFinish('hongyi')===true);
t('readyList 能看到', S.STORY.readyList().some(r=>r.key==='hongyi'));
t('readyList 带两个结局', (()=>{const r=S.STORY.readyList().find(x=>x.key==='hongyi');
  return r&&r.ep1&&r.ep2&&r.ep1!==r.ep2;})());

console.log('\n=== 未看完不能结案 ===');
W();
S.STORY.start('hongyi');
S.STORY.arrive(beats[0].node); S.STORY.arrive(beats[1].node);
t('只看了2环', S.STORY.s.beat.hongyi===2);
t('readyFinish 假', S.STORY.readyFinish('hongyi')===false);
const early=S.STORY.finish('hongyi',1,(rw)=>Q.QUEST.grant(rw,1));
t('不能提前结案', early.ok===false);
t('提示明确', early.msg.includes('没看完'));

console.log('\n=== 结案发奖(结局1) ===');
W();
S.STORY.start('hongyi');
for(const b of beats) S.STORY.arrive(b.node);
const d0=Cult.get().dao, sc0=I.Bag.count('scroll_2');
const f1=S.STORY.finish('hongyi',1,(rw)=>Q.QUEST.grant(rw,1));
t('结案成功', f1.ok===true);
t('发了道行', Cult.get().dao===d0+f1.reward.dao && f1.reward.dao>0);
t('发了传承书', I.Bag.count('scroll_2')===sc0+1);
t('记入 done', !!S.STORY.s.done.hongyi);
t('记录结局', S.STORY.s.done.hongyi.path===1);
t('从活跃移除', !S.STORY.s.active.hongyi);
t('返回结案文本', f1.text===beats[3].epilogue);
t('奖励有文字', f1.reward.text.length>0);
t('不能重复结案', S.STORY.finish('hongyi',2).ok===false);

console.log('\n=== 结案发奖(结局2,不同奖励) ===');
W();
S.STORY.start('hongyi');
for(const b of beats) S.STORY.arrive(b.node);
const d1=Cult.get().dao, sc1=I.Bag.count('scroll_2'), it1=I.Bag.count('bld_field');
const f2=S.STORY.finish('hongyi',2,(rw)=>Q.QUEST.grant(rw,2));
t('结案成功', f2.ok===true);
t('结局文本不同', f2.text===beats[3].epilogue2);
t('奖励不同', f2.reward.dao!==900);
t('还给了道具', I.Bag.count('bld_field')===it1+1);

console.log('\n=== 传说线奖励更重 ===');
W();
S.STORY.start('laolao');
const lb=S.ARCS.laolao.beats;
for(const b of lb) S.STORY.arrive(b.node);
const dl=Cult.get().dao;
S.STORY.finish('laolao',1,(rw)=>Q.QUEST.grant(rw,1));
const gainL=Cult.get().dao-dl;
W();
S.STORY.start('hongyi');
for(const b of beats) S.STORY.arrive(b.node);
const dh=Cult.get().dao;
S.STORY.finish('hongyi',1,(rw)=>Q.QUEST.grant(rw,1));
const gainH=Cult.get().dao-dh;
t(`姥姥(${gainL}) > 红衣女鬼(${gainH})`, gainL>gainH);

console.log('\n=== 全部5条线都能结 ===');
for(const k of Object.keys(S.ARCS)){
  W();
  S.STORY.start(k);
  for(const b of S.ARCS[k].beats) S.STORY.arrive(b.node);
  const r=S.STORY.finish(k,1,(rw)=>Q.QUEST.grant(rw,1));
  t(`${k} 可结案发奖`, r.ok===true && (r.reward.text.length>0 || !!S.ARC_REWARD[k]));
}

console.log('\n=== 与支线系统共存 ===');
W();
S.STORY.start('hongyi');
for(const b of beats) S.STORY.arrive(b.node);
S.STORY.finish('hongyi',1,(rw)=>Q.QUEST.grant(rw,1));
S.STORY.see('hongyi'); Q.QUEST.autoTake();
const c0=Cult.get().dao, cs=I.Bag.count('scroll_2');
Cult.get().visited.n10=true; Cult.get().visited.n1=true; Cult.commit();
const qf=Q.QUEST.finish('hongyi',1);
t('支线仍能独立结案', qf.ok===true);
t('两份奖励都发过', Cult.get().dao>c0 && I.Bag.count('scroll_2')>cs);

console.log(`\n${'='.repeat(52)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(52)}`);