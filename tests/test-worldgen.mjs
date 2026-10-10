// 节点图生成回归测试 —— 工单 XX-S3-001~005
// 运行: node tests/test-worldgen.mjs
import { generate, validate, GRID, MAX_SECRET_DEPTH, DENSITY } from '../js/xiuxian/worldgen.js';

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; failed.push(name + (detail ? ' :: ' + detail : '')); }
}

const N = 1000;
console.log(`\n[1] ${N} 个随机种子的不变量校验`);
console.log(`    (全连通 / 秘境≤${MAX_SECRET_DEPTH}步 / Boss非死角 / 必含Boss秘境)`);

const t0 = Date.now();
const problems = [];
let attemptsHist = {};
let fallbackCount = 0;

for (let i = 0; i < N; i++) {
  const seed = 'seed-' + i;
  const w = generate(seed);
  const v = validate(w.nodes, w.edges);

  if (!v.ok) problems.push(`${seed}: ${v.reasons.join('; ')}`);
  if (v.ok !== true && w.fallback) fallbackCount++;
  attemptsHist[w.attempts] = (attemptsHist[w.attempts] || 0) + 1;

  // 额外: fallback 的世界也必须合法
  if (!v.ok && w.fallback) problems.push(`${seed}: 连兜底布局都不合法 - ${v.reasons.join('; ')}`);
}
const elapsed = Date.now() - t0;

ok(`${N} 个种子全部通过不变量`, problems.length === 0,
   problems.length ? `${problems.length} 个失败, 首个: ${problems[0]}` : '');

console.log(`     耗时: ${elapsed}ms (平均 ${(elapsed / N).toFixed(2)}ms/次)`);
console.log(`     重试次数分布: ${JSON.stringify(attemptsHist)}`);
console.log(`     兜底布局触发: ${fallbackCount} 次`);

ok('单次生成 < 50ms', elapsed / N < 50, `实际 ${(elapsed / N).toFixed(2)}ms`);
ok('总耗时 < 5s', elapsed < 5000, `实际 ${elapsed}ms`);
ok('兜底布局触发率 < 1%', fallbackCount / N < 0.01, `${fallbackCount}/${N}`);

console.log('\n[2] home 节点固定');
{
  let allFixed = true;
  for (let i = 0; i < 200; i++) {
    const w = generate('home-' + i);
    const h = w.nodes.find(n => n.home);
    if (!h || h.x !== 1 || h.y !== 1 || h.name !== '青石村') allFixed = false;
  }
  ok('200 个种子的 home 恒为 (1,1) 青石村', allFixed);
}

console.log('\n[3] 同种子可复现');
{
  let same = true, diff = 0;
  for (let i = 0; i < 100; i++) {
    const s = 'repro-' + i;
    const a = generate(s), b = generate(s);
    if (JSON.stringify(a.nodes) !== JSON.stringify(b.nodes)) same = false;
    if (JSON.stringify(a.nodes) === JSON.stringify(generate('other-' + i).nodes)) diff++;
  }
  ok('同种子两次生成节点完全一致', same);
  ok('不同种子生成结果确实不同', diff < 20, `${diff}/100 与对照组相同`);
}

console.log('\n[4] 密度区间');
{
  let violations = 0;
  const counts = { village: 0, secret: 0, field: 0, elite: 0, boss: 0 };
  for (let i = 0; i < 300; i++) {
    const w = generate('dens-' + i);
    const c = {};
    for (const n of w.nodes) c[n.type] = (c[n.type] || 0) + 1;
    for (const t in counts) counts[t] += c[t] || 0;
    // 村庄不含 home
    if ((c.village || 0) - 1 < DENSITY.village[0] || (c.village || 0) - 1 > DENSITY.village[1]) violations++;
    if ((c.secret || 0) < DENSITY.secret[0] || (c.secret || 0) > DENSITY.secret[1]) violations++;
    if ((c.field || 0) < DENSITY.fieldMin) violations++;
    if ((c.boss || 0) !== 1) violations++;
  }
  const avg = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, (v / 300).toFixed(1)]));
  console.log(`     平均节点数: ${JSON.stringify(avg)}`);
  console.log(`     区间要求: village ${DENSITY.village} secret ${DENSITY.secret} field≥${DENSITY.fieldMin} boss ${DENSITY.boss}`);
  ok('300 个种子的密度都在区间内', violations === 0, `${violations} 次越界`);
}

console.log('\n[5] 秘境距离分布');
{
  const buckets = {};
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const w = generate('dist-' + i);
    // 自己算一遍 BFS
    const occ = new Set(w.nodes.map(n => n.x + ',' + n.y));
    const dist = new Map([['1,1', 0]]);
    const q = ['1,1'];
    while (q.length) {
      const cur = q.shift();
      const [cx, cy] = cur.split(',').map(Number);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx+dx, ny = cy+dy, k = nx+','+ny;
        if (nx<1||nx>GRID||ny<1||ny>GRID||!occ.has(k)||dist.has(k)) continue;
        dist.set(k, dist.get(cur)+1); q.push(k);
      }
    }
    for (const n of w.nodes.filter(x => x.type === 'secret')) {
      const d = dist.get(n.x+','+n.y);
      buckets[d] = (buckets[d]||0)+1;
      worst = Math.max(worst, d);
    }
  }
  console.log(`     秘境步数分布: ${JSON.stringify(buckets)}  最远 ${worst} 步`);
  ok('所有秘境 ≤ ' + MAX_SECRET_DEPTH + ' 步', worst <= MAX_SECRET_DEPTH, `最远 ${worst}`);
  ok('秘境确实分布在多档距离(不是全挤一起)', Object.keys(buckets).length >= 2);
}

console.log('\n[6] Boss 死角检查');
{
  let deadEnds = 0;
  for (let i = 0; i < 300; i++) {
    const w = generate('boss-' + i);
    for (const n of w.nodes.filter(x => x.type === 'boss')) {
      const deg = w.edges.filter(e => e[0] === n || e[1] === n).length;
      if (deg < 2) deadEnds++;
    }
  }
  ok('300 个种子的 Boss 度数全部 ≥ 2', deadEnds === 0, `${deadEnds} 个落在死角`);
}

console.log('\n[7] id 唯一性与格式');
{
  let dup = 0, badFmt = 0;
  for (let i = 0; i < 200; i++) {
    const w = generate('id-' + i);
    const ids = w.nodes.map(n => n.id);
    if (new Set(ids).size !== ids.length) dup++;
    ids.forEach(id => { if (!/^n\d+$/.test(id)) badFmt++; });
  }
  ok('节点 id 无重复', dup === 0, `${dup} 次重复`);
  ok('id 格式均为 n<数字>', badFmt === 0, `${badFmt} 个格式错`);
}

console.log(`\ntest-worldgen: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
if (problems.length) {
  console.log('\n失败样例(前 10):');
  problems.slice(0, 10).forEach(p => console.log('  ' + p));
}
if (fail) {
  console.log('\n失败项:');
  failed.forEach(f => console.log('  ' + f));
  process.exit(1);
}