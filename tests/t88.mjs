globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const S=await import('../js/xiuxian/story.js');

const Q=await import('../js/xiuxian/quest.js');
const I=await import('../js/xiuxian/items.js');
const {Cult}=await import('../js/xiuxian/index.js');

// ⚠️ XX-WORLD-007:beat 里的 node 是 V0.97 之前的写死序号,地图改按种子生成后
//    它不再对应正确类型(默认种子下 n8 是 field 不是 boss)。
//    直接 arrive(b.node) 会被 story.js 的类型判定正确拒绝 → 推不完 → 连锁红。
//    见 tests/helpers/play-arc.mjs(与 duel-echo / story-echo / t86 共用同一实现)。
const { nodeForBeat } = await import('./helpers/play-arc.mjs');

let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const W=()=>{for(const k of Object.keys(store))delete store[k];
  S.STORY.reset(); Q.QUEST.s={active:[],done:{},choices:{}};
  I.Bag.s={items:{},demon:0,charter:false}; Cult.load(); Cult.get().visited={n0:true};};

/** 把一条线从头走到尾(不结案)。XX-WORLD-007:按类型找节点,不用写死的旧序号。
 *  变量别叫 t —— 本文件的断言函数就叫 t,同作用域会撞。 */
function walk(arcKey) {
  const used = new Set();
  for (const b of S.ARCS[arcKey].beats) {
    if (b.room) { S.STORY.arriveRoom(b.room); continue; }
    const nodeId = nodeForBeat(b, used); used.add(nodeId);
    S.STORY.arrive(nodeId);
  }
}

console.log('\n=== 奖励表 ===');
t('5条线都有奖励', Object.keys(S.ARC_REWARD).length===5);
t('每条线两个结局奖励', Object.values(S.ARC_REWARD).every(a=>Array.isArray(a)&&a.length===2));
t('奖励含道行', Object.values(S.ARC_REWARD).every(a=>a.every(x=>typeof x.dao==='number')));
t('奖励含传承书或道具', Object.values(S.ARC_REWARD).every(a=>a.some(x=>x.scroll||x.item)));
t('两结局奖励不完全相同', Object.values(S.ARC_REWARD).every(a=>
  JSON.stringify(a[0])!==JSON.stringify(a[1])));
// 传说线奖励应高于最低那条线。
// ⚠️ 这里原来写的是 `S.ARC_REWARD.dengshiTest` —— **那把线不存在**,
//   于是 `undefined.dao` 直接 TypeError,t88 从来没能跑完过。
//   它一直在 `test:legacy` 链里,每次跑到这儿就崩,后面所有断言根本没执行。
//   即「测试存在」不等于「测试跑过」(P1-6 同源问题,这里又中一次)。
//   改成对**实际存在的最低奖励线**取比较,并顺手钉住表里没有幽灵键。
const _lines = Object.keys(S.ARC_REWARD);
const _minLine = _lines.reduce((a, b) =>
  (S.ARC_REWARD[a][0].dao <= S.ARC_REWARD[b][0].dao ? a : b));
t('奖励表里没有不存在的线', !('dengshiTest' in S.ARC_REWARD));
t('传说线奖励更高', S.ARC_REWARD.laolao[0].dao > S.ARC_REWARD[_minLine][0].dao,
  `laolao=${S.ARC_REWARD.laolao[0].dao} 应高于最低线 ${_minLine}=${S.ARC_REWARD[_minLine][0].dao}`);

console.log('\n=== 走到最后一环不自动结案 ===');
W();
S.STORY.start('hongyi');
const beats=S.ARCS.hongyi.beats;
walk('hongyi');
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
walk('hongyi');
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
walk('hongyi');
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
walk('laolao');
const dl=Cult.get().dao;
S.STORY.finish('laolao',1,(rw)=>Q.QUEST.grant(rw,1));
const gainL=Cult.get().dao-dl;
W();
S.STORY.start('hongyi');
walk('hongyi');
const dh=Cult.get().dao;
S.STORY.finish('hongyi',1,(rw)=>Q.QUEST.grant(rw,1));
const gainH=Cult.get().dao-dh;
t(`姥姥(${gainL}) > 红衣女鬼(${gainH})`, gainL>gainH);

console.log('\n=== 全部5条线都能结 ===');
for(const k of Object.keys(S.ARCS)){
  W();
  S.STORY.start(k);
  walk(k);
  const r=S.STORY.finish(k,1,(rw)=>Q.QUEST.grant(rw,1));
  t(`${k} 可结案发奖`, r.ok===true && (r.reward.text.length>0 || !!S.ARC_REWARD[k]));
}

console.log('\n=== 与支线系统共存 ===');
W();
S.STORY.start('hongyi');
walk('hongyi');
S.STORY.finish('hongyi',1,(rw)=>Q.QUEST.grant(rw,1));
S.STORY.see('hongyi'); Q.QUEST.autoTake();
const c0=Cult.get().dao, cs=I.Bag.count('scroll_2');
Cult.get().visited.n10=true; Cult.get().visited.n1=true; Cult.commit();
const qf=Q.QUEST.finish('hongyi',1);
t('支线仍能独立结案', qf.ok===true);
t('两份奖励都发过', Cult.get().dao>c0 && I.Bag.count('scroll_2')>cs);

console.log(`\n${'='.repeat(52)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(52)}`);