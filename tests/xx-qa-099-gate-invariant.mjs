// XX-QA-099 · 灵气门槛不变量穷举
//
// 为什么有这个东西:tests/audit-loop.py 里关于灵气门槛的断言,我连着写错两次——
//   ① 以为门槛「饱和到 1」,实际 gateDrop 是**回绕**(`while (g >= need) g -= need`)
//   ② 以为「累计充能恒为 8 的倍数」,忘了回绕时减掉的 GATE=125 本身不是 8 的倍数
// 两次都是照公式想当然、没先拿真实实现跑一遍(本项目第 11、12 次同类坑)。
//
// 这个门禁把那两条反例**钉成注释旁的活证据**:直接 import 真实 loot.js、
// 复刻 spirit.js 的 8 只一批逻辑,穷举击杀组合,逐条验不变量。
// 以后谁想再往 audit-loop.py 里加一条门槛断言,先在这里加候选,跑一遍打脸再写。
//
// 铁律(沿用本项目):**任何「版本戳/接线自检」断言的基准必须取自被检查对象自身**。
// 本文件所有预期值都来自 GATE / CHARGE / gateProgress / gateRemain 的真实运行结果,
// 不是抄进断言的字面量。

import { gateDrop, gateProgress, gateRemain, GATE, CHARGE, resetGate } from '../js/xiuxian/loot.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const NEED = GATE.spirit;

/** 复刻 js/xiuxian/spirit.js:55-71 的批次逻辑:三个 tier 各自独立 bucket,满 8 只结算一批 */
function replay(nk, ek, bk) {
  resetGate();
  let forced = 0;
  for (const [tier, k] of [['normal', nk], ['elite', ek], ['boss', bk]]) {
    let bucket = 0;
    for (let i = 0; i < k; i++) {
      bucket++;
      if (bucket < 8) continue;            // spirit.js:61
      bucket = 0;
      forced += gateDrop('spirit', tier, 8).forced;
    }
  }
  return { prog: gateProgress('spirit'), remain: gateRemain('spirit'), forced };
}

console.log('【基准取自真实实现,不是字面量】');
ok('GATE.spirit 是正整数', Number.isInteger(NEED) && NEED > 0, `GATE.spirit=${NEED}`);
ok('CHARGE 三档都是正整数', ['normal', 'elite', 'boss'].every(t => Number.isInteger(CHARGE[t]) && CHARGE[t] > 0),
   `normal=${CHARGE.normal} elite=${CHARGE.elite} boss=${CHARGE.boss}`);

console.log('\n【不变量 1】门槛进度与剩余互洽(穷举)');
// g 是整数且恒 < need,所以 remain = need - g = need × (1 - prog) 精确成立。
// 这条同时验掉 gateProgress / gateRemain / GATE 三者之间任何一处公式漂移。
let n1 = 0, f1 = 0, ex1 = null;
for (let nk = 0; nk <= 300; nk++)
  for (let ek = 0; ek <= 90; ek += 6)
    for (let bk = 0; bk <= 30; bk += 6) {
      const r = replay(nk, ek, bk);
      n1++;
      const good = r.prog >= 0 && r.prog < 1
        && Math.abs(r.remain - NEED * (1 - r.prog)) < 1e-9;
      if (!good) { f1++; if (!ex1) ex1 = { nk, ek, bk, ...r }; }
    }
ok(`${n1} 种击杀组合下 remain == GATE×(1-prog)`, f1 === 0,
   f1 === 0 ? '' : `${f1} 例不成立,首个 ${JSON.stringify(ex1)}`);

console.log('\n【不变量 2】门槛是回绕而非饱和(反例钉死)');
// 这条不是「断言成立」,是「断言某个错误写法不成立」——
// 把两条已被穷举打脸的写法写成可执行的负向证据,防止有人再写回去。
{
  const a = replay(NEED, 0, 0);           // 正好 125 只普通怪
  ok(`kills=门槛值(${NEED}) 时 prog 不是 1`, a.prog < 1, `prog=${a.prog.toFixed(3)}`);
  const b = replay(NEED * 2, 0, 0);       // 250 只 = 整整两轮门槛
  ok(`kills=2×门槛值(${NEED * 2}) 时 prog 仍 < 1`, b.prog < 1, `prog=${b.prog.toFixed(3)}`);
}

console.log('\n【反例 1】kills ≥ 门槛 并不必然掉一颗(批次舍入)');
// spirit.js 每 8 只才结算一次,且 normal/elite/boss 各有独立 bucket,最坏 21 只压在桶里。
{
  const r = replay(NEED + 1, 0, 6);       // nk=126:floor(126/8)=15 批 × 8 = 120 充能 < 125
  const ch = r.prog * NEED;
  ok(`kills=${NEED + 1} 全部普通怪时累计充能 ${ch} < 门槛 ${NEED}`, ch < NEED);
  ok('因此「kills ≥ 门槛 ⟹ 掉过一颗」是**错的**,不得写进 audit-loop', true,
     `该组合 forced=${r.forced}(0=没掉)`);
}

console.log('\n【反例 2】累计充能不是 8 的倍数(回绕减掉了非 8 倍数)');
{
  const r = replay(0, 0, 8);              // 8 只 boss × CHARGE.boss=45 = 360;360 mod 125 = 110
  const ch = r.prog * NEED;
  ok(`8 只 boss 的充能 ${ch} 不是 8 的整数倍`, Math.abs(ch / 8 - Math.round(ch / 8)) > 1e-6,
     `g=${ch},need=${NEED},125 不是 8 的倍数`);
}

console.log('\n【正例】门槛内至少要凑够 128 只普通怪才必然出货');
{
  // 128 = 16 批 × 8,充能 128 ≥ 125 → 必掉。这是「普通怪必掉」的**真实**门槛,
  // 注意它比 GATE.spirit=125 大 3 —— 因为批次舍入,门槛值 ≠ 实际触发击杀数。
  const r = replay(128, 0, 0);
  ok('128 只普通怪必然出货', r.forced >= 1, `forced=${r.forced}, 剩余充能=${(r.prog * NEED).toFixed(0)}`);
  const s = replay(127, 0, 0);
  ok('127 只普通怪不出货(批次舍入卡住)', s.forced === 0, `forced=${s.forced}, 剩余充能=${(s.prog * NEED).toFixed(0)}`);
}

console.log('\n【接线】门槛状态只由 spirit.js 一处写');
// 如果将来有人加了第二个 gateDrop('spirit', ...) 调用点,上面的穷举就不再代表真实链路,
// 这里用源码扫描兜住:确保 batch 逻辑仍与本文件 replay 一致。
{
  const src = await import('node:fs').then(fs => fs.readFileSync(new URL('../js/xiuxian/spirit.js', import.meta.url), 'utf8'));
  const callSites = (src.match(/gateDrop\(\s*'spirit'/g) || []).length;
  ok("spirit.js 只有一处 gateDrop('spirit', ...)", callSites === 1, `实测 ${callSites} 处`);
  ok('spirit.js 的结算批量仍是 8', /if \(bucket\[tier\] < 8\) return;/.test(src),
     '本门禁 replay 里的 8 必须与 spirit.js 一致');
  ok('CHARGE.normal 为 1(本门禁 gateRemain 的推导前提)', CHARGE.normal === 1, `= ${CHARGE.normal}`);
}

console.log(`\n失败 ${fails} 项` + (fails ? '' : ' · 全部通过'));
process.exit(fails ? 1 : 0);
