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

// ══════════════════════════════════════════════════
console.log('\n[7] 机制必须**落到界面上**,否则玩家看不见就等于没做');
{
  // 难度调制本身是**看不见**的:系数在 0.85~1.25 之间无声起伏。
  // 不给信号的话玩家只会觉得「难度在乱抖」,「可学习」这个前提整个落空。
  S.setCollatzTrajectory(null);
  ok('未激活时不显示信号(不留空串污染计时器)', [0, 100, 600].every(t => S.collatzParityAt(t) === ''));

  const r = C.runSeedFor('hud-probe');
  S.setCollatzTrajectory(r.traj);
  const seen = new Set();
  // ⚠️ 窗口必须按**这条轨迹的真实长度**算,不能拍一个「900 秒」。
  //    900/20 = 45 步,而这条轨迹可能有一百多步 —— 根本走不到末尾,
  //    于是 settle 永远不出现,断言会以「玩家学不到」的名义报红,其实是窗口拍小了。
  const span = (r.traj.steps + 2) * 20;
  for (let t = 0; t <= span; t += 5) seen.add(S.collatzParityAt(t));
  ok('信号只取约定的三种值', [...seen].every(v => ['odd', 'even', 'settle'].includes(v)),
     [...seen].join(','));
  ok(`整条轨迹(${r.traj.steps} 步)走完三种信号都出现过(玩家真能学到)`, seen.size === 3,
     [...seen].join(','));

  // 防「导出了但没人用」——本模块一度 6 个导出里 4 个生产引用为 0。
  // 特性写了不接,比不写更坏:它让人以为这机制已经在了。
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const ROOT = new URL('..', import.meta.url).pathname;
  const walk = d => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap(e =>
    e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'tests' || e.name === 'docs'
      ? [] : e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  // ⚠️ 必须**排除 collatz.js 自己** —— 否则它自己的函数定义会被算成「有人用」,
  //    于是「导出了但没人用」这条永远为真地通过,恰好毁掉这条断言的意义。
  const srcs = [...walk('js'), 'sw.js']
    .filter(f => f.endsWith('.js') && !f.endsWith('collatz.js'))
    .map(f => ({ f, s: readFileSync(join(ROOT, f), 'utf8') }));
  const EXPORTS = ['modAt', 'parityAt', 'biasOf', 'runSeedFor'];
  const dead = EXPORTS.filter(name =>
    !srcs.some(({ s }) => s.includes(name + '(') || s.includes(name + ' as ')));
  ok('collatz 的导出在生产代码里都真的有人用', dead.length === 0,
     `零生产引用: ${dead.join(',')}`);

  // ⚠️ 光「函数被调用过」证明不了信号真的**显示出来了** ——
  //    把 HUD 里拼接后缀那一行删掉,hud.js 里的调用还在,上面那条照样绿。
  //    所以这里必须**跑真实的 HUD.update()**,读它写进 DOM 的 textContent。
  //    断言对象是「玩家眼睛看到的那串字」,不是「代码里有没有这个名字」。
  const { HUD } = await import('../js/ui/hud.js');
  const mk = () => {
    const el = {};
    const mkEl = () => ({
      textContent: '', innerHTML: '', style: {}, dataset: {},
      classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      appendChild(){}, append(...a){}, prepend(...a){}, remove(){},
      querySelector:()=>mkEl(), querySelectorAll:()=>[],
      getBoundingClientRect:()=>({ width:100, height:20 }),
      addEventListener(){}, removeEventListener(){}, focus(){},
    });
    globalThis.document = {
      getElementById: id => (el[id] = el[id] || mkEl()),
      querySelector: () => mkEl(), querySelectorAll: () => [],
      createElement: mkEl, addEventListener(){},
      body: { appendChild(){} }, hidden: false,
    };
    globalThis.window = { addEventListener(){}, innerWidth: 400, devicePixelRatio: 2 };
    return el;
  };
  // ⚠️ 桩要满足 HUD.update() 的两个守卫,否则它会**静默 return**,什么都写不进去:
  //     if (!this.visible) return;   → 必须先 show(true)
  //     if (!p || !p.stats) return;  → player 上必须有 stats.maxHp(不是 hpMax)
  const gStub = { time: 0, boss: null,
                  player: { hp: 10, stats: { maxHp: 10 }, xpRatio:()=>0.5, level:1, weapons:[],
                            dashCd:()=>0, dashMax:()=>0, dashOn:()=>false,
                            speed:()=>100, atkCd:()=>0, atkMax:()=>1 },
                  stats: { kills: 0, gold: 0 } };
  const startHud = () => { const els = mk(); HUD.init(gStub); HUD.show(true); return els; };

  S.setCollatzTrajectory(null);
  let el = startHud(); gStub.time = 60; HUD.update();
  const neutralTxt = el['hud-timer'].textContent;
  ok('未激活时计时器只有时间,没有奇偶后缀', /^\d\d:\d\d$/.test(neutralTxt), `实测「${neutralTxt}」`);

  const rH = C.runSeedFor('hud-render-probe');
  S.setCollatzTrajectory(rH.traj);
  el = startHud();
  let sawOdd = false, sawEven = false, lastTxt = '';
  for (let t = 0; t <= (rH.traj.steps + 2) * 20; t += 20) {
    gStub.time = t;
    HUD._sec = -1;                 // 强制重绘计时器
    HUD.update();
    lastTxt = el['hud-timer'].textContent;
    if (/·\s*爆发$/.test(lastTxt)) sawOdd = true;
    if (/·\s*收敛$/.test(lastTxt)) sawEven = true;
  }
  ok('计时器上真的渲染出了「爆发」', sawOdd, `最后渲染「${lastTxt}」`);
  ok('计时器上真的渲染出了「收敛」', sawEven, `最后渲染「${lastTxt}」`);
  S.setCollatzTrajectory(null);

  // biasOf 落在刷怪池档位上:奇数步多的局,重兵来得更早。
  // 这条断言要的是「偏置真的改变了行为」,不是「函数存在」。
  S.setCollatzTrajectory(null);
  const baseTier = [60, 100, 150, 300, 500].map(t => S.poolIdx(t));
  let aggroSeed = null, sustainSeed = null;
  for (let i = 0; i < 400 && (!aggroSeed || !sustainSeed); i++) {
    const r = C.runSeedFor('biaspool-' + i);
    const b = C.biasOf(r.traj);
    if (b === 'aggro' && !aggroSeed) aggroSeed = r;
    if (b === 'sustain' && !sustainSeed) sustainSeed = r;
  }
  ok('找得到 aggro 与 sustain 两种局(样本池够)', !!aggroSeed && !!sustainSeed);
  if (aggroSeed && sustainSeed) {
    const aT = [60, 100, 150, 300, 500].map(t => { S.setCollatzTrajectory(aggroSeed.traj); return S.poolIdx(t); });
    const sT = [60, 100, 150, 300, 500].map(t => { S.setCollatzTrajectory(sustainSeed.traj); return S.poolIdx(t); });
    ok('激进局的重兵档位不早于温和局', aT.every((v, i) => v >= sT[i]), `aggro ${aT} / sustain ${sT}`);
    ok('偏置确实改变了档位(不是接了个寂寞)', aT.some((v, i) => v !== sT[i]), `aggro ${aT} / sustain ${sT}`);
  }
  S.setCollatzTrajectory(null);
  ok('未激活时档位与改动前逐位相同', [60, 100, 150, 300, 500].every((t, i) => S.poolIdx(t) === baseTier[i]),
     `基准 ${baseTier}`);
  ok('未激活时 bias 是空串', S.collatzBias() === '');
  console.log(`     生产引用:${EXPORTS.map(n => `${n}=${srcs.filter(({ s }) => s.includes(n + '(') || s.includes(n + ' as ')).length}`).join(' ')}`);
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (failed.length) { console.log('\n失败明细:'); for (const f of failed) console.log('  ✗ ' + f); }
process.exit(fail ? 1 : 0);