// tests/spine-stage-reachability.mjs —— 主线骨架「抉择」阶段的**可达性**门禁
// 运行: node tests/spine-stage-reachability.mjs
//
// 为什么需要这个文件(XX-SPINE-004):
//   spine.js 的第四阶段 `ending`(抉择 · 双结局解锁)的解锁条件是
//     if (s.tombstone && nArc >= 2) return 'ending';     // spine.js:144
//   而 nArc 来自 s.arcsDone,s.arcsDone **只有 SPINE.observeArc() 会写**。
//   接线之前,observeArc 的调用点**全仓只有 tests/test-spine.mjs 里那个测试自己**。
//   生产代码一次都没调过 ⇒ arcsDone 恒为 {} ⇒ ending 阶段在真游戏里永远到不了。
//
// 【这个 bug 类为什么能骗过所有人】
//   test-spine.mjs 原来的写法是:
//       SPINE.observeArc('hongyi', true);   ← 测试自己喂
//       SPINE.observeArc('laolao', true);   ← 测试自己喂
//       ok('完成2线+开墓 → ending', ...)     ← 于是永远绿
//   它断言的是「**如果调了就进 ending**」,不是「**实际游戏里会进 ending**」。
//   结局演出是有的(tomb.js 自己出屏),但没有任何系统知道玩家选了哪个结局 ——
//   这个选择对世界状态零影响。玩家看得见戏,看不见因果。
//
//   这就是 AUTONOMY.md §3「绿色的断言主动提供保证」:它不漏报,它是**根本没被问**。
//
// 本门禁的三条判据:
//   1. 全程**不手工调 observeArc**,只走 STORY.finish() 这一真实结案路径,
//      断言阶段确实推进到 ending —— 覆盖从「一条 arc 都没结」到「结了两条 + 开墓」。
//   2. 阶段序列**单调**:不会倒退。
//   3. **反例钉死**:条件不满足时**不会**提前进 ending。
//   4. **反向自检**:把「单调」的方向写反时,本门禁必须报红(见 [5])。

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};

const { SPINE, PHASES, ENDING_BY_PATH } = await import('../js/xiuxian/spine.js');
const { STORY, ARCS } = await import('../js/xiuxian/story.js');
const { OUTCOMES } = await import('../js/xiuxian/outcomes.js');
// 与 t88 / duel-echo 共用同一份「按 beat 类型找真实节点」的实现,不另写一份。
// (XX-WORLD-007 之后节点类型随种子漂,写死 id 会静默推不动。)
const { nodeForBeat, walkArc } = await import('./helpers/play-arc.mjs');

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, d = '') => {
  if (c) pass++; else { fail++; failed.push(n + (d ? ' :: ' + d : '')); console.log(`  ❌ ${n} ${d}`); }
};

/** 清干净:localStorage + 两个模块的状态,避免上一段留的脏数据影响下一段 */
const clear = () => {
  mem.clear();
  SPINE.reset();
  STORY.reset();
};

/** 真实走完一条线并结案 —— 全程不碰 SPINE.observeArc */
function playAndFinish(key, path = 1) {
  STORY.start(key);
  const used = new Set();
  for (const b of ARCS[key].beats) {
    const t = nodeForBeat(b, used);
    used.add(t);
    STORY.arrive(t);
  }
  return STORY.finish(key, path, () => ({ text: [] }));
}

console.log('\n[1] 起跑线:一条 arc 都没结时,不该在 ending');
{
  clear();
  const s = SPINE.get();
  ok('arcsDone 初始为空', Object.keys(s.arcsDone).length === 0);
  ok('阶段在 depart', s.phase === 'depart', `实际 ${s.phase}`);
  ok('此刻不在 ending', s.phase !== 'ending');
  ok('tombstone 初始为 false', s.tombstone === false);
}

console.log('\n[2] 全程不调 observeArc,只走 STORY.finish()');
{
  clear();
  const r1 = playAndFinish('hongyi');
  ok('第 1 条线结案成功', r1.ok === true, r1.ok ? '' : r1.msg);
  // 关键断言:arcsDone 由生产代码自己写,不是测试喂的
  ok('finish 后 arcsDone 记上了第 1 条(生产代码自己写的)',
     Object.keys(SPINE.get().arcsDone).length === 1,
     `arcsDone=${JSON.stringify(Object.keys(SPINE.get().arcsDone))}`);

  const r2 = playAndFinish('laolao');
  ok('第 2 条线结案成功', r2.ok === true, r2.ok ? '' : r2.msg);
  ok('finish 后 arcsDone 记上了第 2 条',
     Object.keys(SPINE.get().arcsDone).length === 2,
     `arcsDone=${JSON.stringify(Object.keys(SPINE.get().arcsDone))}`);
}

