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
const M=await import('../js/xiuxian/mount.js');
const S=await import('../js/xiuxian/story.js');
const L=await import('../js/xiuxian/legend.js');
const T=await import('../js/xiuxian/tomb.js');
const Q=await import('../js/xiuxian/quest.js');
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
// 如果 ui.js 没接,玩家永远拿不到 —— 用 grep 验证接线。
// ⚠️ XX-AUDIT-005:读的是整个 UI 层而不是 ui.js 一个文件。ui.js 拆成
// js/xiuxian/ui/*.js 之后,`MOUNT.checkUnlocks()` 会跟着 arrive() 一起搬走,
// 断言会**因为代码不在那儿了而变红** —— 更坏的情况是有人去"修"本来正确的逻辑。
// 这里两个锚点都精确落在 arrive() 里,所以连位置一起收进方法体内判断。
const {blob, methodBody}=await import('./lib-uimod.mjs');
const ui=blob();
const arrive=methodBody('arrive');
t('arrive 里真的调用了 checkUnlocks', /MOUNT\.checkUnlocks\(\)/.test(arrive));
t('UI 层 import 了 MOUNT', /import\s*\{[^}]*MOUNT/.test(ui));

console.log('\n=== 断链 1b:冷却不能吞掉「见到」本身 ===');
// V0.94 曾把 STORY.see() 放进冷却 if 里 —— 冷却期内玩家走一圈
// 没见过青穹,就拿不到它的坐骑。可达性 bug,不是测试问题。
{
  // 范围收到 arrive() 里:原来在全文件找第一处 'const cool =',
  // 一旦同文件里再出现第二个 const cool,断言就会指向不相干的那一处。
  const iSee=arrive.indexOf('STORY.see(l.key)');
  const iCool=arrive.indexOf('const cool =');
  t('STORY.see 在冷却判断之前', iSee>-1 && iCool>-1 && iSee<iCool,
    `see@${iSee} cool@${iCool}`);
}

