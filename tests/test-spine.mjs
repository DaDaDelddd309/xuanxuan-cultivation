// 主线骨架测试 —— 工单 XX-SPINE-001/002
// 运行: node tests/test-spine.mjs
// Node 环境无 localStorage,用一个内存 shim 顶上(与 test-seed 同一思路)

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};

const { SPINE, PHASES, CAUSAL_LINKS } = await import('../js/xiuxian/spine.js');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

console.log('\n[1] 阶段定义完整');
{
  ok('四个阶段齐全', Object.keys(PHASES).length === 4, Object.keys(PHASES).join(','));
  ok('每阶段有名字', Object.values(PHASES).every(p => p.name && p.name.length));
  ok('每阶段有目标(玩家知道要做什么)', Object.values(PHASES).every(p => p.goal && p.goal.length));
  ok('每阶段有进入条件', Object.values(PHASES).every(p => p.enter && p.enter.length));
}

console.log('\n[2] 初始状态在第一阶段');
{
  SPINE.reset();
  ok('初始为 depart', SPINE.get().phase === 'depart');
  ok('depma 是第一阶段', PHASES.depart.n === 1);
  ok('尚未见到任何妖', Object.keys(SPINE.get().seen).length === 0);
}

console.log('\n[3] 阶段推进');
{
  SPINE.reset();
  // 见到 1 只 → encounter
  SPINE.observeLegend('hongyi');
  ok('见到1只 → encounter', SPINE.get().phase === 'encounter', `实际 ${SPINE.get().phase}`);
  // 见到 3 只 + 接 1 支线 → intervene
  SPINE.observeLegend('laolao');
  SPINE.observeLegend('baize');
  ok('见到3只仍 encounter(还差支线)', SPINE.get().phase === 'encounter');
  SPINE.observeQuest('q1', 'active');
  ok('见到3只+接1支线 → intervene', SPINE.get().phase === 'intervene', `实际 ${SPINE.get().phase}`);
}

// ⚠️【XX-SPINE-004】原来这里的三行被删掉了,不是「不需要」,是**它测错了东西**:
//     SPINE.observeArc('hongyi', true);
//     SPINE.observeArc('laolao', true);
//     SPINE.openTomb();
//     ok('完成2线+开墓 → ending', ...);
//   它**自己**把 arcsDone 喂进去,再断言「喂进去就会进 ending」。
//   而生产代码里 observeArc 的调用点全仓只有这个测试自己 ——
//   于是它一直是绿的,真游戏里 s.arcsDone 恒为 {},第四阶段「抉择」永远到不了。
//   绿色的断言**主动提供保证**:它让人以为这条路被走过。
//
// 现在改成断言真正该断言的东西:「不手工调 observeArc,只走 STORY.finish(),
// 阶段能不能自己走到 ending」。这条断言在接线之前会红 —— 那才是它该有的样子。
// 更完整的可达性门禁(含反向注入)在 tests/spine-stage-reachability.mjs。
console.log('\n[3b] ending 阶段在生产路径上真的走得到(不手工调 observeArc)');
{
  const mem2 = mem;
  const { STORY: ST } = await import('../js/xiuxian/story.js');
  const { nodeForBeat } = await import('./helpers/play-arc.mjs');
  const { ARCS } = await import('../js/xiuxian/story.js');

  SPINE.reset();
  ST.reset();
  mem2.clear();

  let finished = 0;
  for (const k of ['hongyi', 'laolao']) {
    ST.start(k);
    const arc = ARCS[k];
    const used = new Set();
    for (const b of arc.beats) {
      const t = nodeForBeat(b, used);
      used.add(t);
      ST.arrive(t);
    }
    const r = ST.finish(k, 1, () => ({ text: [] }));
    if (r.ok) finished++;
  }
  ok('两条线都真的结案了(前置)', finished === 2, `结案 ${finished}/2`);
  ok('STORY.finish 自己把 arcsDone 记上了(不靠测试手工喂)',
     Object.keys(SPINE.get().arcsDone).length === 2,
     `arcsDone=${JSON.stringify(Object.keys(SPINE.get().arcsDone))}`);
  SPINE.openTomb();
  ok('走生产路径 → ending', SPINE.get().phase === 'ending', `实际 ${SPINE.get().phase}`);

  ST.reset();
  mem2.clear();
  SPINE.reset();
}