console.log('\n[3] 开墓后阶段真的推进到 ending(不是测试自己喂的)');
{
  // 承上:此处 arcsDone 已是 2 条,由上面的真实 finish 写入
  ok('开墓前不在 ending(还差 tombstone)', SPINE.get().phase !== 'ending',
     `实际 ${SPINE.get().phase}`);
  SPINE.openTomb();
  ok('开墓 + 2 条 arc → ending', SPINE.get().phase === 'ending',
     `实际 ${SPINE.get().phase}`);
  ok('ending 是最后一个阶段', PHASES.ending.n === 4);
}

console.log('\n[4] 阶段序列单调:不会倒退');
{
  clear();
  // 攒一个真实发生的倒退场景:
  //   _compute 的 nQuest 只数 status==='active' 的支线,
  //   支线结案后被 observeQuest(key,'done') 改成 done ⇒ nQuest 掉到 0
  //   ⇒ 未夹 _atLeast 时阶段会从 intervene 掉回 encounter。
  // ui/story.js:72 在生产里就会把 done 的支线同步回主线,所以这不是理论场景。
  SPINE.observeLegend('a'); SPINE.observeLegend('b'); SPINE.observeLegend('c');
  SPINE.observeQuest('q1', 'active');
  const atIntervene = SPINE.get().phase;
  ok('前置:已到 intervene', atIntervene === 'intervene', `实际 ${atIntervene}`);
  SPINE.observeQuest('q1', 'done');
  ok('支线结案后阶段不倒退(仍 intervene)', SPINE.get().phase === 'intervene',
     `实际 ${SPINE.get().phase}`);

  // 整段真实路径上的单调性:每一步都比上一步不低
  clear();
  const seq = [SPINE.get().phase];
  const step = f => { f(); seq.push(SPINE.get().phase); };
  step(() => SPINE.observeLegend('hongyi'));
  step(() => SPINE.observeLegend('laolao'));
  step(() => SPINE.observeLegend('baize'));
  step(() => SPINE.observeQuest('q1', 'active'));
  step(() => playAndFinish('hongyi'));
  step(() => playAndFinish('laolao'));
  step(() => SPINE.openTomb());
  let regressAt = -1;
  for (let i = 1; i < seq.length; i++) {
    if ((PHASES[seq[i]]?.n || 0) < (PHASES[seq[i - 1]]?.n || 0)) { regressAt = i; break; }
  }
  ok('整段路径阶段单调不倒退', regressAt === -1,
     regressAt >= 0 ? `第 ${regressAt} 步 ${seq[regressAt - 1]} → ${seq[regressAt]}` : '');
  console.log('     ' + seq.join(' → '));
}

console.log('\n[5] 反向自检:方向/约定写反时,本门禁必须报红');
{
  // [4] 的单调断言依赖 PHASES[].n 这个约定。把方向写反(应 >= 却写成 <=),
  // [4] 的判定函数应当变红 —— 否则「单调」这条断言其实什么都没验。
  const seq = ['depart', 'encounter', 'intervene', 'ending'];
  const nums = seq.map(p => PHASES[p]?.n || 0);
  const isMonoUp = arr => arr.every((v, i) => i === 0 || v >= arr[i - 1]);
  ok('自检·正例:真实递增序列被判为单调', isMonoUp(nums) === true);

  // 把方向反过来:判「单调」时用 <=
  const isMonoDown = arr => arr.every((v, i) => i === 0 || v <= arr[i - 1]);
  ok('自检·反例:方向写反后必须判为「不单调」(否则断言失效)',
     isMonoDown(nums) === false, `isMonoDown 返回了 ${isMonoDown(nums)}`);

  // 再钉一条:PHASES[].n 若不严格递增,单调这个约定本身就失效了
  const ns = Object.values(PHASES).map(p => p.n).sort((a, b) => a - b);
  ok('自检·PHASES.n 是 1..4 严格递增(单调约定的前提)',
     JSON.stringify(ns) === JSON.stringify([1, 2, 3, 4]), JSON.stringify(ns));
}

console.log('\n[6] 反例钉死:条件不满足时不能提前进 ending');
{
  // 反例 A:0 条 arc + 开墓 ⇒ 不许进
  clear();
  SPINE.openTomb();
  ok('0 条 arc + 开墓 → 不进 ending', SPINE.get().phase !== 'ending',
     `实际 ${SPINE.get().phase}`);

  // 反例 B:1 条 arc + 开墓 ⇒ 不许进(缺一条)
  clear();
  playAndFinish('hongyi');
  SPINE.openTomb();
  ok('1 条 arc + 开墓 → 不进 ending', SPINE.get().phase !== 'ending',
     `实际 ${SPINE.get().phase}`);

  // 反例 C:2 条 arc 但**没开墓** ⇒ 不许进(这里直接改 arcsDone 绕开
  // finish(),只为单独验证 tombstone 这一个条件;不构成对可达性的断言)
  clear();
  SPINE.get().arcsDone = { hongyi: 1, laolao: 1 };
  ok('2 条 arc 但没开墓 → 不进 ending', SPINE.get().phase !== 'ending',
     `实际 ${SPINE.get().phase}`);

  // 正例收尾:补上开墓 ⇒ 这时才进
  SPINE.openTomb();
  ok('2 条 arc + 开墓 → 进 ending', SPINE.get().phase === 'ending',
     `实际 ${SPINE.get().phase}`);
}

