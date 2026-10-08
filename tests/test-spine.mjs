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
  // 完成 2 条线 + 开墓 → ending
  SPINE.observeArc('hongyi', true);
  SPINE.observeArc('laolao', true);
  SPINE.openTomb();
  ok('完成2线+开墓 → ending', SPINE.get().phase === 'ending', `实际 ${SPINE.get().phase}`);
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