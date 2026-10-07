globalThis.document={addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const S=await import('/workspace/probe/rouge-offline/js/xiuxian/story.js');
const Q=await import('/workspace/probe/rouge-offline/js/xiuxian/quest.js');
const I=await import('/workspace/probe/rouge-offline/js/xiuxian/items.js');
const T=await import('/workspace/probe/rouge-offline/js/xiuxian/tomb.js');
const {Cult}=await import('/workspace/probe/rouge-offline/js/xiuxian/index.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const W=()=>{for(const k of Object.keys(store))delete store[k];
  S.STORY.reset();Q.QUEST.s={active:[],done:{},choices:{}};
  I.Bag.s={items:{},demon:0,charter:false};
  T.TOMB.s={in:false,at:null,seen:[],done:false,path:0,flag:{}};
  Cult.load();};

console.log('\n=== 墓的结构 ===');
t('5 个房间', T.ROOMS.length===5);
t('房间都有名字', T.ROOMS.every(r=>r.name&&r.text&&r.beat));
t('互相连通', (()=>{const seen=new Set(['dk']);let ch=1;
  while(ch){ch=0;for(const r of T.ROOMS)if(seen.has(r.id))for(const e of r.edge)
    if(!seen.has(e)){seen.add(e);ch=1;}}return seen.size===5;})());
t('所有 edge 指向存在的房间', T.ROOMS.every(r=>r.edge.every(e=>T.ROOM_BY_ID[e])));
t('房间都有退路(除终点外)', T.ROOMS.filter(r=>!r.end).every(r=>r.edge.length>0));
t('只有主墓是终点', T.ROOMS.filter(r=>r.end).length===1);
t('主墓没有别的出口', T.ROOM_BY_ID.zm.edge.length===1);

console.log('\n=== 入口要见过石将 ===');
W();
t('没见过 → 不知道墓在哪儿', T.TOMB.known()===false);
t('没见过 → 进不去', T.TOMB.enter().ok===false);
S.STORY.see('shijiang');
t('见过石将 → 知道了', T.TOMB.known()===true);
t('进了墓,停在墓道', (()=>{const r=T.TOMB.enter();return r.ok&&T.TOMB.s.at==='dk';})());
t('已在墓里 → 不让再进', T.TOMB.enter().ok===false);
t('进墓后支线自动在手', (()=>{Q.QUEST.autoTake();return Q.QUEST.s.active.includes('shijiang');})());

console.log('\n=== 走动受相邻限制 ===');
W(); S.STORY.see('shijiang'); T.TOMB.enter();
t('墓道不能直接跳主墓', T.TOMB.move('zm').ok===false);
t('留在了原地', T.TOMB.s.at==='dk');
t('墓道 → 前殿', T.TOMB.move('qd').ok===true);
t('前殿 → 侧室', T.TOMB.move('ce').ok===true);
t('侧室 → 前殿(退)', T.TOMB.move('qd').ok===true);
t('前殿 → 石将前', T.TOMB.move('sj').ok===true);
t('石将前 → 前殿(退)', T.TOMB.move('qd').ok===true);
t('前殿 → 墓道(退)', T.TOMB.move('dk').ok===true);

console.log('\n=== 每间房都有内容 ===');
W(); S.STORY.see('shijiang'); T.TOMB.enter();
const got=[];
for(const r of T.ROOMS){
  // 走过去
  let guard=0;
  while(T.TOMB.s.at!==r.id && guard++<10){
    const cur=T.TOMB.room();
    if(cur.edge.includes(r.id)){T.TOMB.move(r.id);break;}
    T.TOMB.move(cur.edge[0]);
  }
  const s=T.TOMB.settle(r.id);
  got.push(s);
  t(`${r.id} 有文本`, !!s.text && s.text.length>20);
  t(`${r.id} 有独白`, !!s.beat);
}
t('五个房间都有结算', got.length===5);

console.log('\n=== 侧室给拓片 ===');
t('侧室首次进入得拓片', got.find(g=>true) && I.Bag.count('beiwen')===1);
t('再进不给', (()=>{T.TOMB.s.at='ce';const s=T.TOMB.settle('ce');return !s.first;})());
t('拓片只有1件', I.Bag.count('beiwen')===1);
t('拓片有名字', I.GOODS.beiwen && I.GOODS.beiwen.name==='碑文拓片');
t('拓片不能卖', I.GOODS.beiwen.noSell===true);

console.log('\n=== 叙事线最后一环在墓里 ===');
W(); S.STORY.see('shijiang');
S.STORY.start('tomb');
S.STORY.arrive('n8');S.STORY.arrive('n8');S.STORY.arrive('n8');
t('地表走3环', S.STORY.s.beat.tomb===3);
t('地表不该结案', S.STORY.readyFinish('tomb')===false);
Q.QUEST.autoTake();
t('支线在等墓', Q.QUEST.ready('shijiang')===false);
T.TOMB.enter();
T.TOMB.move('qd'); T.TOMB.settle('qd');
T.TOMB.move('sj');
const sj=T.TOMB.settle('sj');
t('走到石将前触发最后一环', !!sj.arcBeat);
t('arcBeat 是最后一环', sj.arcBeat && sj.arcBeat.last===true);
t('现在能结案了', S.STORY.readyFinish('tomb')===true);
t('结案前支线仍未完成', Q.QUEST.ready('shijiang')===false);
t('结案前有碑文吗', T.TOMB.epitaph()===null);

console.log('\n=== 结局1:奈何无人共 ===');
const d0=Cult.get().dao;
const f1=T.TOMB.finish(1);
t('结案成功', f1.ok===true);
t('补的是「奈何无人共」', f1.words==='奈何无人共');
t('发道行', Cult.get().dao===d0+3200);
t('叙事线同步结案', f1.arc===true);
t('叙事线记了结局1', S.STORY.s.done.tomb.path===1);
Q.QUEST.settleShijiang(1);
t('支线同步了结', !!Q.QUEST.s.done.shijiang);
t('支线记录结局1', Q.QUEST.s.done.shijiang.path===1);
t('支线标了是在墓里结的', Q.QUEST.s.done.shijiang.inTomb===true);
t('支线从在手移除', !Q.QUEST.s.active.includes('shijiang'));
t('支线现在算完成', Q.QUEST.ready('shijiang')===true);
t('出墓了', T.TOMB.s.in===false);
t('碑文刻成结局1的样子', (T.TOMB.epitaph()||'').includes('奈何无人共'));
t('不能重复结案', T.TOMB.finish(1).ok===false);
t('不能改结局', T.TOMB.finish(2).ok===false);
const d1=Cult.get().dao;
t('重复点不再发奖', (()=>{T.TOMB.finish(1);return Cult.get().dao===d1;})());

console.log('\n=== 结局2:此生无悔 ===');
W(); S.STORY.see('shijiang'); S.STORY.start('tomb');
S.STORY.arrive('n8');S.STORY.arrive('n8');S.STORY.arrive('n8');
T.TOMB.enter(); T.TOMB.move('qd'); T.TOMB.settle('qd'); T.TOMB.move('sj'); T.TOMB.settle('sj');
Q.QUEST.autoTake();
const d2=Cult.get().dao;
const f2=T.TOMB.finish(2);
t('结案成功', f2.ok===true);
t('补的是「此生无悔」', f2.words==='此生无悔');
t('结局2不发道行(换传承)', Cult.get().dao===d2);
t('结局2给传承书', f2.reward.scroll==='scroll_4');
t('传承书真进了背包', I.Bag.count('scroll_4')===1);
t('两结局奖励不同', f1.reward.scroll!==f2.reward.scroll);
t('碑文刻成结局2的样子', (T.TOMB.epitaph()||'').includes('此生无悔'));
t('碑文两结局不同', (()=>{
  W(); S.STORY.see('shijiang'); S.STORY.start('tomb');
  S.STORY.arrive('n8');S.STORY.arrive('n8');S.STORY.arrive('n8');
  T.TOMB.enter();T.TOMB.move('qd');T.TOMB.settle('qd');T.TOMB.move('sj');T.TOMB.settle('sj');
  T.TOMB.finish(2);
  const a=T.TOMB.epitaph();
  W(); S.STORY.see('shijiang'); S.STORY.start('tomb');
  S.STORY.arrive('n8');S.STORY.arrive('n8');S.STORY.arrive('n8');
  T.TOMB.enter();T.TOMB.move('qd');T.TOMB.settle('qd');T.TOMB.move('sj');T.TOMB.settle('sj');
  T.TOMB.finish(1);
  return a!==T.TOMB.epitaph();
})());

console.log('\n=== 走不到石将前不能结案 ===');
W(); S.STORY.see('shijiang'); T.TOMB.enter();
t('在墓道结案失败', T.TOMB.finish(1).ok===false);
T.TOMB.move('qd');
t('在前殿结案失败', T.TOMB.finish(1).ok===false);
t('提示明确', T.TOMB.finish(1).msg.includes('石将'));
t('支线条件不误判', Q.QUEST.ready('shijiang')===false);
t('碑文没生成', T.TOMB.epitaph()===null);

console.log('\n=== 出墓 ===');
W(); S.STORY.see('shijiang'); T.TOMB.enter(); T.TOMB.move('qd');
T.TOMB.leave();
t('出墓后不在墓里', T.TOMB.s.in===false);
t('出墓后没有当前房间', T.TOMB.room()===null);
t('出墓不丢进度', T.TOMB.s.seen.includes('dk'));
t('出墓后还能再进', T.TOMB.enter().ok===true);
t('回到墓道', T.TOMB.s.at==='dk');

console.log('\n=== 存档迁移 ===');
W(); S.STORY.see('shijiang');
localStorage.setItem('xx_tomb_v089','{"in":false,"seen":["dk","qd"],"done":true,"path":1}');
T.TOMB.load();
t('旧存档能读', T.TOMB.s.done===true);
t('缺 flag 字段不炸', T.TOMB.s.flag && typeof T.TOMB.s.flag==='object');
t('缺 at 字段不炸', T.TOMB.s.at===null);
t('读到了 seen', T.TOMB.s.seen.length===2);
t('读到了碑文', (T.TOMB.epitaph()||'').length>0);
localStorage.setItem('xx_tomb_v089','坏数据');
t('坏存档不炸', (()=>{T.TOMB.load();return T.TOMB.s && Array.isArray(T.TOMB.s.seen);})());
t('坏存档后能正常用', T.TOMB.s.seen.length===0);
t('没有存档时是初始态', (()=>{T.TOMB.load();return T.TOMB.s.in===false && T.TOMB.s.done===false;})());

console.log('\n=== 奖励只发一次 ===');
W(); S.STORY.see('shijiang'); S.STORY.start('tomb');
S.STORY.arrive('n8');S.STORY.arrive('n8');S.STORY.arrive('n8');
T.TOMB.enter();T.TOMB.move('qd');T.TOMB.settle('qd');T.TOMB.move('sj');T.TOMB.settle('sj');
const daoA=Cult.get().dao;
T.TOMB.finish(1);
const afterFirst=Cult.get().dao;
T.TOMB.finish(1); T.TOMB.finish(2);
t('只发一次', Cult.get().dao===afterFirst);
t('发奖数额=3200', afterFirst-daoA===3200);
t('主墓道行只算一次', (()=>{T.TOMB.s.done=false;T.TOMB.s.in=true;T.TOMB.s.at='sj';
  T.TOMB.move('zm'); const s=T.TOMB.settle('zm');
  return !s.first;})());

console.log(`\n${'='.repeat(52)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(52)}`);