console.log('\n[7] 生产代码里存在 observeArc 的调用点(结构自查)');
{
  // 运行时断言已经覆盖了行为([2])。这条再加一道结构检查:
  // 防止有人把 story.js 的接线删掉、同时把 [2] 也一起改绿。
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../js/xiuxian/story.js', import.meta.url), 'utf8');
  ok('story.js 里确实调了 SPINE.observeArc', /SPINE\.observeArc\(/.test(src));
  ok('接线在 finish() 里(不是别处)',
     /finish\(key, path, grant\)[\s\S]{0,3000}SPINE\.observeArc\(/.test(src));
}

console.log('\n[8] 双结局落档:选结局这件事对世界状态不再是零影响');
{
  // 真实墓线路径:start → 走完 4 环(末环 room:'sj',只能由 arriveRoom 推进)
  //           → finish('tomb', path, null)
  // 最后一行刻意与 tomb.js:181 同形(grant 传 null):验的是生产那一笔,不是理想形态。
  const playTomb = path => {
    clear();
    STORY.start('tomb');
    walkArc('tomb');
    return STORY.finish('tomb', path, null);
  };

  const r1 = playTomb(1);
  ok('墓线 path=1 结案成功', r1 && r1.ok === true, r1 ? '' : (r1 && r1.msg));
  ok('path=1 落档为「奈何无人共」', SPINE.get().ending === OUTCOMES.unlone,
     `s.ending=${SPINE.get().ending}`);
  ok('path=1 同时写进 choices.ending(审计读的字段)',
     SPINE.get().choices.ending === OUTCOMES.unlone,
     `choices.ending=${SPINE.get().choices.ending}`);

  const r2 = playTomb(2);
  ok('墓线 path=2 结案成功', r2 && r2.ok === true, r2 ? '' : (r2 && r2.msg));
  ok('path=2 落档为「此生无悔」', SPINE.get().ending === OUTCOMES.noless,
     `s.ending=${SPINE.get().ending}`);

  // 结案回声没丢(接线不能把原有行为挤掉)
  ok('结案仍产生流言回声(XX-NET-001 没被挤掉)',
     STORY.s.rumors.length >= 2, `rumors=${STORY.s.rumors.length}`);

  // 非法 path:必须「什么都不记」,不能兜底成 noless
  clear();
  const bad = SPINE.chooseEndingByPath(3);
  ok('非法 path 返回 null', bad === null, `得到 ${bad}`);
  // ⚠️ 这里第一次写成了 `choices.ending === null`,红了一条 —— 是**断言写错**,
  //   不是代码写错:defaultState() 给的是 `choices:{}`,没写过的键是 **undefined**。
  //   存档里「没落档」就长这样(save-integrity-audit 也按这个形状登记),
  //   所以判据用「取不到值」而不是「等于 null」。
  ok('非法 path 不落档(否则玩家会记着一个自己没选过的结局)',
     SPINE.get().ending === null && !SPINE.get().choices.ending,
     `ending=${SPINE.get().ending} choices.ending=${SPINE.get().choices.ending}`);
}

console.log('\n[9] 反向自检:path↔结局 的映射方向写反时必须报红');
{
  ok('表内容 1→unlone / 2→noless',
     ENDING_BY_PATH[1] === 'unlone' && ENDING_BY_PATH[2] === 'noless',
     JSON.stringify(ENDING_BY_PATH));

  // 从**叙事文案**反推方向,而不是照抄上面的表 —— 表错了这里就会红。
  const last = ARCS.tomb.beats[ARCS.tomb.beats.length - 1];
  const derived = path => {
    const text = path === 1 ? last.epilogue : last.epilogue2;
    return Object.keys(OUTCOMES).find(k => text.includes(OUTCOMES[k]));
  };
  ok('文案反推:path=1 的尾声说的是 unlone 那半句', derived(1) === 'unlone',
     `epilogue=${last.epilogue} → ${derived(1)}`);
  ok('文案反推:path=2 的尾声说的是 noless 那半句', derived(2) === 'noless',
     `epilogue2=${last.epilogue2} → ${derived(2)}`);

  // 反例自检:方向写反的表必须对不上文案。
  //   —— 证明上面两条断言真的有牙,而不是恒真。
  const swapped = { 1: 'noless', 2: 'unlone' };
  const matches = (map, path) =>
    (path === 1 ? last.epilogue : last.epilogue2).includes(OUTCOMES[map[path]]);
  ok('自检·反例:写反的表与文案对不上(否则断言恒真)',
     matches(swapped, 1) === false && matches(swapped, 2) === false,
     'swapped 判为对上了');
}

console.log(`\nspine-stage-reachability: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
if (fail) { failed.forEach(f => console.log('  ' + f)); process.exit(1); }