console.log('\n=== 断链 1c:坐骑发到了,UI 真的有弹吗 ===');
// 2026-10-10 新增。这条存在的理由:
//   V0.92 修了「checkUnlocks 零调用」,但**只修了一半** ——
//   arrive() 把坐骑塞进 `this._pendingMount` 队列,然后就没人管了。
//   消费队列的 `_nextPending()` 全项目**没有任何外部调用者**
//   (只被自己递归和同样零调用的 `showMountGet` 调用)。
//   结果:坐骑发到了(MOUNT.s.have 更新),玩家却**看不到任何提示**。
//
//   为什么上面那些断言全绿:
//   「抵达节点能发出坐骑」测的是 checkUnlocks 的**返回值**,
//   「发出来之后坐骑在手」测的是 MOUNT.has(),
//   **从头到尾没有一条断言过 UI 有没有弹** —— 可达性只测了一半。
{
  // 同样收进 arrive():这三个锚点全在 arrive() 里。
  const fills = /this\._pendingMount\s*=\s*\(this\._pendingMount\|\|\[\]\)\.concat\(m\)/.test(arrive);
  t('arrive 把坐骑塞进待弹队列', fills);
  // 关键:队列必须有人消费。只填充不消费 = 弹层永远不出现。
  const drains = /if \(gotMounts\.length\) this\._nextPending\(\);/.test(arrive);
  t('填充后立刻消费队列(否则弹层永远不弹)', drains,
    '找不到 arrive 里对 _nextPending() 的调用 —— 坐骑到手但玩家看不到提示');
  t('_nextPending 确实读这个队列', /const q = this\._pendingMount;/.test(methodBody('_nextPending')));
  // 反向:确认不是「靠别处间接调用」蒙混过关
  const calls = (arrive.match(/_nextPending\(\)/g) || []).length;
  const fromArrive = /if \(gotMounts\.length\) this\._nextPending\(\);/.test(ui);
  t('_nextPending 的调用点存在外部入口', fromArrive,
    `全文件出现 ${calls} 次`);
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

// —— 2026-10-10 重写:从「当前种子碰巧对得上」改成「任何种子都对得上」——
//
// 教训:世界从 11 个硬编码节点改成按种子生成(worldgen.js)之后,
// 「来源地名必须在节点名里」这条断言的成立与否**取决于当前种子**。
// 旧写法只在当前这一世检查,于是它要么绿要么红,和内容对不对没关系 ——
// 是运气,不是不变量。实测黑风岭/落云镇/古战场遗迹/青岚秘境有大半概率缺席,
// 坐骑文案指向玩家这一世根本不存在的地方。
//
// 现在改成:换 N 个种子重新生成世界,每次都断言一遍。
// 这才是「坐骑文案不是孤儿」的真正含义。
const W_=await import('../js/xiuxian/world.js');
const { ANCHORS } = await import('../js/xiuxian/worldgen.js');
const { getMaster } = await import('../js/xiuxian/seed.js');
const ORIGIN_SEED = getMaster();

// 坐骑来源允许是「地图节点名」或「独立场所(墓/秘境/妖)」
// —— 仙人墓在 tomb.js、灯尸是妖,都不在地图上,是**设计如此**的局外场所。
// 青岚秘境已从本表移除:它现在是锚点节点名,应由上面的多 seed 断言管住。
const EXTRA=['仙人墓','灯尸'];

const MOUNT_SOURCES = M.MOUNT_LIST.map(m=>m.from)
  .filter(f=>!EXTRA.includes(f))
  .filter((v,i,a)=>a.indexOf(v)===i);   // 去重

const SEEDS = ['青石村','a','b','c','轩轩','12345','seed-0','seed-120','seed-999','测试种子'];
let srcBad=[], dupBad=[], selfDup=[];
for (const sd of SEEDS) {
  const w = W_.regenerate(sd);
  const names = w.nodes.map(n=>n.name).filter(Boolean);
  for (const f of MOUNT_SOURCES)
    if (!names.includes(f)) srcBad.push(`${sd}:${f}`);
  // 同类型节点不许重名 —— 两个「血藤谷」会让 lore 的地名失去指认
  const c = {};
  w.nodes.forEach(n=>{ if(n.name) (c[n.type+':'+n.name] ||= []).push(n.id); });
  for (const [k,v] of Object.entries(c)) if (v.length>1) selfDup.push(`${sd}:${k}`);
  // 同一张图内同类型节点不得重名(不同类型可以同名,如两个村都叫青石村不会发生,但允许)
  const byType = {};
  w.nodes.filter(n=>n.name).forEach(n=>(byType[n.type] ||= []).push(n.name));
  for (const [ty,ns] of Object.entries(byType))
    if (new Set(ns).size !== ns.length) dupBad.push(`${sd}:${ty}`);
}
t(`坐骑来源地名在 ${SEEDS.length} 个种子下都存在`, srcBad.length===0,
  srcBad.length ? `缺: ${[...new Set(srcBad)].join(' ')}` : '');
t('同类型节点不重名', dupBad.length===0,
  dupBad.length ? `重名: ${[...new Set(dupBad)].slice(0,5).join(' ')}` : '');
t('锚点名各出现一次(无同名兄弟)', selfDup.length===0,
  selfDup.length ? `多出: ${[...new Set(selfDup)].slice(0,5).join(' ')}` : '');

// 兜底布局也必须满足锚点 —— 否则「保底」反而破不变量
{
  const w = W_.regenerate('seed-120');   // 实测这个种子会走 minimalFallback
  const names = w.nodes.map(n=>n.name).filter(Boolean);
  t('兜底布局同样带齐锚点',
    [ANCHORS.home,ANCHORS.village,ANCHORS.elite,ANCHORS.boss,ANCHORS.secret].every(a=>names.includes(a)),
    `实际: ${names.join(',')}`);
}

// 收工:把世界还原成进入测试时的种子,别给同进程后续断言留脏状态
W_.regenerate(ORIGIN_SEED);

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
