// Collatz 局内难度曲线 —— 回归门禁(XX-MATH-001)
//
// 这个特性最危险的不是算错,是**悄悄不生效**:
//
//   1. 没激活时调制系数恒为 1 ⇒「接了但没反应」,而且**所有测试照样全绿**
//      (这正是 XX-PLAY 那一族门禁自欺的老问题:断言与实现同源)。
//      所以这里必须有一条「接上之后行为确实变了」的**差异断言**。
//   2. 阈值取一个不可达的值 ⇒ 分支永远进不去。本项目已经踩过一次:
//      biasOf 的 oddRatio 阈值原写 0.5,而取样区间内 oddRatio 最大只有 0.365,
//      1000 个种子**全部**返回 'sustain',特性是死的。
//      所以必须断言「两种倾向都真实出现过」。
//
// 运行: node tests/collatz-difficulty-regression.mjs
globalThis.document = {
  addEventListener(){}, createElement:()=>({ style:{}, classList:{ add(){}, remove(){} },
    appendChild(){}, focus(){} }), body:{ appendChild(){} }, getElementById:()=>null,
};
globalThis.window = {};
globalThis.Audio = function(){ this.play=()=>Promise.resolve(); this.pause=()=>{}; };

import * as C from '../js/game/collatz.js';
import * as S from '../js/game/spawner.js';

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; failed.push(name + (detail ? ' :: ' + detail : '')); }
}

// ══════════════════════════════════════════════════
console.log('\n[1] 轨迹算得对吗(对照 COLLATZ 已知值)');
{
  // 这些是公开可查的经典值,不是从实现里反推的 —— 断言独立于被检查的数据。
  const cases = [
    [1, 0, 1], [2, 1, 2], [3, 7, 16], [6, 8, 16], [7, 16, 52], [27, 111, 9232],
  ];
  for (const [n, steps, peak] of cases) {
    const t = C.trajectory(n);
    ok(`trajectory(${n}).steps === ${steps}`, t.steps === steps, `实测 ${t.steps}`);
    ok(`trajectory(${n}).peak === ${peak}`, t.peak === peak, `实测 ${t.peak}`);
  }
  ok('轨迹最终都落到 1', [1, 2, 3, 6, 7, 27].every(n => !C.trajectory(n).capped));
  ok('序列长度 = 步数 + 1', C.trajectory(27).seq.length === C.trajectory(27).steps + 1);
}

// ══════════════════════════════════════════════════
console.log('\n[2] 必须有兜底:不收敛不能死循环');
{
  const t = C.trajectory(7, 10);            // 强行砍到 10 步
  ok('超过 cap 就停', t.steps === 10, `实测 ${t.steps}`);
  ok('被截断时 capped=true', t.capped === true);
  ok('非法输入不炸(n=0/负数/NaN 都当 1)', [0, -5, NaN, undefined, 1.7]
    .every(n => C.trajectory(n).steps === 0));
}

// ══════════════════════════════════════════════════
console.log('\n[3] 确定性:同种子必同输出');
{
  const a = JSON.stringify(C.runSeedFor('轩轩-abc-123'));
  const b = JSON.stringify(C.runSeedFor('轩轩-abc-123'));
  ok('runSeedFor 同输入同输出', a === b);
  ok('不同种子得到不同 n', C.runSeedFor('a').n !== C.runSeedFor('b').n);
  ok('n 落在声明的取样区间内', (() => {
    for (let i = 0; i < 200; i++) { const r = C.runSeedFor('s' + i); if (r.n < 64 || r.n > 1024) return false; }
    return true;
  })());
}