console.log('\n[4] 阶段不倒退');
{
  SPINE.reset();
  SPINE.observeLegend('a'); SPINE.observeLegend('b'); SPINE.observeLegend('c');
  SPINE.observeQuest('q', 'active');
  const at = SPINE.get().phase;
  ok('进入 intervene 后不回退', SPINE.get().phase === 'intervene' && at === 'intervene');
}

console.log('\n[5] 因果提示:见过 A 才提示 B 的关联');
{
  SPINE.reset();
  // 先见姥姥:此时没见过女鬼,不应提示
  const r1 = SPINE.observeLegend('laolao');
  ok('没见过女鬼时不提示因果', r1.lines.length === 0, `得到 ${JSON.stringify(r1.lines)}`);

  // 再见女鬼:此时姥姥见过了,应提示
  const r2 = SPINE.observeLegend('hongyi');
  ok('见过姥姥后再见女鬼 → 补因果', r2.lines.length >= 1,
     `得到 ${JSON.stringify(r2.lines)}`);
  if (r2.lines.length) console.log(`     提示语: ${r2.lines[0]}`);
}

console.log('\n[6] 因果提示不重复啰嗦');
{
  SPINE.reset();
  SPINE.observeLegend('hongyi');
  const again = SPINE.observeLegend('hongyi');
  ok('第二次见同一只不再提示', again.lines.length === 0, `得到 ${JSON.stringify(again.lines)}`);
}

console.log('\n[7] 因果图完整性');
{
  const keys = Object.keys(CAUSAL_LINKS);
  ok('因果图非空', keys.length > 0);
  ok('每条因果都有文字', keys.every(k =>
    CAUSAL_LINKS[k].every(l => l.line && l.line.length > 5)));
  // 引用的 from 必须是真实存在的 key
  const ALL = ['hongyi','laolao','baize','dangkang','qingqiong','jiangu','shijiang','dengshi'];
  const badRef = [];
  keys.forEach(k => CAUSAL_LINKS[k].forEach(l => { if (!ALL.includes(l.from)) badRef.push(l.from); }));
  ok('因果引用无悬空 key', badRef.length === 0, badRef.join(','));
}

console.log('\n[8] 进度提示(玩家知道还差多少)');
{
  SPINE.reset();
  const p0 = SPINE.progress();
  ok('depart 有进度提示', typeof p0.text === 'string' && p0.need >= 1);
  SPINE.observeLegend('hongyi');
  const p1 = SPINE.progress();
  ok('encounter 显示已见数量', /1\/3/.test(p1.text) || p1.cur === 1,
     `实际 "${p1.text}" cur=${p1.cur}`);
  console.log(`     ${p0.text} → ${p1.text}`);
}

console.log('\n[9] 双结局:不改奖励,只定义你是谁');
{
  SPINE.reset();
  const a = SPINE.chooseEnding('unlone');
  ok('结局一 = 奈何无人共', a === '奈何无人共', `实际 ${a}`);
  SPINE.reset();
  const b = SPINE.chooseEnding('noless');
  ok('结局二 = 此生无悔', b === '此生无悔', `实际 ${b}`);
  ok('两种结局都是文字,不涉数值', typeof a === 'string' && typeof b === 'string');
}

console.log('\n[10] 时间痕迹(不是养成任务)');
{
  SPINE.reset();
  SPINE.observeLegend('hongyi');
  SPINE.observeLegend('laolao');
  SPINE.observeLegend('baize');
  SPINE.observeQuest('q', 'active');
  const tl = SPINE.timeline();
  ok('阶段推进有记录', tl.length >= 1, `${tl.length} 条`);
  ok('记录含 from/to', tl.every(e => e.from && e.to));
  console.log('     ' + tl.map(e => `${e.from}→${e.to}`).join(', '));
}

console.log('\n[11] 存档往返');
{
  SPINE.reset();
  SPINE.observeLegend('hongyi');
  SPINE.observeQuest('q', 'active');
  const before = JSON.stringify(SPINE.get());
  SPINE.s = null;
  SPINE.load();
  ok('重载后状态一致', JSON.stringify(SPINE.get()) === before);
  SPINE.reset();
}

console.log(`\ntest-spine: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
if (fail) { failed.forEach(f => console.log('  ' + f)); process.exit(1); }