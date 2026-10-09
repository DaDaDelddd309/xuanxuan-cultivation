// 掉落体系模块的测试(XX-DROP-001)
//
// 盯三件事:
//   1. 加权表本身自洽(概率和为 1、每档不越封顶)
//   2. **稀有度随难度单调递增** —— owner 原话「稀有度应该按难度来」
//   3. 保底真的会兜底
// 用固定随机数而不是 Math.random,结果可复现。
import { install } from './harness.mjs';
install();

const L = await import('../js/xiuxian/loot.js');

let pass = 0, fail = 0; const bad = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; bad.push(n + (d ? ' :: ' + d : '')); } };

console.log('\n[1] 权重表自洽');
for (const tier of ['normal', 'elite', 'boss', 'secret']) {
  const w = L.weightTable(tier);
  const sum = w.reduce((a, b) => a + b.pct, 0);
  ok(`${tier} 概率和为 1`, Math.abs(sum - 1) < 0.001, sum.toFixed(4));
  // 只查**被封顶的档**(浓/焦)。低档不设上限 —— 见 loot.js 里的说明:
  // 给低档设 cap 会和"摊回权重"互相踩,实测出现自相矛盾的分布。
  const CAPPED = ['nong', 'jiao'];
  const over = [];
  for (const g of Object.values(L.GRADE)) {
    if (!CAPPED.includes(g.key)) continue;
    const s = w.filter(x => x.grade === g.key).reduce((a, b) => a + b.pct, 0);
    if (s > g.cap + 0.005) over.push(`${g.name}=${(s * 100).toFixed(1)}%>${(g.cap * 100).toFixed(1)}%`);
  }
  ok(`${tier} 每档不越封顶`, over.length === 0, over.join(' '));
}

console.log('\n[2] 稀有度随难度单调递增(owner 的硬要求)');
const rankPct = t => {
  const w = L.weightTable(t), o = {};
  for (const r of w) o[r.grade] = (o[r.grade] || 0) + r.pct;
  return o;
};
const pn = rankPct('normal'), pe = rankPct('elite'), pb = rankPct('boss');
for (const g of ['dan', 'zhong', 'nong', 'jiao']) {
  ok(`精英的「${L.GRADE[g].name}」≥ 普通`, (pe[g] || 0) >= (pn[g] || 0) - 0.0001,
     `普通 ${((pn[g] || 0) * 100).toFixed(2)}% vs 精英 ${((pe[g] || 0) * 100).toFixed(2)}%`);
  ok(`秘窟的「${L.GRADE[g].name}」≥ 精英`, (pb[g] || 0) >= (pe[g] || 0) - 0.0001,
     `精英 ${((pe[g] || 0) * 100).toFixed(2)}% vs 秘窟 ${((pb[g] || 0) * 100).toFixed(2)}%`);
}

console.log('\n[3] 保底真的兜底');
{
  const st = { miss: 0 };
  let got = null;
  for (let i = 0; i < L.PITY.threshold + 5; i++) got = L.roll('boss', st) || got;
  ok(`连空 ${L.PITY.threshold + 5} 次必出货`, got !== null);
  // 必须 >= threshold 才触发保底。写成 threshold-1 是一次都没攒够,
  // 测出来的是普通随机结果,不是保底 —— 第一版就栽在这。
  const st2 = { miss: L.PITY.threshold };
  const g2 = L.roll('boss', st2);
  ok('保底出的不是最差档', g2 && L.GRADE[L.LOOT[g2].grade].rank >= 4, g2 || 'null');
}

console.log('\n[4] EV 随难度递增');
ok('秘窟 EV ≥ 精英 EV', L.ev('boss') >= L.ev('elite') - 0.01,
   `boss ${L.ev('boss').toFixed(1)} vs elite ${L.ev('elite').toFixed(1)}`);


// ══════ 批量掉落(XX-DROP-002:owner 指出逐只掷骰会卡)══════
console.log('\n[5] 表中有表:外层门槛 + 内层权重(XX-DROP-002)');
{
  // 性能:复杂度必须与批量大小无关。owner 原话「一秒死好多怪,逐只算掉率会卡」。
  L.resetGate();
  let t0 = Date.now(); let d = 0;
  for (let i = 0; i < 200; i++) d += L.gateDrop('spirit', 'normal', 100).drops.length;
  const ms = Date.now() - t0;
  ok('20000 只一次算完', ms < 400, `${ms}ms`);
  ok('普通档出货量 = 20000/门槛', Math.abs(d - 20000 / L.GATE.spirit) < 40, `实得 ${d}`);
}
{
  // 精英/Boss 只是**加充能**,不是掉指定物 —— owner 的原话。
  L.resetGate();
  const r1 = L.gateDrop('spirit', 'elite', 16);      // 16 × 8 = 128 > 门槛 125
  ok('精英只加充能,16 只就够门槛', r1.forced === 1, `forced=${r1.forced}`);
  ok('掉什么由权重决定,不是指定', typeof r1.drops[0] === 'string' && L.LOOT[r1.drops[0]],
     r1.drops.join(','));
  L.resetGate();
  const r2 = L.gateDrop('spirit', 'elite', 15);      // 15 × 8 = 120 < 125
  ok('差一点就不出货(门槛真的在门)', r2.forced === 0 && r2.drops.length === 0, JSON.stringify(r2));
}
{
  // 门槛 = 保底(达到必出,不是随机跳过)
  L.resetGate();
  let n = 0;
  for (let i = 0; i < L.GATE.spirit / 8; i++) n += L.gateDrop('spirit', 'elite', 8).forced;
  ok('攒到门槛必出(保底成立)', n >= 1, `${n} 次`);
}
{
  // 进度可查:给 UI 显示「还要再杀多少」
  L.resetGate();
  L.gateDrop('spirit', 'normal', 100);
  ok('门槛进度 0~1', L.gateProgress('spirit') > 0.5 && L.gateProgress('spirit') < 1,
     L.gateProgress('spirit').toFixed(2));
  ok('能算出还差多少只', L.gateRemain('spirit') > 0 && L.gateRemain('spirit') < 200,
     `${L.gateRemain('spirit')} 只`);
}
{
  // 稀有度负向调低:普通档出货里,高档应该极少
  L.resetGate();
  const got = {};
  for (let i = 0; i < 4000; i++) {
    const r = L.gateDrop('spirit', 'normal', 125);
    for (const id of r.drops) { const g = L.LOOT[id].grade; got[g] = (got[g] || 0) + 1; }
  }
  const total = Object.values(got).reduce((a, b) => a + b, 0) || 1;
  const hi = ((got.nong || 0) + (got.jiao || 0)) / total;
  ok('普通档高档(浓/焦)占比 < 6%', hi < 0.06, `${(hi * 100).toFixed(1)}%`);
}
console.log(`\ntest-loot(补): ${fail ? 'FAIL' : 'PASS'}`);

console.log(`\ntest-loot: ${fail ? 'FAIL' : 'PASS'} (${pass}/${pass + fail})`);
if (bad.length) { console.log('失败项:'); bad.forEach(b => console.log('  - ' + b)); }
process.exit(fail ? 1 : 0);