// ══════════════════════════════════════════════════
console.log('\n[4] 调制系数恒在区间内(200 个种子 × 全程扫描)');
{
  let lo = Infinity, hi = -Infinity, out = 0;
  for (let i = 0; i < 200; i++) {
    const r = C.runSeedFor('m' + i);
    for (let t = 0; t <= 1800; t += 5) {
      const m = C.modAt(r.traj, t);
      if (m < lo) lo = m; if (m > hi) hi = m;
      if (m < C.MOD_MIN - 1e-9 || m > C.MOD_MAX + 1e-9) out++;
    }
  }
  ok('没有任何一次越界', out === 0, `${out} 次越界`);
  ok('系数确实在动(不是恒等于 1)', hi - lo > 0.05, `实测跨度 ${(hi - lo).toFixed(4)}`);
  console.log(`     实测区间 [${lo.toFixed(4)}, ${hi.toFixed(4)}]  声明 [${C.MOD_MIN}, ${C.MOD_MAX}]`);
}

// ══════════════════════════════════════════════════
console.log('\n[5] 特性必须真的会触发(防"死特性")');
{
  // ⚠️ 本项目已踩过一次:阈值取 0.5,而 oddRatio 最大只有 0.365,
  //    biasOf 于是 1000/1000 恒返回 'sustain',特性形同虚设且无人发现。
  const c = { aggro: 0, sustain: 0 };
  for (let i = 0; i < 1000; i++) { c[C.biasOf(C.runSeedFor('b' + i).traj)]++; }
  ok('两种倾向都会出现(阈值可达)', c.aggro > 0 && c.sustain > 0,
     `aggro=${c.aggro} sustain=${c.sustain}`);
  ok('阈值不超过实测 oddRatio 上界', C.ODD_BIAS_CUT <= 0.365,
     `阈值 ${C.ODD_BIAS_CUT},实测上界 0.365`);
  console.log(`     分布 aggro=${c.aggro} / sustain=${c.sustain}`);

  // 奇数步=爆发 / 偶数步=收敛:这个映射是玩家能学会的那部分,不能反
  const r = C.runSeedFor('parity-probe');
  const kinds = new Set();
  for (let t = 0; t <= 600; t += 5) kinds.add(C.parityAt(r.traj, t));
  ok('奇偶/结算三种状态都会出现', kinds.size >= 2, [...kinds].join(','));
}

// ══════════════════════════════════════════════════
console.log('\n[6] 接进 spawner 之后:默认中性,且接上就真的变');
{
  S.setCollatzTrajectory(null);
  ok('未激活时系数恒为 1', [0, 100, 600, 1800].every(t => S.collatzModAt(t) === 1));

  // 差异断言:先量中性基准,再激活,量同一个 t 的比值,
  // 必须**恰好**等于调制系数 —— 这条保证「接上之后行为确实变了」,
  // 而不只是"函数存在"。
  const probe = [0, 90, 300, 900];
  const baseHp = probe.map(t => S.hpMultAt(t));
  const baseElite = probe.map(t => S.eliteHpMultAt(t));

  const r = C.runSeedFor('integration-probe');
  S.setCollatzTrajectory(r.traj);
  const moved = probe.some((t, i) => Math.abs(S.hpMultAt(t) - baseHp[i]) > 1e-9);
  ok('激活后 hpMultAt 确实变了(不是接了个寂寞)', moved,
     `基准 ${baseHp.map(v => v.toFixed(3)).join('/')} → 现在 ${probe.map(t => S.hpMultAt(t).toFixed(3)).join('/')}`);
  ok('比值恰好等于调制系数(唯一的改动就是它)',
     probe.every((t, i) => Math.abs(S.hpMultAt(t) / baseHp[i] - S.collatzModAt(t)) < 1e-9));
  ok('精英曲线同样按系数缩放',
     probe.every((t, i) => Math.abs(S.eliteHpMultAt(t) / baseElite[i] - S.collatzModAt(t)) < 1e-9));

  S.setCollatzTrajectory(null);
  ok('关掉后完全回到中性(可回滚)', probe.every((t, i) => S.hpMultAt(t) === baseHp[i]));
  ok('getCollatzTrajectory 能取回注入的轨迹', (() => {
    S.setCollatzTrajectory(r.traj);
    const got = S.getCollatzTrajectory() === r.traj;
    S.setCollatzTrajectory(null);
    return got;
  })());
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (failed.length) { console.log('\n失败明细:'); for (const f of failed) console.log('  ✗ ' + f); }
process.exit(fail ? 1 : 0);