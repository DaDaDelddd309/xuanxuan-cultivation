globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.AudioContext=function(){this.createGain=()=>({gain:{value:0,linearRampToValueAtTime(){}},connect(){}});
this.createBufferSource=()=>({connect(){},start(){}});this.createOscillator=()=>({connect(){},start(){},stop(){}});
this.createBiquadFilter=()=>({connect(){}});this.createBuffer=()=>({getChannelData:()=>new Float32Array(1)});
this.currentTime=0;this.sampleRate=44100;this.destination={};};
globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const L=await import('../js/xiuxian/legend.js');
const S=await import('../js/xiuxian/story.js');
const A=await import('../js/xiuxian/ambience.js');
const I=await import('../js/xiuxian/items.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};

console.log('\n=== 传说妖谱 ===');
t('8种传说妖', L.LEGEND_LIST.length===8);
t('有红衣女鬼', L.LEGEND.hongyi && L.LEGEND.hongyi.name==='红衣女鬼');
t('有黑山姥姥', !!L.LEGEND.laolao);
t('有白泽', !!L.LEGEND.baize);
t('有当康', !!L.LEGEND.dangkang);
t('有青穹', !!L.ENG||!!L.LEGEND.qingqiong);
t('每只都有来历(lore)', L.LEGEND_LIST.every(x=>x.lore&&x.lore.length>15));
t('每只都有故事(story)', L.LEGEND_LIST.every(x=>x.story&&x.story.length>25));
t('每只都有传闻(tell)', L.LEGEND_LIST.every(x=>x.tell&&x.tell.length>8));
t('稀有度分级', L.LEGEND_LIST.every(x=>x.rarity>=3&&x.rarity<=5));
t('有专属立绘', L.LEGEND_LIST.every(x=>x.img.includes('assets/legend/')));
t('白泽当康不伤人', L.LEGEND.baize.peaceful===true&&L.LEGEND.dangkang.peaceful===true);
t('每个都有支线', L.LEGEND_LIST.every(x=>x.quest&&x.quest.title&&x.quest.desc));
t('支线有目标妖', L.LEGEND_LIST.every(x=>x.quest.target===x.key));

console.log('\n=== 叙事引擎:多环因果 ===');
t('5条故事线', Object.keys(S.ARCS).length===5);
t('每线都有名字', Object.values(S.ARCS).every(a=>a.name&&a.name.length>=3));
t('每线至少4环', Object.values(S.ARCS).every(a=>a.beats.length>=4));
t('环编号连续', Object.values(S.ARCS).every(a=>a.beats.every((b,i)=>b.at===i)));
t('每环都有文本', Object.values(S.ARCS).every(a=>a.beats.every(b=>b.text&&b.text.length>10)));
t('每环都有线索(rumor)', Object.values(S.ARCS).every(a=>a.beats.every(b=>b.rumor)));
t('每环都有揭示(reveal)', Object.values(S.ARCS).every(a=>a.beats.every(b=>b.reveal)));
t('每线有双结局', Object.values(S.ARCS).every(a=>{
  const last=a.beats[a.beats.length-1];
  return last.epilogue&&last.epilogue2&&last.epilogue!==last.epilogue2;}));
// V0.89:「半句话」最后一环移进仙人墓(见 t89),不再锚定地图节点
t('每环都锚定(地面节点或墓内房间)', Object.values(S.ARCS).every(a=>a.beats.every(b=>b.node||b.room)));
t('墓内那环标了 room', S.ARCS.tomb.beats[3].room==='sj' && !S.ARCS.tomb.beats[3].node);
t('前3环仍在地表', S.ARCS.tomb.beats.slice(0,3).every(b=>b.node==='n8'));
t('每线关联一只妖', Object.values(S.ARCS).every(a=>L.LEGEND[a.mob]||['hongyi','laolao','shijiang','jiangu','baize'].includes(a.mob)));

console.log('\n=== 叙事推进 ===');
S.STORY.reset(); S.STORY.load();
t('初始无活跃线', S.STORY.activeList().length===0);
S.STORY.start('hongyi');
t('能开线', S.STORY.activeList().length===1);
t('开了就知道第一环', S.STORY.rumorCount()>0);
const arcs=S.ARCS.hongyi.beats;
const got=S.STORY.arrive(arcs[0].node);
t('到节点触发推进', got.length===1);
t('拿到环文本', got[0]&&got[0].text===arcs[0].text);
t('beat前进', S.STORY.s.beat.hongyi===1);
// 无关节点不该触发:hongyi 第1环在 n0,先去 n4 不应推进
S.STORY.reset(); S.STORY.start('hongyi');
const gA=S.STORY.arrive('n4');
t('无关节点不触发', S.STORY.s.beat.hongyi===0 && gA.every(x=>x.arc!=='hongyi'));
// 走完全程
S.STORY.reset(); S.STORY.start('hongyi');
S.STORY.arrive(arcs[0].node);
let last=null;
for(let i=1;i<arcs.length;i++) last=S.STORY.arrive(arcs[i].node);
t('最后一环有 last 标记', last&&last[0]&&last[0].last===true);
// V0.88 起:走到最后一环不再自动结案,等玩家选结局(见 t88)
t('看完不自动结案', !S.STORY.s.done.hongyi);
t('仍在活跃等选择', !!S.STORY.s.active.hongyi);
t('readyFinish 为真', S.STORY.readyFinish('hongyi')===true);
t('最后一环带两个结局', !!(last&&last[0]&&last[0].ep1&&last[0].ep2));
// 双结局
const e1=S.STORY.finish('hongyi',1,null);
t('结局1', e1&&e1.text===arcs[arcs.length-1].epilogue);
S.STORY.start('jiangu');
const arcs2=S.ARCS.jiangu.beats;
for(const b of arcs2) S.STORY.arrive(b.node);
const e2=S.STORY.finish('jiangu',2,null);
t('结局2不同', e2&&e2.text===arcs2[arcs2.length-1].epilogue2);

console.log('\n=== 流言(商人/鬼火的素材) ===');
S.STORY.reset();S.STORY.load();
S.STORY.start('hongyi');
t('开局有流言可念', S.STORY.rumorCount()>0);
const r1=S.STORY.takeRumor();
t('能取流言', !!r1&&r1.length>5);
t('同一句不重复给', S.STORY.takeRumor()!==r1 || S.STORY.rumorCount()===0);

console.log('\n=== 昼夜氛围 ===');
t('4个时段', Object.keys(A.PHASES).length===4);
t('每段有色调', Object.values(A.PHASES).every(p=>/^#[0-9a-f]{6}$/i.test(p.tint)));
t('每段有雾浓度', Object.values(A.PHASES).every(p=>typeof p.fog==='number'));
t('夜雾最浓', A.PHASES.night.fog===Math.max(...Object.values(A.PHASES).map(p=>p.fog)));
t('夜最暗', A.PHASES.night.bright===Math.min(...Object.values(A.PHASES).map(p=>p.bright)));
t('夜怪最强', A.PHASES.night.mul>1.5);
t('晨怪最弱', A.PHASES.dawn.mul<1);
t('每段有音效标识', Object.values(A.PHASES).every(p=>p.amb));
t('每段有描述', Object.values(A.PHASES).every(p=>p.d&&p.d.length>6));

console.log(`\n${'='.repeat(50)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(50)}`);