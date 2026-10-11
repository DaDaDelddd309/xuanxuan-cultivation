// XX-QA-064 · 剧情线与支线的「可达性」—— 关掉 XX-WORLD-007 整个 bug 类
//
// 这个 bug 类已经咬了两次,而且两次都伪装成「产品缺陷」:
//
// ① t89.py「叙事线已结案」—— 测试写死 arrive('n8') ×3,
//    但 V0.97(XX-S4-001)起地图按种子生成,默认种子下 **n8 实测是 field**,
//    而 tomb 线前三环声明 nodeType:'boss'。story.js 的类型判定**正确地**拒绝它,
//    三环一环都推不动 → readyFinish 恒 false → 奖励发了、碑文刻了、支线了结了,
//    唯独叙事线永远结不了案。报出来的错是「还没看完」,看着像功能坏了。
//
// ② t88.py「传说妖支线可结」—— setup 只标了 visited.n10 + n3,
//    但 n3 实测是 **secret**,而 dengshi 支线要 2 个 **field**。
//    永远凑不齐 → 支线永远结不了案。报出来的错是「支线不可结」,同样像产品坏了。
//
// 两处的真实原因都是**「假设某个 id 的类型恒定」这个前提不成立了**。
// 于是这里不钉单点,而是**逐条验全部线在默认种子下真的走得通**:
//   · 每条剧情线的每一环,都能找到一个类型对得上的真实节点
//   · 走完之后 readyFinish 必须为真、finish 必须 ok
//   · 每条支线的达标条件,在默认种子的世界里**必须有足够的节点可满足**
//
// ⚠️ 为什么用默认种子就够:XX-WORLD-007 的结论是「boss 每图恒为 1 个,
//   field 4~9 / secret 2~4 / elite 1~3 / village 2~3」。
//   那意味着**别的种子同样会踩** —— 所以本门禁还额外报出每种类型的节点数,
//   让人一眼看出哪条线的条件已经贴着下限(见【余量】那段)。

globalThis.document = { addEventListener(){}, createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},focus(){}}), body:{appendChild(){}}, getElementById:()=>null };
globalThis.window = {};
globalThis.Audio = function(){ this.play=()=>Promise.resolve(); this.pause=()=>{}; };
const store = {}; globalThis.localStorage = { getItem:k=>store[k]??null, setItem:(k,v)=>store[k]=v, removeItem:k=>delete store[k] };

const { STORY, ARCS } = await import('../js/xiuxian/story.js');
const { QUEST, QUEST_COND } = await import('../js/xiuxian/quest.js');
const { Cult } = await import('../js/xiuxian/index.js');
const { WORLD } = await import('../js/xiuxian/world.js');
// 与 t88.mjs / duel-echo 共用同一份「按 beat 类型找节点」的实现,不另写一份
const { nodeForBeat } = await import('./helpers/play-arc.mjs');

let fails = 0;
const ok = (n, c, extra = '') => {
  if (!c) fails++;
  console.log(`  ${c ? '✅' : '❌'} ${n}${extra ? ` — ${extra}` : ''}`);
};
const clear = () => {
  for (const k of Object.keys(store)) delete store[k];
  STORY.reset(); QUEST.s = { active: [], done: {}, choices: {} }; Cult.load();
};
const typeOf = id => (WORLD.nodes || []).find(n => n.id === id)?.type ?? null;

console.log('【基准】默认种子下每种类型的节点数(全部结论都从这里取,不用字面量)');
const nodes = WORLD.nodes || [];
const byType = {};
for (const n of nodes) (byType[n.type] ||= []).push(n.id);
for (const t of Object.keys(byType).sort()) console.log(`  ${t.padEnd(7)} ${byType[t].length} 个: ${JSON.stringify(byType[t])}`);
ok('世界能读到节点', nodes.length > 0, `${nodes.length} 个节点`);

