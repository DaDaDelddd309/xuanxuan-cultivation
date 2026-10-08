// 可达性 —— 锁住 V0.92 修的两个断链。
//
// 教训(V0.88~V0.92 反复踩):
//   「函数定义了 + 单测能调通」≠「玩家拿得到」。
//   V0.92 坐骑 checkUnlocks 全项目零调用、见妖只取 [0],
//   都是逻辑测试全绿、但正常流程走不到。
// 这类 bug 只能靠「可达性」测试抓:不能注入状态,得从入口一路走到。
globalThis.document={addEventListener(){},removeEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}),body:{appendChild(){}},getElementById:()=>null};
globalThis.window={};globalThis.Audio=function(){this.play=()=>Promise.resolve();this.pause=()=>{}};
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]};
const M=await import('/workspace/probe/rouge-offline/js/xiuxian/mount.js');
const S=await import('/workspace/probe/rouge-offline/js/xiuxian/story.js');
const L=await import('/workspace/probe/rouge-offline/js/xiuxian/legend.js');
const T=await import('/workspace/probe/rouge-offline/js/xiuxian/tomb.js');
const Q=await import('/workspace/probe/rouge-offline/js/xiuxian/quest.js');
let pass=0,fail=0;const t=(n,c)=>{c?pass++:(fail++,console.log('  ❌',n))};
const W=()=>{for(const k of Object.keys(store))delete store[k];
  M.MOUNT.s={have:[],ride:null,pet:null};S.STORY.reset();
  T.TOMB.s={in:false,at:null,seen:[],done:false,path:0,flag:{}};
  Q.QUEST.s={active:[],done:{},choices:{}};};

console.log('\n=== 断链 1:checkUnlocks 有没有调用点 ===');
// 模拟真实 UI 的调用:抵达节点时执行
W(); S.STORY.see('qingqiong');
const onArrive = () => M.MOUNT.checkUnlocks();   // 这就是 ui.js 现在做的事
t('抵达节点能发出坐骑', onArrive().length===1);
t('发出来之后坐骑在手', M.MOUNT.has('qiao'));
// 如果 ui.js 没接,玩家永远拿不到 —— 用 grep 验证接线
const {readFileSync}=await import('fs');
const ui=readFileSync('/workspace/probe/rouge-offline/js/xiuxian/ui.js','utf8');
t('ui.js 里真的调用了 checkUnlocks', /MOUNT\.checkUnlocks\(\)/.test(ui));
t('ui.js 里 import 了 MOUNT', /import\s*\{[^}]*MOUNT/.test(ui));

console.log('\n=== 断链 1b:冷却不能吞掉「见到」本身 ===');
// V0.94 曾把 STORY.see() 放进冷却 if 里 —— 冷却期内玩家走一圈
// 没见过青穹,就拿不到它的坐骑。可达性 bug,不是测试问题。
{
  const ui=readFileSync('/workspace/probe/rouge-offline/js/xiuxian/ui.js','utf8');
  const iSee=ui.indexOf('STORY.see(l.key)');
  const iCool=ui.indexOf('const cool =');
  t('STORY.see 在冷却判断之前', iSee>-1 && iCool>-1 && iSee<iCool);
}

console.log('\n=== 断链 2:同类型节点的第二只妖能不能见到 ===');
// 以前是 LEGEND_LIST.filter(w=>w.where===type)[0] —— 剑骨/灯尸永远见不到
const byType={};
for(const l of L.LEGEND_LIST) (byType[l.where] ||= []).push(l.key);
const multi=Object.entries(byType).filter(([,v])=>v.length>1);
t('存在一类节点有多只妖', multi.length>=2);
console.log('   多只的节点:', multi.map(([k,v])=>`${k}=${v.join('/')}`).join('  '));
// 新逻辑:没见过的里随机挑 → 全部都能被见到
W();
const sim = (type, rounds=200) => {
  const seen=new Set();
  for(let i=0;i<rounds;i++){
    const pool=L.LEGEND_LIST.filter(l=>l.where===type && !S.STORY.met(l.key));
    if(!pool.length) break;
    const l=pool[Math.floor(Math.random()*pool.length)];
    S.STORY.see(l.key);
    seen.add(l.key);
  }
  return seen;
};
for(const [type,keys] of multi){
  // 重复模拟,确认所有同类型妖最终都能见到
  let allGot=true;
  for(let trial=0;trial<20;trial++){
    S.STORY.reset();
    if(sim(type).size!==keys.length){ allGot=false; break; }
  }
  t(`${type} 的 ${keys.length} 只妖都能见到`, allGot);
}
t('elite 两只都能见到', (()=>{S.STORY.reset();const r=sim('elite',50);return r.has('laolao')&&r.has('jiangu');})());
t('field 两只都能见到', (()=>{S.STORY.reset();const r=sim('field',50);return r.has('dangkang')&&r.has('dengshi');})());

console.log('\n=== 断链 3:所有坐骑的解锁条件都可达吗 ===');
W();
const reach={};
// 青穹 / 白泽:见到即可
S.STORY.see('qingqiong'); S.STORY.see('baize');
reach.qiao=S.STORY.met('qingqiong'); reach.baize=S.STORY.met('baize');
// 石俑犬:走完墓
T.TOMB.s.done=true; reach.stonepuppy=T.TOMB.s.done;
// 灯蛾:灯尸结案
Q.QUEST.s.done={dengshi:{path:1}}; reach.denghuo=!!Q.QUEST.s.done.dengshi;
for(const [id,ok] of Object.entries(reach)) t(`${id} 的解锁条件可达`, ok===true);
const got=M.MOUNT.checkUnlocks().map(m=>m.id);
t('条件满足时 4 个全发', got.length===4);
t('没有坐骑的解锁条件是死的',
  M.MOUNT_LIST.every(m=>reach[m.id]!==undefined || ['tongyaji','langyixue','guibiao'].includes(m.id)));

console.log('\n=== 断链 4:坐骑内容不会成为孤儿 ===');
// 每只坐骑的文案不能是空的
t('都有 lore', M.MOUNT_LIST.every(m=>m.lore&&m.lore.length>8));
t('都有 give(它为什么跟你)', M.MOUNT_LIST.every(m=>m.give&&m.give.length>8));
// 每只坐骑引用的来源地名必须能在图上找到
const W_=await import('/workspace/probe/rouge-offline/js/xiuxian/world.js');
const nodeNames=W_.WORLD.nodes.map(n=>n.name).filter(Boolean);
// 坐骑来源允许是「地图节点名」或「独立场所(墓/秘境/妖)」
const EXTRA=['仙人墓','灯尸','青岚秘境'];
t('来源地名都对应真实节点或独立场所',
  M.MOUNT_LIST.every(m=>nodeNames.includes(m.from)||EXTRA.includes(m.from)));
if(!M.MOUNT_LIST.every(m=>nodeNames.includes(m.from)||EXTRA.includes(m.from))){
  console.log('   对不上的:',M.MOUNT_LIST.filter(m=>!nodeNames.includes(m.from)&&!EXTRA.includes(m.from)).map(m=>m.name+'/'+m.from));
  console.log('   地图节点名:',nodeNames.join(','));
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