console.log('\n【剧情线】每条线的每一环都必须能落在真实节点上,且走完能结案');
for (const key of Object.keys(ARCS)) {
  clear();
  const arc = ARCS[key];
  STORY.start(key);
  const used = new Set();
  const bad = [];
  let i = 0;
  for (const b of arc.beats) {
    const idx = i++;
    if (b.room) {
      // 墓内/室内环:必须真的认这个房间 id
      const got = STORY.arriveRoom(b.room);
      if (!got.some(x => x.arc === key && x.beat === idx)) bad.push(`环${idx}(room:${b.room}) 没推进`);
      continue;
    }
    // beat 自带节点类型对不上时必须能找到同类型的替代节点 —— 找不到才是真问题
    const self = nodes.find(n => n.id === b.node);
    const selfOk = !b.nodeType || (self && self.type === b.nodeType);
    const alt = (byType[b.nodeType] || []).filter(x => x !== b.node);
    if (!selfOk && !alt.length) {
      bad.push(`环${idx} 声明 nodeType:'${b.nodeType}' 但世界里没有这种类型`);
      continue;
    }
    const target = nodeForBeat(b, used);
    const t = typeOf(target);
    if (b.nodeType && t !== b.nodeType) {
      bad.push(`环${idx} 落到 ${target}(${t}) 但要的是 '${b.nodeType}'`);
      continue;
    }
    used.add(target);
    const got = STORY.arrive(target);
    if (!got.some(x => x.arc === key && x.beat === idx)) bad.push(`环${idx} 走到 ${target} 没推进`);
  }
  const reached = STORY.s.beat[key] || 0;
  const ready = STORY.readyFinish(key);
  ok(`${key}(${arc.beats.length} 环)走通`, bad.length === 0, bad.length ? bad.join('; ') : `beat=${reached}/${arc.beats.length}`);
  ok(`${key} 走完后可结案`, ready === true, `readyFinish=${ready} (beat=${reached}/${arc.beats.length})`);
  const fin = STORY.finish(key, 1, () => ({ text: [] }));
  ok(`${key} 结案发奖成功`, fin.ok === true && !!STORY.s.done[key], fin.ok ? '' : fin.msg);
}

console.log('\n【支线】该去的点全走一遍,必须真的能结案');
// ⚠️ 这里第一版写成「世界里的该类节点数 ≥ 条件里的 need」,判红说 laolao 不可达。
//   **那条判据本身是错的** —— quest.js:119 早就写了
//   `const need = Math.min(c.need, nodes.length)`,注释里连本例都点名了:
//   「险地(elite)每图只有 1~3 个,而 laolao 要 2 个 —— 只出 1 个险地的图里就永久卡死」
//   → 取 min 的代价是难度随图浮动,换来的是「任何种子都走得完」。
//   即产品是**故意**让 need 跟着图缩的,而我拿原始 need 去卡它。
//   (本项目第 13 次同类坑:度量工具自己比被测对象更武断。)
//
// 正确判据只有一个:**玩家把该去的点全走一遍,这条线到底能不能结。**
// 直接让 progress() 自己算 —— 判据取自被检查对象自身,不取自字面量。
for (const key of Object.keys(QUEST_COND)) {
  const c = QUEST_COND[key];
  if (c.type === 'peace' || c.type === 'tomb') {
    ok(`${key}(${c.type}) 由剧情线/墓内流程驱动,不在本门禁范围`, true,
       c.type === 'tomb' ? '由 tests/xx-qa-003 / t89 覆盖' : '由 STORY.met 覆盖');
    continue;
  }
  const types = c.type === 'boss' ? ['boss'] : c.types;
  const avail = types.reduce((sum, t) => sum + (byType[t] || []).length, 0);
  clear();
  QUEST.s.active = [key];
  Cult.load();
  for (const t of types) for (const n of nodes.filter(x => x.type === t)) Cult.get().visited[n.id] = true;
  Cult.commit();
  const prog = QUEST.progress(key);
  ok(`${key} 该类点全走后可结案`, prog === 1 && QUEST.ready(key) === true,
     `要 ${c.need ?? 1} 个 ${JSON.stringify(types)} / 这图只有 ${avail} 个 → progress=${prog}`);
  if (avail < (c.need ?? 1)) {
    console.log(`     ℹ️ 这图的 ${JSON.stringify(types)} 只有 ${avail} 个 < 声明的 ${c.need}:`);
    console.log(`        quest.js:119 的 min() 封顶会把 need 降到 ${avail},难度随图浮动(有意为之,非缺陷)`);
  }
}

console.log('\n【反例钉死】写死旧 id 会静默推不动(这是 t89 那条红的机制)');
{
  // 用 tomb 线演示:声明的 node 与实际类型不符时,故事线**不会**报错,只是不推进。
  const b0 = ARCS.tomb.beats.find(b => !b.room && b.nodeType);
  const self = typeOf(b0.node);
  if (self !== b0.nodeType) {
    clear(); STORY.start('tomb');
    const got = STORY.arrive(b0.node);
    ok(`${b0.node} 实测是 ${self} ≠ 声明的 ${b0.nodeType} 时,arrive 被正确拒绝`,
       got.length === 0, `推进 ${got.length} 环 —— 静默不推进,不报错`);
  } else {
    ok(`${b0.node} 在默认种子下恰好就是 ${b0.nodeType}(该反例本种子不成立)`, true);
  }
}

console.log(`\n失败 ${fails} 项` + (fails ? '' : ' · 全部通过'));
process.exit(fails ? 1 : 0);
